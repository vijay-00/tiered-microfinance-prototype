import type { Role } from './types';

/**
 * Who may do what. The reducer enforces this on every event that names its
 * actor, and the UI reads the same table to hide what a role cannot do, so the
 * two can never disagree.
 */

export type Action =
  | 'SUBMIT_APPLICATION'
  | 'APPRAISE_APPLICATION'
  | 'DECIDE_APPLICATION'
  | 'MANAGE_POOL'
  | 'REVIEW_POOL'
  | 'DISBURSE'
  | 'RECORD_PAYMENT'
  | 'RECORD_REMITTANCE';

export const PERMISSIONS: Readonly<Record<Action, readonly Role[]>> = {
  // A member may apply for themselves; the reducer refuses an application for anyone else.
  SUBMIT_APPLICATION: ['LOAN_OFFICER', 'SECRETARY', 'MEMBER'],
  APPRAISE_APPLICATION: ['LOAN_OFFICER', 'SECRETARY'],
  // Above the officer's approval limit only the secretary may decide; see
  // approvalAuthority in machines.ts, which the reducer applies on top.
  DECIDE_APPLICATION: ['LOAN_OFFICER', 'SECRETARY'],
  MANAGE_POOL: ['SECRETARY'],
  REVIEW_POOL: ['APEX_OFFICER'],
  DISBURSE: ['SECRETARY'],
  RECORD_PAYMENT: ['LOAN_OFFICER', 'SECRETARY'],
  RECORD_REMITTANCE: ['SECRETARY'],
};

/** Actions taken for the federation, by people who belong to no society. */
export const APEX_ACTIONS: ReadonlySet<Action> = new Set<Action>(['REVIEW_POOL']);

export const ACTION_VERBS: Readonly<Record<Action, string>> = {
  SUBMIT_APPLICATION: 'submit an application',
  APPRAISE_APPLICATION: 'appraise an application',
  DECIDE_APPLICATION: 'decide an application',
  MANAGE_POOL: 'build or submit a pool',
  REVIEW_POOL: 'review a pool',
  DISBURSE: 'draw down or disburse',
  RECORD_PAYMENT: 'record a payment',
  RECORD_REMITTANCE: 'record a remittance',
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}
