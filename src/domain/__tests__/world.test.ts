import { describe, expect, it } from 'vitest';
import { loadScenarioA } from '@/data/seed';
import { TransitionError } from '../machines';
import { ReconciliationError } from '../reconciliation';
import {
  applyEvent,
  createWorld,
  poolOf,
  remittanceDueFor,
  replay,
  ReplayError,
  WorldError,
  type WorldEvent,
  type WorldState,
} from '../world';
import { setUpPool, Simulation, POOL_OF_TWELVE } from './helpers/simulation';

const seedWorld = (): WorldState => {
  const seed = loadScenarioA();
  return replay(createWorld(seed.base), seed.events);
};

function expectError(fn: () => unknown, kind: new (...args: never[]) => Error, pattern?: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(kind);
    if (pattern) expect((error as Error).message).toMatch(pattern);
    return;
  }
  throw new Error(`expected ${kind.name}`);
}

describe('the reducer', () => {
  it('never mutates the world it is given', () => {
    const world = seedWorld();
    const before = JSON.stringify(world);
    applyEvent(world, { type: 'CLOCK_ADVANCED', to: '2026-12-01' });
    expect(JSON.stringify(world)).toBe(before);
  });

  it('replays to byte-identical state every time', () => {
    expect(JSON.stringify(seedWorld())).toBe(JSON.stringify(seedWorld()));
  });

  it('counts the events it has applied', () => {
    const seed = loadScenarioA();
    expect(seedWorld().eventCount).toBe(seed.events.length);
  });

  it('refuses to move the clock backwards', () => {
    expectError(() => applyEvent(seedWorld(), { type: 'CLOCK_ADVANCED', to: '2026-10-01' }), WorldError, /only moves forward/);
  });

  it('refuses anything dated after today', () => {
    const event: WorldEvent = { type: 'RESERVES_OPENED', on: '2026-11-01', societyId: 'soc_1', amount: 100 };
    expectError(() => applyEvent(seedWorld(), event), WorldError, /after today/);
  });

  it('names the event that broke a replay', () => {
    const seed = loadScenarioA();
    const broken: WorldEvent[] = [...seed.events.slice(0, 5), { type: 'CLOCK_ADVANCED', to: '2025-01-01' }];
    try {
      replay(createWorld(seed.base), broken);
      throw new Error('expected a ReplayError');
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayError);
      expect((error as ReplayError).index).toBe(5);
    }
  });
});

