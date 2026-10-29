import type { Role } from '@/domain/types';

/**
 * Which part of the app each role sees. The screens hide what a role cannot
 * reach; what it may change is checked again by the reducer, against the same
 * permission table, so a hand-made event is refused too.
 */

export type Tier = 'society' | 'apex' | 'member';

export interface RoleInfo {
  readonly role: Role;
  readonly label: string;
  readonly tier: Tier;
  readonly home: string;
  /** Sees everything in its tier and changes nothing. */
  readonly readOnly: boolean;
}

export const ROLES: readonly RoleInfo[] = [
  { role: 'SECRETARY', label: 'Society Secretary', tier: 'society', home: '/dashboard', readOnly: false },
  { role: 'LOAN_OFFICER', label: 'Loan Officer', tier: 'society', home: '/dashboard', readOnly: false },
  { role: 'APEX_OFFICER', label: 'Apex Officer', tier: 'apex', home: '/apex', readOnly: false },
  { role: 'MEMBER', label: 'Member', tier: 'member', home: '/me', readOnly: false },
  { role: 'AUDITOR', label: 'Auditor', tier: 'society', home: '/dashboard', readOnly: true },
];

export function roleInfo(role: Role): RoleInfo {
  return ROLES.find((r) => r.role === role)!;
}
