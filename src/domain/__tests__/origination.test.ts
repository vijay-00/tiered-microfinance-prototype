import { describe, expect, it } from 'vitest';
import { loadScenarioA } from '@/data/seed';
import { financialYear } from '../dates';
import { generateSchedule } from '../interest';
import { ACCOUNTS } from '../ledger';
import { sum } from '../money';
import {
  applicationQueue,
  disbursementPlan,
  poolDetail,
  proRataRescope,
  fundingRequests,
  memberProfile,
  poolEconomics,
  poolReview,
  quoteLoan,
  repaymentCapacity,
  societyTrackRecord,
} from '../origination';
import {
  applicationOf,
  applyEvent,
  createWorld,
  invariantsBySociety,
  journalOf,
  loanOf,
  poolOf,
  positionOf,
  remittanceDueFor,
  replay,
  trancheOf,
  WorldError,
  type WorldBase,
  type WorldEvent,
  type WorldState,
} from '../world';

/**
 * Phase 4: origination. A member's application becomes a disbursed, scheduled,
 * serviceable loan, with the correct journal entries at every step, and every
 * rule on the way is the reducer's to enforce.
 */

const ON = '2026-10-29';

const seedWorld = (adjust?: (base: WorldBase) => WorldBase): WorldState => {
  const seed = loadScenarioA();
  return replay(createWorld(adjust ? adjust(seed.base) : seed.base), seed.events);
};

function expectError(fn: () => unknown, pattern: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorldError);
    expect((error as Error).message).toMatch(pattern);
    return;
  }
  throw new Error(`expected a WorldError matching ${pattern}`);
}

function expectInvariants(world: WorldState) {
  const results = Object.values(invariantsBySociety(world)).flat();
  expect(results).toHaveLength(36);
  expect(results.filter((r) => !r.ok)).toEqual([]);
}

const submit = (overrides: Partial<Extract<WorldEvent, { type: 'APPLICATION_SUBMITTED' }>> = {}): WorldEvent => ({
  type: 'APPLICATION_SUBMITTED',
  on: ON,
  applicationId: 'app_900',
  memberId: 'mem_030',
  requestedAmount: 4_000_000,
  requestedTenureMonths: 12,
  purpose: 'DAIRY',
  recordedBy: 'usr_officer',
  ...overrides,
});

const appraise = (applicationId: string, recommendedAmount: number, recordedBy = 'usr_officer'): WorldEvent => ({
  type: 'APPLICATION_APPRAISED',
  on: ON,
  applicationId,
  monthlyIncome: 1_800_000,
  existingObligations: 200_000,
  recommendedAmount,
  notes: 'Visited the household',
  recordedBy,
});

const decide = (
  applicationId: string,
  recordedBy: string,
  sanctionedAmount: number,
  tenureMonths: number,
  outcome: 'APPROVED' | 'REJECTED' = 'APPROVED',
  reason?: string,
): WorldEvent => ({
  type: 'APPLICATION_DECIDED',
  on: ON,
  applicationId,
  outcome,
  sanctionedAmount,
  tenureMonths,
  reason,
  recordedBy,
});

const LOOSE = ['app_061', 'app_062', 'app_063'];

