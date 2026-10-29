import { addDaysISO, compareISO, daysBetween } from './dates';
import { ACCOUNTS } from './ledger';
import { sum } from './money';
import {
  computeRemittance,
  interestPortion,
  principalPortion,
  reconcileReceipt,
  ReconciliationError,
  remittanceDates,
  trancheDrawn,
  type LoanPosition,
  type ReceiptSource,
  type ReconcileOutput,
  type RemittanceDue,
  type RemittanceRecord,
} from './reconciliation';
import { balanceOf } from './statements';
import type { ID, ISODate, JournalEntry, Loan, Member, Paise, Pool, ScheduleRow, Tranche } from './types';
import {
  fundedLoansOf,
  journalOf,
  loanOf,
  memberOf,
  nextRemittanceDate,
  poolOf,
  positionOf,
  societyOf,
  trancheOf,
  trancheOutstanding,
  userOf,
  type ReceiptEntry,
  type RemittanceEntry,
  type WorldState,
} from './world';

/**
 * Read models and previews for servicing: the collections desk, the payment
 * drawer, loan detail and the tranche screens. Pure functions of the world.
 */

// ---------------------------------------------------------------------------
// Collections desk
// ---------------------------------------------------------------------------

export type CollectionStatus = 'DUE_TODAY' | 'IN_GRACE' | 'OVERDUE' | 'UPCOMING';

export interface CollectionRow {
  readonly loanId: ID;
  readonly memberId: ID;
  readonly memberName: string;
  readonly village: string;
  readonly poolReference: string;
  readonly status: CollectionStatus;
  /** The oldest unpaid due date, or the next one for an upcoming row. */
  readonly dueOn: ISODate;
  readonly daysPastDue: number;
  /** Everything owed now, penal included; the next instalment when upcoming. */
  readonly amountDue: Paise;
  readonly penalDue: Paise;
  readonly emi: Paise;
  readonly advanceHeld: Paise;
}

export interface CollectionsQueue {
  readonly asOf: ISODate;
  readonly dueToday: readonly CollectionRow[];
  /** In grace or past it, oldest first. */
  readonly overdue: readonly CollectionRow[];
  readonly upcoming: readonly CollectionRow[];
  readonly horizonDays: number;
}

export function collectionsQueue(state: WorldState, societyId: ID, horizonDays = 7): CollectionsQueue {
  const horizon = addDaysISO(state.clock, horizonDays);
  const dueToday: CollectionRow[] = [];
  const overdue: CollectionRow[] = [];
  const upcoming: CollectionRow[] = [];

  for (const entry of Object.values(state.loans)) {
    if (entry.loan.societyId !== societyId || entry.loan.status !== 'ACTIVE') continue;
    const position = positionOf(state, entry.loan.id);
    const member = memberOf(state, entry.loan.memberId);
    const base = {
      loanId: entry.loan.id,
      memberId: member.id,
      memberName: member.name,
      village: member.village,
      poolReference: poolOf(state, entry.loan.poolId).reference,
      penalDue: position.penalUnpaid,
      emi: entry.loan.emi,
      advanceHeld: position.unappliedReceipts,
    };

    if (position.totalDueNow > 0) {
      const oldest = position.rows.find(
        (r) => compareISO(r.row.dueOn, state.clock) <= 0 && r.interestUnpaid + r.principalUnpaid > 0,
      );
      const days = position.daysPastDue;
      const row: CollectionRow = {
        ...base,
        status: days === 0 ? 'DUE_TODAY' : days <= state.policy.graceDays ? 'IN_GRACE' : 'OVERDUE',
        dueOn: oldest?.row.dueOn ?? state.clock,
        daysPastDue: days,
        amountDue: position.totalDueNow,
      };
      (days === 0 ? dueToday : overdue).push(row);
      continue;
    }
    const next = entry.schedule.find((r) => compareISO(r.dueOn, state.clock) > 0);
    if (next && compareISO(next.dueOn, horizon) <= 0) {
      upcoming.push({ ...base, status: 'UPCOMING', dueOn: next.dueOn, daysPastDue: 0, amountDue: next.instalment });
    }
  }

  const byName = (a: CollectionRow, b: CollectionRow) => a.memberName.localeCompare(b.memberName);
  return {
    asOf: state.clock,
    dueToday: dueToday.sort(byName),
    overdue: overdue.sort((a, b) => b.daysPastDue - a.daysPastDue || byName(a, b)),
    upcoming: upcoming.sort((a, b) => compareISO(a.dueOn, b.dueOn) || byName(a, b)),
    horizonDays,
  };
}

