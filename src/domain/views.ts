import { compareISO } from './dates';
import { ACCOUNTS, type AccountCode } from './ledger';
import { sum } from './money';
import type { RemittanceDue } from './reconciliation';
import { accountBalances, incomeStatement } from './statements';
import type { Bps, ID, ISODate, LoanStatus, Paise, Society } from './types';
import {
  journalOf,
  nextRemittanceDate,
  positionOf,
  remittanceDueFor,
  trancheOutstanding,
  type WorldState,
} from './world';

/**
 * Read models: the figures each tier's home screen shows, derived from the
 * world on demand. Pure, so they test without a browser and a backend can
 * serve the same shapes later.
 */

export interface DueBucket {
  readonly count: number;
  readonly amount: Paise;
}

export interface NextRemittance {
  readonly trancheId: ID;
  readonly sanctionRef: string;
  readonly dueOn: ISODate;
  readonly due: RemittanceDue;
  /** The date has passed and the society has not settled it. */
  readonly overdue: boolean;
}

export interface SocietySummary {
  readonly societyId: ID;
  readonly asOf: ISODate;
  readonly cash: Paise;
  readonly loansOutstanding: Paise;
  readonly federationPayable: Paise;
  readonly advancesHeld: Paise;
  readonly netInterestIncome: Paise;
  readonly penalFeeIncome: Paise;
  readonly surplus: Paise;
  readonly activeLoans: number;
  readonly closedLoans: number;
  /** Fell due today and not yet paid. */
  readonly dueToday: DueBucket;
  /** Fell due on an earlier day and not yet paid. */
  readonly overdue: DueBucket;
  /** Overdue loans past the grace period, now accruing penal interest. */
  readonly accruingPenal: number;
  readonly nextRemittance: NextRemittance | undefined;
  /** Cash below zero: the society has paid out more than it holds. */
  readonly liquidityBreach: boolean;
}

export function societySummary(state: WorldState, societyId: ID): SocietySummary {
  const journal = journalOf(state, societyId);
  const balances = accountBalances(journal);
  const balance = (code: AccountCode) => balances.get(code)?.balance ?? 0;
  const income = incomeStatement(journal);

  const loans = Object.values(state.loans).filter((l) => l.loan.societyId === societyId);
  const active = loans.filter((l) => l.loan.status === 'ACTIVE');
  let dueToday = { count: 0, amount: 0 };
  let overdue = { count: 0, amount: 0 };
  let accruingPenal = 0;
  for (const entry of active) {
    const position = positionOf(state, entry.loan.id);
    if (position.totalDueNow <= 0) continue;
    if (position.daysPastDue === 0) {
      dueToday = { count: dueToday.count + 1, amount: dueToday.amount + position.totalDueNow };
    } else {
      overdue = { count: overdue.count + 1, amount: overdue.amount + position.totalDueNow };
      if (position.daysPastDue > state.policy.graceDays) accruingPenal += 1;
    }
  }

  let nextRemittance: NextRemittance | undefined;
  for (const entry of Object.values(state.tranches)) {
    if (entry.tranche.societyId !== societyId) continue;
    if (entry.tranche.status === 'CLOSED' || entry.tranche.status === 'SANCTIONED') continue;
    const dueOn = nextRemittanceDate(state, entry.tranche.id);
    if (!dueOn) continue;
    if (nextRemittance && compareISO(nextRemittance.dueOn, dueOn) <= 0) continue;
    nextRemittance = {
      trancheId: entry.tranche.id,
      sanctionRef: entry.tranche.sanctionRef,
      dueOn,
      due: remittanceDueFor(state, entry.tranche.id, dueOn),
      overdue: compareISO(dueOn, state.clock) < 0,
    };
  }

  const cash = balance(ACCOUNTS.CASH);
  return {
    societyId,
    asOf: state.clock,
    cash,
    loansOutstanding: balance(ACCOUNTS.LOANS_RECEIVABLE),
    federationPayable: balance(ACCOUNTS.FEDERATION_PAYABLE),
    advancesHeld: balance(ACCOUNTS.UNAPPLIED_RECEIPTS),
    netInterestIncome: income.netInterestIncome,
    penalFeeIncome: income.penalFeeIncome,
    surplus: income.surplus,
    activeLoans: active.length,
    closedLoans: loans.length - active.length,
    dueToday,
    overdue,
    accruingPenal,
    nextRemittance,
    liquidityBreach: cash < 0,
  };
}

