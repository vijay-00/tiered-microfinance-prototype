import {
  apexSocieties,
  apexSocietyDetail,
  applicationDetail,
  disbursementPlan,
  applicationQueue,
  fundingRequests,
  memberProfile,
  memberRegister,
  poolBuilder,
  poolDetail,
  poolList,
  poolReview,
  type ApexSocietyDetail,
  type ApplicationDetail,
  type ApplicationQueue,
  type DisbursementPlan,
  type FundingRequest,
  type MemberProfile,
  type MemberRow,
  type PoolBuilder,
  type PoolDetail,
  type PoolReview,
  type PoolRow,
  type SocietyRow,
} from '@/domain/origination';
import {
  federationHome,
  federationSocietyDetail,
  federationTrends,
  fundingDesk,
  type FederationHome,
  type FederationSocietyDetail,
  type FederationTrends,
  type FundingDesk,
} from '@/domain/federation';
import type { AccountCode } from '@/domain/ledger';
import {
  ageingReport,
  apexOverview,
  collectionDues,
  collectionEfficiency,
  inceptionOf,
  ledgerTrace,
  marginAnalysis,
  periodPresets,
  poolPerformance,
  societyDashboard,
  statementsFor,
  tAccountView,
  trialBalanceOf,
  type AgeingReport,
  type ApexOverview,
  type CollectionDue,
  type CollectionMonth,
  type LedgerQuery,
  type LedgerTrace,
  type MarginAnalysis,
  type Period,
  type PoolPerformance,
  type SocietyDashboard,
  type Statements,
  type TAccountView,
} from '@/domain/reporting';
import type { DateRange, TrialBalance } from '@/domain/statements';
import {
  collectionsOn,
  collectionsQueue,
  loanDetail,
  memberLoanDetail,
  trancheDetail,
  trancheSummaries,
  type CollectionsQueue,
  type CollectionTotals,
  type LoanDetail,
  type MemberLoanDetail,
  type TrancheDetail,
  type TrancheSummary,
} from '@/domain/servicing';
import type { ID, ISODate, Paise } from '@/domain/types';
import {
  apexExposure,
  memberLoans,
  societySummary,
  type ExposureRow,
  type MemberLoanView,
  type SocietySummary,
} from '@/domain/views';
import type { AppStore } from '@/store/appStore';
import type { WorldEvent } from '@/domain/world';
import {
  applicationEvent,
  appraisalEvent,
  decisionEvent,
  drawAndDisburseEvents,
  dueTodayEvents,
  paymentEvent,
  remittanceEvent,
  rescopeEvent,
  sanctionEvent,
  savePoolEvents,
  type AppraiseInput,
  type DecideInput,
  type DrawAndDisburseInput,
  type RecordPaymentInput,
  type RecordRemittanceInput,
  type RescopeInput,
  type SanctionInput,
  type SavePoolInput,
  type SubmitApplicationInput,
} from '@/store/commands';

/**
 * The seam for a future backend. Every read and every write the screens make
 * goes through a repository that returns a promise and takes 150 to 400 ms, so
 * the UI is built with real loading and pending states from the start.
 * Swapping this in-memory version for one that calls `fetch` should not touch
 * a single component.
 *
 * The exceptions are the previews computed in the browser as the user types or
 * ticks: the payment split in the drawer and the pool builder's economics. The
 * engine is shared code, and a round trip per keystroke would make both
 * unusable.
 */

export interface Latency {
  min: number;
  max: number;
}

export const DEFAULT_LATENCY: Latency = { min: 150, max: 400 };

