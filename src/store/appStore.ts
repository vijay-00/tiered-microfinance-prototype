import { createStore, type StoreApi } from 'zustand/vanilla';
import { roleInfo } from '@/app/roles';
import type { ID, ISODate, Role, User } from '@/domain/types';
import { applyEvent, createWorld, replay, type WorldEvent, type WorldState } from '@/domain/world';
import { DEFAULT_SCENARIO, scenario, type ScenarioId } from '@/data/scenarios';
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
}

export type AppStoreState = AppState & AppActions;
export type AppStore = StoreApi<AppStoreState>;

const seedWorlds = new Map<ScenarioId, { world: WorldState; version: string }>();

function seedWorldFor(id: ScenarioId): { world: WorldState; version: string } {
  const cached = seedWorlds.get(id);
  if (cached) return cached;
  const load = scenario(id).load;
  if (!load) throw new Error(`scenario ${id} is not available yet`);
  const seed = load();
  const built = { world: replay(createWorld(seed.base), seed.events), version: seed.version };
  seedWorlds.set(id, built);
  return built;
}

/** The demo society's user for a role, falling back to anyone with it. */
export function userForRole(world: WorldState, role: Role): User | undefined {
  const demoSociety = world.societies[0]?.id;
  return (
    world.users.find((u) => u.role === role && (u.societyId === demoSociety || !u.societyId)) ??
    world.users.find((u) => u.role === role)
  );
}

function defaultSession(world: WorldState): Session {
  const user = userForRole(world, 'SECRETARY') ?? world.users[0];
  if (!user) throw new Error('the seed has no users');
  return { userId: user.id };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAppStore(options: { storage?: StorageLike } = {}): AppStore {
  const { storage } = options;
  const saved = loadPersisted(storage);

  let scenarioId: ScenarioId = DEFAULT_SCENARIO;
  if (saved && scenario(saved.scenarioId).load) scenarioId = saved.scenarioId;
  const seed = seedWorldFor(scenarioId);

  let world = seed.world;
  let userEvents: readonly WorldEvent[] = [];
  let notice: string | undefined;
  if (saved && saved.scenarioId === scenarioId) {
    if (saved.seedVersion !== seed.version) {
      notice = 'The demo data has changed since your last visit, so the demo started fresh.';
    } else {
      try {
        world = replay(seed.world, saved.userEvents);
        userEvents = saved.userEvents;
      } catch {
        notice = 'Your saved changes no longer replay against the demo data, so the demo started fresh.';
      }
    }
  }
  const savedUser = saved && world.users.some((u) => u.id === saved.session.userId);
  const session = savedUser ? saved.session : defaultSession(world);

  const store = createStore<AppStoreState>()((set, get) => ({
    scenarioId,
    seedVersion: seed.version,
    seedWorld: seed.world,
    userEvents,
    world,
    session,
    notice,

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
      set({ session: { userId } });
    },

    switchRole(role) {
      const user = userForRole(get().world, role);
      if (user) set({ session: { userId: user.id } });
      else set({ notice: `No ${roleInfo(role).label} in this scenario.` });
    },

    loadScenario(id) {
      try {
        const next = seedWorldFor(id);
        const current = get().session.userId;
        set({
          scenarioId: id,
          seedVersion: next.version,
          seedWorld: next.world,
          world: next.world,
          userEvents: [],
          session: next.world.users.some((u) => u.id === current) ? get().session : defaultSession(next.world),
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
      const current = seedWorldFor(get().scenarioId);
      set({ world: current.world, seedWorld: current.world, userEvents: [], notice: undefined });
    },

    dismissNotice() {
      set({ notice: undefined });
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