describe('the Phase 4 gate', () => {
  it('takes an application to a disbursed, scheduled, serviceable loan, with the right journal at every step', () => {
    let world = seedWorld();
    const apply = (event: WorldEvent) => {
      world = applyEvent(world, event);
      expectInvariants(world);
    };
    const journal = () => journalOf(world, 'soc_1');
    const before = journal().length;

    apply(submit());
    expect(applicationOf(world, 'app_900').status).toBe('SUBMITTED');
    apply(appraise('app_900', 4_000_000));
    expect(applicationOf(world, 'app_900').appraisal).toMatchObject({ officerId: 'usr_officer', recommendedAmount: 4_000_000 });
    apply(decide('app_900', 'usr_officer', 4_000_000, 12));
    expect(applicationOf(world, 'app_900')).toMatchObject({
      status: 'APPROVED',
      decision: { by: 'usr_officer', sanctionedAmount: 4_000_000, rateBps: 1150 },
    });
    // Applying and deciding move no money, so nothing is posted.
    expect(journal()).toHaveLength(before);

    const ids = [...poolOf(world, 'pool_04').applicationIds, ...LOOSE, 'app_900'];
    apply({ type: 'POOL_APPLICATIONS_SET', on: ON, poolId: 'pool_04', applicationIds: ids, recordedBy: 'usr_secretary' });
    expect(poolOf(world, 'pool_04')).toMatchObject({ status: 'READY', requestedTenureMonths: 24 });
    apply({ type: 'POOL_STATUS_CHANGED', on: ON, poolId: 'pool_04', to: 'SUBMITTED', recordedBy: 'usr_secretary' });
    expect(ids.every((id) => applicationOf(world, id).status === 'POOLED')).toBe(true);
    apply({ type: 'POOL_STATUS_CHANGED', on: ON, poolId: 'pool_04', to: 'UNDER_APEX_REVIEW', recordedBy: 'usr_apex' });
    const pool = poolOf(world, 'pool_04');
    expect(pool.requestedAmount).toBe(sum(ids.map((id) => applicationOf(world, id).decision!.sanctionedAmount)));
    apply({
      type: 'TRANCHE_SANCTIONED',
      on: ON,
      trancheId: 'trn_90',
      poolId: 'pool_04',
      sanctionRef: 'PACF/SAN/TEST/1',
      sanctionedAmount: pool.requestedAmount,
      wholesaleRateBps: 950,
      tenureMonths: 24,
      remarks: 'In full',
      recordedBy: 'usr_apex',
    });
    // A sanction is a promise to lend, not money moved.
    expect(journal()).toHaveLength(before);
    expect(poolOf(world, 'pool_04')).toMatchObject({ status: 'SANCTIONED', apexReview: { officerId: 'usr_apex' } });

    apply({ type: 'TRANCHE_DRAWN', on: ON, trancheId: 'trn_90', amount: pool.requestedAmount, recordedBy: 'usr_secretary' });
    expect(journal().at(-1)).toMatchObject({ sourceType: 'DRAWDOWN', sourceId: 'trn_90' });
    expect(journal().at(-1)!.lines).toEqual([
      { accountCode: ACCOUNTS.CASH, dr: pool.requestedAmount, cr: 0 },
      { accountCode: ACCOUNTS.FEDERATION_PAYABLE, dr: 0, cr: pool.requestedAmount },
    ]);

    for (const applicationId of ids) {
      const loanId = applicationId.replace('app_', 'loan_');
      const amount = applicationOf(world, applicationId).decision!.sanctionedAmount;
      apply({ type: 'LOAN_DISBURSED', on: ON, loanId, applicationId, trancheId: 'trn_90', firstDueOn: '2026-11-29', recordedBy: 'usr_secretary' });
      expect(journal().at(-1)).toMatchObject({ sourceType: 'DISBURSEMENT', sourceId: loanId });
      expect(journal().at(-1)!.lines).toEqual([
        { accountCode: ACCOUNTS.LOANS_RECEIVABLE, dr: amount, cr: 0 },
        { accountCode: ACCOUNTS.CASH, dr: 0, cr: amount },
      ]);
    }
    expect(journal()).toHaveLength(before + 1 + ids.length);
    expect(poolOf(world, 'pool_04').status).toBe('DISBURSED');
    expect(trancheOf(world, 'trn_90').tranche.status).toBe('DRAWN');
    expect(applicationOf(world, 'app_900').status).toBe('DISBURSED');

    // Scheduled: twelve rows at the retail rate, repaying exactly the principal.
    const { loan, schedule } = loanOf(world, 'loan_900');
    expect(loan).toMatchObject({ principal: 4_000_000, rateBps: 1150, tenureMonths: 12, firstDueOn: '2026-11-29', status: 'ACTIVE' });
    expect(schedule).toHaveLength(12);
    expect(sum(schedule.map((r) => r.principal))).toBe(4_000_000);
    expect(schedule.at(-1)!.closing).toBe(0);
    expect(loan.emi).toBe(quoteLoan(4_000_000, 12, 1150, ON)!.emi);

    // Serviceable: the first instalment falls due, is paid, and the federation is owed its share.
    apply({ type: 'CLOCK_ADVANCED', to: '2026-11-29' });
    expect(positionOf(world, 'loan_900').totalDueNow).toBe(loan.emi);
    apply({
      type: 'PAYMENT_RECEIVED',
      on: '2026-11-29',
      paymentId: 'pay_900',
      loanId: 'loan_900',
      amount: loan.emi,
      mode: 'CASH',
      receiptNo: 'ANN/R/T0001',
      source: 'CASH',
      electPrepayment: false,
      recordedBy: 'usr_officer',
    });
    expect(positionOf(world, 'loan_900')).toMatchObject({ totalDueNow: 0, principalOutstanding: schedule[0]!.closing });
    expect(journal().at(-1)).toMatchObject({ sourceType: 'PAYMENT' });
    expect(remittanceDueFor(world, 'trn_90', '2026-11-29').interestDue).toBeGreaterThan(0);
  });
});

