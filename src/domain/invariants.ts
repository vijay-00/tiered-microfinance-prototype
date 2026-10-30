import { compareISO } from './dates';
import { ACCOUNTS } from './ledger';
import { sum } from './money';
import {
  allocationTotal,
  prepaymentsFrom,
  principalPortion,
  trancheDrawn,
  type ReceiptRecord,
  type RemittanceRecord,
} from './reconciliation';
import { balanceSheet, balanceOf, incomeStatement } from './statements';
import type {
  ID,
  ISODate,
  JournalEntry,
  Loan,
  Paise,
  Policy,
  PoolStatus,
  ReconciliationResult,
  ScheduleRow,
  Tranche,
} from './types';

/**
 * The assertions that must hold after every state change. A red invariant is a
 * build-blocking bug, not a warning. In development they run on every action;
 * the invariants panel shows them; the determinism test runs them after each
 * step of a replay, because one that breaks and then self-corrects is still a bug.
 */

export interface WorldReceipt extends ReceiptRecord {
  reconciliation: ReconciliationResult;
}

export interface WorldLoan {
  loan: Loan;
  /** The current schedule: rescheduled after any prepayment. */
  schedule: readonly ScheduleRow[];
  receipts: readonly WorldReceipt[];
  feesCharged: Paise;
}

export interface WorldTranche {
  tranche: Tranche;
  fundedLoanIds: readonly ID[];
  remittances: readonly RemittanceRecord[];
}

export interface WorldPool {
  id: ID;
  applicationIds: readonly ID[];
  status: PoolStatus;
}

export interface World {
  clock: ISODate;
  policy: Policy;
  loans: readonly WorldLoan[];
  tranches: readonly WorldTranche[];
  pools: readonly WorldPool[];
  journal: readonly JournalEntry[];
}

export interface InvariantResult {
  readonly id: number;
  readonly name: string;
  readonly ok: boolean;
  /** Present when the check fails, or when it was skipped and why. */
  readonly detail?: string;
}

export class InvariantViolation extends Error {
  constructor(readonly failures: readonly InvariantResult[]) {
    super(
      `invariant${failures.length === 1 ? '' : 's'} violated:\n` +
        failures.map((f) => `  ${f.id}. ${f.name} - ${f.detail ?? ''}`).join('\n'),
    );
    this.name = 'InvariantViolation';
  }
}

const loanPrincipalOutstanding = (entry: WorldLoan): Paise =>
  entry.loan.principal - sum(entry.receipts.map((r) => principalPortion(r.allocation)));

const loanUnapplied = (entry: WorldLoan): Paise =>
  sum(entry.receipts.map((r) => r.allocation.advance - (r.source === 'ADVANCE' ? r.amount : 0)));

const trancheOutstanding = (entry: WorldTranche): Paise =>
  trancheDrawn(entry.tranche) - sum(entry.remittances.map((r) => r.principalPaid));

function check(id: number, name: string, ok: boolean, detail: () => string): InvariantResult {
  return ok ? { id, name, ok } : { id, name, ok, detail: detail() };
}

