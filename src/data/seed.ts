import { z } from 'zod';
import {
  federationSchema,
  loanApplicationSchema,
  memberSchema,
  policySchema,
  poolSchema,
  societySchema,
  userSchema,
  type ISODate,
} from '@/domain/types';
import { worldEventSchema, type WorldBase, type WorldEvent } from '@/domain/world';
import applicationsJson from './mock/applications.json';
import eventsJson from './mock/events.json';
import eventsBJson from './mock/events-b.json';
import eventsCJson from './mock/events-c.json';
import federationJson from './mock/federation.json';
import membersJson from './mock/members.json';
import policyJson from './mock/policy.json';
import poolsJson from './mock/pools.json';
import societiesJson from './mock/societies.json';
import usersJson from './mock/users.json';

/**
 * Loads the mock JSON, validates it against the same schemas the domain uses,
 * and checks the records refer to each other properly. A malformed seed fails
 * here, loudly, at boot, rather than as a blank screen three clicks later.
 */

export class SeedError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`the seed data is invalid:\n  ${problems.join('\n  ')}`);
    this.name = 'SeedError';
  }
}

export interface LoadedSeed {
  base: WorldBase;
  events: WorldEvent[];
  /** A content hash. Saved state from a different seed is discarded, not migrated. */
  version: string;
}

const eventsFileSchema = z.object({
  startsOn: z.string(),
  events: z.array(worldEventSchema),
});

/** 32-bit FNV-1a, enough to tell one seed from another. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function parseSeed(raw: {
  federation: unknown;
  policy: unknown;
  societies: unknown;
  users: unknown;
  members: unknown;
  applications: unknown;
  pools: unknown;
  events: unknown;
}): LoadedSeed {
  const problems: string[] = [];
  function parse<T>(schema: z.ZodType<T>, value: unknown, file: string): T | undefined {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues.slice(0, 5)) {
      problems.push(`${file} at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return undefined;
  }

  const federation = parse(federationSchema, raw.federation, 'federation.json');
  const policy = parse(policySchema, raw.policy, 'policy.json');
  const societies = parse(z.array(societySchema), raw.societies, 'societies.json');
  const users = parse(z.array(userSchema), raw.users, 'users.json');
  const members = parse(z.array(memberSchema), raw.members, 'members.json');
  const applications = parse(z.array(loanApplicationSchema), raw.applications, 'applications.json');
  const pools = parse(z.array(poolSchema), raw.pools, 'pools.json');
  const eventsFile = parse(eventsFileSchema, raw.events, 'events.json');

  if (!federation || !policy || !societies || !users || !members || !applications || !pools || !eventsFile) {
    throw new SeedError(problems);
  }

  // Referential integrity.
  const unique = (file: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`${file}: duplicate id ${id}`);
      seen.add(id);
    }
    return seen;
  };
  const societyIds = unique('societies.json', societies.map((s) => s.id));
  const memberIds = unique('members.json', members.map((m) => m.id));
  unique('users.json', users.map((u) => u.id));
  unique('applications.json', applications.map((a) => a.id));
  unique('pools.json', pools.map((p) => p.id));
  const memberSociety = new Map(members.map((m) => [m.id, m.societyId]));
  const applicationById = new Map(applications.map((a) => [a.id, a]));

  for (const s of societies) {
    if (s.federationId !== federation.id) problems.push(`society ${s.id} belongs to an unknown federation`);
  }
  for (const m of members) {
    if (!societyIds.has(m.societyId)) problems.push(`member ${m.id} belongs to unknown society ${m.societyId}`);
  }
  for (const u of users) {
    if (u.societyId && !societyIds.has(u.societyId)) problems.push(`user ${u.id} belongs to unknown society`);
    if (u.role === 'MEMBER' && (!u.memberId || !memberIds.has(u.memberId))) {
      problems.push(`member login ${u.id} is not linked to a member`);
    }
    if (u.role === 'APEX_OFFICER' && u.societyId) problems.push(`apex officer ${u.id} cannot belong to a society`);
    if (u.role !== 'APEX_OFFICER' && !u.societyId) problems.push(`user ${u.id} needs a society`);
  }
  for (const a of applications) {
    if (memberSociety.get(a.memberId) !== a.societyId) {
      problems.push(`application ${a.id} is for a member outside its society`);
    }
    if (a.poolId && !pools.some((p) => p.id === a.poolId && p.applicationIds.includes(a.id))) {
      problems.push(`application ${a.id} names pool ${a.poolId}, which does not list it`);
    }
  }
  for (const p of pools) {
    if (!societyIds.has(p.societyId)) problems.push(`pool ${p.id} belongs to unknown society`);
    for (const id of p.applicationIds) {
      const a = applicationById.get(id);
      if (!a) problems.push(`pool ${p.id} lists unknown application ${id}`);
      else if (a.poolId !== p.id || a.societyId !== p.societyId) {
        problems.push(`pool ${p.id} lists ${id}, which belongs elsewhere`);
      }
    }
  }

  if (problems.length > 0) throw new SeedError(problems);

  const base: WorldBase = {
    clock: eventsFile.startsOn as ISODate,
    policy,
    federation,
    societies,
    users,
    members,
    applications,
    pools,
  };
  return {
    base,
    events: eventsFile.events,
    version: fnv1a(JSON.stringify({ base, events: eventsFile.events })),
  };
}

export type SeedScenario = 'A' | 'B' | 'C';

const EVENTS: Record<SeedScenario, unknown> = { A: eventsJson, B: eventsBJson, C: eventsCJson };
const cached = new Map<SeedScenario, LoadedSeed>();

/** A scenario: the shared base files and its own event log. Parsed once per session. */
export function loadSeed(id: SeedScenario): LoadedSeed {
  let seed = cached.get(id);
  if (!seed) {
    seed = parseSeed({
      federation: federationJson,
      policy: policyJson,
      societies: societiesJson,
      users: usersJson,
      members: membersJson,
      applications: applicationsJson,
      pools: poolsJson,
      events: EVENTS[id],
    });
    cached.set(id, seed);
  }
  return seed;
}

/** Scenario A, the state the app opens in. */
export const loadScenarioA = (): LoadedSeed => loadSeed('A');
