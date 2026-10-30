import { createStore, type StoreApi } from 'zustand/vanilla';
import { roleInfo } from '@/app/roles';
import { compareISO } from '@/domain/dates';
import type { ID, ISODate, Role, User } from '@/domain/types';
import { applyEvent, createWorld, replay, type WorldEvent, type WorldState } from '@/domain/world';
import { DEFAULT_SCENARIO, scenario, type ScenarioId } from '@/data/scenarios';
import { cleanStart } from '@/data/seed';
import { catchUpEvents } from './commands';
import {
  clearPersisted,
  loadPersisted,
  savePersisted,
  STATE_VERSION,
  type Session,
  type StorageLike,
} from './persistence';

/**
 * The app's single store. It holds the replayed seed, the events added since
 * and who is logged in; `world` is always the seed plus those events. Every
 * change to the world goes through `dispatch`, which runs the domain reducer:
 * the store never computes a balance itself.
 */

export type DispatchResult = { ok: true } | { ok: false; error: string };

export interface AppState {
  scenarioId: ScenarioId;
  seedVersion: string;
  /** The seed, replayed. Kept so a reset or reload does not replay it again. */
  seedWorld: WorldState;
  /** What was done in the app since the seed, in order. */
  userEvents: readonly WorldEvent[];
  world: WorldState;
  session: Session;
  /** The last thing that could not be done, for the UI to say so. */
  notice: string | undefined;
  /**
   * The demo's clean start: no history, so the scenarios and walkthroughs
   * that tell a story about past loans are not offered.
   */
  demo: boolean;
}

export interface DispatchOptions {
  /**
   * The caller shows its own error, so do not also raise the banner. Used by
   * screens that already say what went wrong in place.
   */
  quiet?: boolean;
}

export interface AppActions {
  dispatch(event: WorldEvent, options?: DispatchOptions): DispatchResult;
  /** All or nothing: if any event is refused, none is applied. */
  dispatchMany(events: readonly WorldEvent[], options?: DispatchOptions): DispatchResult;
  advanceClock(to: ISODate): DispatchResult;
  switchUser(userId: ID): void;
  switchRole(role: Role): void;
  loadScenario(id: ScenarioId): DispatchResult;
  /** Discards everything done in the app and reloads the current scenario. */
  reset(): void;
  dismissNotice(): void;
  /** Remembers pop-ups as seen, so they are not shown again. */
  markSeen(keys: readonly string[]): void;
}

export type AppStoreState = AppState & AppActions;
export type AppStore = StoreApi<AppStoreState>;

const seedWorlds = new Map<string, { world: WorldState; version: string }>();

/** The demo's world: one society, a few members, nothing on file. */
export interface DemoOptions {
  societyId: ID;
  members: number;
}

function seedWorldFor(id: ScenarioId, demo?: DemoOptions, today?: ISODate): { world: WorldState; version: string } {
  const key = `${id}:${demo ? `${demo.societyId}/${demo.members}` : '*'}:${today ?? ''}`;
  const cached = seedWorlds.get(key);
  if (cached) return cached;
  const load = scenario(id).load;
  if (!load) throw new Error(`scenario ${id} is not available yet`);
  const full = load();
  const seed = demo ? cleanStart(full, demo.societyId, demo.members, (role) => !!roleInfo(role).hidden) : full;
  const replayed = replay(createWorld(seed.base), seed.events);
  // The seed's history ends on its own day. Carried forward to today, the
  // demo opens on the real date with every month in between gone as usual.
  const built =
    today && compareISO(today, replayed.clock) > 0
      ? { world: catchUpEvents(replayed, today).world, version: `${seed.version}@${today}` }
      : { world: replayed, version: seed.version };
  seedWorlds.set(key, built);
  return built;
}

/** A user the demo can log in as: in this world, and not in a hidden role. */
function canLogInAs(world: WorldState, userId: ID): boolean {
  const user = world.users.find((u) => u.id === userId);
  return !!user && !roleInfo(user.role).hidden;
}

/** The demo society's user for a role, falling back to anyone with it. */
export function userForRole(world: WorldState, role: Role): User | undefined {
  const demoSociety = world.societies[0]?.id;
  return (
    world.users.find((u) => u.role === role && (u.societyId === demoSociety || !u.societyId)) ??
    world.users.find((u) => u.role === role)
  );
}

