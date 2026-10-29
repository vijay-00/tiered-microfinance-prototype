import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldEvent } from '../src/domain/world';
import { buildScenario, SEED_START, type ScenarioKey } from './seed/scenario-a';

/**
 * Writes the scenarios' seed into src/data/mock. Run with `npm run seed`.
 * The base files are shared; each scenario has its own event log. The JSON is
 * committed; a test fails if it drifts from this generator.
 */

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'mock');
mkdirSync(out, { recursive: true });

const write = (file: string, text: string) => {
  writeFileSync(join(out, file), text.endsWith('\n') ? text : `${text}\n`);
  console.log(`  ${file}`);
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

// One event per line: a year of history stays scannable and diffs cleanly.
const eventsFile = (events: readonly WorldEvent[]) =>
  `{\n  "startsOn": ${JSON.stringify(SEED_START)},\n  "events": [\n${events
    .map((event) => `    ${JSON.stringify(event)}`)
    .join(',\n')}\n  ]\n}`;

export const EVENTS_FILE: Record<ScenarioKey, string> = { A: 'events.json', B: 'events-b.json', C: 'events-c.json' };

const { base } = buildScenario('A');
console.log(`Writing the scenarios to ${out}`);
write('federation.json', pretty(base.federation));
write('policy.json', pretty(base.policy));
write('societies.json', pretty(base.societies));
write('users.json', pretty(base.users));
write('members.json', pretty(base.members));
write('applications.json', pretty(base.applications));
write('pools.json', pretty(base.pools));

for (const key of ['A', 'B', 'C'] as const) {
  const { events } = buildScenario(key);
  write(EVENTS_FILE[key], eventsFile(events));
  console.log(
    `  ${key}: ${JSON.stringify({
      events: events.length,
      loans: events.filter((e) => e.type === 'LOAN_DISBURSED').length,
      payments: events.filter((e) => e.type === 'PAYMENT_RECEIVED').length,
      remittances: events.filter((e) => e.type === 'REMITTANCE_RECORDED').length,
    })}`,
  );
}