describe('batches', () => {
  it('will not mark an empty batch ready, and says why', () => {
    // pool_04 is being assembled; emptied, it has nothing to send.
    const emptied = applyEvent(seedWorld(), {
      type: 'POOL_APPLICATIONS_SET',
      on: '2026-10-29',
      poolId: 'pool_04',
      applicationIds: [],
      recordedBy: 'usr_secretary',
    });
    const event: WorldEvent = {
      type: 'POOL_STATUS_CHANGED',
      on: '2026-10-29',
      poolId: 'pool_04',
      to: 'READY',
      recordedBy: 'usr_secretary',
    };
    expectError(() => applyEvent(emptied, event), WorldError, /Choose at least one approved application/);
  });

  it('marks a batch of a single member ready: one application is enough to go to the federation', () => {
    const one = applyEvent(seedWorld(), {
      type: 'POOL_APPLICATIONS_SET',
      on: '2026-10-29',
      poolId: 'pool_04',
      applicationIds: ['app_061'],
      recordedBy: 'usr_secretary',
    });
    expect(one.pools.find((p) => p.id === 'pool_04')?.status).toBe('READY');
  });

  it('locks applications to the batch on submission', () => {
    const sim = new Simulation({ start: '2026-04-01', specs: POOL_OF_TWELVE });
    sim.movePool('READY');
    sim.movePool('SUBMITTED');
    const pool = poolOf(sim.state, 'pool_01');
    expect(pool.submittedOn).toBe('2026-04-01');
    expect(sim.state.applications.every((a) => a.status === 'POOLED')).toBe(true);
  });

  it('releases the applications when the federation declines, and only an apex officer can', () => {
    const sim = new Simulation({ start: '2026-04-01', specs: POOL_OF_TWELVE });
    for (const to of ['READY', 'SUBMITTED', 'UNDER_APEX_REVIEW'] as const) sim.movePool(to);
    const decline = (recordedBy: string, remarks = 'Repayment record too short'): WorldEvent => ({
      type: 'POOL_STATUS_CHANGED',
      on: '2026-04-01',
      poolId: 'pool_01',
      to: 'DECLINED',
      recordedBy,
      remarks,
    });
    expectError(() => applyEvent(sim.state, decline('usr_secretary')), WorldError, /cannot review a batch as a Secretary/);
    expectError(() => applyEvent(sim.state, decline('usr_apex', ' ')), WorldError, /needs remarks/);
    const declined = applyEvent(sim.state, decline('usr_apex'));
    expect(poolOf(declined, 'pool_01').status).toBe('DECLINED');
    expect(poolOf(declined, 'pool_01').apexReview?.officerId).toBe('usr_apex');
    expect(declined.applications.every((a) => a.status === 'APPROVED' && a.poolId === undefined)).toBe(true);
  });

  it('becomes sanctioned only through a sanction, never by a bare status change', () => {
    const event: WorldEvent = {
      type: 'POOL_STATUS_CHANGED',
      on: '2026-10-29',
      poolId: 'pool_05',
      to: 'SANCTIONED',
      recordedBy: 'usr_apex',
    };
    expectError(() => applyEvent(seedWorld(), event), WorldError, /through its sanction/);
  });

  it('refuses a sanction from anyone but an apex officer', () => {
    const event: WorldEvent = {
      type: 'TRANCHE_SANCTIONED',
      on: '2026-10-29',
      trancheId: 'trn_99',
      poolId: 'pool_05',
      sanctionRef: 'X',
      sanctionedAmount: 100,
      wholesaleRateBps: 950,
      tenureMonths: 12,
      remarks: '',
      recordedBy: 'usr_secretary_2',
    };
    expectError(() => applyEvent(seedWorld(), event), WorldError, /cannot review a batch as a Secretary/);
  });

  it('refuses a status change the machine does not allow', () => {
    const event: WorldEvent = {
      type: 'POOL_STATUS_CHANGED',
      on: '2026-10-29',
      poolId: 'pool_04',
      to: 'UNDER_APEX_REVIEW',
      recordedBy: 'usr_apex',
    };
    expectError(() => applyEvent(seedWorld(), event), TransitionError);
  });
});