function wait(latency: Latency): Promise<void> {
  const ms = latency.min + Math.random() * (latency.max - latency.min);
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export type CommandResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface CollectionsDesk {
  queue: CollectionsQueue;
  today: CollectionTotals;
}

export interface Repositories {
  society: {
    getSummary(societyId: ID): Promise<SocietySummary>;
    getDashboard(societyId: ID): Promise<SocietyDashboard>;
  };
  ledger: {
    getTrace(societyId: ID, query: LedgerQuery): Promise<LedgerTrace>;
    getTAccount(societyId: ID, code: AccountCode, range: DateRange): Promise<TAccountView>;
    getTrialBalance(societyId: ID, asOf: ISODate): Promise<TrialBalance>;
    getPeriods(societyId: ID): Promise<Period[]>;
    getStatements(societyId: ID, range: { from: ISODate; to: ISODate }): Promise<Statements>;
  };
  reports: {
    getMargin(societyId: ID): Promise<MarginAnalysis>;
    getAgeing(societyId: ID): Promise<AgeingReport>;
    getCollections(societyId: ID): Promise<CollectionMonth[]>;
    getCollectionDues(societyId: ID, range: { from: ISODate; to: ISODate }): Promise<CollectionDue[]>;
    getPools(societyId: ID): Promise<PoolPerformance[]>;
  };
  apex: {
    getExposure(): Promise<ExposureRow[]>;
    getOverview(): Promise<ApexOverview>;
    getHome(): Promise<FederationHome>;
    getDesk(): Promise<FundingDesk>;
    getSocietyDetail(societyId: ID): Promise<FederationSocietyDetail>;
    getTrends(): Promise<FederationTrends>;
    getRequests(): Promise<FundingRequest[]>;
    getReview(poolId: ID): Promise<PoolReview>;
    beginReview(poolId: ID): Promise<CommandResult>;
    sanction(input: SanctionInput): Promise<CommandResult<{ trancheId: ID; sanctionRef: string }>>;
    decline(poolId: ID, remarks: string): Promise<CommandResult>;
    getSocieties(): Promise<SocietyRow[]>;
    getSociety(societyId: ID): Promise<ApexSocietyDetail>;
  };
  members: {
    list(societyId: ID): Promise<MemberRow[]>;
    getProfile(memberId: ID): Promise<MemberProfile>;
  };
  applications: {
    getQueue(societyId: ID): Promise<ApplicationQueue>;
    getDetail(applicationId: ID): Promise<ApplicationDetail>;
    submit(input: SubmitApplicationInput): Promise<CommandResult<{ applicationId: ID }>>;
    appraise(input: AppraiseInput): Promise<CommandResult>;
    decide(input: DecideInput): Promise<CommandResult>;
  };
  pools: {
    list(societyId: ID): Promise<PoolRow[]>;
    getBuilder(societyId: ID, poolId?: ID): Promise<PoolBuilder>;
    getDetail(poolId: ID): Promise<PoolDetail>;
    /** Saves the selection as a draft, or saves and submits it to the federation. */
    save(input: SavePoolInput, submit: boolean): Promise<CommandResult<{ poolId: ID }>>;
    /** Fits an under-sanctioned pool to its sanction, before any drawdown. */
    rescope(input: RescopeInput): Promise<CommandResult>;
  };
  member: {
    getLoans(memberId: ID): Promise<MemberLoanView[]>;
    getLoan(loanId: ID, memberId: ID): Promise<MemberLoanDetail>;
  };
  collections: {
    getDesk(societyId: ID): Promise<CollectionsDesk>;
    recordAllDueToday(societyId: ID): Promise<CommandResult<{ count: number; amount: Paise }>>;
  };
  loans: {
    getDetail(loanId: ID): Promise<LoanDetail>;
  };
  payments: {
    record(input: RecordPaymentInput): Promise<CommandResult<{ paymentId: ID; receiptNo: string }>>;
  };
  tranches: {
    list(societyId: ID): Promise<TrancheSummary[]>;
    getDetail(trancheId: ID): Promise<TrancheDetail>;
    getDisbursementPlan(trancheId: ID): Promise<DisbursementPlan>;
    drawAndDisburse(input: DrawAndDisburseInput): Promise<CommandResult<{ drawn: Paise; loanIds: ID[] }>>;
  };
  remittances: {
    record(input: RecordRemittanceInput): Promise<CommandResult<{ remittanceId: ID }>>;
  };
}

export function createRepositories(store: AppStore, latency: Latency = DEFAULT_LATENCY): Repositories {
  /** Reads the world as it is when the request is made, as a server would. */
  const respond = async <T>(read: () => T): Promise<T> => {
    const result = read();
    await wait(latency);
    return result;
  };
  const world = () => store.getState().world;
  /** Who is making the request: what a server would take from the session. */
  const actor = () => store.getState().session.userId;
  /**
   * Builds the events from the world as it stands, then dispatches them all
   * or none. A refusal comes back as the reducer worded it.
   */
  const command = async <T extends object>(
    build: () => { events: WorldEvent[]; result: T },
  ): Promise<CommandResult<T>> => {
    await wait(latency);
    try {
      const { events, result } = build();
      const outcome = store.getState().dispatchMany(events, { quiet: true });
      return outcome.ok ? { ok: true, ...result } : outcome;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    society: {
      getSummary: (societyId) => respond(() => societySummary(world(), societyId)),
      getDashboard: (societyId) => respond(() => societyDashboard(world(), societyId)),
    },
    ledger: {
      getTrace: (societyId, query) => respond(() => ledgerTrace(world(), societyId, query)),
      getTAccount: (societyId, code, range) => respond(() => tAccountView(world(), societyId, code, range)),
      getTrialBalance: (societyId, asOf) => respond(() => trialBalanceOf(world(), societyId, asOf)),
      getPeriods: (societyId) => respond(() => periodPresets(world().clock, inceptionOf(world(), societyId))),
      getStatements: (societyId, range) => respond(() => statementsFor(world(), societyId, range)),
    },
    reports: {
      getMargin: (societyId) => respond(() => marginAnalysis(world(), societyId)),
      getAgeing: (societyId) => respond(() => ageingReport(world(), societyId)),
      getCollections: (societyId) => respond(() => collectionEfficiency(world(), societyId)),
      getCollectionDues: (societyId, range) => respond(() => collectionDues(world(), societyId, range)),
      getPools: (societyId) => respond(() => poolPerformance(world(), societyId)),
    },
    apex: {
      getExposure: () => respond(() => apexExposure(world())),
      getOverview: () => respond(() => apexOverview(world())),
      getHome: () => respond(() => federationHome(world())),
      getDesk: () => respond(() => fundingDesk(world())),
      getSocietyDetail: (societyId) => respond(() => federationSocietyDetail(world(), societyId)),
      getTrends: () => respond(() => federationTrends(world())),
      getRequests: () => respond(() => fundingRequests(world())),
      getReview: (poolId) => respond(() => poolReview(world(), poolId)),
      beginReview: (poolId) =>
        command(() => ({
          events: [{ type: 'POOL_STATUS_CHANGED', on: world().clock, poolId, to: 'UNDER_APEX_REVIEW', recordedBy: actor() }],
          result: {},
        })),
      sanction: (input) =>
        command(() => {
          const event = sanctionEvent(world(), input, actor());
          if (event.type !== 'TRANCHE_SANCTIONED') throw new Error('unexpected event');
          return { events: [event], result: { trancheId: event.trancheId, sanctionRef: event.sanctionRef } };
        }),
      decline: (poolId, remarks) =>
        command(() => ({
          events: [{ type: 'POOL_STATUS_CHANGED', on: world().clock, poolId, to: 'DECLINED', remarks, recordedBy: actor() }],
          result: {},
        })),
      getSocieties: () => respond(() => apexSocieties(world())),
      getSociety: (societyId) => respond(() => apexSocietyDetail(world(), societyId)),
    },
    members: {
      list: (societyId) => respond(() => memberRegister(world(), societyId)),
      getProfile: (memberId) => respond(() => memberProfile(world(), memberId)),
    },
    applications: {
      getQueue: (societyId) => respond(() => applicationQueue(world(), societyId)),
      getDetail: (applicationId) => respond(() => applicationDetail(world(), applicationId)),
      submit: (input) =>
        command(() => {
          const event = applicationEvent(world(), input, actor());
          if (event.type !== 'APPLICATION_SUBMITTED') throw new Error('unexpected event');
          return { events: [event], result: { applicationId: event.applicationId } };
        }),
      appraise: (input) => command(() => ({ events: [appraisalEvent(world(), input, actor())], result: {} })),
      decide: (input) => command(() => ({ events: [decisionEvent(world(), input, actor())], result: {} })),
    },
    pools: {
      list: (societyId) => respond(() => poolList(world(), societyId)),
      getBuilder: (societyId, poolId) => respond(() => poolBuilder(world(), societyId, poolId)),
      getDetail: (poolId) => respond(() => poolDetail(world(), poolId)),
      save: (input, submit) =>
        command(() => {
          const { poolId, events } = savePoolEvents(world(), input, actor(), submit);
          return { events, result: { poolId } };
        }),
      rescope: (input) => command(() => ({ events: [rescopeEvent(world(), input, actor())], result: {} })),
    },
    member: {
      getLoans: (memberId) => respond(() => memberLoans(world(), memberId)),
      getLoan: (loanId, memberId) => respond(() => memberLoanDetail(world(), loanId, memberId)),
    },
    collections: {
      getDesk: (societyId) =>
        respond(() => ({ queue: collectionsQueue(world(), societyId), today: collectionsOn(world(), societyId) })),
      async recordAllDueToday(societyId) {
        await wait(latency);
        const events = dueTodayEvents(world(), societyId, actor());
        if (events.length === 0) return { ok: false, error: 'Nothing is due today.' };
        const result = store.getState().dispatchMany(events, { quiet: true });
        if (!result.ok) return result;
        const amount = events.reduce((t, e) => t + (e.type === 'PAYMENT_RECEIVED' ? e.amount : 0), 0);
        return { ok: true, count: events.length, amount };
      },
    },
    loans: {
      getDetail: (loanId) => respond(() => loanDetail(world(), loanId)),
    },
    payments: {
      async record(input) {
        await wait(latency);
        try {
          const event = paymentEvent(world(), input, actor());
          const result = store.getState().dispatch(event, { quiet: true });
          if (!result.ok || event.type !== 'PAYMENT_RECEIVED') return result as CommandResult<never>;
          return { ok: true, paymentId: event.paymentId, receiptNo: event.receiptNo };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    tranches: {
      list: (societyId) => respond(() => trancheSummaries(world(), societyId)),
      getDetail: (trancheId) => respond(() => trancheDetail(world(), trancheId)),
      getDisbursementPlan: (trancheId) => respond(() => disbursementPlan(world(), trancheId)),
      drawAndDisburse: (input) =>
        command(() => {
          const { drawn, loanIds, events } = drawAndDisburseEvents(world(), input, actor());
          return { events, result: { drawn, loanIds } };
        }),
    },
    remittances: {
      async record(input) {
        await wait(latency);
        const event = remittanceEvent(world(), input, actor());
        const result = store.getState().dispatch(event, { quiet: true });
        if (!result.ok || event.type !== 'REMITTANCE_RECORDED') return result as CommandResult<never>;
        return { ok: true, remittanceId: event.remittanceId };
      },
    },
  };
}
