import { addMonthsISO, compareISO, daysBetween, financialYearStart, startOfMonth } from './dates';
import { generateSchedule, MONTHS_PER_YEAR } from './interest';
import { mulRate, sum } from './money';
import {
  fundingRequests,
  proRataRescope,
  societyTrackRecord,
  type FundingRequest,
  type SocietyTrackRecord,
} from './origination';
import { trancheDrawn } from './reconciliation';
import { trancheSummaries, type TrancheSummary } from './servicing';
import type { Bps, ID, ISODate, LoanPurpose, Paise, Pool, Society, Tranche, User } from './types';
import {
  nextRemittanceDate,
  poolAsk,
  positionOf,
  remittanceDueFor,
  societyOf,
  trancheOutstanding,
  type TrancheState,
  type WorldState,
} from './world';

/**
 * The federation's read models: its book across societies, its queue of
 * funding requests with the decisions already taken, and each society as a
 * borrower. Pure functions of the world.
 */

export type Punctuality = 'ON_TIME' | 'LATE' | 'SHORT';

/** Paid in full on the day, paid in full but late, or paid short. */
export function punctuality(r: { dueOn: ISODate; paidOn: ISODate; interestDue: Paise; interestPaid: Paise; principalDue: Paise; principalPaid: Paise }): Punctuality {
  if (r.interestPaid < r.interestDue || r.principalPaid < r.principalDue) return 'SHORT';
  return r.paidOn === r.dueOn ? 'ON_TIME' : 'LATE';
}

function societyTranches(state: WorldState, societyId: ID): TrancheState[] {
  return Object.values(state.tranches).filter((t) => t.tranche.societyId === societyId);
}

/** A sanctioned pool whose members still ask for more than the sanction, so nothing can be drawn. */
function needsRescopeNow(state: WorldState, pool: Pool): boolean {
  if (pool.status !== 'SANCTIONED') return false;
  const tranche = Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id)?.tranche;
  return tranche !== undefined && poolAsk(state, pool.id) > tranche.sanctionedAmount;
}

export interface FederationSocietyRow {
  readonly society: Society;
  readonly members: number;
  readonly borrowing: number;
  readonly sanctioned: Paise;
  readonly drawn: Paise;
  readonly undrawn: Paise;
  readonly outstanding: Paise;
  readonly headroom: Paise;
  readonly interestYear: Paise;
  readonly track: SocietyTrackRecord;
  /** Every remittance, oldest first. */
  readonly punctuality: readonly Punctuality[];
  readonly awaitingReview: readonly Pool[];
  readonly rescopePending: readonly Pool[];
  /** The society's most recently submitted pool, if any. */
  readonly latestPool: Pool | undefined;
}

function societyRow(state: WorldState, society: Society, yearFrom: ISODate): FederationSocietyRow {
  const tranches = societyTranches(state, society.id);
  const open = tranches.filter((t) => t.tranche.status !== 'CLOSED');
  const sanctioned = sum(open.map((t) => t.tranche.sanctionedAmount));
  const drawn = sum(open.map((t) => trancheDrawn(t.tranche)));
  const remittances = tranches
    .flatMap((t) => t.remittances)
    .sort((a, b) => compareISO(a.dueOn, b.dueOn));
  const pools = state.pools.filter((p) => p.societyId === society.id);
  const borrowers = new Set(
    Object.values(state.loans)
      .filter((l) => l.loan.societyId === society.id && l.loan.status === 'ACTIVE')
      .map((l) => l.loan.memberId),
  );
  return {
    society,
    members: state.members.filter((m) => m.societyId === society.id && m.status === 'ACTIVE').length,
    borrowing: borrowers.size,
    sanctioned,
    drawn,
    undrawn: sanctioned - drawn,
    outstanding: sum(open.map(trancheOutstanding)),
    headroom: society.creditLimit - sanctioned,
    interestYear: sum(remittances.filter((r) => compareISO(r.paidOn, yearFrom) >= 0).map((r) => r.interestPaid)),
    track: societyTrackRecord(state, society.id),
    punctuality: remittances.map(punctuality),
    awaitingReview: pools.filter((p) => p.status === 'SUBMITTED' || p.status === 'UNDER_APEX_REVIEW'),
    rescopePending: pools.filter((p) => needsRescopeNow(state, p)),
    latestPool: pools
      .filter((p) => p.submittedOn)
      .sort((a, b) => compareISO(b.submittedOn!, a.submittedOn!))[0],
  };
}

