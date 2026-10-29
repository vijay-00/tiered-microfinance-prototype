import { z } from 'zod';
import { idSchema } from '@/domain/types';
import { worldEventSchema, type WorldEvent } from '@/domain/world';
import type { ScenarioId } from '@/data/scenarios';

/**
 * Saved demo state. Only what a person did is saved: the events added since
 * the seed, the scenario and who is logged in. The world itself is rebuilt by
 * replay on load, so a saved file can never disagree with the engine.
 *
 * Browser storage can be missing, full or blocked (private windows, previews),
 * so every access is wrapped and the app works without it.
 */

export const STORAGE_KEY = 'tmp.state.v1';
export const STATE_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Session {
  userId: string;
  /** Pop-ups already shown and closed, by their notice key. */
  seen?: string[];
}

export interface PersistedState {
  stateVersion: typeof STATE_VERSION;
  /** Saved state from a different seed is discarded, not migrated. */
  seedVersion: string;
  scenarioId: ScenarioId;
  userEvents: WorldEvent[];
  session: Session;
}

const persistedSchema = z.object({
  stateVersion: z.literal(STATE_VERSION),
  seedVersion: z.string(),
  scenarioId: z.enum(['A', 'B', 'C']),
  userEvents: z.array(worldEventSchema),
  session: z.object({ userId: idSchema, seen: z.array(z.string()).optional() }),
});

export function loadPersisted(storage: StorageLike | undefined): PersistedState | undefined {
  if (!storage) return undefined;
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return undefined;
    const parsed = persistedSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function savePersisted(storage: StorageLike | undefined, state: PersistedState): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Full or blocked storage: the demo carries on, unsaved.
  }
}

export function clearPersisted(storage: StorageLike | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

export function browserStorage(): StorageLike | undefined {
  try {
    const storage = window.localStorage;
    const probe = '__tmp_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return undefined;
  }
}
