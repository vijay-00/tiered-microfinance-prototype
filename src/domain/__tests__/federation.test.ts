import { describe, expect, it } from 'vitest';
import { loadSeed, type SeedScenario } from '@/data/seed';
import { federationHome, federationSocietyDetail, federationTrends, fundingDesk, sanctionEconomics } from '../federation';
import { sum } from '../money';
import { createWorld, replay, type WorldState } from '../world';

/** The federation's read models agree with each other and with the society rows they total. */

const world = (id: SeedScenario): WorldState => {
  const seed = loadSeed(id);
  return replay(createWorld(seed.base), seed.events);
};

describe.each(['A', 'B', 'C'] as const)('the federation in scenario %s', (id) => {
  const state = world(id);
  const home = federationHome(state);

  it('totals the society rows, and splits each limit into drawn, undrawn and headroom', () => {
    const { totals, societies } = home;
    expect(totals.creditLimit).toBe(sum(societies.map((r) => r.society.creditLimit)));
    expect(totals.outstanding).toBe(sum(societies.map((r) => r.outstanding)));
    expect(totals.interestYear).toBe(sum(societies.map((r) => r.interestYear)));
    expect(totals.drawn + totals.undrawn).toBe(totals.sanctioned);
    expect(totals.sanctioned + totals.headroom).toBe(totals.creditLimit);
    for (const r of societies) {
      expect(r.drawn + r.undrawn).toBe(r.sanctioned);
      expect(r.sanctioned + r.headroom).toBe(r.society.creditLimit);
      expect(r.outstanding).toBeLessThanOrEqual(r.drawn);
    }
  });

  it('lists the requests waiting oldest first, and the same ones on the desk', () => {
    const waiting = state.pools.filter((p) => p.status === 'SUBMITTED' || p.status === 'UNDER_APEX_REVIEW');
    expect(home.requests.map((r) => r.pool.id).sort()).toEqual(waiting.map((p) => p.id).sort());
    const days = home.requests.map((r) => r.waitingDays);
    expect(days).toEqual([...days].sort((a, b) => b - a));
    expect(fundingDesk(state).requests.map((r) => r.pool.id)).toEqual(home.requests.map((r) => r.pool.id));
  });

  it('charts the year by month, by purpose and by who kept the interest, agreeing with the totals', () => {
    const trends = federationTrends(state);
    expect(trends.months[0]!.month).toBe(home.yearFrom);
    expect(sum(trends.months.map((m) => m.interest))).toBe(home.totals.interestYear);
    expect(sum(trends.months.map((m) => m.remittances))).toBe(home.totals.remittancesYear);
    expect(sum(trends.purposes.map((p) => p.loans))).toBe(Object.values(state.loans).filter((l) => l.loan.status === 'ACTIVE').length);
    const outstanding = trends.purposes.map((p) => p.outstanding);
    expect(outstanding).toEqual([...outstanding].sort((a, b) => b - a));
    const { members, federation, societies } = trends.interestSplit;
    expect(federation).toBe(home.totals.interestYear);
    expect(federation + societies).toBe(members);
    expect(societies).toBeGreaterThan(0);
  });

  it('shows each society its remittances newest first, one for each dot of punctuality', () => {
    for (const { society } of home.societies) {
      const detail = federationSocietyDetail(state, society.id);
      expect(detail.remittances).toHaveLength(detail.row.punctuality.length);
      const due = detail.remittances.map((r) => r.dueOn);
      expect(due).toEqual([...due].sort().reverse());
      expect(detail.repaid).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sanction economics', () => {
  const state = world('A');
  const pool = fundingDesk(state).requests[0]!.pool;

  it('splits what members pay into the federation’s interest and the society’s spread', () => {
    const full = sanctionEconomics(state, pool.id, pool.requestedAmount, state.policy.wholesaleRateBps);
    expect(full.wholesale + full.margin).toBe(full.retail);
    expect(full.wholesale).toBeGreaterThan(full.margin);
  });

  it('earns less on a short sanction, and leaves the society more spread at a lower rate', () => {
    const rate = state.policy.wholesaleRateBps;
    const full = sanctionEconomics(state, pool.id, pool.requestedAmount, rate);
    const short = sanctionEconomics(state, pool.id, Math.floor(pool.requestedAmount * 0.8), rate);
    expect(short.retail).toBeLessThan(full.retail);
    const cheaper = sanctionEconomics(state, pool.id, pool.requestedAmount, rate - 100);
    expect(cheaper.retail).toBe(full.retail);
    expect(cheaper.margin).toBeGreaterThan(full.margin);
  });
});