export interface FederationHome {
  readonly asOf: ISODate;
  readonly yearFrom: ISODate;
  readonly totals: {
    readonly creditLimit: Paise;
    readonly sanctioned: Paise;
    readonly drawn: Paise;
    readonly undrawn: Paise;
    readonly outstanding: Paise;
    readonly headroom: Paise;
    /** Principal societies paid back this financial year. */
    readonly repaidYear: Paise;
    readonly interestYear: Paise;
    readonly remittancesYear: number;
    readonly onTimeYear: number;
    readonly firstRemittanceYear: ISODate | undefined;
    /** Member loans past grace, across societies. */
    readonly late: { readonly loans: number; readonly principal: Paise; readonly societies: readonly string[] };
  };
  /** Sanctioned and not yet drawn, by society, with re-scope pending where that is why. */
  readonly undrawn: ReadonlyArray<{ readonly society: Society; readonly amount: Paise; readonly rescope: boolean }>;
  readonly requests: readonly FundingRequest[];
  readonly societies: readonly FederationSocietyRow[];
}

export function federationHome(state: WorldState): FederationHome {
  const yearFrom = financialYearStart(state.clock);
  const societies = state.societies.map((s) => societyRow(state, s, yearFrom));
  const remittancesYear = Object.values(state.tranches)
    .flatMap((t) => t.remittances)
    .filter((r) => compareISO(r.paidOn, yearFrom) >= 0)
    .sort((a, b) => compareISO(a.paidOn, b.paidOn));
  const total = (pick: (r: FederationSocietyRow) => Paise) => sum(societies.map(pick));
  return {
    asOf: state.clock,
    yearFrom,
    totals: {
      creditLimit: sum(state.societies.map((s) => s.creditLimit)),
      sanctioned: total((r) => r.sanctioned),
      drawn: total((r) => r.drawn),
      undrawn: total((r) => r.undrawn),
      outstanding: total((r) => r.outstanding),
      headroom: total((r) => r.headroom),
      repaidYear: sum(remittancesYear.map((r) => r.principalPaid)),
      interestYear: sum(remittancesYear.map((r) => r.interestPaid)),
      remittancesYear: remittancesYear.length,
      onTimeYear: remittancesYear.filter((r) => punctuality(r) === 'ON_TIME').length,
      firstRemittanceYear: remittancesYear[0]?.paidOn,
      late: {
        loans: sum(societies.map((r) => r.track.atRisk.loans)),
        principal: sum(societies.map((r) => r.track.atRisk.amount)),
        societies: societies.filter((r) => r.track.atRisk.loans > 0).map((r) => r.society.name),
      },
    },
    undrawn: societies
      .filter((r) => r.undrawn > 0)
      .map((r) => ({ society: r.society, amount: r.undrawn, rescope: r.rescopePending.length > 0 })),
    requests: fundingRequests(state),
    societies,
  };
}

// ---------------------------------------------------------------------------
// The funding desk
// ---------------------------------------------------------------------------

export interface FundingDecision {
  readonly pool: Pool;
  readonly society: Society;
  readonly tranche: Tranche | undefined;
  readonly outcome: 'SANCTIONED' | 'SHORT' | 'DECLINED';
  readonly decidedOn: ISODate;
  /** Days from submission to decision. */
  readonly took: number | undefined;
  readonly sanctioned: Paise;
}

export interface FundingDesk {
  readonly requests: readonly FundingRequest[];
  /** Newest first. */
  readonly decided: readonly FundingDecision[];
  readonly stats: {
    readonly requested: Paise;
    readonly oldestDays: number;
    readonly sanctionedYear: Paise;
    readonly averageDays: number | undefined;
  };
}

