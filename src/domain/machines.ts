import { compareISO } from './dates';
import type {
  ApplicationStatus,
  ISODate,
  LoanStatus,
  Paise,
  Policy,
  PoolStatus,
  RemittanceStatus,
  TrancheStatus,
} from './types';

/**
 * Allowed status transitions, one table per entity. A transition not listed
 * here is refused. Facts that depend on the clock (a loan being overdue, a
 * remittance being late) are derived, never stored as a status.
 */

export type Machine<S extends string> = Readonly<Record<S, readonly S[]>>;

export const applicationMachine: Machine<ApplicationStatus> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_APPRAISAL'],
  UNDER_APPRAISAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['POOLED'],
  REJECTED: [],
  // Back to APPROVED when removed from a pool before submission, or released
  // from a declined pool, or dropped while re-scoping an under-sanctioned one.
  POOLED: ['DISBURSED', 'APPROVED'],
  DISBURSED: [],
};

/**
 * There is no re-scope status. A pool sanctioned for less than it requested
 * needs re-scoping, and that is derived by comparing the two amounts, in the
 * same way delinquency is derived rather than stored.
 */
export const poolMachine: Machine<PoolStatus> = {
  OPEN: ['READY'],
  READY: ['OPEN', 'SUBMITTED'],
  SUBMITTED: ['UNDER_APEX_REVIEW'],
  UNDER_APEX_REVIEW: ['SANCTIONED', 'DECLINED'],
  SANCTIONED: ['DISBURSED'],
  DECLINED: [],
  DISBURSED: ['SERVICING'],
  SERVICING: ['CLOSED'],
  CLOSED: [],
};

export const trancheMachine: Machine<TrancheStatus> = {
  SANCTIONED: ['PARTIALLY_DRAWN', 'DRAWN'],
  PARTIALLY_DRAWN: ['DRAWN', 'SERVICING'],
  DRAWN: ['SERVICING'],
  SERVICING: ['CLOSED', 'DEFAULTED'],
  CLOSED: [],
  DEFAULTED: [],
};

export const loanMachine: Machine<LoanStatus> = {
  ACTIVE: ['CLOSED', 'FORECLOSED', 'WRITTEN_OFF'],
  CLOSED: [],
  FORECLOSED: [],
  WRITTEN_OFF: [],
};

/**
 * OVERDUE is never stored; see remittanceStatusOn. A short payment settles the
 * period as PARTIAL and its shortfall is carried into the next period's due,
 * so neither PAID nor PARTIAL moves again.
 */
export const remittanceMachine: Machine<Exclude<RemittanceStatus, 'OVERDUE'>> = {
  DUE: ['PAID', 'PARTIAL'],
  PAID: [],
  PARTIAL: [],
};

export class TransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`a ${entity} cannot move from ${from} to ${to}`);
    this.name = 'TransitionError';
  }
}

export function canTransition<S extends string>(machine: Machine<S>, from: S, to: S): boolean {
  return machine[from].includes(to);
}

export function assertTransition<S extends string>(
  entity: string,
  machine: Machine<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(machine, from, to)) throw new TransitionError(entity, from, to);
}

export function isTerminal<S extends string>(machine: Machine<S>, state: S): boolean {
  return machine[state].length === 0;
}

// ---------------------------------------------------------------------------
// Guards: the business rules that decide whether a transition may happen
// ---------------------------------------------------------------------------

export interface Readiness {
  readonly ready: boolean;
  /** Shown beside the disabled Submit button, so the user knows why. */
  readonly reason?: string;
}

export function poolReadiness(
  memberCount: number,
  policy: Pick<Policy, 'poolMinMembers' | 'poolMaxMembers'>,
): Readiness {
  if (memberCount === 0) {
    return { ready: false, reason: 'Choose at least one approved application to send.' };
  }
  if (memberCount < policy.poolMinMembers) {
    const short = policy.poolMinMembers - memberCount;
    return {
      ready: false,
      reason: `Add ${short} more member${short === 1 ? '' : 's'}: a batch needs at least ${policy.poolMinMembers}.`,
    };
  }
  if (memberCount > policy.poolMaxMembers) {
    const over = memberCount - policy.poolMaxMembers;
    return {
      ready: false,
      reason: `Remove ${over} member${over === 1 ? '' : 's'}: a batch takes at most ${policy.poolMaxMembers}.`,
    };
  }
  return { ready: true };
}

export type ApprovalAuthority = 'LOAN_OFFICER' | 'SECRETARY';

/** At or under the officer's limit the Loan Officer may decide; above it, the Secretary. */
export function approvalAuthority(
  amount: Paise,
  policy: Pick<Policy, 'officerApprovalLimit'>,
): ApprovalAuthority {
  return amount <= policy.officerApprovalLimit ? 'LOAN_OFFICER' : 'SECRETARY';
}

/** A pool sanctioned below its request must be re-scoped before any drawdown. */
export function needsRescope(requested: Paise, sanctioned: Paise): boolean {
  return sanctioned < requested;
}

/** The status a remittance shows on a given day, with OVERDUE derived from the clock. */
export function remittanceStatusOn(
  stored: Exclude<RemittanceStatus, 'OVERDUE'>,
  dueOn: ISODate,
  clock: ISODate,
): RemittanceStatus {
  if (stored === 'DUE' && compareISO(clock, dueOn) > 0) return 'OVERDUE';
  return stored;
}
