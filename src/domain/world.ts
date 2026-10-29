import { z } from 'zod';
import { compareISO } from './dates';
import { generateSchedule } from './interest';
import {
  checkInvariants,
  type InvariantResult,
  type World,
  type WorldLoan,
  type WorldReceipt,
  type WorldTranche,
} from './invariants';
import {
  disbursementEntry,
  drawdownEntry,
  openingReservesEntry,
  periodCloseEntry,
  receiptEntry,
  remittanceEntry,
  type AccountCode,
  type EntryHeader,
} from './ledger';
import {
  applicationMachine,
  approvalAuthority,
  assertTransition,
  loanMachine,
  needsRescope,
  poolMachine,
  poolReadiness,
  trancheMachine,
} from './machines';
import { formatPaise, sum } from './money';
import { ACTION_VERBS, APEX_ACTIONS, can, type Action } from './permissions';
import {
  computeRemittance,
  loanPosition,
  prepaymentsFrom,
  reconcileReceipt,
  remittanceDates,
  trancheDrawn,
  type FundedLoan,
  type LoanPosition,
  type RemittanceDue,
  type RemittanceRecord,
} from './reconciliation';
import { accountBalances } from './statements';
import {
  bpsSchema,
  idSchema,
  isoDateSchema,
  loanPurposeSchema,
  paiseSchema,
  paymentModeSchema,
  poolStatusSchema,
  type Federation,
  type ID,
  type ISODate,
  type JournalEntry,
  type LoanApplication,
  type Member,
  type Paise,
  type PaymentMode,
  type Policy,
  type Pool,
  type ScheduleRow,
  type Society,
  type Tranche,
  type User,
} from './types';

/**
 * The world, event-sourced. Every change to the app's financial state is an
 * event; applyEvent is the one pure function that turns the world before an
 * event into the world after it. The seed is a base world plus an event log,
 * persistence saves only the events a user added, and reset is a replay.
 *
 * Each event carries facts, not intents: a payment records the amount that
 * arrived, not "whatever was due". So a replay is exact, and an event that
 * would no longer be valid fails loudly instead of quietly meaning something
 * else.
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const on = isoDateSchema;

export const worldEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CLOCK_ADVANCED'), to: isoDateSchema }),
  z.object({
    type: z.literal('RESERVES_OPENED'),
    on,
    societyId: idSchema,
    amount: paiseSchema.positive(),
  }),
  z.object({
    type: z.literal('APPLICATION_SUBMITTED'),
    on,
    applicationId: idSchema,
    memberId: idSchema,
    requestedAmount: paiseSchema.positive(),
    requestedTenureMonths: z.number().int().positive(),
    purpose: loanPurposeSchema,
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('APPLICATION_APPRAISED'),
    on,
    applicationId: idSchema,
    monthlyIncome: paiseSchema.nonnegative(),
    existingObligations: paiseSchema.nonnegative(),
    /** Zero recommends rejection. */
    recommendedAmount: paiseSchema.nonnegative(),
    notes: z.string(),
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('APPLICATION_DECIDED'),
    on,
    applicationId: idSchema,
    outcome: z.enum(['APPROVED', 'REJECTED']),
    sanctionedAmount: paiseSchema.nonnegative(),
    tenureMonths: z.number().int().positive(),
    reason: z.string().optional(),
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('POOL_CREATED'),
    on,
    poolId: idSchema,
    reference: z.string().min(1),
    applicationIds: z.array(idSchema),
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('POOL_APPLICATIONS_SET'),
    on,
    poolId: idSchema,
    applicationIds: z.array(idSchema),
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('POOL_STATUS_CHANGED'),
    on,
    poolId: idSchema,
    to: poolStatusSchema,
    /** The secretary submitting, or the apex officer reviewing or declining. */
    recordedBy: idSchema,
    remarks: z.string().optional(),
  }),
  z.object({
    type: z.literal('POOL_RESCOPED'),
    on,
    poolId: idSchema,
    /**
     * PRO_RATA keeps every member at a reduced amount; REMOVE keeps some
     * members at their full amounts. Either way the pool must then fit its
     * sanction.
     */
    method: z.enum(['PRO_RATA', 'REMOVE']),
    keep: z.array(z.object({ applicationId: idSchema, amount: paiseSchema.positive() })).min(1),
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('TRANCHE_SANCTIONED'),
    on,
    trancheId: idSchema,
    poolId: idSchema,
    sanctionRef: z.string().min(1),
    sanctionedAmount: paiseSchema.positive(),
    wholesaleRateBps: bpsSchema,
    tenureMonths: z.number().int().positive(),
    remarks: z.string(),
    /** The apex officer who sanctioned it. */
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('TRANCHE_DRAWN'),
    on,
    trancheId: idSchema,
    amount: paiseSchema.positive(),
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('LOAN_DISBURSED'),
    on,
    loanId: idSchema,
    applicationId: idSchema,
    trancheId: idSchema,
    firstDueOn: isoDateSchema,
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('FEE_CHARGED'),
    on,
    loanId: idSchema,
    amount: paiseSchema.positive(),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal('PAYMENT_RECEIVED'),
    on,
    paymentId: idSchema,
    loanId: idSchema,
    amount: paiseSchema.positive(),
    mode: paymentModeSchema,
    receiptNo: z.string().min(1),
    source: z.enum(['CASH', 'ADVANCE']),
    electPrepayment: z.boolean(),
    /** The user who recorded it: a loan officer or secretary of the loan's society. */
    recordedBy: idSchema,
  }),
  z.object({
    type: z.literal('REMITTANCE_RECORDED'),
    on,
    remittanceId: idSchema,
    trancheId: idSchema,
    /** The remittance date the payment settles; `on` is when it was paid. */
    dueOn: isoDateSchema,
    interestPaid: paiseSchema.nonnegative(),
    principalPaid: paiseSchema.nonnegative(),
    /** The secretary of the tranche's society who recorded it. */
    recordedBy: idSchema,
  }),
  z.object({ type: z.literal('PERIOD_CLOSED'), on, societyId: idSchema }),
]);