function defaultSession(world: WorldState, role: Role): Session {
  const user = userForRole(world, role) ?? world.users[0];
  if (!user) throw new Error('the seed has no users');
  return { userId: user.id };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `startAs` is the role a first visit opens as, and the fallback when a
 * scenario lacks the current user. The demo opens as the apex officer
 * (main.tsx); tests start as the secretary, where their scripts begin.
 *
 * `demo` opens a clean start instead of the seed's history: one society,
 * that many members each with a login of their own, no loans, and nobody in
 * a role the demo hides (see cleanStart). Tests leave it unset and run the
 * three societies' year of history.
 *
 * `today` is the real date: the world is carried forward to it, instalments
 * paid and remittances made as usual, so the demo opens on the day it is
 * used. Tests leave it unset and stay on the seed's own day.
 */
export function createAppStore(
  options: { storage?: StorageLike; startAs?: Role; demo?: DemoOptions; today?: ISODate } = {},
): AppStore {
  const { storage, startAs = 'SECRETARY', demo, today } = options;
  const saved = loadPersisted(storage);

  let scenarioId: ScenarioId = DEFAULT_SCENARIO;
  if (saved && scenario(saved.scenarioId).load) scenarioId = saved.scenarioId;
  // The clean start has no history for another scenario to tell.
  if (demo) scenarioId = DEFAULT_SCENARIO;
  const seed = seedWorldFor(scenarioId, demo, today);

  let world = seed.world;
  let userEvents: readonly WorldEvent[] = [];
  let notice: string | undefined;
  if (saved && saved.scenarioId === scenarioId) {
    if (saved.seedVersion !== seed.version) {
      // The same data on a later day only moved the calendar on.
      notice =
        saved.seedVersion.split('@')[0] === seed.version.split('@')[0]
          ? 'A new day: the demo has moved on to today, so it started fresh.'
          : 'The demo data has changed since your last visit, so the demo started fresh.';
    } else {
      try {
        world = replay(seed.world, saved.userEvents);
        userEvents = saved.userEvents;
      } catch {
        notice = 'Your saved changes no longer replay against the demo data, so the demo started fresh.';
      }
    }
  }
  const savedUser = saved && canLogInAs(world, saved.session.userId);
  const session = savedUser ? saved.session : defaultSession(world, startAs);

  const store = createStore<AppStoreState>()((set, get) => ({
    scenarioId,
    seedVersion: seed.version,
    seedWorld: seed.world,
    userEvents,
    world,
    session,
    notice,
    demo: !!demo,

    dispatch(event, options) {
      return get().dispatchMany([event], options);
    },

    dispatchMany(events, options) {
      try {
        const next = events.reduce(applyEvent, get().world);
        set({ world: next, userEvents: [...get().userEvents, ...events], notice: undefined });
        return { ok: true };
      } catch (error) {
        const text = message(error);
        if (!options?.quiet) set({ notice: text });
        return { ok: false, error: text };
      }
    },

    advanceClock(to) {
      return get().dispatch({ type: 'CLOCK_ADVANCED', to });
    },

    switchUser(userId) {
      if (!get().world.users.some((u) => u.id === userId)) return;
      set({ session: { ...get().session, userId } });
    },

    switchRole(role) {
      const user = userForRole(get().world, role);
      if (user) set({ session: { ...get().session, userId: user.id } });
      else set({ notice: `No ${roleInfo(role).label} in this scenario.` });
    },

    loadScenario(id) {
      try {
        const next = seedWorldFor(id, demo, today);
        const current = get().session.userId;
        set({
          scenarioId: id,
          seedVersion: next.version,
          seedWorld: next.world,
          world: next.world,
          userEvents: [],
          session: canLogInAs(next.world, current) ? { userId: current } : defaultSession(next.world, startAs),
          notice: undefined,
        });
        return { ok: true };
      } catch (error) {
        const text = message(error);
        set({ notice: text });
        return { ok: false, error: text };
      }
    },

    reset() {
      clearPersisted(storage);
      const current = seedWorldFor(get().scenarioId, demo, today);
      set({ world: current.world, seedWorld: current.world, userEvents: [], session: { userId: get().session.userId }, notice: undefined });
    },

    dismissNotice() {
      set({ notice: undefined });
    },

    markSeen(keys) {
      const seen = new Set(get().session.seen ?? []);
      keys.forEach((k) => seen.add(k));
      set({ session: { ...get().session, seen: [...seen] } });
    },
  }));

  store.subscribe((state, previous) => {
    const changed =
      state.userEvents !== previous.userEvents ||
      state.session !== previous.session ||
      state.scenarioId !== previous.scenarioId;
    if (!changed) return;
    savePersisted(storage, {
      stateVersion: STATE_VERSION,
      seedVersion: state.seedVersion,
      scenarioId: state.scenarioId,
      userEvents: [...state.userEvents],
      session: state.session,
    });
  });

  return store;
}
