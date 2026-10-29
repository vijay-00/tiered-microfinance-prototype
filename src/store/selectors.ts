import type { InvariantResult } from '@/domain/invariants';
import type { ID, User } from '@/domain/types';
import { invariantsBySociety, nextDueDate, type WorldState } from '@/domain/world';
import { roleInfo, type RoleInfo } from '@/app/roles';
import type { AppStoreState } from './appStore';

/**
 * Selectors over the store. Anything derived from the world is memoised on the
 * world object itself: the world is immutable, so a new object is the only way
 * it changes, and React sees a stable value until then.
 */

function memoOnWorld<T>(derive: (world: WorldState) => T): (world: WorldState) => T {
  const cache = new WeakMap<WorldState, T>();
  return (world) => {
    if (!cache.has(world)) cache.set(world, derive(world));
    return cache.get(world)!;
  };
}

export const selectInvariants = memoOnWorld(invariantsBySociety);
export const selectNextDueDate = memoOnWorld(nextDueDate);

export interface InvariantHealth {
  readonly passing: number;
  readonly total: number;
  readonly ok: boolean;
  readonly failures: ReadonlyArray<{ societyId: ID; result: InvariantResult }>;
}

export const selectInvariantHealth = memoOnWorld((world): InvariantHealth => {
  const bySociety = selectInvariants(world);
  const failures = Object.entries(bySociety).flatMap(([societyId, results]) =>
    results.filter((r) => !r.ok).map((result) => ({ societyId, result })),
  );
  const total = Object.values(bySociety).reduce((n, results) => n + results.length, 0);
  return { passing: total - failures.length, total, ok: failures.length === 0, failures };
});

export function selectCurrentUser(state: AppStoreState): User {
  const user = state.world.users.find((u) => u.id === state.session.userId);
  if (!user) throw new Error(`no user ${state.session.userId}`);
  return user;
}

export function selectRoleInfo(state: AppStoreState): RoleInfo {
  return roleInfo(selectCurrentUser(state).role);
}