export type WorldEvent = z.infer<typeof worldEventSchema>;
export type WorldEventType = WorldEvent['type'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ReceiptEntry extends WorldReceipt {
  readonly id: ID;
  readonly mode: PaymentMode;
  readonly receiptNo: string;
  readonly electPrepayment: boolean;
  readonly recordedBy: ID;
}

export interface LoanState extends WorldLoan {
  /** As disbursed, before any prepayment rescheduled it. */
  readonly originalSchedule: readonly ScheduleRow[];
  readonly receipts: readonly ReceiptEntry[];
}

export interface RemittanceEntry extends RemittanceRecord {
  readonly id: ID;
  readonly paidOn: ISODate;
  readonly recordedBy: ID;
  /** What was owed when it was settled, frozen as a receipt's split is. */
  readonly due: RemittanceDue;
}

export interface TrancheState extends WorldTranche {
  readonly remittances: readonly RemittanceEntry[];
}

/** Everything that is not financial history: who exists, before anything happened. */
export interface WorldBase {
  clock: ISODate;
  policy: Policy;
  federation: Federation;
  societies: readonly Society[];
  users: readonly User[];
  members: readonly Member[];
  applications: readonly LoanApplication[];
  pools: readonly Pool[];
}

export interface WorldState extends WorldBase {
  readonly loans: Readonly<Record<ID, LoanState>>;
  /** Insertion order is creation order, so iteration is deterministic. */
  readonly tranches: Readonly<Record<ID, TrancheState>>;
  /** One set of books per society. The federation keeps none here. */
  readonly journals: Readonly<Record<ID, readonly JournalEntry[]>>;
  readonly eventCount: number;
  readonly entrySeq: number;
}

export function createWorld(base: WorldBase): WorldState {
  const journals: Record<ID, readonly JournalEntry[]> = {};
  for (const society of base.societies) journals[society.id] = [];
  return { ...base, loans: {}, tranches: {}, journals, eventCount: 0, entrySeq: 0 };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type WorldErrorCode =
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'DATE'
  | 'INVALID_STATE'
  | 'OVER_LIMIT'
  | 'NOTHING_TO_CLOSE'
  | 'NOT_PERMITTED';

export class WorldError extends Error {
  constructor(
    readonly code: WorldErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorldError';
  }
}

export class ReplayError extends Error {
  constructor(
    readonly index: number,
    readonly event: WorldEvent,
    readonly cause: unknown,
  ) {
    super(
      `event ${index} (${event.type}) could not be applied: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ReplayError';
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function notFound(kind: string, id: ID): never {
  throw new WorldError('NOT_FOUND', `no ${kind} ${id}`);
}

export function societyOf(state: WorldState, id: ID): Society {
  return state.societies.find((s) => s.id === id) ?? notFound('society', id);
}

export function poolOf(state: WorldState, id: ID): Pool {
  return state.pools.find((p) => p.id === id) ?? notFound('pool', id);
}

export function applicationOf(state: WorldState, id: ID): LoanApplication {
  return state.applications.find((a) => a.id === id) ?? notFound('application', id);
}

export function memberOf(state: WorldState, id: ID): Member {
  return state.members.find((m) => m.id === id) ?? notFound('member', id);
}

export function userOf(state: WorldState, id: ID): User {
  return state.users.find((u) => u.id === id) ?? notFound('user', id);
}

export function loanOf(state: WorldState, id: ID): LoanState {
  return state.loans[id] ?? notFound('loan', id);
}

export function trancheOf(state: WorldState, id: ID): TrancheState {
  return state.tranches[id] ?? notFound('tranche', id);
}

export function journalOf(state: WorldState, societyId: ID): readonly JournalEntry[] {
  return state.journals[societyId] ?? notFound('journal for society', societyId);
}

// ---------------------------------------------------------------------------
// Helpers for the reducer
// ---------------------------------------------------------------------------

/**
 * The actor exists and their role may do this. Society actions must also be
 * for the actor's own society; apex actions are taken for the federation.
 */
function requireActor(state: WorldState, userId: ID, action: Action, societyId?: ID): User {
  const user = userOf(state, userId);
  if (!can(user.role, action)) {
    throw new WorldError('NOT_PERMITTED', `${user.name} cannot ${ACTION_VERBS[action]} as a ${user.title}`);
  }
  if (!APEX_ACTIONS.has(action) && user.societyId !== societyId) {
    throw new WorldError('NOT_PERMITTED', `${user.name} cannot ${ACTION_VERBS[action]} for another society`);
  }
  return user;
}

/** An application still on its way to becoming a loan. */
const IN_PROGRESS: ReadonlySet<LoanApplication['status']> = new Set(['SUBMITTED', 'UNDER_APPRAISAL', 'APPROVED', 'POOLED']);

export const MIN_TENURE_MONTHS = 3;
export const MAX_TENURE_MONTHS = 60;

function requireTicket(state: WorldState, amount: Paise): void {
  const { minTicket, maxTicket } = state.policy;
  if (amount < minTicket || amount > maxTicket) {
    throw new WorldError(
      'OVER_LIMIT',
      `a loan must be between ${formatPaise(minTicket)} and ${formatPaise(maxTicket)}`,
    );
  }
}

function requireTenure(months: number): void {
  if (!Number.isInteger(months) || months < MIN_TENURE_MONTHS || months > MAX_TENURE_MONTHS) {
    throw new WorldError(
      'INVALID_STATE',
      `a tenure must be between ${MIN_TENURE_MONTHS} and ${MAX_TENURE_MONTHS} whole months`,
    );
  }
}

function replaceApplication(state: WorldState, application: LoanApplication): WorldState {
  return {
    ...state,
    applications: state.applications.map((a) => (a.id === application.id ? application : a)),
  };
}

/** A member's principal still outstanding on loans that are active. */
export function memberExposure(state: WorldState, memberId: ID): Paise {
  return sum(
    Object.values(state.loans)
      .filter((l) => l.loan.memberId === memberId && l.loan.status === 'ACTIVE')
      .map((l) => positionOf(state, l.loan.id).principalOutstanding),
  );
}

/**
 * Sets which approved applications a pool holds while it is being built, and
 * moves it between OPEN and READY as the count enters or leaves the band.
 */
function setPoolApplications(state: WorldState, poolId: ID, ids: readonly ID[]): WorldState {
  const pool = poolOf(state, poolId);
  if (pool.status !== 'OPEN' && pool.status !== 'READY') {
    throw new WorldError('INVALID_STATE', `pool ${pool.reference} is ${pool.status} and can no longer change`);
  }
  if (new Set(ids).size !== ids.length) throw new WorldError('INVALID_STATE', 'an application is listed twice');
  if (ids.length > state.policy.poolMaxMembers) {
    throw new WorldError('OVER_LIMIT', `a pool takes at most ${state.policy.poolMaxMembers} members`);
  }
  const chosen = ids.map((id) => applicationOf(state, id));
  for (const application of chosen) {
    if (application.societyId !== pool.societyId) {
      throw new WorldError('INVALID_STATE', `${application.id} belongs to another society`);
    }
    if (application.status !== 'APPROVED') {
      throw new WorldError('INVALID_STATE', `${application.id} is ${application.status}, not approved`);
    }
    if (application.poolId !== undefined && application.poolId !== pool.id) {
      throw new WorldError('INVALID_STATE', `${application.id} is already in another pool`);
    }
  }
  const keep = new Set(ids);
  let next: WorldState = {
    ...state,
    applications: state.applications.map((a) => {
      if (keep.has(a.id)) return { ...a, poolId: pool.id };
      if (a.poolId === pool.id) {
        const { poolId: _removed, ...rest } = a;
        return rest;
      }
      return a;
    }),
  };
  const ready = poolReadiness(ids.length, state.policy).ready;
  const status = ready ? 'READY' : 'OPEN';
  if (status !== pool.status) assertTransition('pool', poolMachine, pool.status, status);
  next = replacePool(next, {
    ...pool,
    status,
    applicationIds: [...ids],
    requestedAmount: sum(chosen.map((a) => a.decision!.sanctionedAmount)),
    requestedTenureMonths: Math.max(0, ...chosen.map((a) => a.decision!.tenureMonths)),
  });
  return next;
}

function requireNotAfterClock(state: WorldState, date: ISODate, what: string): void {
  if (compareISO(date, state.clock) > 0) {
    throw new WorldError('DATE', `${what} on ${date} is after today, ${state.clock}`);
  }
}

function post(
  state: WorldState,
  societyId: ID,
  header: Omit<EntryHeader, 'id'>,
  build: (header: EntryHeader) => JournalEntry,
): WorldState {
  const entrySeq = state.entrySeq + 1;
  const entry = build({ ...header, id: `je_${String(entrySeq).padStart(6, '0')}` });
  return {
    ...state,
    entrySeq,
    journals: { ...state.journals, [societyId]: [...journalOf(state, societyId), entry] },
  };
}

function replacePool(state: WorldState, pool: Pool): WorldState {
  return { ...state, pools: state.pools.map((p) => (p.id === pool.id ? pool : p)) };
}

function movePool(state: WorldState, poolId: ID, to: Pool['status']): WorldState {
  const pool = poolOf(state, poolId);
  assertTransition('pool', poolMachine, pool.status, to);
  return replacePool(state, { ...pool, status: to });
}

function moveApplications(
  state: WorldState,
  ids: readonly ID[],
  to: LoanApplication['status'],
): WorldState {
  const targets = new Set(ids);
  return {
    ...state,
    applications: state.applications.map((application) => {
      if (!targets.has(application.id)) return application;
      assertTransition('application', applicationMachine, application.status, to);
      return { ...application, status: to };
    }),
  };
}

/** What a pool's members ask for now, pooled or already lent, against its sanction. */
export function poolAsk(state: WorldState, poolId: ID): Paise {
  return sum(
    state.applications
      .filter((a) => a.poolId === poolId && (a.status === 'POOLED' || a.status === 'DISBURSED'))
      .map((a) => a.decision!.sanctionedAmount),
  );
}

function replaceTranche(state: WorldState, entry: TrancheState): WorldState {
  return { ...state, tranches: { ...state.tranches, [entry.tranche.id]: entry } };
}

function moveTranche(entry: TrancheState, to: Tranche['status']): TrancheState {
  assertTransition('tranche', trancheMachine, entry.tranche.status, to);
  return { ...entry, tranche: { ...entry.tranche, status: to } };
}

export function fundedLoansOf(state: WorldState, trancheId: ID): FundedLoan[] {
  return trancheOf(state, trancheId).fundedLoanIds.map((loanId) => {
    const loan = loanOf(state, loanId);
    return { loanId, schedule: loan.schedule, prepayments: prepaymentsFrom(loan.receipts) };
  });
}

export function trancheOutstanding(entry: TrancheState): Paise {
  return trancheDrawn(entry.tranche) - sum(entry.remittances.map((r) => r.principalPaid));
}

/**
 * A tranche closes once nothing is owed on it and every loan it funded has
 * closed; its pool closes with it.
 */
function settleClosure(state: WorldState, trancheId: ID): WorldState {
  const entry = trancheOf(state, trancheId);
  if (entry.tranche.status !== 'SERVICING') return state;
  if (trancheOutstanding(entry) !== 0) return state;
  if (entry.fundedLoanIds.some((id) => loanOf(state, id).loan.status === 'ACTIVE')) return state;
  const closed = replaceTranche(state, moveTranche(entry, 'CLOSED'));
  return movePool(closed, entry.tranche.poolId, 'CLOSED');
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export function applyEvent(state: WorldState, event: WorldEvent): WorldState {
  const next = reduce(state, event);
  return { ...next, eventCount: state.eventCount + 1 };
}

function reduce(state: WorldState, event: WorldEvent): WorldState {
  switch (event.type) {
    case 'CLOCK_ADVANCED': {
      if (compareISO(event.to, state.clock) < 0) {
        throw new WorldError('DATE', `the clock only moves forward, not from ${state.clock} to ${event.to}`);
      }
      return { ...state, clock: event.to };
    }

    case 'RESERVES_OPENED': {
      requireNotAfterClock(state, event.on, 'opening reserves');
      societyOf(state, event.societyId);
      return post(
        state,
        event.societyId,
        { on: event.on, narration: 'Opening reserves', sourceType: 'OPENING', sourceId: event.societyId },
        (header) => openingReservesEntry(header, event.amount),
      );
    }

    case 'APPLICATION_SUBMITTED': {
      requireNotAfterClock(state, event.on, 'an application');
      if (state.applications.some((a) => a.id === event.applicationId)) {
        throw new WorldError('DUPLICATE_ID', `application ${event.applicationId} already exists`);
      }
      const member = memberOf(state, event.memberId);
      requireActor(state, event.recordedBy, 'SUBMIT_APPLICATION', member.societyId);
      if (member.status !== 'ACTIVE') {
        throw new WorldError('INVALID_STATE', `${member.name} is ${member.status.toLowerCase()} and cannot apply`);
      }
      const open = state.applications.find((a) => a.memberId === member.id && IN_PROGRESS.has(a.status));
      if (open) {
        throw new WorldError('INVALID_STATE', `${member.name} already has application ${open.id} in progress`);
      }
      requireTicket(state, event.requestedAmount);
      requireTenure(event.requestedTenureMonths);
      return {
        ...state,
        applications: [
          ...state.applications,
          {
            id: event.applicationId,
            memberId: member.id,
            societyId: member.societyId,
            requestedAmount: event.requestedAmount,
            requestedTenureMonths: event.requestedTenureMonths,
            purpose: event.purpose,
            appliedOn: event.on,
            status: 'SUBMITTED',
          },
        ],
      };
    }

    case 'APPLICATION_APPRAISED': {
      requireNotAfterClock(state, event.on, 'an appraisal');
      const application = applicationOf(state, event.applicationId);
      requireActor(state, event.recordedBy, 'APPRAISE_APPLICATION', application.societyId);
      if (event.recommendedAmount > application.requestedAmount) {
        throw new WorldError('OVER_LIMIT', 'an appraisal cannot recommend more than was requested');
      }
      assertTransition('application', applicationMachine, application.status, 'UNDER_APPRAISAL');
      return replaceApplication(state, {
        ...application,
        status: 'UNDER_APPRAISAL',
        appraisal: {
          officerId: event.recordedBy,
          on: event.on,
          monthlyIncome: event.monthlyIncome,
          existingObligations: event.existingObligations,
          recommendedAmount: event.recommendedAmount,
          notes: event.notes,
        },
      });
    }

    case 'APPLICATION_DECIDED': {
      requireNotAfterClock(state, event.on, 'a decision');
      const application = applicationOf(state, event.applicationId);
      const actor = requireActor(state, event.recordedBy, 'DECIDE_APPLICATION', application.societyId);
      const atStake = event.outcome === 'APPROVED' ? event.sanctionedAmount : application.requestedAmount;
      if (approvalAuthority(atStake, state.policy) === 'SECRETARY' && actor.role !== 'SECRETARY') {
        throw new WorldError(
          'NOT_PERMITTED',
          `${actor.name} cannot decide ${formatPaise(atStake)}: above the ${formatPaise(state.policy.officerApprovalLimit)} officer limit, the secretary decides`,
        );
      }
      assertTransition('application', applicationMachine, application.status, event.outcome);
      if (event.outcome === 'REJECTED') {
        if (!event.reason?.trim()) throw new WorldError('INVALID_STATE', 'a rejection needs a reason');
        return replaceApplication(state, {
          ...application,
          status: 'REJECTED',
          decision: {
            by: actor.id,
            on: event.on,
            outcome: 'REJECTED',
            sanctionedAmount: 0,
            tenureMonths: event.tenureMonths,
            rateBps: state.policy.retailRateBps,
            reason: event.reason.trim(),
          },
        });
      }
      if (event.sanctionedAmount > application.requestedAmount) {
        throw new WorldError('OVER_LIMIT', 'a loan cannot be sanctioned for more than was requested');
      }
      requireTicket(state, event.sanctionedAmount);
      requireTenure(event.tenureMonths);
      const member = memberOf(state, application.memberId);
      const exposure = memberExposure(state, member.id) + event.sanctionedAmount;
      if (exposure > state.policy.maxTicket) {
        throw new WorldError(
          'OVER_LIMIT',
          `this would take ${member.name}'s borrowing to ${formatPaise(exposure)}, above the ${formatPaise(state.policy.maxTicket)} limit per member`,
        );
      }
      return replaceApplication(state, {
        ...application,
        status: 'APPROVED',
        decision: {
          by: actor.id,
          on: event.on,
          outcome: 'APPROVED',
          sanctionedAmount: event.sanctionedAmount,
          tenureMonths: event.tenureMonths,
          rateBps: state.policy.retailRateBps,
        },
      });
    }

    case 'POOL_CREATED': {
      requireNotAfterClock(state, event.on, 'a new pool');
      if (state.pools.some((p) => p.id === event.poolId)) {
        throw new WorldError('DUPLICATE_ID', `pool ${event.poolId} already exists`);
      }
      const societyId = userOf(state, event.recordedBy).societyId;
      requireActor(state, event.recordedBy, 'MANAGE_POOL', societyId);
      if (state.pools.some((p) => p.reference === event.reference)) {
        throw new WorldError('DUPLICATE_ID', `a pool ${event.reference} already exists`);
      }
      const pool: Pool = {
        id: event.poolId,
        societyId: societyId!,
        reference: event.reference,
        applicationIds: [],
        requestedAmount: 0,
        requestedTenureMonths: 0,
        createdOn: event.on,
        status: 'OPEN',
      };
      return setPoolApplications({ ...state, pools: [...state.pools, pool] }, pool.id, event.applicationIds);
    }

    case 'POOL_APPLICATIONS_SET': {
      requireNotAfterClock(state, event.on, 'a pool change');
      const pool = poolOf(state, event.poolId);
      requireActor(state, event.recordedBy, 'MANAGE_POOL', pool.societyId);
      return setPoolApplications(state, pool.id, event.applicationIds);
    }

    case 'POOL_STATUS_CHANGED': {
      requireNotAfterClock(state, event.on, 'a pool status change');
      const pool = poolOf(state, event.poolId);
      const derived: Pool['status'][] = ['SANCTIONED', 'DISBURSED', 'SERVICING', 'CLOSED'];
      if (derived.includes(event.to)) {
        throw new WorldError(
          'INVALID_STATE',
          `a pool becomes ${event.to} through its sanction, disbursement or servicing, not directly`,
        );
      }
      // The society builds and submits; the federation reviews and declines.
      const byApex = event.to === 'UNDER_APEX_REVIEW' || event.to === 'DECLINED';
      const actor = requireActor(state, event.recordedBy, byApex ? 'REVIEW_POOL' : 'MANAGE_POOL', pool.societyId);
      if (event.to === 'READY') {
        const readiness = poolReadiness(pool.applicationIds.length, state.policy);
        if (!readiness.ready) throw new WorldError('INVALID_STATE', readiness.reason ?? 'pool not ready');
      }
      let next = movePool(state, pool.id, event.to);
      if (event.to === 'SUBMITTED') {
        // Submission locks the applications against edits and other pools.
        next = moveApplications(next, pool.applicationIds, 'POOLED');
        next = replacePool(next, { ...poolOf(next, pool.id), submittedOn: event.on });
      }
      if (event.to === 'DECLINED') {
        if (!event.remarks?.trim()) throw new WorldError('INVALID_STATE', 'a decline needs remarks for the society');
        // Declining releases the applications for another pool.
        const released = new Set(pool.applicationIds);
        next = moveApplications(next, pool.applicationIds, 'APPROVED');
        next = {
          ...next,
          applications: next.applications.map((a) => {
            if (!released.has(a.id)) return a;
            const { poolId: _released, ...rest } = a;
            return rest;
          }),
        };
        next = replacePool(next, {
          ...poolOf(next, pool.id),
          apexReview: { officerId: actor.id, on: event.on, decision: 'DECLINED', remarks: event.remarks.trim() },
        });
      }
      return next;
    }

    case 'TRANCHE_SANCTIONED': {
      requireNotAfterClock(state, event.on, 'a sanction');
      if (state.tranches[event.trancheId]) {
        throw new WorldError('DUPLICATE_ID', `tranche ${event.trancheId} already exists`);
      }
      const officer = requireActor(state, event.recordedBy, 'REVIEW_POOL');
      const pool = poolOf(state, event.poolId);
      if (event.sanctionedAmount > pool.requestedAmount) {
        throw new WorldError('OVER_LIMIT', 'a sanction cannot exceed what the pool requested');
      }
      if (event.tenureMonths < pool.requestedTenureMonths) {
        throw new WorldError(
          'INVALID_STATE',
          `the tranche must run at least as long as the pool's longest loan, ${pool.requestedTenureMonths} months`,
        );
      }
      const society = societyOf(state, pool.societyId);
      const exposure =
        sum(
          Object.values(state.tranches)
            .filter((t) => t.tranche.societyId === society.id && t.tranche.status !== 'CLOSED')
            .map((t) => t.tranche.sanctionedAmount),
        ) + event.sanctionedAmount;
      if (exposure > society.creditLimit) {
        throw new WorldError(
          'OVER_LIMIT',
          `this would take ${society.name} to ${formatPaise(exposure)} sanctioned, above its ${formatPaise(society.creditLimit)} credit limit`,
        );
      }
      let next = movePool(state, pool.id, 'SANCTIONED');
      next = replacePool(next, {
        ...poolOf(next, pool.id),
        apexReview: { officerId: officer.id, on: event.on, decision: 'SANCTIONED', remarks: event.remarks },
      });
      const tranche: Tranche = {
        id: event.trancheId,
        poolId: pool.id,
        societyId: pool.societyId,
        federationId: state.federation.id,
        sanctionRef: event.sanctionRef,
        sanctionedAmount: event.sanctionedAmount,
        wholesaleRateBps: event.wholesaleRateBps,
        tenureMonths: event.tenureMonths,
        sanctionedOn: event.on,
        marginRequirementBps: 0,
        drawdowns: [],
        status: 'SANCTIONED',
      };
      return replaceTranche(next, { tranche, fundedLoanIds: [], remittances: [] });
    }

    case 'POOL_RESCOPED': {
      requireNotAfterClock(state, event.on, 'a re-scope');
      const pool = poolOf(state, event.poolId);
      const actor = requireActor(state, event.recordedBy, 'MANAGE_POOL', pool.societyId);
      const entry = Object.values(state.tranches).find((t) => t.tranche.poolId === pool.id);
      if (pool.status !== 'SANCTIONED' || !entry || entry.tranche.drawdowns.length > 0) {
        throw new WorldError('INVALID_STATE', `${pool.reference} can be re-scoped only after its sanction and before any drawdown`);
      }
      const sanctioned = entry.tranche.sanctionedAmount;
      const asked = poolAsk(state, pool.id);
      if (!needsRescope(asked, sanctioned)) {
        throw new WorldError('INVALID_STATE', `the sanction already covers ${pool.reference}`);
      }
      const ids = event.keep.map((k) => k.applicationId);
      if (new Set(ids).size !== ids.length) throw new WorldError('INVALID_STATE', 'an application is listed twice');
      const kept = event.keep.map((k) => ({ application: applicationOf(state, k.applicationId), amount: k.amount }));
      for (const { application, amount } of kept) {
        if (application.poolId !== pool.id || application.status !== 'POOLED') {
          throw new WorldError('INVALID_STATE', `${application.id} is not waiting in ${pool.reference}`);
        }
        const approved = application.decision!.sanctionedAmount;
        if (amount > approved) throw new WorldError('OVER_LIMIT', `${application.id} cannot be raised in a re-scope`);
        if (event.method === 'REMOVE' && amount !== approved) {
          throw new WorldError('INVALID_STATE', 'removing members keeps the others at their approved amounts');
        }
        if (amount < state.policy.minTicket) {
          throw new WorldError(
            'OVER_LIMIT',
            `${application.id} would fall below the ${formatPaise(state.policy.minTicket)} minimum: remove members instead`,
          );
        }
      }
      const removed = pool.applicationIds.filter((id) => !ids.includes(id));
      if (event.method === 'PRO_RATA' && removed.length > 0) {
        throw new WorldError('INVALID_STATE', 'a pro rata cut keeps every member');
      }
      const total = sum(kept.map((k) => k.amount));
      if (total > sanctioned) {
        throw new WorldError(
          'OVER_LIMIT',
          `the pool would still ask for ${formatPaise(total)} against a ${formatPaise(sanctioned)} sanction`,
        );
      }
      const amounts = new Map(event.keep.map((k) => [k.applicationId, k.amount]));
      let next = moveApplications(state, removed, 'APPROVED');
      next = {
        ...next,
        applications: next.applications.map((a) => {
          if (removed.includes(a.id)) {
            const { poolId: _left, ...rest } = a;
            return rest;
          }
          const amount = amounts.get(a.id);
          if (amount === undefined || amount === a.decision!.sanctionedAmount) return a;
          return {
            ...a,
            decision: {
              ...a.decision!,
              sanctionedAmount: amount,
              rescopedFrom: a.decision!.rescopedFrom ?? a.decision!.sanctionedAmount,
            },
          };
        }),
      };
      return replacePool(next, {
        ...poolOf(next, pool.id),
        applicationIds: ids,
        rescope: { on: event.on, by: actor.id, method: event.method, removed, askedBefore: asked },
      });
    }

    case 'TRANCHE_DRAWN': {
      requireNotAfterClock(state, event.on, 'a drawdown');
      const entry = trancheOf(state, event.trancheId);
      requireActor(state, event.recordedBy, 'DISBURSE', entry.tranche.societyId);
      // A sanction below the request goes back to the secretary to re-scope
      // before any money moves; nothing shrinks a member's loan unasked.
      const asked = poolAsk(state, entry.tranche.poolId);
      if (needsRescope(asked, entry.tranche.sanctionedAmount)) {
        throw new WorldError(
          'INVALID_STATE',
          `re-scope ${poolOf(state, entry.tranche.poolId).reference} first: its members ask for ${formatPaise(asked)} against a ${formatPaise(entry.tranche.sanctionedAmount)} sanction`,
        );
      }
      if (entry.tranche.status === 'CLOSED' || entry.tranche.status === 'DEFAULTED') {
        throw new WorldError('INVALID_STATE', `tranche ${entry.tranche.id} is ${entry.tranche.status}`);
      }
      const drawn = trancheDrawn(entry.tranche) + event.amount;
      if (drawn > entry.tranche.sanctionedAmount) {
        throw new WorldError('OVER_LIMIT', `drawing ${event.amount} would exceed the sanction`);
      }
      let updated: TrancheState = {
        ...entry,
        tranche: {
          ...entry.tranche,
          drawdowns: [...entry.tranche.drawdowns, { on: event.on, amount: event.amount }],
        },
      };
      const status = updated.tranche.status;
      if (status === 'SANCTIONED' || status === 'PARTIALLY_DRAWN') {
        const to = drawn === entry.tranche.sanctionedAmount ? 'DRAWN' : 'PARTIALLY_DRAWN';
        if (to !== status) updated = moveTranche(updated, to);
      }
      return post(
        replaceTranche(state, updated),
        entry.tranche.societyId,
        { on: event.on, narration: `Drawdown on ${entry.tranche.sanctionRef}`, sourceType: 'DRAWDOWN', sourceId: entry.tranche.id },
        (header) => drawdownEntry(header, event.amount),
      );
    }

    case 'LOAN_DISBURSED': {
      requireNotAfterClock(state, event.on, 'a disbursement');
      if (state.loans[event.loanId]) {
        throw new WorldError('DUPLICATE_ID', `loan ${event.loanId} already exists`);
      }
      const trancheEntry = trancheOf(state, event.trancheId);
      const application = applicationOf(state, event.applicationId);
      requireActor(state, event.recordedBy, 'DISBURSE', application.societyId);
      if (application.poolId !== trancheEntry.tranche.poolId) {
        throw new WorldError('INVALID_STATE', `${application.id} is not in the pool this tranche funds`);
      }
      const decision = application.decision;
      if (!decision || decision.outcome !== 'APPROVED') {
        throw new WorldError('INVALID_STATE', `${application.id} has no approval to disburse against`);
      }
      // Lend only what has been drawn: the tranche funds the loan, not reserves.
      const lent = sum(trancheEntry.fundedLoanIds.map((id) => loanOf(state, id).loan.principal));
      const undisbursed = trancheDrawn(trancheEntry.tranche) - lent;
      if (decision.sanctionedAmount > undisbursed) {
        throw new WorldError(
          'OVER_LIMIT',
          `draw down first: ${formatPaise(undisbursed)} of the tranche is drawn and not yet lent`,
        );
      }
      if (compareISO(event.firstDueOn, event.on) <= 0) {
        throw new WorldError('DATE', 'the first instalment must fall due after disbursement');
      }
      const schedule = generateSchedule({
        loanId: event.loanId,
        principal: decision.sanctionedAmount,
        annualBps: decision.rateBps,
        tenureMonths: decision.tenureMonths,
        firstDueOn: event.firstDueOn,
      });
      const loanState: LoanState = {
        loan: {
          id: event.loanId,
          applicationId: application.id,
          memberId: application.memberId,
          societyId: application.societyId,
          poolId: trancheEntry.tranche.poolId,
          trancheId: trancheEntry.tranche.id,
          principal: decision.sanctionedAmount,
          rateBps: decision.rateBps,
          tenureMonths: decision.tenureMonths,
          disbursedOn: event.on,
          firstDueOn: event.firstDueOn,
          emi: schedule[0]!.instalment,
          status: 'ACTIVE',
        },
        schedule,
        originalSchedule: schedule,
        receipts: [],
        feesCharged: 0,
      };

      let next: WorldState = { ...state, loans: { ...state.loans, [event.loanId]: loanState } };
      next = moveApplications(next, [application.id], 'DISBURSED');
      next = replaceTranche(next, {
        ...trancheEntry,
        fundedLoanIds: [...trancheEntry.fundedLoanIds, event.loanId],
      });
      if (poolOf(next, trancheEntry.tranche.poolId).status === 'SANCTIONED') {
        next = movePool(next, trancheEntry.tranche.poolId, 'DISBURSED');
      }
      const member = memberOf(state, application.memberId);
      return post(
        next,
        application.societyId,
        { on: event.on, narration: `Disbursement to ${member.name}`, sourceType: 'DISBURSEMENT', sourceId: event.loanId },
        (header) => disbursementEntry(header, decision.sanctionedAmount),
      );
    }

    case 'FEE_CHARGED': {
      requireNotAfterClock(state, event.on, 'a fee');
      const entry = loanOf(state, event.loanId);
      if (entry.loan.status !== 'ACTIVE') {
        throw new WorldError('INVALID_STATE', `cannot charge a fee on a ${entry.loan.status} loan`);
      }
      // Fees are income when received, on the cash basis, so nothing posts yet.
      return {
        ...state,
        loans: { ...state.loans, [event.loanId]: { ...entry, feesCharged: entry.feesCharged + event.amount } },
      };
    }

    case 'PAYMENT_RECEIVED': {
      const entry = loanOf(state, event.loanId);
      requireActor(state, event.recordedBy, 'RECORD_PAYMENT', entry.loan.societyId);
      const isTaken = Object.values(state.loans).some((l) => l.receipts.some((r) => r.id === event.paymentId));
      if (isTaken) throw new WorldError('DUPLICATE_ID', `payment ${event.paymentId} already exists`);
      const tranche = trancheOf(state, entry.loan.trancheId).tranche;
      const out = reconcileReceipt({
        loan: entry.loan,
        schedule: entry.schedule,
        priorReceipts: entry.receipts,
        feesCharged: entry.feesCharged,
        receipt: {
          amount: event.amount,
          receivedOn: event.on,
          source: event.source,
          electPrepayment: event.electPrepayment,
        },
        clock: state.clock,
        wholesaleRateBps: tranche.wholesaleRateBps,
        policy: state.policy,
      });

      const receipt: ReceiptEntry = {
        id: event.paymentId,
        receivedOn: event.on,
        amount: event.amount,
        source: event.source,
        allocation: out.reconciliation.allocation,
        reconciliation: out.reconciliation,
        mode: event.mode,
        receiptNo: event.receiptNo,
        electPrepayment: event.electPrepayment,
        recordedBy: event.recordedBy,
      };
      let loan = entry.loan;
      if (out.closesLoan) {
        const to = receipt.allocation.prepaidPrincipal > 0 ? 'FORECLOSED' : 'CLOSED';
        assertTransition('loan', loanMachine, loan.status, to);
        loan = { ...loan, status: to };
      }
      const updated: LoanState = {
        ...entry,
        loan,
        schedule: out.rescheduled ?? entry.schedule,
        receipts: [...entry.receipts, receipt],
      };
      const member = memberOf(state, loan.memberId);
      const next = post(
        { ...state, loans: { ...state.loans, [loan.id]: updated } },
        loan.societyId,
        { on: event.on, narration: `Receipt ${event.receiptNo} from ${member.name}`, sourceType: 'PAYMENT', sourceId: event.paymentId },
        (header) =>
          receiptEntry(header, {
            amount: event.amount,
            source: event.source,
            allocation: receipt.allocation,
            accrualBasis: state.policy.accrualEnabled,
          }),
      );
      return settleClosure(next, loan.trancheId);
    }

    case 'REMITTANCE_RECORDED': {
      requireNotAfterClock(state, event.on, 'a remittance');
      requireNotAfterClock(state, event.dueOn, 'a remittance period');
      if (compareISO(event.on, event.dueOn) < 0) {
        throw new WorldError('DATE', 'a remittance is paid on or after its due date');
      }
      const entry = trancheOf(state, event.trancheId);
      requireActor(state, event.recordedBy, 'RECORD_REMITTANCE', entry.tranche.societyId);
      const funded = fundedLoansOf(state, entry.tranche.id);
      if (!remittanceDates(funded).includes(event.dueOn)) {
        throw new WorldError('DATE', `${event.dueOn} is not a remittance date for ${entry.tranche.sanctionRef}`);
      }
      const due = computeRemittance({
        tranche: entry.tranche,
        fundedLoans: funded,
        priorRemittances: entry.remittances,
        dueOn: event.dueOn,
        policy: state.policy.reconciliationPolicy,
      });
      if (event.interestPaid > due.interestDue || event.principalPaid > due.principalDue) {
        throw new WorldError('OVER_LIMIT', 'a remittance cannot pay the federation more than is due');
      }

      let updated: TrancheState = {
        ...entry,
        remittances: [
          ...entry.remittances,
          {
            id: event.remittanceId,
            dueOn: event.dueOn,
            paidOn: event.on,
            recordedBy: event.recordedBy,
            interestDue: due.interestDue,
            principalDue: due.principalDue,
            interestPaid: event.interestPaid,
            principalPaid: event.principalPaid,
            due,
          },
        ],
      };
      if (updated.tranche.status === 'DRAWN' || updated.tranche.status === 'PARTIALLY_DRAWN') {
        updated = moveTranche(updated, 'SERVICING');
      }
      let next = replaceTranche(state, updated);
      if (poolOf(next, entry.tranche.poolId).status === 'DISBURSED') {
        next = movePool(next, entry.tranche.poolId, 'SERVICING');
      }
      // A missed remittance moves no money and posts nothing; its whole due
      // carries forward as arrears through the record above.
      if (event.interestPaid + event.principalPaid > 0) {
        next = post(
          next,
          entry.tranche.societyId,
          { on: event.on, narration: `Remittance on ${entry.tranche.sanctionRef} for ${event.dueOn}`, sourceType: 'REMITTANCE', sourceId: event.remittanceId },
          (header) =>
            remittanceEntry(header, {
              interestPaid: event.interestPaid,
              principalPaid: event.principalPaid,
              accrualBasis: state.policy.accrualEnabled,
            }),
        );
      }
      return settleClosure(next, entry.tranche.id);
    }

    case 'PERIOD_CLOSED': {
      requireNotAfterClock(state, event.on, 'a period close');
      const balances = [...accountBalances(journalOf(state, event.societyId)).values()]
        .filter((row) => (row.account.type === 'INCOME' || row.account.type === 'EXPENSE') && row.balance !== 0)
        .map((row) => ({ code: row.account.code as AccountCode, balance: row.balance }));
      if (balances.length === 0) {
        throw new WorldError('NOTHING_TO_CLOSE', 'there is no income or expense to close into reserves');
      }
      return post(
        state,
        event.societyId,
        { on: event.on, narration: 'Period close', sourceType: 'CLOSE', sourceId: event.societyId },
        (header) => periodCloseEntry(header, balances),
      );
    }
  }
}