export interface CollectionTotals {
  readonly date: ISODate;
  readonly receipts: number;
  /** New cash in. Advances being applied are not new cash. */
  readonly cashReceived: Paise;
  readonly appliedFromAdvance: Paise;
  readonly toFederation: Paise;
  readonly wholesaleInterest: Paise;
  readonly principal: Paise;
  /** Net interest income plus penal interest and fees: what the society keeps. */
  readonly retained: Paise;
  readonly margin: Paise;
  readonly penalAndFees: Paise;
  readonly heldAsAdvance: Paise;
}

/** Everything a society collected on one day, split as the engine split it. */
export function collectionsOn(state: WorldState, societyId: ID, date: ISODate = state.clock): CollectionTotals {
  const receipts = Object.values(state.loans)
    .filter((l) => l.loan.societyId === societyId)
    .flatMap((l) => l.receipts)
    .filter((r) => r.receivedOn === date);
  const r = receipts.map((x) => x.reconciliation);
  const margin = sum(r.map((x) => x.society.netInterestIncome));
  const penalAndFees = sum(r.map((x) => x.society.penalIncome + x.society.feeIncome));
  return {
    date,
    receipts: receipts.length,
    cashReceived: sum(receipts.filter((x) => x.source === 'CASH').map((x) => x.amount)),
    appliedFromAdvance: sum(receipts.filter((x) => x.source === 'ADVANCE').map((x) => x.amount)),
    toFederation: sum(r.map((x) => x.federation.remittanceShare)),
    wholesaleInterest: sum(r.map((x) => x.federation.wholesaleInterestShare)),
    principal: sum(r.map((x) => x.federation.principalPassThrough)),
    retained: margin + penalAndFees,
    margin,
    penalAndFees,
    heldAsAdvance: sum(receipts.map((x) => x.allocation.advance)),
  };
}

// ---------------------------------------------------------------------------
// Payment preview
// ---------------------------------------------------------------------------

export interface RescheduleSummary {
  readonly instalmentsLeft: number;
  readonly lastDueOn: ISODate | undefined;
  readonly previousLastDueOn: ISODate | undefined;
  /** Interest the member no longer owes on the months ahead. */
  readonly interestSaved: Paise;
}

export type PaymentPreview =
  | {
      readonly ok: true;
      readonly output: ReconcileOutput;
      readonly position: LoanPosition;
      readonly reschedule: RescheduleSummary | undefined;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly maxAcceptable: Paise | undefined;
      readonly position: LoanPosition;
    };

/**
 * What a payment would do if it were recorded now, computed by the same engine
 * that will record it. The drawer shows this live as the amount is typed.
 */