export function checkInvariants(world: World): InvariantResult[] {
  const results: InvariantResult[] = [];
  const { journal, loans, tranches, pools, policy } = world;

  // 1
  const unbalanced = journal.filter(
    (entry) => sum(entry.lines.map((l) => l.dr)) !== sum(entry.lines.map((l) => l.cr)),
  );
  results.push(
    check(1, 'Every journal entry balances', unbalanced.length === 0, () =>
      `unbalanced: ${unbalanced.map((e) => e.id).join(', ')}`,
    ),
  );

  // 2
  const sheet = balanceSheet(journal);
  results.push(
    check(2, 'Assets equal liabilities plus equity', sheet.balanced, () =>
      `assets ${sheet.totalAssets}, liabilities ${sheet.totalLiabilities}, equity ${sheet.totalEquity}`,
    ),
  );

  // 3
  const liveLoans = loans.filter((l) => l.loan.status !== 'WRITTEN_OFF');
  const receivableExpected = sum(liveLoans.map(loanPrincipalOutstanding));
  const receivableLedger = balanceOf(journal, ACCOUNTS.LOANS_RECEIVABLE);
  const unappliedExpected = sum(loans.map(loanUnapplied));
  const unappliedLedger = balanceOf(journal, ACCOUNTS.UNAPPLIED_RECEIPTS);
  results.push(
    check(
      3,
      'Member balances on the ledger match the loans',
      receivableExpected === receivableLedger && unappliedExpected === unappliedLedger,
      () =>
        `1100 is ${receivableLedger} against ${receivableExpected} outstanding; ` +
        `2100 is ${unappliedLedger} against ${unappliedExpected} held`,
    ),
  );

  // 4
  const payableExpected = sum(tranches.map(trancheOutstanding));
  const payableLedger = balanceOf(journal, ACCOUNTS.FEDERATION_PAYABLE);
  results.push(
    check(4, 'Federation payable equals tranche balances', payableExpected === payableLedger, () =>
      `2000 is ${payableLedger} against ${payableExpected} owed on tranches`,
    ),
  );

  // 5
  if (policy.reconciliationPolicy === 'PASS_THROUGH') {
    const drifted: string[] = [];
    for (const entry of tranches) {
      const funded = loans.filter((l) => entry.fundedLoanIds.includes(l.loan.id));
      const last = entry.remittances.at(-1);
      const byLastRemittance = (date: ISODate) =>
        last !== undefined && compareISO(date, last.dueOn) <= 0;
      // What members were scheduled to have repaid, plus what they prepaid,
      // by the last remittance date: all of it should have passed through.
      const scheduledOutstanding = sum(
        funded.map(
          (l) =>
            l.loan.principal -
            sum(l.schedule.filter((row) => byLastRemittance(row.dueOn)).map((row) => row.principal)) -
            sum(prepaymentsFrom(l.receipts).filter((p) => byLastRemittance(p.on)).map((p) => p.principal)),
        ),
      );
      const arrears = last ? last.principalDue - last.principalPaid : 0;
      const undrawnFunding = sum(funded.map((l) => l.loan.principal)) - trancheDrawn(entry.tranche);
      const actual = trancheOutstanding(entry);
      if (actual !== scheduledOutstanding + arrears - undrawnFunding) {
        drifted.push(
          `${entry.tranche.id} owes ${actual}, members are scheduled at ${scheduledOutstanding} with ${arrears} arrears`,
        );
      }
    }
    results.push(
      check(5, 'Under pass-through, each tranche tracks its member schedules', drifted.length === 0, () =>
        drifted.join('; '),
      ),
    );
  } else {
    results.push({
      id: 5,
      name: 'Under pass-through, each tranche tracks its member schedules',
      ok: true,
      detail: 'skipped: independent amortisation is in force',
    });
  }

  // 6
  const badSchedules: string[] = [];
  for (const { loan, schedule, receipts } of loans) {
    const prepayments = prepaymentsFrom(receipts);
    let expectedOpening = loan.principal;
    let previousDue: ISODate | undefined;
    for (const row of schedule) {
      // A prepayment made on or after the previous due date and before this
      // one is where the schedule was cut and re-amortised.
      expectedOpening -= sum(
        prepayments
          .filter(
            (p) =>
              (previousDue === undefined || compareISO(p.on, previousDue) >= 0) &&
              compareISO(p.on, row.dueOn) < 0,
          )
          .map((p) => p.principal),
      );
      const consistent =
        row.opening === expectedOpening &&
        row.instalment === row.interest + row.principal &&
        row.closing === row.opening - row.principal;
      if (!consistent) {
        badSchedules.push(`${loan.id} period ${row.period}`);
        break;
      }
      expectedOpening = row.closing;
      previousDue = row.dueOn;
    }
    const accounted =
      sum(schedule.map((row) => row.principal)) + sum(prepayments.map((p) => p.principal));
    if (accounted !== loan.principal) {
      badSchedules.push(`${loan.id} accounts for ${accounted} of ${loan.principal}`);
    }
    // A foreclosure on or after the last kept row is what takes that row's
    // scheduled closing balance to zero.
    const finalBalance =
      expectedOpening -
      sum(
        prepayments
          .filter((p) => previousDue === undefined || compareISO(p.on, previousDue) >= 0)
          .map((p) => p.principal),
      );
    if (finalBalance !== 0) badSchedules.push(`${loan.id} closes at ${finalBalance}, not zero`);
  }
  results.push(
    check(
      6,
      'Every schedule is consistent, closes at zero, and with prepayments accounts for the principal',
      badSchedules.length === 0,
      () => badSchedules.join('; '),
    ),
  );

  // 7
  const misallocated = loans.flatMap((l) =>
    l.receipts.filter((r) => allocationTotal(r.allocation) !== r.amount).map(() => l.loan.id),
  );
  results.push(
    check(7, 'Every receipt allocates exactly its amount', misallocated.length === 0, () =>
      `misallocated receipts on ${[...new Set(misallocated)].join(', ')}`,
    ),
  );

  // 8
  if (!policy.accrualEnabled) {
    const allReceipts = loans.flatMap((l) => l.receipts);
    const receiptMargins = sum(allReceipts.map((r) => r.reconciliation.society.netInterestIncome));
    const sharesAttributed = sum(
      allReceipts.map((r) => r.reconciliation.federation.wholesaleInterestShare),
    );
    const wholesalePaid = sum(tranches.flatMap((t) => t.remittances.map((r) => r.interestPaid)));
    const wholesaleVariance = wholesalePaid - sharesAttributed;
    const ledgerNii = incomeStatement(journal).netInterestIncome;
    results.push(
      check(
        8,
        'Ledger net interest income reconciles to the engine',
        ledgerNii === receiptMargins - wholesaleVariance,
        () =>
          `ledger ${ledgerNii}; receipts report ${receiptMargins} less ${wholesaleVariance} wholesale variance`,
      ),
    );
  } else {
    results.push({
      id: 8,
      name: 'Ledger net interest income reconciles to the engine',
      ok: true,
      detail: 'skipped: accrual basis; income is recognised by accrual, not on receipt',
    });
  }

  // 9
  const seen = new Map<ID, ID>();
  const doubled: string[] = [];
  for (const pool of pools) {
    if (pool.status === 'DECLINED') continue;
    for (const applicationId of pool.applicationIds) {
      const other = seen.get(applicationId);
      if (other !== undefined) doubled.push(`${applicationId} in ${other} and ${pool.id}`);
      seen.set(applicationId, pool.id);
    }
  }
  results.push(
    check(9, 'No application sits in two batches', doubled.length === 0, () => doubled.join('; ')),
  );

  // 10
  const sized: PoolStatus[] = ['READY', 'SUBMITTED', 'UNDER_APEX_REVIEW'];
  const misSized = pools.filter(
    (pool) =>
      sized.includes(pool.status) &&
      (pool.applicationIds.length < policy.poolMinMembers ||
        pool.applicationIds.length > policy.poolMaxMembers),
  );
  results.push(
    check(
      10,
      `Every batch awaiting sanction has ${policy.poolMinMembers} to ${policy.poolMaxMembers} members`,
      misSized.length === 0,
      () => misSized.map((p) => `${p.id} has ${p.applicationIds.length}`).join('; '),
    ),
  );

  // 11
  const overdrawn = tranches.filter((t) => trancheDrawn(t.tranche) > t.tranche.sanctionedAmount);
  results.push(
    check(11, 'No tranche is drawn beyond its sanction', overdrawn.length === 0, () =>
      overdrawn.map((t) => t.tranche.id).join(', '),
    ),
  );

  // 12
  const negative = loans.filter(
    (l) =>
      loanPrincipalOutstanding(l) < 0 ||
      l.schedule.some((row) => row.principal < 0 || row.interest < 0 || row.closing < 0),
  );
  results.push(
    check(12, 'No loan balance or schedule component is negative', negative.length === 0, () =>
      negative.map((l) => l.loan.id).join(', '),
    ),
  );

  return results;
}

export function assertInvariants(world: World): void {
  const failures = checkInvariants(world).filter((result) => !result.ok);
  if (failures.length > 0) throw new InvariantViolation(failures);
}