export interface ExposureRow {
  readonly society: Society;
  readonly creditLimit: Paise;
  /** Sanctioned on tranches not yet closed. */
  readonly sanctioned: Paise;
  readonly drawn: Paise;
  readonly outstanding: Paise;
  readonly headroom: Paise;
  readonly openTranches: number;
  /** Tranches whose last remittance date passed without being settled. */
  readonly remittancesOverdue: number;
  readonly awaitingReview: DueBucket;
}

export function apexExposure(state: WorldState): ExposureRow[] {
  return state.societies.map((society) => {
    const tranches = Object.values(state.tranches).filter(
      (t) => t.tranche.societyId === society.id && t.tranche.status !== 'CLOSED',
    );
    const sanctioned = sum(tranches.map((t) => t.tranche.sanctionedAmount));
    const drawn = sum(tranches.map((t) => sum(t.tranche.drawdowns.map((d) => d.amount))));
    const remittancesOverdue = tranches.filter((t) => {
      const next = nextRemittanceDate(state, t.tranche.id);
      return next !== undefined && compareISO(next, state.clock) < 0;
    }).length;
    const reviewing = state.pools.filter(
      (p) => p.societyId === society.id && (p.status === 'SUBMITTED' || p.status === 'UNDER_APEX_REVIEW'),
    );
    return {
      society,
      creditLimit: society.creditLimit,
      sanctioned,
      drawn,
      outstanding: sum(tranches.map(trancheOutstanding)),
      headroom: society.creditLimit - sanctioned,
      openTranches: tranches.length,
      remittancesOverdue,
      awaitingReview: { count: reviewing.length, amount: sum(reviewing.map((p) => p.requestedAmount)) },
    };
  });
}

/**
 * What a member sees of their own loans. The retail rate only: the wholesale
 * rate and the society's margin are not the member's business, and nothing
 * here can leak them.
 */
export interface MemberLoanView {
  readonly loanId: ID;
  readonly principal: Paise;
  readonly rateBps: Bps;
  readonly emi: Paise;
  readonly status: LoanStatus;
  readonly disbursedOn: ISODate;
  readonly outstanding: Paise;
  readonly instalmentsPaid: number;
  readonly instalmentsTotal: number;
  readonly dueNow: Paise;
  readonly daysPastDue: number;
  readonly nextInstalment: { readonly dueOn: ISODate; readonly amount: Paise } | undefined;
}

export function memberLoans(state: WorldState, memberId: ID): MemberLoanView[] {
  return Object.values(state.loans)
    .filter((l) => l.loan.memberId === memberId)
    .map((entry) => {
      const position = positionOf(state, entry.loan.id);
      const upcoming = entry.schedule.find((row) => compareISO(row.dueOn, state.clock) > 0);
      return {
        loanId: entry.loan.id,
        principal: entry.loan.principal,
        rateBps: entry.loan.rateBps,
        emi: entry.loan.emi,
        status: entry.loan.status,
        disbursedOn: entry.loan.disbursedOn,
        outstanding: position.principalOutstanding,
        instalmentsPaid: position.rows.filter((r) => r.interestUnpaid + r.principalUnpaid === 0).length,
        instalmentsTotal: entry.schedule.length,
        dueNow: position.totalDueNow,
        daysPastDue: position.daysPastDue,
        nextInstalment:
          entry.loan.status === 'ACTIVE' && upcoming
            ? { dueOn: upcoming.dueOn, amount: upcoming.instalment }
            : undefined,
      };
    });
}