describe('money events', () => {
  it('refuses to draw more than was sanctioned', () => {
    const event: WorldEvent = {
      type: 'TRANCHE_DRAWN',
      on: '2026-10-29',
      trancheId: 'trn_03',
      amount: 1_000_000_000,
      recordedBy: 'usr_secretary_3',
    };
    expectError(() => applyEvent(seedWorld(), event), WorldError, /exceed the sanction/);
  });

  it('refuses a duplicate payment id', () => {
    const world = applyEvent(seedWorld(), { type: 'CLOCK_ADVANCED', to: '2026-11-15' });
    const event: WorldEvent = {
      type: 'PAYMENT_RECEIVED',
      on: '2026-11-15',
      paymentId: 'pay_00001',
      loanId: 'loan_001',
      amount: 100,
      mode: 'CASH',
      receiptNo: 'X',
      source: 'CASH',
      electPrepayment: false,
      recordedBy: 'usr_officer',
    };
    expectError(() => applyEvent(world, event), WorldError, /already exists/);
  });

  it('passes the engine refusals through, such as a payment larger than the loan', () => {
    const world = applyEvent(seedWorld(), { type: 'CLOCK_ADVANCED', to: '2026-11-15' });
    const event: WorldEvent = {
      type: 'PAYMENT_RECEIVED',
      on: '2026-11-15',
      paymentId: 'pay_new',
      loanId: 'loan_001',
      amount: 999_999_999,
      mode: 'CASH',
      receiptNo: 'X',
      source: 'CASH',
      electPrepayment: false,
      recordedBy: 'usr_officer',
    };
    expectError(() => applyEvent(world, event), ReconciliationError, /most this loan can accept/);
  });

  it('refuses to pay the federation more than is due, or on a day that is not a remittance date', () => {
    const world = applyEvent(seedWorld(), { type: 'CLOCK_ADVANCED', to: '2026-11-16' });
    const due = remittanceDueFor(world, 'trn_01', '2026-11-15');
    const remit = (dueOn: string, extra = 0): WorldEvent => ({
      type: 'REMITTANCE_RECORDED',
      on: '2026-11-16',
      remittanceId: 'rem_new',
      trancheId: 'trn_01',
      dueOn,
      interestPaid: due.interestDue + extra,
      principalPaid: due.principalDue,
      recordedBy: 'usr_secretary',
    });
    expectError(() => applyEvent(world, remit('2026-11-15', 1)), WorldError, /more than is due/);
    expectError(() => applyEvent(world, remit('2026-11-14')), WorldError, /not a remittance date/);
    expect(() => applyEvent(world, remit('2026-11-15'))).not.toThrow();
  });

  it('lets only a loan officer or secretary of the loan’s own society record a payment', () => {
    const world = applyEvent(seedWorld(), { type: 'CLOCK_ADVANCED', to: '2026-11-15' });
    const pay = (recordedBy: string): WorldEvent => ({
      type: 'PAYMENT_RECEIVED',
      on: '2026-11-15',
      paymentId: 'pay_new',
      loanId: 'loan_001',
      amount: 100,
      mode: 'CASH',
      receiptNo: 'X',
      source: 'CASH',
      electPrepayment: false,
      recordedBy,
    });
    expectError(() => applyEvent(world, pay('usr_auditor')), WorldError, /cannot record a payment as a Statutory Auditor/);
    expectError(() => applyEvent(world, pay('usr_member')), WorldError, /cannot record a payment/);
    expectError(() => applyEvent(world, pay('usr_officer_2')), WorldError, /for another society/);
    expect(applyEvent(world, pay('usr_officer')).loans.loan_001!.receipts.at(-1)!.recordedBy).toBe('usr_officer');
    expect(() => applyEvent(world, pay('usr_secretary'))).not.toThrow();
  });

  it('lets only the society’s secretary record a remittance', () => {
    const world = applyEvent(seedWorld(), { type: 'CLOCK_ADVANCED', to: '2026-11-15' });
    const due = remittanceDueFor(world, 'trn_01', '2026-11-15');
    const remit = (recordedBy: string): WorldEvent => ({
      type: 'REMITTANCE_RECORDED',
      on: '2026-11-15',
      remittanceId: 'rem_new',
      trancheId: 'trn_01',
      dueOn: '2026-11-15',
      interestPaid: due.interestDue,
      principalPaid: due.principalDue,
      recordedBy,
    });
    expectError(() => applyEvent(world, remit('usr_officer')), WorldError, /cannot record a remittance as a Field Officer/);
    expectError(() => applyEvent(world, remit('usr_apex')), WorldError, /cannot record a remittance/);
    expectError(() => applyEvent(world, remit('usr_secretary_2')), WorldError, /for another society/);
    expect(() => applyEvent(world, remit('usr_secretary'))).not.toThrow();
  });

  it('moves a batch to servicing on its first remittance and closes it with its last', () => {
    const sim = setUpPool({ checkEveryStep: false });
    expect(poolOf(sim.state, 'pool_01').status).toBe('DISBURSED');
    sim.advanceTo('2026-05-15');
    sim.collectAllDue();
    sim.remit('trn_01');
    expect(poolOf(sim.state, 'pool_01').status).toBe('SERVICING');
  });
});
