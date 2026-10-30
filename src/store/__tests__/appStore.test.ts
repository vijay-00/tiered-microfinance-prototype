import { describe, expect, it } from 'vitest';
import { createAppStore } from '../appStore';
import { STORAGE_KEY, STATE_VERSION, type StorageLike } from '../persistence';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

describe('a fresh store', () => {
  const store = createAppStore();

  it('opens scenario A on the seed, as the society secretary', () => {
    const state = store.getState();
    expect(state.scenarioId).toBe('A');
    expect(state.world.clock).toBe('2026-10-29');
    expect(state.userEvents).toHaveLength(0);
    expect(state.session.userId).toBe('usr_secretary');
  });

  it('switches role to that role’s user in the demo society', () => {
    const s = createAppStore();
    s.getState().switchRole('APEX_OFFICER');
    expect(s.getState().session.userId).toBe('usr_apex');
    s.getState().switchRole('MEMBER');
    expect(s.getState().session.userId).toBe('usr_member');
  });

  it('changes the world only through the reducer, one event at a time', () => {
    const s = createAppStore();
    const before = s.getState().world;
    expect(s.getState().advanceClock('2026-11-15')).toEqual({ ok: true });
    expect(s.getState().world.clock).toBe('2026-11-15');
    expect(s.getState().world.eventCount).toBe(before.eventCount + 1);
    expect(s.getState().userEvents).toEqual([{ type: 'CLOCK_ADVANCED', to: '2026-11-15' }]);
  });

  it('refuses an invalid event, says why, and leaves the world untouched', () => {
    const s = createAppStore();
    const before = s.getState().world;
    const result = s.getState().advanceClock('2026-01-01');
    expect(result.ok).toBe(false);
    expect(s.getState().notice).toMatch(/only moves forward/);
    expect(s.getState().world).toBe(before);
    s.getState().dismissNotice();
    expect(s.getState().notice).toBeUndefined();
  });

  it('loads each prepared scenario, discarding what was done in the last', () => {
    const s = createAppStore();
    s.getState().advanceClock('2026-11-02');
    for (const id of ['B', 'C', 'A'] as const) {
      expect(s.getState().loadScenario(id).ok).toBe(true);
      expect(s.getState().scenarioId).toBe(id);
      expect(s.getState().userEvents).toHaveLength(0);
      expect(s.getState().world.clock).toBe('2026-10-29');
    }
  });

  it('resets to the seed', () => {
    const s = createAppStore();
    s.getState().advanceClock('2027-01-01');
    s.getState().reset();
    expect(s.getState().world).toBe(s.getState().seedWorld);
    expect(s.getState().userEvents).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('saves what was done and replays it on the next load', () => {
    const storage = new MemoryStorage();
    const first = createAppStore({ storage });
    first.getState().advanceClock('2026-12-01');
    first.getState().switchRole('AUDITOR');

    const second = createAppStore({ storage });
    expect(second.getState().world.clock).toBe('2026-12-01');
    expect(second.getState().session.userId).toBe('usr_auditor');
    expect(second.getState().notice).toBeUndefined();
  });

  it('saves events, never the derived world', () => {
    const storage = new MemoryStorage();
    createAppStore({ storage }).getState().advanceClock('2026-12-01');
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(Object.keys(saved).sort()).toEqual(['scenarioId', 'seedVersion', 'session', 'stateVersion', 'userEvents']);
  });

  it('starts fresh, and says so, when the seed has changed', () => {
    const storage = new MemoryStorage();
    const store = createAppStore({ storage });
    store.getState().advanceClock('2026-12-01');
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, seedVersion: 'deadbeef' }));

    const reloaded = createAppStore({ storage });
    expect(reloaded.getState().world.clock).toBe('2026-10-29');
    expect(reloaded.getState().notice).toMatch(/started fresh/);
  });

  it('starts fresh, and says so, when saved events no longer replay', () => {
    const storage = new MemoryStorage();
    const seedVersion = createAppStore().getState().seedVersion;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        stateVersion: STATE_VERSION,
        seedVersion,
        scenarioId: 'A',
        session: { userId: 'usr_secretary' },
        userEvents: [{ type: 'CLOCK_ADVANCED', to: '2025-01-01' }],
      }),
    );
    const store = createAppStore({ storage });
    expect(store.getState().world.clock).toBe('2026-10-29');
    expect(store.getState().notice).toMatch(/no longer replay/);
  });

  it('ignores storage that is corrupt or throws', () => {
    const corrupt = new MemoryStorage();
    corrupt.setItem(STORAGE_KEY, '{not json');
    expect(createAppStore({ storage: corrupt }).getState().world.clock).toBe('2026-10-29');

    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createAppStore({ storage: throwing });
    expect(store.getState().advanceClock('2026-11-01').ok).toBe(true);
  });

  it('clears what was saved on reset', () => {
    const storage = new MemoryStorage();
    const store = createAppStore({ storage });
    store.getState().advanceClock('2026-12-01');
    store.getState().reset();
    expect(createAppStore({ storage }).getState().world.clock).toBe('2026-10-29');
  });
});

describe('the role a first visit opens as', () => {
  it('opens as the apex officer when the demo asks, and as the secretary by default', () => {
    const apex = createAppStore({ startAs: 'APEX_OFFICER' });
    expect(apex.getState().world.users.find((u) => u.id === apex.getState().session.userId)?.role).toBe('APEX_OFFICER');
    const plain = createAppStore();
    expect(plain.getState().world.users.find((u) => u.id === plain.getState().session.userId)?.role).toBe('SECRETARY');
  });
});

describe.each(['A', 'B', 'C'] as const)('the demo, cut down to the member’s society, in scenario %s', (id) => {
  const store = createAppStore({ onlySociety: 'soc_1' });
  if (id !== 'A') store.getState().loadScenario(id);
  const world = () => store.getState().world;

  it('has one society, one member to log in as, and nobody in a hidden role', () => {
    expect(world().societies.map((s) => s.name)).toEqual(['Annapoorani Credit Society']);
    expect(world().users.map((u) => `${u.name}, ${u.role}`).sort()).toEqual([
      'Dr. Sudha Ramanathan, APEX_OFFICER',
      'Meenakshi Sundaram, SECRETARY',
      'R. N. Subramanian, AUDITOR',
      'Veerappan Pandian, MEMBER',
    ]);
  });

  it('credits the loan officer’s past work to the secretary, so his name is nowhere in it', () => {
    expect(JSON.stringify(world())).not.toContain('usr_officer');
    const appraised = world().applications.filter((a) => a.appraisal);
    expect(appraised.length).toBeGreaterThan(0);
    expect(appraised.every((a) => a.appraisal!.officerId === 'usr_secretary')).toBe(true);
    expect(store.getState().userEvents).toHaveLength(0);
  });
});