export function fundingDesk(state: WorldState): FundingDesk {
  const requests = fundingRequests(state);
  const decided = state.pools
    .filter((p) => p.apexReview)
    .map((pool): FundingDecision => {
      const tranche = Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id)?.tranche;
      const review = pool.apexReview!;
      const sanctioned = tranche?.sanctionedAmount ?? 0;
      return {
        pool,
        society: societyOf(state, pool.societyId),
        tranche,
        outcome:
          review.decision === 'DECLINED' ? 'DECLINED' : sanctioned < (pool.rescope?.askedBefore ?? pool.requestedAmount) ? 'SHORT' : 'SANCTIONED',
        decidedOn: review.on,
        took: pool.submittedOn ? Math.max(0, daysBetween(pool.submittedOn, review.on)) : undefined,
        sanctioned,
      };
    })
    .sort((a, b) => compareISO(b.decidedOn, a.decidedOn));
  const yearFrom = financialYearStart(state.clock);
  const timed = decided.filter((d) => d.took !== undefined);
  return {
    requests,
    decided,
    stats: {
      requested: sum(requests.map((r) => r.pool.requestedAmount)),
      oldestDays: Math.max(0, ...requests.map((r) => r.waitingDays)),
      sanctionedYear: sum(
        Object.values(state.tranches)
          .filter((t) => compareISO(t.tranche.sanctionedOn, yearFrom) >= 0)
          .map((t) => t.tranche.sanctionedAmount),
      ),
      averageDays: timed.length ? sum(timed.map((d) => d.took!)) / timed.length : undefined,
    },
  };
}

/**
 * Interest over the life of a pool's loans if the federation sanctions this
 * amount at this rate: below the request, every loan cut pro rata, as the
 * society would re-scope it.
 */
export function sanctionEconomics(
  state: WorldState,
  poolId: ID,
  amount: Paise,
  wholesaleRateBps: Bps,
): { readonly retail: Paise; readonly wholesale: Paise; readonly margin: Paise } {
  const pool = state.pools.find((p) => p.id === poolId);
  if (!pool) throw new Error(`no batch ${poolId}`);
  const apps = pool.applicationIds.map((id) => state.applications.find((a) => a.id === id)!).filter((a) => a.decision);
  const amounts = new Map(
    proRataRescope(
      apps.map((a) => ({ applicationId: a.id, amount: a.decision!.sanctionedAmount })),
      Math.max(0, amount),
    ).map((l) => [l.applicationId, l.amount]),
  );
  let retail = 0;
  let wholesale = 0;
  for (const a of apps) {
    const principal = amounts.get(a.id)!;
    if (principal <= 0) continue;
    const schedule = generateSchedule({
      loanId: a.id,
      principal,
      annualBps: a.decision!.rateBps,
      tenureMonths: a.decision!.tenureMonths,
      firstDueOn: state.clock,
    });
    retail += sum(schedule.map((r) => r.interest));
    wholesale += sum(schedule.map((r) => mulRate(r.opening, wholesaleRateBps, MONTHS_PER_YEAR)));
  }
  return { retail, wholesale, margin: retail - wholesale };
}

// ---------------------------------------------------------------------------
// One society, as the federation sees it
// ---------------------------------------------------------------------------

export interface FederationRemittance {
  readonly id: ID;
  readonly sanctionRef: string;
  readonly dueOn: ISODate;
  readonly paidOn: ISODate;
  readonly paid: Paise;
  readonly punctuality: Punctuality;
  readonly daysLate: number;
}

export interface FederationSocietyDetail {
  readonly row: FederationSocietyRow;
  readonly secretary: User | undefined;
  /** Principal repaid on every tranche drawn. */
  readonly repaid: Paise;
  readonly firstDrawOn: ISODate | undefined;
  readonly next: { readonly dueOn: ISODate; readonly amount: Paise; readonly sanctionRef: string; readonly inDays: number } | undefined;
  /** Newest first. */
  readonly remittances: readonly FederationRemittance[];
  readonly tranches: readonly TrancheSummary[];
  readonly pools: ReadonlyArray<{ readonly pool: Pool; readonly tranche: Tranche | undefined; readonly rescope: boolean; readonly asked: Paise }>;
}

