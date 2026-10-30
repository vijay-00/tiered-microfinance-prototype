import { describe, expect, it } from 'vitest';
import { loadScenarioA } from '@/data/seed';
import { sum } from '../money';
import { apexExposure, memberLoans, societySummary } from '../views';
import { applyEvent, createWorld, positionOf, replay, trancheOutstanding, type WorldState } from '../world';

const seedWorld = (): WorldState => {
  const seed = loadScenarioA();
  return replay(createWorld(seed.base), seed.events);
};
const at = (world: WorldState, to: string) => applyEvent(world, { type: 'CLOCK_ADVANCED', to });

describe('the society summary', () => {
  const world = seedWorld();
  const summary = societySummary(world, 'soc_1');

  it('starts scenario A with the demo batch up to date', () => {
    expect(summary.asOf).toBe('2026-10-29');
    expect(summary.activeLoans).toBe(12);
    expect(summary.dueToday.count).toBe(0);
    expect(summary.overdue.count).toBe(0);
    expect(summary.liquidityBreach).toBe(false);
  });

  it('agrees with the loans and tranches it summarises', () => {
    const loans = Object.values(world.loans).filter((l) => l.loan.societyId === 'soc_1');
    expect(summary.loansOutstanding).toBe(sum(loans.map((l) => positionOf(world, l.loan.id).principalOutstanding)));
    expect(summary.federationPayable).toBe(trancheOutstanding(world.tranches.trn_01!));
    expect(summary.netInterestIncome).toBeGreaterThan(0);
  });

  it('points at the next remittance, on the demo batch date', () => {
    expect(summary.nextRemittance).toMatchObject({ trancheId: 'trn_01', dueOn: '2026-11-15', overdue: false });
    expect(summary.nextRemittance!.due.totalDue).toBeGreaterThan(0);
  });

  it('shows instalments falling due, then going overdue past grace, as the clock moves', () => {
    const dueDay = societySummary(at(world, '2026-11-15'), 'soc_1');
    expect(dueDay.dueToday.count).toBe(12);
    expect(dueDay.overdue.count).toBe(0);

    const later = societySummary(at(world, '2026-11-25'), 'soc_1');
    expect(later.dueToday.count).toBe(0);
    expect(later.overdue.count).toBe(12);
    expect(later.accruingPenal).toBe(12);
    expect(later.overdue.amount).toBeGreaterThan(dueDay.dueToday.amount);
    expect(later.nextRemittance).toMatchObject({ dueOn: '2026-11-15', overdue: true });
  });
});

describe('the apex exposure', () => {
  const rows = apexExposure(seedWorld());

  it('has a row per society, within its credit limit', () => {
    expect(rows.map((r) => r.society.id)).toEqual(['soc_1', 'soc_2', 'soc_3']);
    for (const row of rows) expect(row.headroom).toBe(row.creditLimit - row.sanctioned);
  });

  it('shows the part-drawn tranche and the batch awaiting review', () => {
    const sahakar = rows.find((r) => r.society.id === 'soc_3')!;
    expect(sahakar.drawn).toBeLessThan(sahakar.sanctioned);
    const gramodaya = rows.find((r) => r.society.id === 'soc_2')!;
    expect(gramodaya.awaitingReview.count).toBe(1);
  });
});

describe('the member view', () => {
  const loans = memberLoans(seedWorld(), 'mem_001');

  it('shows the member their own loan, six instalments in', () => {
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ status: 'ACTIVE', instalmentsPaid: 6, rateBps: 1150, dueNow: 0 });
    expect(loans[0]!.nextInstalment?.dueOn).toBe('2026-11-15');
  });

  it('carries nothing about wholesale pricing or the society margin', () => {
    const allowed = [
      'loanId', 'principal', 'rateBps', 'emi', 'status', 'disbursedOn', 'outstanding',
      'instalmentsPaid', 'instalmentsTotal', 'dueNow', 'daysPastDue', 'nextInstalment',
    ];
    expect(Object.keys(loans[0]!).sort()).toEqual([...allowed].sort());
    expect(JSON.stringify(loans)).not.toMatch(/wholesale|margin|950/i);
  });
});