describe('applications', () => {
  it('takes one at a time per member, from active members, within the ticket and tenure limits', () => {
    const world = seedWorld();
    expectError(() => applyEvent(world, submit({ memberId: 'mem_024' })), /already has application app_064 in progress/);
    expectError(() => applyEvent(world, submit({ memberId: 'mem_029' })), /dormant and cannot apply/);
    expectError(() => applyEvent(world, submit({ requestedAmount: 100_000 })), /between ₹5,000.00 and ₹5,00,000.00/);
    expectError(() => applyEvent(world, submit({ requestedTenureMonths: 2 })), /between 3 and 60 whole months/);
    expectError(() => applyEvent(world, submit({ recordedBy: 'usr_officer_2' })), /for another society/);
    expectError(() => applyEvent(world, submit({ recordedBy: 'usr_auditor' })), /cannot submit an application/);
    expectError(() => applyEvent(world, submit({ applicationId: 'app_001' })), /already exists/);
  });

  it('cannot recommend more than was asked for', () => {
    const world = applyEvent(seedWorld(), submit());
    expectError(() => applyEvent(world, appraise('app_900', 4_000_100)), /cannot recommend more than was requested/);
  });

  it('lets a loan officer decide up to the limit, and only the secretary above it', () => {
    // app_065: Rs 75,000 asked for, under appraisal.
    const world = seedWorld();
    expectError(
      () => applyEvent(world, decide('app_065', 'usr_officer', 7_000_000, 18)),
      /cannot decide ₹70,000.00: above the ₹50,000.00 officer limit, the secretary decides/,
    );
    // Cut to the limit, it is the officer's to approve.
    expect(applicationOf(applyEvent(world, decide('app_065', 'usr_officer', 5_000_000, 18)), 'app_065').status).toBe('APPROVED');
    // Rejecting puts the whole request at stake.
    expectError(() => applyEvent(world, decide('app_065', 'usr_officer', 0, 18, 'REJECTED', 'Thin records')), /officer limit/);
    expect(applicationOf(applyEvent(world, decide('app_065', 'usr_secretary', 7_000_000, 18)), 'app_065').decision).toMatchObject({
      by: 'usr_secretary',
      sanctionedAmount: 7_000_000,
    });
    expectError(() => applyEvent(world, decide('app_065', 'usr_secretary', 0, 18, 'REJECTED', ' ')), /needs a reason/);
    expectError(() => applyEvent(world, decide('app_065', 'usr_secretary', 8_000_000, 18)), /more than was requested/);
    // Not yet appraised: the state machine refuses it.
    expect(() => applyEvent(world, decide('app_066', 'usr_secretary', 7_500_000, 18))).toThrow(/cannot move from SUBMITTED to APPROVED/);
  });

  it('holds a member’s total borrowing to the limit per member', () => {
    // mem_001 is still repaying loan_001.
    let world = seedWorld();
    expect(positionOf(world, 'loan_001').principalOutstanding).toBeGreaterThan(0);
    world = applyEvent(world, submit({ applicationId: 'app_901', memberId: 'mem_001', requestedAmount: 50_000_000, recordedBy: 'usr_secretary' }));
    world = applyEvent(world, appraise('app_901', 50_000_000, 'usr_secretary'));
    expectError(() => applyEvent(world, decide('app_901', 'usr_secretary', 50_000_000, 12)), /above the ₹5,00,000.00 limit per member/);
    expect(() => applyEvent(world, decide('app_901', 'usr_secretary', 40_000_000, 12))).not.toThrow();
  });
});