export function replay(state: WorldState, events: readonly WorldEvent[]): WorldState {
  let current = state;
  events.forEach((event, index) => {
    try {
      current = applyEvent(current, event);
    } catch (error) {
      throw new ReplayError(index, event, error);
    }
  });
  return current;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function positionOf(state: WorldState, loanId: ID, asOf: ISODate = state.clock): LoanPosition {
  const entry = loanOf(state, loanId);
  return loanPosition({
    schedule: entry.schedule,
    receipts: entry.receipts,
    feesCharged: entry.feesCharged,
    asOf,
    penalRateBps: state.policy.penalRateBps,
    graceDays: state.policy.graceDays,
  });
}

/** The next remittance date a tranche has not yet settled, if any. */
export function nextRemittanceDate(state: WorldState, trancheId: ID): ISODate | undefined {
  const entry = trancheOf(state, trancheId);
  const last = entry.remittances.at(-1)?.dueOn;
  return remittanceDates(fundedLoansOf(state, trancheId)).find(
    (date) => last === undefined || compareISO(date, last) > 0,
  );
}

export function remittanceDueFor(state: WorldState, trancheId: ID, dueOn: ISODate): RemittanceDue {
  const entry = trancheOf(state, trancheId);
  return computeRemittance({
    tranche: entry.tranche,
    fundedLoans: fundedLoansOf(state, trancheId),
    priorRemittances: entry.remittances,
    dueOn,
    policy: state.policy.reconciliationPolicy,
  });
}

/** The earliest instalment date after today on any active loan. */
export function nextDueDate(state: WorldState): ISODate | undefined {
  let next: ISODate | undefined;
  for (const entry of Object.values(state.loans)) {
    if (entry.loan.status !== 'ACTIVE') continue;
    const row = entry.schedule.find((r) => compareISO(r.dueOn, state.clock) > 0);
    if (row && (next === undefined || compareISO(row.dueOn, next) < 0)) next = row.dueOn;
  }
  return next;
}

/** One society's books and positions, in the shape the invariants check. */
export function societySlice(state: WorldState, societyId: ID): World {
  return {
    clock: state.clock,
    policy: state.policy,
    loans: Object.values(state.loans).filter((l) => l.loan.societyId === societyId),
    tranches: Object.values(state.tranches).filter((t) => t.tranche.societyId === societyId),
    pools: state.pools.filter((p) => p.societyId === societyId),
    journal: journalOf(state, societyId),
  };
}

export function invariantsBySociety(state: WorldState): Record<ID, InvariantResult[]> {
  const results: Record<ID, InvariantResult[]> = {};
  for (const society of state.societies) {
    results[society.id] = checkInvariants(societySlice(state, society.id));
  }
  return results;
}
