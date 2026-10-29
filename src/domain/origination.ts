import { addMonthsISO, compareISO, daysBetween } from './dates';
import { generateSchedule, MONTHS_PER_YEAR } from './interest';
import { approvalAuthority, poolReadiness, type ApprovalAuthority, type Readiness } from './machines';
import { formatPaise, mulRate, sum } from './money';
import { trancheSummaries, type TrancheSummary } from './servicing';
import type { Bps, ID, ISODate, Loan, LoanApplication, LoanPurpose, Member, Paise, Pool, Society, Tranche } from './types';
import {
  memberExposure,
  memberOf,
  nextRemittanceDate,
  poolAsk,
  positionOf,
  societyOf,
  trancheOutstanding,
  userOf,
  type WorldState,
} from './world';

/**
 * Read models for origination: members, applications, pools, and the
 * federation's review of them. Pure functions of the world.
 */

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface LoanQuote {
  readonly amount: Paise;
  readonly tenureMonths: number;
  readonly emi: Paise;
  readonly totalInterest: Paise;
}

/**
 * What a loan would cost the member: the EMI and total interest, from the same
 * schedule generator that will build the real schedule. Undefined for inputs
 * the generator would refuse.
 */
export function quoteLoan(amount: Paise, tenureMonths: number, rateBps: Bps, from: ISODate): LoanQuote | undefined {
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) return undefined;
  try {
    const schedule = generateSchedule({
      loanId: 'quote',
      principal: amount,
      annualBps: rateBps,
      tenureMonths,
      firstDueOn: addMonthsISO(from, 1),
    });
    return { amount, tenureMonths, emi: schedule[0]!.instalment, totalInterest: sum(schedule.map((r) => r.interest)) };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const IN_PROGRESS: ReadonlySet<LoanApplication['status']> = new Set(['SUBMITTED', 'UNDER_APPRAISAL', 'APPROVED', 'POOLED']);

export interface MemberRow {
  readonly member: Member;
  readonly activeLoans: number;
  readonly outstanding: Paise;
  readonly daysPastDue: number;
  readonly inProgress: LoanApplication | undefined;
}

export function memberRegister(state: WorldState, societyId: ID): MemberRow[] {
  return state.members
    .filter((m) => m.societyId === societyId)
    .map((member) => {
      const loans = Object.values(state.loans).filter((l) => l.loan.memberId === member.id && l.loan.status === 'ACTIVE');
      const positions = loans.map((l) => positionOf(state, l.loan.id));
      return {
        member,
        activeLoans: loans.length,
        outstanding: sum(positions.map((p) => p.principalOutstanding)),
        daysPastDue: Math.max(0, ...positions.map((p) => p.daysPastDue)),
        inProgress: state.applications.find((a) => a.memberId === member.id && IN_PROGRESS.has(a.status)),
      };
    })
    .sort((a, b) => a.member.name.localeCompare(b.member.name));
}

export interface MemberProfile {
  readonly member: Member;
  readonly exposure: Paise;
  /** What more the member may borrow before reaching the limit per member. */
  readonly headroom: Paise;
  readonly loans: ReadonlyArray<{ loan: Loan; outstanding: Paise; daysPastDue: number; poolReference: string }>;
  readonly applications: readonly LoanApplication[];
  /** Whether a new application can be taken, and if not, why. */
  readonly canApply: { readonly ok: boolean; readonly reason?: string };
}

export function memberProfile(state: WorldState, memberId: ID): MemberProfile {
  const member = memberOf(state, memberId);
  const exposure = memberExposure(state, member.id);
  const loans = Object.values(state.loans)
    .filter((l) => l.loan.memberId === member.id)
    .map((l) => {
      const position = positionOf(state, l.loan.id);
      return {
        loan: l.loan,
        outstanding: position.principalOutstanding,
        daysPastDue: position.daysPastDue,
        poolReference: state.pools.find((p) => p.id === l.loan.poolId)?.reference ?? '',
      };
    });
  const applications = state.applications
    .filter((a) => a.memberId === member.id)
    .sort((a, b) => compareISO(b.appliedOn, a.appliedOn));
  const open = applications.find((a) => IN_PROGRESS.has(a.status));
  const headroom = Math.max(0, state.policy.maxTicket - exposure);
  const canApply =
    member.status !== 'ACTIVE'
      ? { ok: false, reason: `${member.name} is ${member.status.toLowerCase()}.` }
      : open
        ? { ok: false, reason: `Application ${open.id} is already in progress.` }
        : headroom < state.policy.minTicket
          ? { ok: false, reason: 'Borrowing is already at the limit per member.' }
          : { ok: true };
  return { member, exposure, headroom, loans, applications, canApply };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export type ApplicationStage = 'NEEDS_APPRAISAL' | 'AWAITING_DECISION' | 'READY_TO_POOL' | 'IN_POOL' | 'DISBURSED' | 'REJECTED';

export const STAGE_ORDER: readonly ApplicationStage[] = [
  'NEEDS_APPRAISAL',
  'AWAITING_DECISION',
  'READY_TO_POOL',
  'IN_POOL',
  'DISBURSED',
  'REJECTED',
];

export function stageOf(application: LoanApplication): ApplicationStage {
  switch (application.status) {
    case 'DRAFT':
    case 'SUBMITTED':
      return 'NEEDS_APPRAISAL';
    case 'UNDER_APPRAISAL':
      return 'AWAITING_DECISION';
    case 'APPROVED':
      return application.poolId ? 'IN_POOL' : 'READY_TO_POOL';
    case 'POOLED':
      return 'IN_POOL';
    case 'DISBURSED':
      return 'DISBURSED';
    case 'REJECTED':
      return 'REJECTED';
  }
}

/** The amount an application is about now: decided, else recommended, else asked for. */
export function workingAmount(application: LoanApplication): { amount: Paise; tenureMonths: number } {
  if (application.decision?.outcome === 'APPROVED') {
    return { amount: application.decision.sanctionedAmount, tenureMonths: application.decision.tenureMonths };
  }
  if (application.appraisal && application.appraisal.recommendedAmount > 0) {
    return { amount: application.appraisal.recommendedAmount, tenureMonths: application.requestedTenureMonths };
  }
  return { amount: application.requestedAmount, tenureMonths: application.requestedTenureMonths };
}

export interface ApplicationRow {
  readonly application: LoanApplication;
  readonly memberName: string;
  readonly village: string;
  readonly stage: ApplicationStage;
  readonly amount: Paise;
  readonly tenureMonths: number;
  readonly emi: Paise | undefined;
  /** Who may decide it: by the amount now at stake, against the officer limit. */
  readonly authority: ApprovalAuthority;
  readonly poolReference: string | undefined;
  readonly loanId: ID | undefined;
}

function applicationRow(state: WorldState, application: LoanApplication): ApplicationRow {
  const member = memberOf(state, application.memberId);
  const { amount, tenureMonths } = workingAmount(application);
  const loan = Object.values(state.loans).find((l) => l.loan.applicationId === application.id)?.loan;
  return {
    application,
    memberName: member.name,
    village: member.village,
    stage: stageOf(application),
    amount,
    tenureMonths,
    emi: quoteLoan(amount, tenureMonths, state.policy.retailRateBps, state.clock)?.emi,
    authority: approvalAuthority(amount, state.policy),
    poolReference: state.pools.find((p) => p.id === application.poolId)?.reference,
    loanId: loan?.id,
  };
}

export type ApplicationQueue = Record<ApplicationStage, ApplicationRow[]>;

export function applicationQueue(state: WorldState, societyId: ID): ApplicationQueue {
  const queue = Object.fromEntries(STAGE_ORDER.map((s) => [s, [] as ApplicationRow[]])) as ApplicationQueue;
  for (const application of state.applications) {
    if (application.societyId !== societyId) continue;
    const row = applicationRow(state, application);
    queue[row.stage].push(row);
  }
  for (const stage of STAGE_ORDER) {
    // Oldest first while work is pending; newest first once it is done.
    const done = stage === 'DISBURSED' || stage === 'REJECTED';
    queue[stage].sort((a, b) => compareISO(a.application.appliedOn, b.application.appliedOn) * (done ? -1 : 1));
  }
  return queue;
}

/**
 * RBI's microfinance directions (2022) cap a household's repayments on all its
 * loans at half its monthly income. The appraisal shows the share against it;
 * it informs the decision rather than blocking it.
 */
export const REPAYMENT_CAP_SHARE = 0.5;

export interface RepaymentCapacity {
  readonly monthlyIncome: Paise;
  readonly existingObligations: Paise;
  readonly emi: Paise;
  /** Existing obligations plus this EMI, as a share of monthly income. */
  readonly share: number | undefined;
  readonly withinCap: boolean;
}

export function repaymentCapacity(monthlyIncome: Paise, existingObligations: Paise, emi: Paise): RepaymentCapacity {
  const share = monthlyIncome > 0 ? (existingObligations + emi) / monthlyIncome : undefined;
  return { monthlyIncome, existingObligations, emi, share, withinCap: share !== undefined && share <= REPAYMENT_CAP_SHARE };
}

export interface ApplicationDetail {
  readonly row: ApplicationRow;
  readonly member: Member;
  readonly exposure: Paise;
  readonly requested: LoanQuote | undefined;
  readonly recommended: LoanQuote | undefined;
  /** From the appraisal: what repaying this loan would take out of the monthly income. */
  readonly capacity: RepaymentCapacity | undefined;
  readonly appraisedBy: string | undefined;
  readonly decidedBy: string | undefined;
  readonly pool: Pool | undefined;
}

export function applicationDetail(state: WorldState, applicationId: ID): ApplicationDetail {
  const application = state.applications.find((a) => a.id === applicationId);
  if (!application) throw new Error(`no application ${applicationId}`);
  const row = applicationRow(state, application);
  const rate = state.policy.retailRateBps;
  const requested = quoteLoan(application.requestedAmount, application.requestedTenureMonths, rate, state.clock);
  const recommended = application.appraisal?.recommendedAmount
    ? quoteLoan(application.appraisal.recommendedAmount, application.requestedTenureMonths, rate, state.clock)
    : undefined;
  const capacity = application.appraisal
    ? repaymentCapacity(
        application.appraisal.monthlyIncome,
        application.appraisal.existingObligations,
        (recommended ?? requested)?.emi ?? 0,
      )
    : undefined;
  return {
    row,
    member: memberOf(state, application.memberId),
    exposure: memberExposure(state, application.memberId),
    requested,
    recommended,
    capacity,
    appraisedBy: application.appraisal ? userOf(state, application.appraisal.officerId).name : undefined,
    decidedBy: application.decision ? userOf(state, application.decision.by).name : undefined,
    pool: state.pools.find((p) => p.id === application.poolId),
  };
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

export interface PoolEconomics {
  readonly count: number;
  readonly total: Paise;
  /** Tenure weighted by amount, in months. */
  readonly weightedTenureMonths: number;
  readonly longestTenureMonths: number;
  /** Over the full tenure, if every member pays on schedule. */
  readonly retailInterest: Paise;
  readonly wholesaleInterest: Paise;
  readonly margin: Paise;
  readonly readiness: Readiness;
}

/**
 * What a pool would earn and cost over its life: each loan's real schedule,
 * retail interest on it, and wholesale interest on the same balances under
 * pass-through. The pool builder's one-glance view of the business model.
 */
export function poolEconomics(state: WorldState, applicationIds: readonly ID[]): PoolEconomics {
  const chosen = applicationIds
    .map((id) => state.applications.find((a) => a.id === id))
    .filter((a): a is LoanApplication => a?.decision?.outcome === 'APPROVED');
  let retail = 0;
  let wholesale = 0;
  for (const application of chosen) {
    const { sanctionedAmount, tenureMonths, rateBps } = application.decision!;
    const schedule = generateSchedule({
      loanId: application.id,
      principal: sanctionedAmount,
      annualBps: rateBps,
      tenureMonths,
      firstDueOn: addMonthsISO(state.clock, 1),
    });
    retail += sum(schedule.map((r) => r.interest));
    wholesale += sum(schedule.map((r) => mulRate(r.opening, state.policy.wholesaleRateBps, MONTHS_PER_YEAR)));
  }
  const total = sum(chosen.map((a) => a.decision!.sanctionedAmount));
  return {
    count: applicationIds.length,
    total,
    weightedTenureMonths:
      total > 0 ? sum(chosen.map((a) => a.decision!.sanctionedAmount * a.decision!.tenureMonths)) / total : 0,
    longestTenureMonths: Math.max(0, ...chosen.map((a) => a.decision!.tenureMonths)),
    retailInterest: retail,
    wholesaleInterest: wholesale,
    margin: retail - wholesale,
    readiness: poolReadiness(applicationIds.length, state.policy),
  };
}

export interface PoolRow {
  readonly pool: Pool;
  readonly members: number;
  readonly readiness: Readiness;
  readonly tranche: Tranche | undefined;
}

export function poolList(state: WorldState, societyId: ID): PoolRow[] {
  return state.pools
    .filter((p) => p.societyId === societyId)
    .map((pool) => ({
      pool,
      members: pool.applicationIds.length,
      readiness: poolReadiness(pool.applicationIds.length, state.policy),
      tranche: Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id)?.tranche,
    }))
    .sort((a, b) => compareISO(b.pool.createdOn, a.pool.createdOn));
}

export interface PoolBuilder {
  /** The pool being edited, when continuing an open one. */
  readonly pool: Pool | undefined;
  /** Approved applications free to pool, plus those already in this pool. */
  readonly candidates: readonly ApplicationRow[];
  readonly selectedIds: readonly ID[];
}

export function poolBuilder(state: WorldState, societyId: ID, poolId?: ID): PoolBuilder {
  const pool = poolId ? state.pools.find((p) => p.id === poolId && p.societyId === societyId) : undefined;
  const candidates = state.applications
    .filter(
      (a) =>
        a.societyId === societyId &&
        a.status === 'APPROVED' &&
        (a.poolId === undefined || (pool !== undefined && a.poolId === pool.id)),
    )
    .map((a) => applicationRow(state, a))
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
  return { pool, candidates, selectedIds: pool ? pool.applicationIds : [] };
}

export interface TrailStep {
  readonly on: ISODate;
  readonly label: string;
  readonly by?: string;
  readonly detail?: string;
}

export interface PoolDetail {
  readonly pool: Pool;
  readonly society: Society;
  readonly applications: readonly ApplicationRow[];
  readonly economics: PoolEconomics;
  readonly trail: readonly TrailStep[];
  readonly tranche: Tranche | undefined;
  /**
   * What the members still ask for beyond the sanction. Above zero, the pool
   * must be re-scoped before any drawdown.
   */
  readonly shortfall: Paise;
  /** Pooled applications not yet disbursed. */
  readonly awaitingDisbursement: number;
  /** What the sanction can still lend: sanctioned less already lent. Zero before a sanction. */
  readonly stillToLend: Paise;
}

export function poolDetail(state: WorldState, poolId: ID): PoolDetail {
  const pool = state.pools.find((p) => p.id === poolId);
  if (!pool) throw new Error(`no pool ${poolId}`);
  const tranche = Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id)?.tranche;
  const applications = pool.applicationIds
    .map((id) => state.applications.find((a) => a.id === id)!)
    .map((a) => applicationRow(state, a));

  const trail: TrailStep[] = [{ on: pool.createdOn, label: 'Pool opened' }];
  if (pool.submittedOn) trail.push({ on: pool.submittedOn, label: 'Submitted to the federation' });
  if (pool.rescope) {
    trail.push({
      on: pool.rescope.on,
      label: pool.rescope.method === 'PRO_RATA' ? 'Re-scoped: every loan cut pro rata' : `Re-scoped: ${pool.rescope.removed.length} removed`,
      by: userOf(state, pool.rescope.by).name,
      detail: `from ${formatPaise(pool.rescope.askedBefore)}`,
    });
  }
  if (pool.apexReview) {
    trail.push({
      on: pool.apexReview.on,
      label: pool.apexReview.decision === 'SANCTIONED' ? 'Sanctioned' : 'Declined',
      by: userOf(state, pool.apexReview.officerId).name,
      detail: pool.apexReview.remarks || undefined,
    });
  }
  for (const drawdown of tranche?.drawdowns ?? []) {
    trail.push({ on: drawdown.on, label: 'Drawn down from the federation', detail: formatPaise(drawdown.amount) });
  }
  const paidOut = new Map<ISODate, Paise[]>();
  for (const id of tranche ? state.tranches[tranche.id]!.fundedLoanIds : []) {
    const loan = state.loans[id]!.loan;
    paidOut.set(loan.disbursedOn, [...(paidOut.get(loan.disbursedOn) ?? []), loan.principal]);
  }
  for (const [on, amounts] of paidOut) {
    trail.push({
      on,
      label: `${amounts.length} loan${amounts.length === 1 ? '' : 's'} paid out to members`,
      detail: formatPaise(sum(amounts)),
    });
  }
  // Stable: a drawdown and the loans it funded share a day, drawdown first.
  trail.sort((a, b) => compareISO(a.on, b.on));

  return {
    pool,
    society: societyOf(state, pool.societyId),
    applications,
    economics: poolEconomics(state, pool.applicationIds),
    trail,
    tranche,
    shortfall: tranche ? Math.max(0, poolAsk(state, pool.id) - tranche.sanctionedAmount) : 0,
    awaitingDisbursement: applications.filter((a) => a.application.status === 'POOLED').length,
    stillToLend: tranche
      ? tranche.sanctionedAmount -
        sum(state.tranches[tranche.id]!.fundedLoanIds.map((id) => state.loans[id]!.loan.principal))
      : 0,
  };
}

// ---------------------------------------------------------------------------
// The federation's view
// ---------------------------------------------------------------------------

export interface SocietyTrackRecord {
  readonly openTranches: number;
  readonly sanctionedOpen: Paise;
  readonly outstanding: Paise;
  readonly creditLimit: Paise;
  readonly headroom: Paise;
  readonly remittancesMade: number;
  /** Paid in full on the day it fell due. */
  readonly remittancesOnTime: number;
  /** Past their date and not yet settled. */
  readonly remittancesOverdue: number;
  readonly arrearsCarried: Paise;
  readonly activeLoans: number;
  /** Loans past the grace period, as a share of what members owe: portfolio at risk. */
  readonly atRisk: { readonly loans: number; readonly amount: Paise; readonly share: number; readonly arrears: Paise };
}

export function societyTrackRecord(state: WorldState, societyId: ID): SocietyTrackRecord {
  const society = societyOf(state, societyId);
  const tranches = Object.values(state.tranches).filter((t) => t.tranche.societyId === societyId);
  const open = tranches.filter((t) => t.tranche.status !== 'CLOSED');
  const remittances = tranches.flatMap((t) => t.remittances);
  const sanctionedOpen = sum(open.map((t) => t.tranche.sanctionedAmount));
  const loans = Object.values(state.loans).filter((l) => l.loan.societyId === societyId && l.loan.status === 'ACTIVE');
  const positions = loans.map((l) => positionOf(state, l.loan.id));
  const owed = sum(positions.map((p) => p.principalOutstanding));
  const late = positions.filter((p) => p.daysPastDue > state.policy.graceDays);
  const lateAmount = sum(late.map((p) => p.principalOutstanding));
  const last = (t: (typeof tranches)[number]) => t.remittances.at(-1);
  return {
    openTranches: open.length,
    sanctionedOpen,
    outstanding: sum(open.map(trancheOutstanding)),
    creditLimit: society.creditLimit,
    headroom: society.creditLimit - sanctionedOpen,
    remittancesMade: remittances.length,
    remittancesOnTime: remittances.filter(
      (r) => r.paidOn === r.dueOn && r.interestPaid === r.interestDue && r.principalPaid === r.principalDue,
    ).length,
    remittancesOverdue: open.filter((t) => {
      const next = nextRemittanceDate(state, t.tranche.id);
      return next !== undefined && compareISO(next, state.clock) < 0;
    }).length,
    arrearsCarried: sum(
      open.map((t) => {
        const r = last(t);
        return r ? r.interestDue - r.interestPaid + r.principalDue - r.principalPaid : 0;
      }),
    ),
    activeLoans: loans.length,
    atRisk: {
      loans: late.length,
      amount: lateAmount,
      share: owed > 0 ? lateAmount / owed : 0,
      arrears: sum(late.map((p) => p.totalDueNow)),
    },
  };
}

export interface FundingRequest {
  readonly pool: Pool;
  readonly society: Society;
  readonly members: number;
  readonly waitingDays: number;
}

/** Pools submitted to the federation and not yet decided, oldest first. */
export function fundingRequests(state: WorldState): FundingRequest[] {
  return state.pools
    .filter((p) => p.status === 'SUBMITTED' || p.status === 'UNDER_APEX_REVIEW')
    .map((pool) => ({
      pool,
      society: societyOf(state, pool.societyId),
      members: pool.applicationIds.length,
      waitingDays: pool.submittedOn ? Math.max(0, daysBetween(pool.submittedOn, state.clock)) : 0,
    }))
    .sort((a, b) => b.waitingDays - a.waitingDays);
}

export interface PoolReview {
  readonly detail: PoolDetail;
  readonly track: SocietyTrackRecord;
  readonly composition: {
    readonly purposes: ReadonlyArray<{ purpose: LoanPurpose; count: number; amount: Paise }>;
    readonly smallest: Paise;
    readonly largest: Paise;
  };
  /** The most the federation can sanction: what was asked, within the credit limit. */
  readonly maxSanction: Paise;
}

export function poolReview(state: WorldState, poolId: ID): PoolReview {
  const detail = poolDetail(state, poolId);
  const track = societyTrackRecord(state, detail.pool.societyId);
  const byPurpose = new Map<LoanPurpose, { count: number; amount: Paise }>();
  for (const row of detail.applications) {
    const entry = byPurpose.get(row.application.purpose) ?? { count: 0, amount: 0 };
    byPurpose.set(row.application.purpose, { count: entry.count + 1, amount: entry.amount + row.amount });
  }
  const amounts = detail.applications.map((r) => r.amount);
  return {
    detail,
    track,
    composition: {
      purposes: [...byPurpose.entries()]
        .map(([purpose, v]) => ({ purpose, ...v }))
        .sort((a, b) => b.amount - a.amount),
      smallest: amounts.length ? Math.min(...amounts) : 0,
      largest: amounts.length ? Math.max(...amounts) : 0,
    },
    maxSanction: Math.max(0, Math.min(detail.pool.requestedAmount, track.headroom)),
  };
}

export interface SocietyRow {
  readonly society: Society;
  readonly track: SocietyTrackRecord;
  readonly awaitingReview: number;
}

export function apexSocieties(state: WorldState): SocietyRow[] {
  return state.societies.map((society) => ({
    society,
    track: societyTrackRecord(state, society.id),
    awaitingReview: state.pools.filter(
      (p) => p.societyId === society.id && (p.status === 'SUBMITTED' || p.status === 'UNDER_APEX_REVIEW'),
    ).length,
  }));
}

export interface ApexSocietyDetail {
  readonly society: Society;
  readonly track: SocietyTrackRecord;
  readonly tranches: readonly TrancheSummary[];
  readonly pools: readonly PoolRow[];
  /** Every remittance the society has made, newest first, with its punctuality. */
  readonly remittances: ReadonlyArray<{
    readonly sanctionRef: string;
    readonly dueOn: ISODate;
    readonly paidOn: ISODate;
    readonly paid: Paise;
    readonly due: Paise;
    readonly daysLate: number;
  }>;
}

export function apexSocietyDetail(state: WorldState, societyId: ID): ApexSocietyDetail {
  const society = societyOf(state, societyId);
  const remittances = Object.values(state.tranches)
    .filter((t) => t.tranche.societyId === societyId)
    .flatMap((t) =>
      t.remittances.map((r) => ({
        sanctionRef: t.tranche.sanctionRef,
        dueOn: r.dueOn,
        paidOn: r.paidOn,
        paid: r.interestPaid + r.principalPaid,
        due: r.interestDue + r.principalDue,
        daysLate: Math.max(0, daysBetween(r.dueOn, r.paidOn)),
      })),
    )
    .sort((a, b) => compareISO(b.dueOn, a.dueOn));
  return {
    society,
    track: societyTrackRecord(state, societyId),
    tranches: trancheSummaries(state, societyId),
    pools: poolList(state, societyId),
    remittances,
  };
}

// ---------------------------------------------------------------------------
// Disbursement
// ---------------------------------------------------------------------------

export interface DisbursementPlan {
  readonly trancheId: ID;
  /** Pooled applications this tranche funds that are not yet loans. */
  readonly candidates: readonly ApplicationRow[];
  /** Drawn from the federation and not yet lent. */
  readonly idle: Paise;
  readonly undrawn: Paise;
  /** The most that can still be lent: the sanction less what has been lent. */
  readonly capacity: Paise;
  /** The day members on this tranche already pay on, if any do. */
  readonly existingDueDates: readonly ISODate[];
  readonly suggestedFirstDueOn: ISODate;
  /** Set while a sanction below the request waits to be re-scoped; nothing can be drawn till then. */
  readonly rescope:
    | { readonly poolId: ID; readonly reference: string; readonly asked: Paise; readonly sanctioned: Paise }
    | undefined;
}

/** Shortest gap, in days, between disbursing a loan and its first instalment. */
export const MIN_DAYS_TO_FIRST_DUE = 15;

export function disbursementPlan(state: WorldState, trancheId: ID): DisbursementPlan {
  const entry = state.tranches[trancheId];
  if (!entry) throw new Error(`no tranche ${trancheId}`);
  const { tranche } = entry;
  const lent = sum(entry.fundedLoanIds.map((id) => state.loans[id]!.loan.principal));
  const drawn = sum(tranche.drawdowns.map((d) => d.amount));
  const candidates = state.applications
    .filter((a) => a.poolId === tranche.poolId && a.status === 'POOLED')
    .map((a) => applicationRow(state, a))
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
  const dates = new Set<ISODate>();
  for (const id of entry.fundedLoanIds) for (const row of state.loans[id]!.schedule) dates.add(row.dueOn);
  const existingDueDates = [...dates].sort(compareISO).filter((d) => compareISO(d, state.clock) > 0);
  // Join the tranche's existing collection day when it leaves the member a
  // fair first month; otherwise a month from today.
  const aligned = existingDueDates.find((d) => daysBetween(state.clock, d) >= MIN_DAYS_TO_FIRST_DUE);
  return {
    trancheId,
    candidates,
    idle: drawn - lent,
    undrawn: tranche.sanctionedAmount - drawn,
    capacity: tranche.sanctionedAmount - lent,
    existingDueDates,
    suggestedFirstDueOn: aligned ?? addMonthsISO(state.clock, 1),
    rescope:
      poolAsk(state, tranche.poolId) > tranche.sanctionedAmount
        ? {
            poolId: tranche.poolId,
            reference: state.pools.find((p) => p.id === tranche.poolId)!.reference,
            asked: poolAsk(state, tranche.poolId),
            sanctioned: tranche.sanctionedAmount,
          }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Re-scoping an under-sanctioned pool
// ---------------------------------------------------------------------------

export interface RescopeLine {
  readonly applicationId: ID;
  readonly amount: Paise;
}

/**
 * Every member's amount cut by the same proportion to fit the sanction,
 * rounded down to the rupee so the pool never asks for more than it got.
 */
export function proRataRescope(lines: readonly RescopeLine[], sanctioned: Paise): RescopeLine[] {
  const asked = sum(lines.map((l) => l.amount));
  if (asked <= sanctioned) return [...lines];
  return lines.map((l) => ({
    applicationId: l.applicationId,
    amount: Math.floor((l.amount * sanctioned) / asked / 100) * 100,
  }));
}
