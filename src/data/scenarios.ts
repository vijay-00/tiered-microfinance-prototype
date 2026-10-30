import { loadSeed, type LoadedSeed } from './seed';

/**
 * The prepared demo states, each reachable in one click. All three share the
 * societies, members and pools; they differ in how the year went.
 */

export type ScenarioId = 'A' | 'B' | 'C';

export interface Scenario {
  id: ScenarioId;
  name: string;
  summary: string;
  /** Absent until the scenario is built. */
  load?: () => LoadedSeed;
  availableIn?: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'A',
    name: 'Clean run',
    summary: 'Every member and every remittance on time.',
    load: () => loadSeed('A'),
  },
  {
    id: 'B',
    name: 'Delinquency',
    summary: 'Four Annapoorani members fall behind and the society remits from reserves.',
    load: () => loadSeed('B'),
  },
  {
    id: 'C',
    name: 'Prepayment and recovery',
    summary: 'On B: a foreclosure without a fee, a part-prepayment, and partial recoveries of arrears.',
    load: () => loadSeed('C'),
  },
];

export const DEFAULT_SCENARIO: ScenarioId = 'A';

/** What the demo's clean start offers: scenario A, with nothing on file, and no other. */
export const CLEAN_START_SCENARIOS: readonly Scenario[] = [
  {
    id: 'A',
    name: 'Fresh start',
    summary: 'Annapoorani with five members and no loans yet: every application, batch and loan is one you make.',
    load: () => loadSeed('A'),
  },
];

export function scenario(id: ScenarioId): Scenario {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}
