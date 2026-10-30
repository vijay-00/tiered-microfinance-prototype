import { describe, expect, it } from 'vitest';
import { loadScenarioA } from '@/data/seed';
import { applyEvent, createWorld, replay } from '@/domain/world';
import { createAppStore } from '../appStore';
import {
  drawAndDisburseEvents,
  dueTodayEvents,
  loanIdFor,
  nextApplicationId,
  nextPaymentNumbers,
  nextPoolId,
  nextPoolReference,
  nextRemittanceId,
  nextSanctionRef,
  nextTrancheId,
  paymentEvent,
  sanctionEvent,
  savePoolEvents,
} from '../commands';

const seedWorld = () => {
  const seed = loadScenarioA();
  return replay(createWorld(seed.base), seed.events);
};

describe('numbering', () => {
  const world = seedWorld();

  it('continues the society’s own receipt series and the global payment ids', () => {
    // Annapoorani has 72 receipts in the seed, Grama Valarchi 112, Sakthi Mahalir 36.
    expect(nextPaymentNumbers(world, 'soc_1', 2)).toEqual([
      { paymentId: 'pay_00221', receiptNo: 'ANN/R/00073' },
      { paymentId: 'pay_00222', receiptNo: 'ANN/R/00074' },
    ]);
    expect(nextPaymentNumbers(world, 'soc_3')[0]!.receiptNo).toBe('SHM/R/00037');
  });

  it('continues the remittance ids', () => {
    expect(nextRemittanceId(world)).toBe('rem_00018');
  });

  it('dates new events today and names who made them', () => {
    const event = paymentEvent(
      world,
      { loanId: 'loan_001', amount: 100, mode: 'UPI', source: 'CASH', electPrepayment: false },
      'usr_officer',
    );
    expect(event).toMatchObject({ type: 'PAYMENT_RECEIVED', on: '2026-10-29', recordedBy: 'usr_officer' });
  });

  it('builds one full cash receipt for each instalment due today, numbered in order', () => {
    const world15 = applyEvent(world, { type: 'CLOCK_ADVANCED', to: '2026-11-15' });
    const events = dueTodayEvents(world15, 'soc_1', 'usr_officer');
    expect(events).toHaveLength(12);
    expect(events.map((e) => (e.type === 'PAYMENT_RECEIVED' ? e.receiptNo : ''))).toEqual(
      Array.from({ length: 12 }, (_, i) => `ANN/R/000${73 + i}`),
    );
  });
});

describe('dispatching several events', () => {
  it('applies all or none', () => {
    const store = createAppStore();
    store.getState().advanceClock('2026-11-15');
    const world = store.getState().world;
    const good = dueTodayEvents(world, 'soc_1', 'usr_officer');
    const bad = { ...good[0]!, recordedBy: 'usr_auditor' };

    const refused = store.getState().dispatchMany([...good.slice(1), bad], { quiet: true });
    expect(refused.ok).toBe(false);
    expect(store.getState().world).toBe(world);
    expect(store.getState().notice).toBeUndefined();

    expect(store.getState().dispatchMany(good).ok).toBe(true);
    expect(store.getState().userEvents).toHaveLength(1 + 12);
  });
});

describe('origination numbering', () => {
  const world = seedWorld();

  it('continues the application, batch and tranche ids', () => {
    expect(nextApplicationId(world)).toBe('app_070');
    expect(nextPoolId(world)).toBe('pool_06');
    expect(nextTrancheId(world)).toBe('trn_04');
  });

  it('numbers each society’s batches afresh each financial year', () => {
    // Annapoorani has POOL /01 and /02 this year; Sakthi Mahalir /01; Grama Valarchi’s /04 was last year’s.
    // New ones are batches, numbered on from the pools of the same year.
    expect(nextPoolReference(world, 'soc_1')).toBe('ANN/BATCH/2026-27/03');
    expect(nextPoolReference(world, 'soc_2')).toBe('GRM/BATCH/2026-27/03');
    expect(nextPoolReference(world, 'soc_3')).toBe('SHM/BATCH/2026-27/02');
    const april = applyEvent(world, { type: 'CLOCK_ADVANCED', to: '2027-04-01' });
    expect(nextPoolReference(april, 'soc_1')).toBe('ANN/BATCH/2027-28/01');
  });

  it('numbers sanctions across the federation', () => {
    expect(nextSanctionRef(world)).toBe('PACF/SAN/2026-27/022');
    const event = sanctionEvent(
      world,
      { poolId: 'pool_05', sanctionedAmount: 100_000, wholesaleRateBps: 950, tenureMonths: 24, remarks: '' },
      'usr_apex',
    );
    expect(event).toMatchObject({ trancheId: 'trn_04', sanctionRef: 'PACF/SAN/2026-27/022', on: '2026-10-29' });
  });

  it('names a loan after its application, unless that name is taken', () => {
    expect(loanIdFor(world, 'app_070')).toBe('loan_070');
    expect(loanIdFor(world, 'app_001')).toBe('loan_039');
    expect(loanIdFor(world, 'app_070', new Set(['loan_070']))).toBe('loan_071');
  });

  it('opens a batch, or changes one, and submits it in the same breath', () => {
    const opened = savePoolEvents(world, { societyId: 'soc_1', applicationIds: ['app_061'] }, 'usr_secretary', false);
    expect(opened.poolId).toBe('pool_06');
    expect(opened.events).toEqual([
      expect.objectContaining({ type: 'POOL_CREATED', poolId: 'pool_06', reference: 'ANN/BATCH/2026-27/03' }),
    ]);
    const ids = [...world.pools.find((p) => p.id === 'pool_04')!.applicationIds, 'app_061', 'app_062'];
    const submitted = savePoolEvents(world, { societyId: 'soc_1', poolId: 'pool_04', applicationIds: ids }, 'usr_secretary', true);
    expect(submitted.events.map((e) => e.type)).toEqual(['POOL_APPLICATIONS_SET', 'POOL_STATUS_CHANGED']);
    const after = submitted.events.reduce(applyEvent, world);
    expect(after.pools.find((p) => p.id === 'pool_04')!.status).toBe('SUBMITTED');
  });

  it('draws only what the chosen loans need beyond money already drawn and not lent', () => {
    let w = applyEvent(world, sanctionEvent(world, { poolId: 'pool_05', sanctionedAmount: 75_000_000, wholesaleRateBps: 950, tenureMonths: 24, remarks: '' }, 'usr_apex'));
    const pooled = w.pools.find((p) => p.id === 'pool_05')!.applicationIds;
    const amountOf = (id: string) => w.applications.find((a) => a.id === id)!.decision!.sanctionedAmount;
    // Draw a little ahead, then disburse two loans: only the rest is drawn.
    w = applyEvent(w, { type: 'TRANCHE_DRAWN', on: w.clock, trancheId: 'trn_04', amount: 100_000, recordedBy: 'usr_secretary_2' });
    const plan = drawAndDisburseEvents(w, { trancheId: 'trn_04', applicationIds: pooled.slice(0, 2), firstDueOn: '2026-11-29' }, 'usr_secretary_2');
    expect(plan.drawn).toBe(amountOf(pooled[0]!) + amountOf(pooled[1]!) - 100_000);
    expect(plan.loanIds).toEqual(pooled.slice(0, 2).map((id) => id.replace('app_', 'loan_')));
    expect(plan.events.map((e) => e.type)).toEqual(['TRANCHE_DRAWN', 'LOAN_DISBURSED', 'LOAN_DISBURSED']);
    expect(() => plan.events.reduce(applyEvent, w)).not.toThrow();
  });
});
