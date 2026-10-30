import { compareISO } from './dates';
import { ACCOUNTS, type AccountCode } from './ledger';
import { sum } from './money';
import type { RemittanceDue } from './reconciliation';
import { accountBalances, incomeStatement } from './statements';
import type { Bps, ID, ISODate, LoanPurpose, LoanStatus, Paise, Society, User } from './types';
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

/**
 * A member's applications as a tracker: each step from applying to being paid
 * out, with the date it happened. Like the member's loans, it names no
 * wholesale rate and no margin.
 */
export type ApplicationStepKey = 'APPLIED' | 'APPRAISED' | 'DECIDED' | 'SENT' | 'FUNDED' | 'PAID_OUT';

export interface MemberApplicationView {
  readonly applicationId: ID;
  readonly requestedAmount: Paise;
  readonly requestedTenureMonths: number;
  readonly purpose: LoanPurpose;
  readonly appliedOn: ISODate;
  readonly outcome: 'IN_PROGRESS' | 'REJECTED' | 'PAID_OUT';
  /** The amount the society approved, once it has. */
  readonly approvedAmount: Paise | undefined;
  readonly reason: string | undefined;
  readonly loanId: ID | undefined;
  readonly steps: ReadonlyArray<{ readonly key: ApplicationStepKey; readonly on: ISODate | undefined }>;
}

export function memberApplications(state: WorldState, memberId: ID): MemberApplicationView[] {
  return state.applications
    .filter((a) => a.memberId === memberId)
    .sort((a, b) => compareISO(b.appliedOn, a.appliedOn))
    .map((application) => {
      const pool = application.poolId ? state.pools.find((p) => p.id === application.poolId) : undefined;
      const tranche = pool ? Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id)?.tranche : undefined;
      const loan = Object.values(state.loans).find((l) => l.loan.applicationId === application.id)?.loan;
      const rejected = application.decision?.outcome === 'REJECTED';
      return {
        applicationId: application.id,
        requestedAmount: application.requestedAmount,
        requestedTenureMonths: application.requestedTenureMonths,
        purpose: application.purpose,
        appliedOn: application.appliedOn,
        outcome: rejected ? 'REJECTED' : loan ? 'PAID_OUT' : 'IN_PROGRESS',
        approvedAmount: application.decision?.outcome === 'APPROVED' ? application.decision.sanctionedAmount : undefined,
        reason: rejected ? application.decision?.reason : undefined,
        loanId: loan?.id,
        steps: [
          { key: 'APPLIED', on: application.appliedOn },
          { key: 'APPRAISED', on: application.appraisal?.on },
          { key: 'DECIDED', on: application.decision?.on },
          { key: 'SENT', on: pool?.submittedOn },
          { key: 'FUNDED', on: tranche?.sanctionedOn },
          { key: 'PAID_OUT', on: loan?.disbursedOn },
        ],
      };
    });
}

/**
 * Pop-ups for the person viewing. About applications members made
 * themselves: a new proposal for the secretary, who appraises and decides it,
 * and the decision, then the payout, for the member. About the federation's
 * decision on a pool: for everyone it concerns, the society's people, the
 * members whose loans are in it, and the apex officer who made it. Each has a
 * key, so once seen it is not shown again.
 */
export type Notice = ApplicationNotice | PoolNotice;

export interface ApplicationNotice {
  readonly key: string;
  readonly kind: 'PROPOSAL' | 'APPROVED' | 'REJECTED' | 'PAID_OUT';
  readonly applicationId: ID;
  readonly memberName: string;
  readonly amount: Paise;
  readonly purpose: LoanPurpose;
  readonly tenureMonths: number;
  readonly reason: string | undefined;
  readonly loanId: ID | undefined;
}

export interface PoolNotice {
  readonly key: string;
  readonly kind: 'POOL_SANCTIONED' | 'POOL_DECLINED';
  /** Whose view it is written for. */
  readonly audience: 'SOCIETY' | 'MEMBER' | 'APEX';
  readonly poolId: ID;
  readonly poolReference: string;
  readonly societyName: string;
  readonly requested: Paise;
  /** What the federation sanctioned; absent when it declined. */
  readonly tranche:
    | {
        readonly id: ID;
        readonly sanctionRef: string;
        readonly sanctioned: Paise;
        readonly rateBps: number;
        readonly tenureMonths: number;
      }
    | undefined;
  readonly remarks: string;
  /** The viewer can look but not act, e.g. the auditor. */
  readonly readOnly: boolean;
}

function poolNotices(state: WorldState, user: User): PoolNotice[] {
  const notices: PoolNotice[] = [];
  for (const pool of state.pools) {
    const review = pool.apexReview;
    if (!review) continue;
    const audience: PoolNotice['audience'] | undefined =
      user.role === 'APEX_OFFICER'
        ? review.officerId === user.id
          ? 'APEX'
          : undefined
        : user.role === 'MEMBER'
          ? state.applications.some((a) => pool.applicationIds.includes(a.id) && a.memberId === user.memberId)
            ? 'MEMBER'
            : undefined
          : user.societyId === pool.societyId
            ? 'SOCIETY'
            : undefined;
    if (!audience) continue;
    const entry = Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id)?.tranche;
    notices.push({
      // Per person: the demo switches people in one session, and the apex
      // officer closing theirs must not hide the society's.
      key: `pool-${review.decision.toLowerCase()}:${pool.id}:${user.id}`,
      kind: review.decision === 'SANCTIONED' ? 'POOL_SANCTIONED' : 'POOL_DECLINED',
      audience,
      poolId: pool.id,
      poolReference: pool.reference,
      societyName: state.societies.find((s) => s.id === pool.societyId)?.name ?? pool.societyId,
      requested: pool.requestedAmount,
      tranche: entry
        ? {
            id: entry.id,
            sanctionRef: entry.sanctionRef,
            sanctioned: entry.sanctionedAmount,
            rateBps: entry.wholesaleRateBps,
            tenureMonths: entry.tenureMonths,
          }
        : undefined,
      remarks: review.remarks,
      readOnly: user.role === 'AUDITOR',
    });
  }
  return notices;
}

export function noticesFor(state: WorldState, userId: ID): Notice[] {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return [];
  // In the order things happen: proposals and decisions, then the
  // federation's word on the pool, then the payout.
  const notices: Notice[] = [];
  const paidOut: Notice[] = [];
  for (const a of state.applications) {
    if (!a.selfApplied) continue;
    const member = state.members.find((m) => m.id === a.memberId);
    const base = {
      applicationId: a.id,
      memberName: member?.name ?? a.memberId,
      amount: a.decision?.outcome === 'APPROVED' ? a.decision.sanctionedAmount : a.requestedAmount,
      purpose: a.purpose,
      tenureMonths: a.decision?.tenureMonths ?? a.requestedTenureMonths,
      reason: a.decision?.reason,
      loanId: undefined,
    };
    if (user.role === 'SECRETARY' && user.societyId === a.societyId && a.status === 'SUBMITTED') {
      notices.push({ ...base, key: `proposal:${a.id}`, kind: 'PROPOSAL' });
    }
    if (user.role === 'MEMBER' && user.memberId === a.memberId && a.decision) {
      notices.push({ ...base, key: `decision:${a.id}`, kind: a.decision.outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED' });
      const loan = Object.values(state.loans).find((l) => l.loan.applicationId === a.id)?.loan;
      if (loan) paidOut.push({ ...base, key: `paid:${a.id}`, kind: 'PAID_OUT', amount: loan.principal, loanId: loan.id });
    }
  }
  return [...notices, ...poolNotices(state, user), ...paidOut];
}