describe('pools', () => {
  const set = (applicationIds: string[], recordedBy = 'usr_secretary'): WorldEvent => ({
    type: 'POOL_APPLICATIONS_SET',
    on: ON,
    poolId: 'pool_04',
    applicationIds,
    recordedBy,
  });

  it('is ready once it holds ten, and goes back to being built below that', () => {
    let world = seedWorld();
    const eight = poolOf(world, 'pool_04').applicationIds;
    world = applyEvent(world, set([...eight, ...LOOSE]));
    expect(poolOf(world, 'pool_04')).toMatchObject({ status: 'READY', applicationIds: [...eight, ...LOOSE] });
    expect(applicationOf(world, 'app_061').poolId).toBe('pool_04');
    world = applyEvent(world, set([...eight]));
    expect(poolOf(world, 'pool_04').status).toBe('OPEN');
    expect(applicationOf(world, 'app_061').poolId).toBeUndefined();
  });

  it('takes only approved applications of its own society that no other pool holds', () => {
    const world = seedWorld();
    const eight = poolOf(world, 'pool_04').applicationIds;
    expectError(() => applyEvent(world, set([...eight, 'app_064'])), /app_064 is UNDER_APPRAISAL, not approved/);
    expectError(() => applyEvent(world, set([...eight, poolOf(world, 'pool_05').applicationIds[0]!])), /belongs to another society/);
    expectError(() => applyEvent(world, set([...eight, eight[0]!])), /listed twice/);
    expectError(
      () =>
        applyEvent(world, {
          type: 'POOL_CREATED',
          on: ON,
          poolId: 'pool_99',
          reference: 'ANN/POOL/TEST/01',
          applicationIds: [eight[0]!],
          recordedBy: 'usr_secretary',
        }),
      /already in another pool/,
    );
  });

  it('is built and submitted only by the secretary', () => {
    const world = seedWorld();
    expectError(() => applyEvent(world, set([...LOOSE], 'usr_officer')), /cannot build or submit a pool as a Field Officer/);
    expectError(
      () => applyEvent(world, { type: 'POOL_CREATED', on: ON, poolId: 'pool_99', reference: 'X', applicationIds: [], recordedBy: 'usr_apex' }),
      /cannot build or submit a pool/,
    );
    expectError(() => applyEvent(world, set([...LOOSE], 'usr_secretary_2')), /for another society/);
  });
});