export function previewPayment(
  state: WorldState,
  loanId: ID,
  input: { amount: Paise; source: ReceiptSource; electPrepayment: boolean },
): PaymentPreview {
  const entry = loanOf(state, loanId);
  const position = positionOf(state, loanId);
  const tranche = trancheOf(state, entry.loan.trancheId).tranche;
  try {
    const output = reconcileReceipt({
      loan: entry.loan,
      schedule: entry.schedule,
      priorReceipts: entry.receipts,
      feesCharged: entry.feesCharged,
      receipt: { ...input, receivedOn: state.clock },
      clock: state.clock,
      wholesaleRateBps: tranche.wholesaleRateBps,
      policy: state.policy,
    });
    let reschedule: RescheduleSummary | undefined;
    if (output.rescheduled) {
      const ahead = (rows: readonly ScheduleRow[]) => rows.filter((r) => compareISO(r.dueOn, state.clock) > 0);
      const before = ahead(entry.schedule);
      const after = ahead(output.rescheduled);
      reschedule = {
        instalmentsLeft: after.length,
        lastDueOn: after.at(-1)?.dueOn,
        previousLastDueOn: before.at(-1)?.dueOn,
        interestSaved: sum(before.map((r) => r.interest)) - sum(after.map((r) => r.interest)),
      };
    }
    return { ok: true, output, position, reschedule };
  } catch (error) {
    if (error instanceof ReconciliationError) {
      const max = error.detail.maxAcceptable;
      return {
        ok: false,
        code: error.code,
        message: error.message,
        maxAcceptable: typeof max === 'number' ? max : undefined,
        position,
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Loan detail
// ---------------------------------------------------------------------------

export type ScheduleStatus = 'PAID' | 'PARTLY_PAID' | 'DUE_TODAY' | 'OVERDUE' | 'UPCOMING';

export interface ScheduleLine {
  readonly row: ScheduleRow;
  readonly status: ScheduleStatus;
  readonly paid: Paise;
  readonly unpaid: Paise;
  readonly daysLate: number;
}

function scheduleLines(state: WorldState, position: LoanPosition): ScheduleLine[] {
  return position.rows.map(({ row, interestUnpaid, principalUnpaid }) => {
    const unpaid = interestUnpaid + principalUnpaid;
    const paid = row.instalment - unpaid;
    const daysLate = Math.max(0, daysBetween(row.dueOn, state.clock));
    let status: ScheduleStatus;
    if (unpaid === 0) status = 'PAID';
    else if (compareISO(row.dueOn, state.clock) > 0) status = 'UPCOMING';
    else if (paid > 0) status = 'PARTLY_PAID';
    else if (row.dueOn === state.clock) status = 'DUE_TODAY';
    else status = 'OVERDUE';
    return { row, status, paid, unpaid, daysLate: unpaid === 0 ? 0 : daysLate };
  });
}

export interface ReceiptLine {
  readonly receipt: ReceiptEntry;
  readonly recordedByName: string;
  readonly journal: JournalEntry | undefined;
}

export interface LoanDetail {
  readonly loan: Loan;
  readonly member: Member;
  readonly pool: Pool;
  readonly tranche: Tranche;
  readonly position: LoanPosition;
  readonly schedule: readonly ScheduleLine[];
  /** A prepayment re-amortised the loan; the original is kept for comparison. */
  readonly rescheduled: boolean;
  readonly originalSchedule: readonly ScheduleRow[];
  /** Newest first. */
  readonly receipts: readonly ReceiptLine[];
  readonly totals: {
    readonly interestPaid: Paise;
    readonly principalPaid: Paise;
    readonly penalPaid: Paise;
    readonly feesPaid: Paise;
    readonly wholesaleShare: Paise;
    readonly marginRetained: Paise;
  };
}

/** The society's view of a loan, including the split of every receipt. */
export function loanDetail(state: WorldState, loanId: ID): LoanDetail {
  const entry = loanOf(state, loanId);
  const position = positionOf(state, loanId);
  const journal = journalOf(state, entry.loan.societyId);
  const receipts = [...entry.receipts].reverse().map((receipt) => ({
    receipt,
    recordedByName: userOf(state, receipt.recordedBy).name,
    journal: journal.find((j) => j.sourceType === 'PAYMENT' && j.sourceId === receipt.id),
  }));
  const r = entry.receipts.map((x) => x.reconciliation);
  return {
    loan: entry.loan,
    member: memberOf(state, entry.loan.memberId),
    pool: poolOf(state, entry.loan.poolId),
    tranche: trancheOf(state, entry.loan.trancheId).tranche,
    position,
    schedule: scheduleLines(state, position),
    rescheduled: entry.schedule !== entry.originalSchedule,
    originalSchedule: entry.originalSchedule,
    receipts,
    totals: {
      interestPaid: sum(entry.receipts.map((x) => interestPortion(x.allocation))),
      principalPaid: sum(entry.receipts.map((x) => principalPortion(x.allocation))),
      penalPaid: sum(entry.receipts.map((x) => x.allocation.penalInterest)),
      feesPaid: sum(entry.receipts.map((x) => x.allocation.fees)),
      wholesaleShare: sum(r.map((x) => x.federation.wholesaleInterestShare)),
      marginRetained: sum(r.map((x) => x.society.netInterestIncome)),
    },
  };
}

export interface MemberPaymentLine {
  readonly id: ID;
  readonly receiptNo: string;
  readonly receivedOn: ISODate;
  readonly amount: Paise;
  readonly mode: ReceiptEntry['mode'];
  readonly towardsInterest: Paise;
  readonly towardsPrincipal: Paise;
  readonly towardsPenalAndFees: Paise;
  readonly heldAsAdvance: Paise;
}

/**
 * The member's view of their own loan: their schedule and how each payment
 * was applied. No wholesale rate, no federation share, no society margin.
 */
export interface MemberLoanDetail {
  readonly loanId: ID;
  readonly principal: Paise;
  readonly rateBps: number;
  readonly emi: Paise;
  readonly status: Loan['status'];
  readonly disbursedOn: ISODate;
  readonly outstanding: Paise;
  readonly dueNow: Paise;
  readonly penalDue: Paise;
  readonly daysPastDue: number;
  readonly rescheduled: boolean;
  readonly schedule: readonly ScheduleLine[];
  readonly payments: readonly MemberPaymentLine[];
}

export class NotYourLoanError extends Error {
  constructor() {
    super('This loan does not belong to you.');
    this.name = 'NotYourLoanError';
  }
}

export function memberLoanDetail(state: WorldState, loanId: ID, memberId: ID): MemberLoanDetail {
  const entry = state.loans[loanId];
  if (!entry || entry.loan.memberId !== memberId) throw new NotYourLoanError();
  const position = positionOf(state, loanId);
  return {
    loanId,
    principal: entry.loan.principal,
    rateBps: entry.loan.rateBps,
    emi: entry.loan.emi,
    status: entry.loan.status,
    disbursedOn: entry.loan.disbursedOn,
    outstanding: position.principalOutstanding,
    dueNow: position.totalDueNow,
    penalDue: position.penalUnpaid,
    daysPastDue: position.daysPastDue,
    rescheduled: entry.schedule !== entry.originalSchedule,
    schedule: scheduleLines(state, position),
    payments: [...entry.receipts].reverse().map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      receivedOn: r.receivedOn,
      amount: r.amount,
      mode: r.mode,
      towardsInterest: interestPortion(r.allocation),
      towardsPrincipal: principalPortion(r.allocation),
      towardsPenalAndFees: r.allocation.penalInterest + r.allocation.fees,
      heldAsAdvance: r.allocation.advance,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tranches and remittances
// ---------------------------------------------------------------------------

export interface TrancheSummary {
  readonly tranche: Tranche;
  readonly poolReference: string;
  readonly fundedLoans: number;
  readonly activeLoans: number;
  readonly drawn: Paise;
  readonly outstanding: Paise;
  readonly next: { readonly dueOn: ISODate; readonly totalDue: Paise; readonly overdue: boolean } | undefined;
}

export function trancheSummaries(state: WorldState, societyId: ID): TrancheSummary[] {
  return Object.values(state.tranches)
    .filter((t) => t.tranche.societyId === societyId)
    .map((entry) => {
      const id = entry.tranche.id;
      const dueOn = entry.tranche.status === 'CLOSED' ? undefined : nextRemittanceDate(state, id);
      const due = dueOn ? computeRemittanceFor(state, id, dueOn) : undefined;
      return {
        tranche: entry.tranche,
        poolReference: poolOf(state, entry.tranche.poolId).reference,
        fundedLoans: entry.fundedLoanIds.length,
        activeLoans: entry.fundedLoanIds.filter((l) => loanOf(state, l).loan.status === 'ACTIVE').length,
        drawn: trancheDrawn(entry.tranche),
        outstanding: trancheOutstanding(entry),
        next:
          dueOn && due
            ? { dueOn, totalDue: due.totalDue, overdue: compareISO(dueOn, state.clock) < 0 }
            : undefined,
      };
    });
}

function computeRemittanceFor(state: WorldState, trancheId: ID, dueOn: ISODate): RemittanceDue {
  const entry = trancheOf(state, trancheId);
  return computeRemittance({
    tranche: entry.tranche,
    fundedLoans: fundedLoansOf(state, trancheId),
    priorRemittances: entry.remittances,
    dueOn,
    policy: state.policy.reconciliationPolicy,
  });
}

function fundedReceipts(state: WorldState, trancheId: ID): ReceiptEntry[] {
  return trancheOf(state, trancheId).fundedLoanIds.flatMap((id) => loanOf(state, id).receipts);
}

export interface RemittancePreview {
  readonly trancheId: ID;
  readonly dueOn: ISODate;
  readonly due: RemittanceDue;
  /** The date has passed and it is unsettled. */
  readonly overdue: boolean;
  /** Only a date that has arrived can be settled. */
  readonly canRecord: boolean;
  /** What members paid since the last remittance date, as the engine split it. */
  readonly collectedSinceLast: {
    readonly receipts: number;
    readonly toFederation: Paise;
    readonly interest: Paise;
    readonly margin: Paise;
  };
  /** What the society must find from its own funds if it pays in full. */
  readonly fromReserves: Paise;
  readonly cashAvailable: Paise;
  readonly cashAfter: Paise;
  readonly liquidityBreach: boolean;
}

/**
 * The remittance screen before it is confirmed: what is owed, what members
 * have paid in towards it, and what the society must cover itself. A shortfall
 * never blocks a remittance; the federation is paid regardless, and showing
 * that pressure is the point.
 */
export function remittancePreview(state: WorldState, trancheId: ID): RemittancePreview | undefined {
  const entry = trancheOf(state, trancheId);
  if (entry.tranche.status === 'CLOSED') return undefined;
  const dueOn = nextRemittanceDate(state, trancheId);
  if (!dueOn) return undefined;
  const due = computeRemittanceFor(state, trancheId, dueOn);
  const since = entry.remittances.at(-1)?.dueOn;
  const receipts = fundedReceipts(state, trancheId).filter(
    (r) => since === undefined || compareISO(r.receivedOn, since) > 0,
  );
  const toFederation = sum(receipts.map((r) => r.reconciliation.federation.remittanceShare));
  const cashAvailable = balanceOf(journalOf(state, entry.tranche.societyId), ACCOUNTS.CASH);
  return {
    trancheId,
    dueOn,
    due,
    overdue: compareISO(dueOn, state.clock) < 0,
    canRecord: compareISO(dueOn, state.clock) <= 0,
    collectedSinceLast: {
      receipts: receipts.length,
      toFederation,
      interest: sum(receipts.map((r) => interestPortion(r.allocation))),
      margin: sum(receipts.map((r) => r.reconciliation.society.netInterestIncome)),
    },
    fromReserves: Math.max(0, due.totalDue - toFederation),
    cashAvailable,
    cashAfter: cashAvailable - due.totalDue,
    liquidityBreach: cashAvailable - due.totalDue < 0,
  };
}

export interface RemittancePeriod {
  readonly remittance: RemittanceEntry;
  readonly recordedByName: string;
  /** Retail interest members paid between the previous remittance date and this one. */
  readonly memberInterest: Paise;
  /** That interest less the wholesale interest paid to the federation for the period. */
  readonly margin: Paise;
  /** What this payment left unpaid, carried into the next period. */
  readonly carriedForward: Paise;
}

export interface ProjectedRemittance {
  readonly dueOn: ISODate;
  readonly opening: Paise;
  readonly interest: Paise;
  readonly principal: Paise;
  readonly total: Paise;
}

export interface TrancheDetail {
  readonly tranche: Tranche;
  readonly pool: Pool;
  readonly societyName: string;
  readonly drawn: Paise;
  readonly undrawn: Paise;
  readonly outstanding: Paise;
  readonly funded: ReadonlyArray<{
    readonly loan: Loan;
    readonly memberName: string;
    readonly outstanding: Paise;
  }>;
  /** Newest first. */
  readonly history: readonly RemittancePeriod[];
  readonly next: RemittancePreview | undefined;
  /** What is left to pay, assuming every member and every remittance is on time. */
  readonly projection: readonly ProjectedRemittance[];
  readonly totals: {
    readonly wholesaleInterestPaid: Paise;
    readonly principalRepaid: Paise;
    readonly memberInterest: Paise;
    readonly marginRetained: Paise;
  };
}

export function trancheDetail(state: WorldState, trancheId: ID): TrancheDetail {
  const entry = trancheOf(state, trancheId);
  const receipts = fundedReceipts(state, trancheId);
  const interestBetween = (after: ISODate | undefined, upTo: ISODate) =>
    sum(
      receipts
        .filter(
          (r) =>
            compareISO(r.receivedOn, upTo) <= 0 && (after === undefined || compareISO(r.receivedOn, after) > 0),
        )
        .map((r) => interestPortion(r.allocation)),
    );

  const history = entry.remittances.map((remittance, i) => {
    const memberInterest = interestBetween(entry.remittances[i - 1]?.dueOn, remittance.dueOn);
    return {
      remittance,
      recordedByName: userOf(state, remittance.recordedBy).name,
      memberInterest,
      margin: memberInterest - remittance.interestPaid,
      carriedForward:
        remittance.interestDue - remittance.interestPaid + remittance.principalDue - remittance.principalPaid,
    };
  });

  // Roll the remaining remittances forward as if everything is paid on time.
  const funded = fundedLoansOf(state, trancheId);
  const last = entry.remittances.at(-1)?.dueOn;
  const prior: RemittanceRecord[] = [...entry.remittances];
  const projection: ProjectedRemittance[] = [];
  if (entry.tranche.status !== 'CLOSED') {
    for (const dueOn of remittanceDates(funded)) {
      if (last !== undefined && compareISO(dueOn, last) <= 0) continue;
      const due = computeRemittance({
        tranche: entry.tranche,
        fundedLoans: funded,
        priorRemittances: prior,
        dueOn,
        policy: state.policy.reconciliationPolicy,
      });
      projection.push({
        dueOn,
        opening: due.trancheOpening,
        interest: due.interestDue,
        principal: due.principalDue,
        total: due.totalDue,
      });
      prior.push({
        dueOn,
        interestDue: due.interestDue,
        principalDue: due.principalDue,
        interestPaid: due.interestDue,
        principalPaid: due.principalDue,
      });
    }
  }

  const drawn = trancheDrawn(entry.tranche);
  const memberInterest = sum(receipts.map((r) => interestPortion(r.allocation)));
  const wholesaleInterestPaid = sum(entry.remittances.map((r) => r.interestPaid));
  return {
    tranche: entry.tranche,
    pool: poolOf(state, entry.tranche.poolId),
    societyName: societyOf(state, entry.tranche.societyId).name,
    drawn,
    undrawn: entry.tranche.sanctionedAmount - drawn,
    outstanding: trancheOutstanding(entry),
    funded: entry.fundedLoanIds.map((id) => {
      const loan = loanOf(state, id).loan;
      return {
        loan,
        memberName: memberOf(state, loan.memberId).name,
        outstanding: positionOf(state, id).principalOutstanding,
      };
    }),
    history: history.reverse(),
    next: remittancePreview(state, trancheId),
    projection,
    totals: {
      wholesaleInterestPaid,
      principalRepaid: sum(entry.remittances.map((r) => r.principalPaid)),
      memberInterest,
      marginRetained: memberInterest - wholesaleInterestPaid,
    },
  };
}
