import { describe, expect, it } from 'vitest';
import { invariantsBySociety, createWorld, replay } from '@/domain/world';
import { trialBalanceOf } from '@/domain/reporting';
import { buildScenario, buildScenarioA, SEED_TODAY } from '../../../scripts/seed/scenario-a';
import { loadSeed, parseSeed, SeedError, loadScenarioA } from '../seed';
import federation from '../mock/federation.json';
import policy from '../mock/policy.json';
import societies from '../mock/societies.json';
import users from '../mock/users.json';
import members from '../mock/members.json';
import applications from '../mock/applications.json';
import pools from '../mock/pools.json';
import events from '../mock/events.json';

const raw = { federation, policy, societies, users, members, applications, pools, events };

describe.each(['B', 'C'] as const)('scenario %s', (id) => {
  const seed = loadSeed(id);

  it('shares scenario A’s origination and matches its generator', () => {
    expect(seed.base).toEqual(loadScenarioA().base);
    expect(seed.events).toEqual(buildScenario(id).events);
    expect(seed.version).not.toBe(loadScenarioA().version);
  });

  it('replays to today with every invariant green and the trial balance balanced in every society', () => {
    const world = replay(createWorld(seed.base), seed.events);
    expect(world.clock).toBe(SEED_TODAY);
    for (const [societyId, results] of Object.entries(invariantsBySociety(world))) {
      expect(results.filter((r) => !r.ok).map((r) => `${r.id} ${r.detail}`), societyId).toEqual([]);
      expect(trialBalanceOf(world, societyId).balanced, societyId).toBe(true);
    }
  });
});

describe('the committed seed', () => {
  const seed = loadScenarioA();

  it('validates and has the shape the TDD describes', () => {
    expect(seed.base.societies).toHaveLength(3);
    expect(seed.base.users).toHaveLength(8);
    expect(seed.base.pools).toHaveLength(5);
    expect(seed.events.filter((e) => e.type === 'LOAN_DISBURSED')).toHaveLength(38);
  });

  it('matches what the generator produces, so the two cannot drift apart', () => {
    // If this fails after an engine change, run `npm run seed`.
    const generated = buildScenarioA();
    expect(seed.base).toEqual(generated.base);
    expect(seed.events).toEqual(generated.events);
  });

  it('replays to today with every invariant green in every society', () => {
    const world = replay(createWorld(seed.base), seed.events);
    expect(world.clock).toBe(SEED_TODAY);
    for (const [societyId, results] of Object.entries(invariantsBySociety(world))) {
      const failing = results.filter((r) => !r.ok).map((r) => `${r.id} ${r.detail}`);
      expect(failing, societyId).toEqual([]);
    }
  });

  it('puts every pool and loan where scenario A says it should be', () => {
    const world = replay(createWorld(seed.base), seed.events);
    const status = Object.fromEntries(world.pools.map((p) => [p.id, p.status]));
    expect(status).toEqual({
      pool_01: 'SERVICING',
      pool_02: 'SERVICING',
      pool_03: 'SERVICING',
      pool_04: 'OPEN',
      pool_05: 'UNDER_APEX_REVIEW',
    });
    expect(world.tranches.trn_03!.tranche.status).toBe('SERVICING');
    expect(world.tranches.trn_03!.tranche.drawdowns).toHaveLength(1);
    // Four of pool_03's sixteen wait for a later drawdown.
    expect(world.applications.filter((a) => a.poolId === 'pool_03' && a.status === 'POOLED')).toHaveLength(4);
    // Six instalments paid on each of the demo pool's twelve loans.
    const demoPool = Object.values(world.loans).filter((l) => l.loan.poolId === 'pool_01');
    expect(demoPool).toHaveLength(12);
    expect(demoPool.every((l) => l.receipts.length === 6)).toBe(true);
  });

  it('versions itself by content', () => {
    expect(seed.version).toMatch(/^[0-9a-f]{8}$/);
    expect(parseSeed(raw).version).toBe(seed.version);
  });
});

describe('a broken seed', () => {
  it('fails on a schema violation, naming the file and field', () => {
    const bad = { ...raw, members: [{ ...members[0], phone: 'call me' }, ...members.slice(1)] };
    expect(() => parseSeed(bad)).toThrow(/members\.json at 0\.phone/);
  });

  it('fails on a dangling reference', () => {
    const bad = { ...raw, applications: [{ ...applications[0], memberId: 'mem_999' }, ...applications.slice(1)] };
    try {
      parseSeed(bad);
      throw new Error('expected a SeedError');
    } catch (error) {
      expect(error).toBeInstanceOf(SeedError);
      expect((error as SeedError).problems.join()).toMatch(/app_001 is for a member outside its society/);
    }
  });

  it('fails on a pool that lists an application it does not own', () => {
    const [first, ...rest] = pools;
    const bad = { ...raw, pools: [{ ...first!, applicationIds: [...first!.applicationIds, 'app_069'] }, ...rest] };
    expect(() => parseSeed(bad)).toThrow(/lists app_069, which belongs elsewhere/);
  });
});
