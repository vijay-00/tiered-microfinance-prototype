import { describe, expect, it } from 'vitest';
import {
  TransitionError,
  applicationMachine,
  approvalAuthority,
  assertTransition,
  canTransition,
  isTerminal,
  loanMachine,
  needsRescope,
  poolMachine,
  poolReadiness,
  remittanceMachine,
  remittanceStatusOn,
  trancheMachine,
  type Machine,
} from '../machines';
import { DEFAULT_POLICY } from '../types';

const machines: Record<string, Machine<string>> = {
  application: applicationMachine,
  pool: poolMachine,
  tranche: trancheMachine,
  loan: loanMachine,
  remittance: remittanceMachine,
};

describe('state machines', () => {
  for (const [name, machine] of Object.entries(machines)) {
    it(`${name}: every transition leads to a known state`, () => {
      const states = Object.keys(machine);
      for (const targets of Object.values(machine)) {
        for (const target of targets) expect(states).toContain(target);
      }
    });
  }

  it('walks an application from draft to disbursement', () => {
    const path = ['DRAFT', 'SUBMITTED', 'UNDER_APPRAISAL', 'APPROVED', 'POOLED', 'DISBURSED'] as const;
    for (let i = 1; i < path.length; i += 1) {
      expect(canTransition(applicationMachine, path[i - 1]!, path[i]!)).toBe(true);
    }
    expect(isTerminal(applicationMachine, 'DISBURSED')).toBe(true);
    expect(isTerminal(applicationMachine, 'REJECTED')).toBe(true);
  });

  it('lets a pooled application go back to approved, but not a disbursed one', () => {
    expect(canTransition(applicationMachine, 'POOLED', 'APPROVED')).toBe(true);
    expect(canTransition(applicationMachine, 'DISBURSED', 'APPROVED')).toBe(false);
  });

  it('refuses to skip apex review', () => {
    expect(() => assertTransition('pool', poolMachine, 'SUBMITTED', 'SANCTIONED')).toThrow(
      TransitionError,
    );
  });

  it('has no overdue state to store for a loan', () => {
    expect(Object.keys(loanMachine)).not.toContain('OVERDUE');
    expect(Object.keys(loanMachine)).not.toContain('DELINQUENT');
  });
});

describe('guards', () => {
  it('blocks a pool below ten members and says how many more are needed', () => {
    expect(poolReadiness(9, DEFAULT_POLICY)).toEqual({
      ready: false,
      reason: 'Add 1 more member: a pool needs at least 10.',
    });
    expect(poolReadiness(7, DEFAULT_POLICY).reason).toBe(
      'Add 3 more members: a pool needs at least 10.',
    );
  });

  it('accepts ten to twenty members inclusive', () => {
    expect(poolReadiness(10, DEFAULT_POLICY).ready).toBe(true);
    expect(poolReadiness(20, DEFAULT_POLICY).ready).toBe(true);
  });

  it('blocks a pool above twenty members', () => {
    expect(poolReadiness(21, DEFAULT_POLICY)).toEqual({
      ready: false,
      reason: 'Remove 1 member: a pool takes at most 20.',
    });
  });

  it('routes approval at the Rs 50,000 officer limit, inclusive', () => {
    expect(approvalAuthority(5_000_000, DEFAULT_POLICY)).toBe('LOAN_OFFICER');
    expect(approvalAuthority(5_000_001, DEFAULT_POLICY)).toBe('SECRETARY');
  });

  it('flags a pool sanctioned below its request for re-scoping', () => {
    expect(needsRescope(1_000_000, 900_000)).toBe(true);
    expect(needsRescope(1_000_000, 1_000_000)).toBe(false);
  });

  it('derives an overdue remittance from the clock rather than storing it', () => {
    expect(remittanceStatusOn('DUE', '2026-05-15', '2026-05-15')).toBe('DUE');
    expect(remittanceStatusOn('DUE', '2026-05-15', '2026-05-16')).toBe('OVERDUE');
    expect(remittanceStatusOn('PAID', '2026-05-15', '2026-06-30')).toBe('PAID');
  });
});