export function federationSocietyDetail(state: WorldState, societyId: ID): FederationSocietyDetail {
  const society = societyOf(state, societyId);
  const row = societyRow(state, society, financialYearStart(state.clock));
  const tranches = societyTranches(state, societyId);
  let next: FederationSocietyDetail['next'];
  for (const t of tranches) {
    if (t.tranche.status === 'CLOSED') continue;
    const dueOn = nextRemittanceDate(state, t.tranche.id);
    if (!dueOn || (next && compareISO(next.dueOn, dueOn) <= 0)) continue;
    next = {
      dueOn,
      amount: remittanceDueFor(state, t.tranche.id, dueOn).totalDue,
      sanctionRef: t.tranche.sanctionRef,
      inDays: daysBetween(state.clock, dueOn),
    };
  }
  const drawnAll = sum(tranches.map((t) => trancheDrawn(t.tranche)));
  return {
    row,
    secretary: state.users.find((u) => u.societyId === societyId && u.role === 'SECRETARY'),
    repaid: drawnAll - sum(tranches.map(trancheOutstanding)),
    firstDrawOn: tranches.flatMap((t) => t.tranche.drawdowns.map((d) => d.on)).sort(compareISO)[0],
    next,
    remittances: tranches
      .flatMap((t) =>
        t.remittances.map((r) => ({
          id: r.id,
          sanctionRef: t.tranche.sanctionRef,
          dueOn: r.dueOn,
          paidOn: r.paidOn,
          paid: r.interestPaid + r.principalPaid,
          punctuality: punctuality(r),
          daysLate: Math.max(0, daysBetween(r.dueOn, r.paidOn)),
        })),
      )
      .sort((a, b) => compareISO(b.dueOn, a.dueOn)),
    tranches: trancheSummaries(state, societyId),
    pools: state.pools
      .filter((p) => p.societyId === societyId)
      .sort((a, b) => compareISO(b.createdOn, a.createdOn))
      .map((pool) => ({
        pool,
        tranche: Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id)?.tranche,
        rescope: needsRescopeNow(state, pool),
        asked: poolAsk(state, pool.id) || pool.requestedAmount,
      })),
  };
}

// ---------------------------------------------------------------------------
// Trends across the federation, for the charts on its home screen
// ---------------------------------------------------------------------------

export interface FederationTrends {
  /** Each month of the financial year so far, by the date remittances were paid. */
  readonly months: ReadonlyArray<{ readonly month: ISODate; readonly principal: Paise; readonly interest: Paise; readonly remittances: number }>;
  /** Member loans still running, largest outstanding first. */
  readonly purposes: ReadonlyArray<{ readonly purpose: LoanPurpose; readonly outstanding: Paise; readonly loans: number }>;
  /** Interest members paid this year, and how it divided between the federation and the societies. */
  readonly interestSplit: { readonly members: Paise; readonly federation: Paise; readonly societies: Paise };
}

export function federationTrends(state: WorldState): FederationTrends {
  const yearFrom = financialYearStart(state.clock);
  const remittances = Object.values(state.tranches)
    .flatMap((t) => t.remittances)
    .filter((r) => compareISO(r.paidOn, yearFrom) >= 0);
  const months: Array<FederationTrends['months'][number]> = [];
  for (let month = yearFrom; compareISO(month, state.clock) <= 0; month = addMonthsISO(month, 1)) {
    const paid = remittances.filter((r) => startOfMonth(r.paidOn) === month);
    months.push({
      month,
      principal: sum(paid.map((r) => r.principalPaid)),
      interest: sum(paid.map((r) => r.interestPaid)),
      remittances: paid.length,
    });
  }

  const byPurpose = new Map<LoanPurpose, { outstanding: Paise; loans: number }>();
  const loans = Object.values(state.loans);
  for (const entry of loans) {
    if (entry.loan.status !== 'ACTIVE') continue;
    const purpose = state.applications.find((a) => a.id === entry.loan.applicationId)!.purpose;
    const row = byPurpose.get(purpose) ?? { outstanding: 0, loans: 0 };
    byPurpose.set(purpose, { outstanding: row.outstanding + positionOf(state, entry.loan.id).principalOutstanding, loans: row.loans + 1 });
  }

  const members = sum(
    loans.flatMap((entry) =>
      entry.receipts
        .filter((r) => compareISO(r.receivedOn, yearFrom) >= 0)
        .map((r) => r.allocation.currentInterest + r.allocation.overdueInterest),
    ),
  );
  const federation = sum(remittances.map((r) => r.interestPaid));
  return {
    months,
    purposes: [...byPurpose].map(([purpose, v]) => ({ purpose, ...v })).sort((a, b) => b.outstanding - a.outstanding),
    interestSplit: { members, federation, societies: members - federation },
  };
}