describe('sanction and disbursement', () => {
  // pool_05: Grama Valarchi, ten members, Rs 7,50,000 over up to 24 months, under review.
  const sanction = (sanctionedAmount: number, tenureMonths = 24): WorldEvent => ({
    type: 'TRANCHE_SANCTIONED',
    on: ON,
    trancheId: 'trn_90',
    poolId: 'pool_05',
    sanctionRef: 'PACF/SAN/TEST/1',
    sanctionedAmount,
    wholesaleRateBps: 950,
    tenureMonths,
    remarks: '',
    recordedBy: 'usr_apex',
  });
  const disburse = (applicationId: string, recordedBy = 'usr_secretary_2'): WorldEvent => ({
    type: 'LOAN_DISBURSED',
    on: ON,
    loanId: applicationId.replace('app_', 'loan_'),
    applicationId,
    trancheId: 'trn_90',
    firstDueOn: '2026-12-05',
    recordedBy,
  });
  const draw = (amount: number): WorldEvent => ({ type: 'TRANCHE_DRAWN', on: ON, trancheId: 'trn_90', amount, recordedBy: 'usr_secretary_2' });

  it('keeps a society within its credit limit', () => {
    const world = seedWorld();
    // Leave Grama Valarchi Rs 1,000 of headroom.
    const tight = seedWorld((base) => ({
      ...base,
      societies: base.societies.map((s) =>
        s.id === 'soc_2' ? { ...s, creditLimit: s.creditLimit - societyTrackRecord(world, 'soc_2').headroom + 100_000 } : s,
      ),
    }));
    expectError(() => applyEvent(tight, sanction(75_000_000)), /above its ₹\d[\d,]*\.\d\d credit limit/);
    expect(() => applyEvent(tight, sanction(100_000))).not.toThrow();
  });

  it('runs at least as long as the longest loan in the pool, and never above what was asked', () => {
    const world = seedWorld();
    expectError(() => applyEvent(world, sanction(75_000_000, 18)), /at least as long as the pool's longest loan, 24 months/);
    expectError(() => applyEvent(world, sanction(75_000_100)), /cannot exceed what the pool requested/);
  });

  it('lends only what has been drawn', () => {
    let world = applyEvent(seedWorld(), sanction(75_000_000));
    const first = poolOf(world, 'pool_05').applicationIds[0]!;
    expectError(() => applyEvent(world, disburse(first)), /draw down first: ₹0.00 of the tranche is drawn and not yet lent/);
    world = applyEvent(world, draw(applicationOf(world, first).decision!.sanctionedAmount));
    expect(() => applyEvent(world, disburse(first))).not.toThrow();
    expectError(() => applyEvent(world, disburse(first, 'usr_officer_2')), /cannot draw down or disburse as a Field Officer/);
  });

  const rescope = (
    method: 'PRO_RATA' | 'REMOVE',
    keep: Array<{ applicationId: string; amount: number }>,
    recordedBy = 'usr_secretary_2',
  ): WorldEvent => ({ type: 'POOL_RESCOPED', on: ON, poolId: 'pool_05', method, keep, recordedBy });

  it('refuses any drawdown on an under-sanctioned pool until it is re-scoped', () => {
    const world = applyEvent(seedWorld(), sanction(60_000_000));
    expectError(
      () => applyEvent(world, draw(100_000)),
      /re-scope GRM\/POOL\/2026-27\/02 first: its members ask for ₹7,50,000.00 against a ₹6,00,000.00 sanction/,
    );
    expect(disbursementPlan(world, 'trn_90').rescope).toMatchObject({ asked: 75_000_000, sanctioned: 60_000_000 });
    expect(poolDetail(world, 'pool_05').shortfall).toBe(15_000_000);
  });

  it('cuts every member pro rata, to the rupee, keeping the cut on record', () => {
    let world = applyEvent(seedWorld(), sanction(60_000_000));
    const ids = poolOf(world, 'pool_05').applicationIds;
    const lines = ids.map((id) => ({ applicationId: id, amount: applicationOf(world, id).decision!.sanctionedAmount }));
    const cut = proRataRescope(lines, 60_000_000);
    expect(cut.every((c) => c.amount % 100 === 0)).toBe(true);
    expect(sum(cut.map((c) => c.amount))).toBeLessThanOrEqual(60_000_000);
    expectError(() => applyEvent(world, rescope('PRO_RATA', cut.slice(1))), /pro rata cut keeps every member/);
    expectError(() => applyEvent(world, rescope('PRO_RATA', cut, 'usr_officer_2')), /cannot build or submit a pool/);
    world = applyEvent(world, rescope('PRO_RATA', cut));
    const first = applicationOf(world, ids[0]!);
    expect(first.decision).toMatchObject({ sanctionedAmount: cut[0]!.amount, rescopedFrom: lines[0]!.amount });
    expect(poolOf(world, 'pool_05').rescope).toMatchObject({ method: 'PRO_RATA', removed: [], askedBefore: 75_000_000 });
    expect(poolDetail(world, 'pool_05').shortfall).toBe(0);
    // Now it fits: draw what the cut loans need and disburse every one.
    const needed = sum(cut.map((c) => c.amount));
    world = applyEvent(world, draw(needed));
    for (const id of ids) world = applyEvent(world, disburse(id));
    expectInvariants(world);
    expect(world.loans[ids[0]!.replace('app_', 'loan_')]!.loan.principal).toBe(cut[0]!.amount);
  });

  it('removes members until the rest fit, releasing them for another pool', () => {
    let world = applyEvent(seedWorld(), sanction(60_000_000));
    const ids = poolOf(world, 'pool_05').applicationIds;
    const amount = (id: string) => applicationOf(world, id).decision!.sanctionedAmount;
    const keep: string[] = [];
    let left = 60_000_000;
    for (const id of ids) {
      if (amount(id) <= left) {
        keep.push(id);
        left -= amount(id);
      }
    }
    const lines = keep.map((id) => ({ applicationId: id, amount: amount(id) }));
    expectError(
      () => applyEvent(world, rescope('REMOVE', ids.map((id) => ({ applicationId: id, amount: amount(id) })))),
      /would still ask for ₹7,50,000.00 against a ₹6,00,000.00 sanction/,
    );
    expectError(
      () => applyEvent(world, rescope('REMOVE', [{ ...lines[0]!, amount: lines[0]!.amount - 100 }, ...lines.slice(1)])),
      /keeps the others at their approved amounts/,
    );
    world = applyEvent(world, rescope('REMOVE', lines));
    const removed = ids.filter((id) => !keep.includes(id));
    expect(removed.length).toBeGreaterThan(0);
    for (const id of removed) {
      expect(applicationOf(world, id).status).toBe('APPROVED');
      expect(applicationOf(world, id).poolId).toBeUndefined();
    }
    expect(poolOf(world, 'pool_05').applicationIds).toEqual(keep);
    expectError(() => applyEvent(world, rescope('REMOVE', lines)), /already covers/);
    world = applyEvent(world, draw(sum(lines.map((l) => l.amount))));
    for (const id of keep) world = applyEvent(world, disburse(id));
    expectInvariants(world);
  });

  it('will not cut a loan below the minimum ticket, or re-scope once money has moved', () => {
    let world = applyEvent(seedWorld(), sanction(5_000_000));
    const ids = poolOf(world, 'pool_05').applicationIds;
    const cut = proRataRescope(
      ids.map((id) => ({ applicationId: id, amount: applicationOf(world, id).decision!.sanctionedAmount })),
      5_000_000,
    );
    expectError(() => applyEvent(world, rescope('PRO_RATA', cut)), /below the ₹5,000.00 minimum: remove members instead/);

    world = applyEvent(seedWorld(), sanction(75_000_000));
    expectError(
      () => applyEvent(world, rescope('PRO_RATA', ids.map((id) => ({ applicationId: id, amount: 100_000 })))),
      /already covers/,
    );
  });
});

describe('read models', () => {
  it('sorts the seed’s applications by stage', () => {
    const queue = applicationQueue(seedWorld(), 'soc_1');
    const counts = Object.fromEntries(Object.entries(queue).map(([stage, rows]) => [stage, rows.length]));
    expect(counts).toEqual({
      NEEDS_APPRAISAL: 2,
      AWAITING_DECISION: 2,
      READY_TO_POOL: 3,
      IN_POOL: 8,
      DISBURSED: 12,
      REJECTED: 1,
    });
    const app065 = queue.AWAITING_DECISION.find((r) => r.application.id === 'app_065')!;
    expect(app065).toMatchObject({ amount: 7_000_000, authority: 'SECRETARY' });
  });

  it('quotes the EMI the schedule generator will charge', () => {
    const quote = quoteLoan(4_000_000, 12, 1150, ON)!;
    const schedule = generateSchedule({ loanId: 'q', principal: 4_000_000, annualBps: 1150, tenureMonths: 12, firstDueOn: '2026-11-29' });
    expect(quote.emi).toBe(schedule[0]!.instalment);
    expect(quote.totalInterest).toBe(sum(schedule.map((r) => r.interest)));
    expect(quoteLoan(0, 12, 1150, ON)).toBeUndefined();
    expect(quoteLoan(4_000_000, 0, 1150, ON)).toBeUndefined();
  });

  it('says whether a member can apply, and why not', () => {
    const world = seedWorld();
    expect(memberProfile(world, 'mem_030')).toMatchObject({ exposure: 0, headroom: 50_000_000, canApply: { ok: true } });
    expect(memberProfile(world, 'mem_024').canApply).toEqual({ ok: false, reason: 'Application app_064 is already in progress.' });
    expect(memberProfile(world, 'mem_029').canApply.reason).toMatch(/dormant/);
  });

  it('measures repayments against half the monthly income', () => {
    expect(repaymentCapacity(1_000_000, 200_000, 300_000)).toMatchObject({ share: 0.5, withinCap: true });
    expect(repaymentCapacity(1_000_000, 200_000, 300_001).withinCap).toBe(false);
    expect(repaymentCapacity(0, 0, 300_000)).toMatchObject({ share: undefined, withinCap: false });
  });

  it('prices a pool at both rates, and the margin is the difference', () => {
    const world = seedWorld();
    const ids = [...poolOf(world, 'pool_04').applicationIds, ...LOOSE];
    const economics = poolEconomics(world, ids);
    expect(economics.count).toBe(11);
    expect(economics.total).toBe(sum(ids.map((id) => applicationOf(world, id).decision!.sanctionedAmount)));
    expect(economics.margin).toBe(economics.retailInterest - economics.wholesaleInterest);
    // Charged on the same balances, wholesale interest is 9.5/11.5 of retail, give or take rounding.
    expect(economics.wholesaleInterest / economics.retailInterest).toBeCloseTo(950 / 1150, 2);
    expect(economics.readiness.ready).toBe(true);
    expect(poolEconomics(world, ids.slice(0, 8)).readiness.reason).toBe('Add 2 more members: a pool needs at least 10.');
  });

  it('queues submitted pools for the federation, oldest first, and caps a sanction at the headroom', () => {
    let world = seedWorld();
    world = applyEvent(world, {
      type: 'POOL_APPLICATIONS_SET',
      on: ON,
      poolId: 'pool_04',
      applicationIds: [...poolOf(world, 'pool_04').applicationIds, ...LOOSE],
      recordedBy: 'usr_secretary',
    });
    world = applyEvent(world, { type: 'POOL_STATUS_CHANGED', on: ON, poolId: 'pool_04', to: 'SUBMITTED', recordedBy: 'usr_secretary' });
    expect(fundingRequests(world).map((r) => [r.pool.id, r.waitingDays])).toEqual([
      ['pool_05', 9],
      ['pool_04', 0],
    ]);
    const review = poolReview(world, 'pool_04');
    expect(review.maxSanction).toBe(Math.min(review.detail.pool.requestedAmount, review.track.headroom));
    expect(review.composition.purposes.reduce((n, p) => n + p.count, 0)).toBe(11);
  });

  it('reads a society’s track record off its remittances', () => {
    const world = seedWorld();
    const track = societyTrackRecord(world, 'soc_1');
    const made = Object.values(world.tranches)
      .filter((t) => t.tranche.societyId === 'soc_1')
      .flatMap((t) => t.remittances);
    expect(track.remittancesMade).toBe(made.length);
    expect(track.remittancesOnTime).toBeLessThanOrEqual(track.remittancesMade);
    expect(track.headroom).toBe(track.creditLimit - track.sanctionedOpen);
  });

  it('suggests a first due date on the tranche’s own collection day when it leaves a fair first month', () => {
    let world = seedWorld();
    world = applyEvent(world, {
      type: 'TRANCHE_SANCTIONED',
      on: ON,
      trancheId: 'trn_90',
      poolId: 'pool_05',
      sanctionRef: 'PACF/SAN/TEST/1',
      sanctionedAmount: 75_000_000,
      wholesaleRateBps: 950,
      tenureMonths: 24,
      remarks: '',
      recordedBy: 'usr_apex',
    });
    const fresh = disbursementPlan(world, 'trn_90');
    expect(fresh).toMatchObject({ idle: 0, undrawn: 75_000_000, capacity: 75_000_000, suggestedFirstDueOn: '2026-11-29' });
    expect(fresh.candidates).toHaveLength(10);

    const first = fresh.candidates[0]!;
    world = applyEvent(world, { type: 'TRANCHE_DRAWN', on: ON, trancheId: 'trn_90', amount: first.amount, recordedBy: 'usr_secretary_2' });
    world = applyEvent(world, {
      type: 'LOAN_DISBURSED',
      on: ON,
      loanId: 'loan_901',
      applicationId: first.application.id,
      trancheId: 'trn_90',
      firstDueOn: '2026-12-05',
      recordedBy: 'usr_secretary_2',
    });
    expect(disbursementPlan(world, 'trn_90')).toMatchObject({ suggestedFirstDueOn: '2026-12-05', capacity: 75_000_000 - first.amount });
    // Ten days before it, the next one along leaves the fairer first month.
    world = applyEvent(world, { type: 'CLOCK_ADVANCED', to: '2026-11-25' });
    expect(disbursementPlan(world, 'trn_90').suggestedFirstDueOn).toBe('2027-01-05');
  });
});

describe('financial years', () => {
  it('run April to March', () => {
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2099-12-31')).toBe('2099-00');
  });
});
