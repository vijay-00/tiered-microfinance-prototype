import { addDaysISO as addDays, compareISO } from '../../src/domain/dates';
import { DEFAULT_POLICY } from '../../src/domain/types';
import type {
  Federation,
  ID,
  ISODate,
  LoanApplication,
  LoanPurpose,
  Member,
  Paise,
  PaymentMode,
  Policy,
  Pool,
  Society,
  User,
} from '../../src/domain/types';
import type { LoanPosition } from '../../src/domain/reconciliation';
import {
  applyEvent,
  createWorld,
  nextRemittanceDate,
  positionOf,
  remittanceDueFor,
  type WorldBase,
  type WorldEvent,
  type WorldState,
} from '../../src/domain/world';

/**
 * The demo scenarios, generated deterministically. A, "clean run", is the
 * state the app opens in; B and C replay the same origination with a
 * different year of collections (see SCRIPTS).
 *
 * Base entities are the origination records: who the members are, what they
 * applied for and how it was decided, which pools they sit in. The event log is
 * the financial history, produced by driving the same reducer the app uses, so
 * every payment amount in it is exactly what was due on the day.
 *
 * Run `npm run seed` after changing this file or the engine; a test fails if the
 * committed JSON and this generator disagree.
 */

export interface Seed {
  base: WorldBase;
  events: WorldEvent[];
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

class Dice {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const rupees = (n: number): Paise => n * 100;
const day = (year: number, month: number, d: number): ISODate =>
  `${year}-${pad(month, 2)}-${pad(d, 2)}`;

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

// Tamil Nadu names: a given name followed by the father's or husband's name.
const FIRST_NAMES = [
  'Murugan', 'Selvam', 'Valliammai', 'Pechiammal', 'Lakshmi', 'Saraswathi', 'Ganesan', 'Ramesh',
  'Suresh', 'Kavitha', 'Selvi', 'Muthu', 'Prakash', 'Revathi', 'Chellammal', 'Karuppasamy',
  'Annamalai', 'Palanisamy', 'Parvathi', 'Gomathi', 'Sumathi', 'Meenal', 'Iyyappan', 'Sivakumar',
  'Chandrasekar', 'Rekha', 'Vijaya', 'Anand', 'Ravi', 'Mahesh', 'Pushpa', 'Jayanthi',
  'Nagammal', 'Mookan', 'Veerappan', 'Ashok', 'Senthil', 'Rohini', 'Deepa', 'Thangaraj',
] as const;

const SURNAMES = [
  'Murugesan', 'Ramasamy', 'Kandasamy', 'Subramani', 'Natarajan', 'Periyasamy', 'Sundaram', 'Kannan',
  'Rajendran', 'Pandian', 'Selvaraj', 'Mariappan', 'Duraisamy', 'Shanmugam', 'Velusamy', 'Govindan',
  'Krishnan', 'Arumugam', 'Chinnasamy', 'Ayyanar',
] as const;

const OCCUPATIONS: ReadonlyArray<{ name: string; purpose: LoanPurpose }> = [
  { name: 'Farmer', purpose: 'CROP' },
  { name: 'Farmer', purpose: 'CROP' },
  { name: 'Dairy farmer', purpose: 'DAIRY' },
  { name: 'Poultry farmer', purpose: 'DAIRY' },
  { name: 'Goat rearer', purpose: 'DAIRY' },
  { name: 'Petty shop owner', purpose: 'TRADE' },
  { name: 'Vegetable vendor', purpose: 'TRADE' },
  { name: 'Tailor', purpose: 'TRADE' },
  { name: 'Handloom weaver', purpose: 'TRADE' },
  { name: 'Carpenter', purpose: 'TRADE' },
  { name: 'Mason', purpose: 'HOUSING' },
  { name: 'Auto-rickshaw driver', purpose: 'TRADE' },
  { name: 'Flower seller', purpose: 'TRADE' },
  { name: 'School teacher', purpose: 'EDUCATION' },
];

const FEDERATION: Federation = {
  id: 'fed_1',
  name: 'Ponni Apex Credit Federation',
  shortName: 'PACF',
  registeredOffice: 'Tiruchirappalli',
};

interface SocietyPlan {
  society: Society;
  villages: readonly string[];
  memberCount: number;
  reserves: Paise;
}

const SOCIETIES: readonly SocietyPlan[] = [
  {
    society: {
      id: 'soc_1',
      federationId: FEDERATION.id,
      name: 'Annapoorani Credit Society',
      code: 'ANN',
      district: 'Madurai',
      registrationNo: 'TN/MDU/CS/1987/0142',
      creditLimit: rupees(25_00_000),
      openedOn: '1987-06-12',
    },
    villages: ['Melur', 'Vadipatti', 'Alanganallur', 'Sholavandan', 'Kallikudi'],
    memberCount: 30,
    reserves: rupees(2_50_000),
  },
  {
    society: {
      id: 'soc_2',
      federationId: FEDERATION.id,
      name: 'Grama Valarchi Credit Society',
      code: 'GRM',
      district: 'Thanjavur',
      registrationNo: 'TN/TNJ/CS/1994/0318',
      creditLimit: rupees(30_00_000),
      openedOn: '1994-02-03',
    },
    villages: ['Budalur', 'Orathanadu', 'Papanasam', 'Thiruvaiyaru', 'Ammapettai'],
    memberCount: 26,
    reserves: rupees(3_00_000),
  },
  {
    society: {
      id: 'soc_3',
      federationId: FEDERATION.id,
      name: 'Sakthi Mahalir Credit Society',
      code: 'SHM',
      district: 'Dindigul',
      registrationNo: 'TN/DGL/CS/2003/0077',
      creditLimit: rupees(20_00_000),
      openedOn: '2003-09-21',
    },
    villages: ['Natham', 'Vedasandur', 'Nilakottai', 'Oddanchatram', 'Batlagundu'],
    memberCount: 18,
    reserves: rupees(1_75_000),
  },
];

const USERS: readonly User[] = [
  { id: 'usr_member', name: '', role: 'MEMBER', title: 'Member', societyId: 'soc_1', memberId: 'mem_001' },
  { id: 'usr_officer', name: 'Karthik Rajan', role: 'LOAN_OFFICER', title: 'Field Officer', societyId: 'soc_1' },
  { id: 'usr_secretary', name: 'Meenakshi Sundaram', role: 'SECRETARY', title: 'Secretary', societyId: 'soc_1' },
  { id: 'usr_officer_2', name: 'Senthil Kumar', role: 'LOAN_OFFICER', title: 'Field Officer', societyId: 'soc_2' },
  { id: 'usr_secretary_2', name: 'Anitha Ramesh', role: 'SECRETARY', title: 'Secretary', societyId: 'soc_2' },
  { id: 'usr_secretary_3', name: 'Velmurugan Pandian', role: 'SECRETARY', title: 'Secretary', societyId: 'soc_3' },
  { id: 'usr_apex', name: 'Dr. Sudha Ramanathan', role: 'APEX_OFFICER', title: 'Credit Manager' },
  { id: 'usr_auditor', name: 'R. N. Subramanian', role: 'AUDITOR', title: 'Statutory Auditor', societyId: 'soc_1' },
];

const OFFICER_OF: Record<ID, ID> = { soc_1: 'usr_officer', soc_2: 'usr_officer_2', soc_3: 'usr_secretary_3' };
const SECRETARY_OF: Record<ID, ID> = { soc_1: 'usr_secretary', soc_2: 'usr_secretary_2', soc_3: 'usr_secretary_3' };

// ---------------------------------------------------------------------------
// Origination records
// ---------------------------------------------------------------------------

type Stage =
  | { kind: 'POOL'; poolId: ID; status: 'APPROVED' | 'POOLED' }
  | { kind: 'APPROVED' }
  | { kind: 'UNDER_APPRAISAL' }
  | { kind: 'SUBMITTED' }
  | { kind: 'REJECTED' };

interface PoolPlan {
  pool: Omit<Pool, 'applicationIds' | 'requestedAmount' | 'requestedTenureMonths'>;
  societyId: ID;
  /** 1-based member numbers within the society. */
  members: readonly number[];
  appliedFrom: ISODate;
  decidedOn: ISODate;
}

const POOLS: readonly PoolPlan[] = [
  {
    societyId: 'soc_1',
    members: range(1, 12),
    appliedFrom: '2026-03-02',
    decidedOn: '2026-03-20',
    pool: {
      id: 'pool_01',
      societyId: 'soc_1',
      reference: 'ANN/POOL/2026-27/01',
      createdOn: '2026-03-21',
      submittedOn: '2026-03-25',
      status: 'UNDER_APEX_REVIEW',
    },
  },
  {
    societyId: 'soc_2',
    members: range(1, 14),
    appliedFrom: '2026-01-05',
    decidedOn: '2026-01-14',
    pool: {
      id: 'pool_02',
      societyId: 'soc_2',
      reference: 'GRM/POOL/2025-26/04',
      createdOn: '2026-01-15',
      submittedOn: '2026-01-18',
      status: 'UNDER_APEX_REVIEW',
    },
  },
  {
    societyId: 'soc_3',
    members: range(1, 16),
    appliedFrom: '2026-06-01',
    decidedOn: '2026-06-15',
    pool: {
      id: 'pool_03',
      societyId: 'soc_3',
      reference: 'SHM/POOL/2026-27/01',
      createdOn: '2026-06-16',
      submittedOn: '2026-06-20',
      status: 'UNDER_APEX_REVIEW',
    },
  },
  {
    // Being assembled: eight approved members, two short of the minimum.
    societyId: 'soc_1',
    members: range(13, 20),
    appliedFrom: '2026-09-14',
    decidedOn: '2026-10-09',
    pool: {
      id: 'pool_04',
      societyId: 'soc_1',
      reference: 'ANN/POOL/2026-27/02',
      createdOn: '2026-10-12',
      status: 'OPEN',
    },
  },
  {
    // Submitted to the federation and awaiting its decision.
    societyId: 'soc_2',
    members: range(15, 24),
    appliedFrom: '2026-09-21',
    decidedOn: '2026-10-08',
    pool: {
      id: 'pool_05',
      societyId: 'soc_2',
      reference: 'GRM/POOL/2026-27/02',
      createdOn: '2026-10-14',
      submittedOn: '2026-10-20',
      status: 'UNDER_APEX_REVIEW',
    },
  },
];

/** Applications outside any pool, by society and member number. */
const LOOSE: ReadonlyArray<{ societyId: ID; member: number; stage: Stage; appliedOn: ISODate }> = [
  { societyId: 'soc_1', member: 21, stage: { kind: 'APPROVED' }, appliedOn: '2026-10-01' },
  { societyId: 'soc_1', member: 22, stage: { kind: 'APPROVED' }, appliedOn: '2026-10-03' },
  { societyId: 'soc_1', member: 23, stage: { kind: 'APPROVED' }, appliedOn: '2026-10-06' },
  { societyId: 'soc_1', member: 24, stage: { kind: 'UNDER_APPRAISAL' }, appliedOn: '2026-10-19' },
  { societyId: 'soc_1', member: 25, stage: { kind: 'UNDER_APPRAISAL' }, appliedOn: '2026-10-21' },
  { societyId: 'soc_1', member: 26, stage: { kind: 'SUBMITTED' }, appliedOn: '2026-10-26' },
  { societyId: 'soc_1', member: 27, stage: { kind: 'SUBMITTED' }, appliedOn: '2026-10-28' },
  { societyId: 'soc_1', member: 28, stage: { kind: 'REJECTED' }, appliedOn: '2026-09-02' },
  { societyId: 'soc_3', member: 17, stage: { kind: 'REJECTED' }, appliedOn: '2026-06-03' },
];

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function memberId(societyId: ID, n: number): ID {
  const offset = { soc_1: 0, soc_2: 100, soc_3: 200 }[societyId as 'soc_1' | 'soc_2' | 'soc_3'];
  return `mem_${pad(offset + n, 3)}`;
}

function buildMembers(dice: Dice): Member[] {
  const members: Member[] = [];
  const used = new Set<string>();
  for (const plan of SOCIETIES) {
    for (let n = 1; n <= plan.memberCount; n += 1) {
      let name: string;
      do {
        name = `${dice.pick(FIRST_NAMES)} ${dice.pick(SURNAMES)}`;
      } while (used.has(name));
      used.add(name);
      const occupation = dice.pick(OCCUPATIONS);
      members.push({
        id: memberId(plan.society.id, n),
        societyId: plan.society.id,
        membershipNo: `${plan.society.code}-M-${pad(n + dice.int(0, 9) * 100, 4)}`,
        name,
        village: dice.pick(plan.villages),
        phone: `+91 ${dice.int(70000, 99999)} ${pad(dice.int(0, 99999), 5)}`,
        joinedOn: day(dice.int(2012, 2024), dice.int(1, 12), dice.int(1, 28)),
        shareCapital: rupees(dice.int(2, 10) * 500),
        occupation: occupation.name,
        internalScore: dice.int(560, 860),
        status: 'ACTIVE',
      });
    }
  }
  return members;
}

function purposeFor(member: Member): LoanPurpose {
  return OCCUPATIONS.find((o) => o.name === member.occupation)?.purpose ?? 'TRADE';
}

function buildApplication(
  dice: Dice,
  policy: Policy,
  member: Member,
  id: ID,
  appliedOn: ISODate,
  decidedOn: ISODate,
  stage: Stage,
): LoanApplication {
  const requested = rupees(dice.int(4, 24) * 5_000);
  const tenure = dice.pick([12, 12, 18, 18, 24]);
  // Most are sanctioned as asked; some appraisals trim the amount.
  const sanctioned = dice.chance(0.2) ? requested - rupees(dice.int(1, 3) * 5_000) : requested;
  const income = rupees(dice.int(9, 30) * 1_000);
  const officerId = OFFICER_OF[member.societyId]!;
  const approverId =
    sanctioned <= policy.officerApprovalLimit ? officerId : SECRETARY_OF[member.societyId]!;

  const application: LoanApplication = {
    id,
    memberId: member.id,
    societyId: member.societyId,
    requestedAmount: requested,
    requestedTenureMonths: tenure,
    purpose: purposeFor(member),
    appliedOn,
    status: 'SUBMITTED',
  };
  if (stage.kind === 'SUBMITTED') return application;

  const appraisal = {
    officerId,
    on: addDays(appliedOn, dice.int(2, 5)),
    monthlyIncome: income,
    existingObligations: rupees(dice.int(0, 4) * 500),
    recommendedAmount: sanctioned,
    notes: dice.pick([
      'Steady seasonal income; repaid an earlier society loan on time.',
      'Household of five; spouse also earns.',
      'Business turnover verified from sales book.',
      'Two milch animals already owned; adding a third.',
      'Repayment capacity adequate at the recommended amount.',
    ]),
  };
  if (stage.kind === 'UNDER_APPRAISAL') {
    return { ...application, status: 'UNDER_APPRAISAL', appraisal };
  }
  if (stage.kind === 'REJECTED') {
    return {
      ...application,
      status: 'REJECTED',
      appraisal: { ...appraisal, recommendedAmount: 0 },
      decision: {
        by: SECRETARY_OF[member.societyId]!,
        on: decidedOn,
        outcome: 'REJECTED',
        sanctionedAmount: 0,
        tenureMonths: tenure,
        rateBps: policy.retailRateBps,
        reason: 'Existing obligations leave too little repayment capacity.',
      },
    };
  }
  return {
    ...application,
    status: stage.kind === 'POOL' ? stage.status : 'APPROVED',
    appraisal,
    decision: {
      by: approverId,
      on: decidedOn,
      outcome: 'APPROVED',
      sanctionedAmount: sanctioned,
      tenureMonths: tenure,
      rateBps: policy.retailRateBps,
    },
    ...(stage.kind === 'POOL' ? { poolId: stage.poolId } : {}),
  };
}

// ---------------------------------------------------------------------------
// The financial history
// ---------------------------------------------------------------------------

interface TranchePlan {
  trancheId: ID;
  poolId: ID;
  sanctionRef: string;
  sanctionedOn: ISODate;
  drawnOn: ISODate;
  firstDueOn: ISODate;
  /** How many of the pool's applications are disbursed; the rest wait for a later draw. */
  disburse: number;
}

const TRANCHES: readonly TranchePlan[] = [
  { trancheId: 'trn_02', poolId: 'pool_02', sanctionRef: 'PACF/SAN/2025-26/052', sanctionedOn: '2026-01-28', drawnOn: '2026-02-10', firstDueOn: '2026-03-10', disburse: 14 },
  { trancheId: 'trn_01', poolId: 'pool_01', sanctionRef: 'PACF/SAN/2026-27/014', sanctionedOn: '2026-04-01', drawnOn: '2026-04-15', firstDueOn: '2026-05-15', disburse: 12 },
  { trancheId: 'trn_03', poolId: 'pool_03', sanctionRef: 'PACF/SAN/2026-27/021', sanctionedOn: '2026-07-06', drawnOn: '2026-07-20', firstDueOn: '2026-08-20', disburse: 12 },
];

export const SEED_START: ISODate = '2026-01-01';
export const SEED_TODAY: ISODate = '2026-10-29';

// ---------------------------------------------------------------------------
// Scenarios: the same societies, members and pools, with a different year
// ---------------------------------------------------------------------------

export type ScenarioKey = 'A' | 'B' | 'C';

interface ExtraReceipt {
  on: ISODate;
  loanId: ID;
  /** Worked out from the loan's position on the day, so the story holds if the engine's figures move. */
  amount: (position: LoanPosition) => Paise;
  /** Elect prepayment: anything beyond what is due reduces principal not yet due. */
  prepay?: boolean;
}

interface Script {
  /** Instalments a member lets pass unpaid, by loan. On their next due date they pay everything owed. */
  misses: Readonly<Record<ID, readonly ISODate[]>>;
  /** Receipts other than the instalment on its due date. */
  receipts: readonly ExtraReceipt[];
  /** Remittance dates on which the society pays the interest and holds the principal back. */
  withheld: ReadonlyArray<{ trancheId: ID; dueOn: ISODate }>;
}

/**
 * B, delinquency, at Annapoorani: Iyyappan Selvaraj and Mahesh Velusamy miss September
 * and October; Rekha Krishnan misses four instalments from July; Palanisamy Velusamy
 * misses July and August and catches up in September, penal interest and all.
 * The society remits in full every month regardless, from its reserves.
 */
const DELINQUENCY: Script['misses'] = {
  loan_003: ['2026-09-15', '2026-10-15'],
  loan_007: ['2026-09-15', '2026-10-15'],
  loan_005: ['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15'],
  loan_010: ['2026-07-15', '2026-08-15'],
};

const roundDownToRupee = (paise: Paise) => Math.floor(paise / 100) * 100;

const SCRIPTS: Record<ScenarioKey, Script> = {
  A: { misses: {}, receipts: [], withheld: [] },
  /**
   * B also carries the variant, at Grama Valarchi: in August the society pays the
   * federation its interest but holds the principal back, and pays it with
   * September's remittance.
   */
  B: {
    misses: DELINQUENCY,
    receipts: [],
    withheld: [{ trancheId: 'trn_02', dueOn: '2026-08-10' }],
  },
  /**
   * C, prepayment and recovery, on B's Annapoorani history: Revathi Selvaraj prepays
   * Rs 25,000 in July and keeps her instalment over a shorter tenure; Karuppasamy
   * Kannan forecloses in month four, with no fee; and two of the late members
   * pay part of their arrears, which goes to penal and overdue interest before
   * any principal. Rekha Krishnan's part stops short of principal; Iyyappan
   * Selvaraj's reaches Rs 1,000 into it.
   */
  C: {
    misses: DELINQUENCY,
    receipts: [
      { on: '2026-07-20', loanId: 'loan_006', amount: () => rupees(25_000), prepay: true },
      { on: '2026-08-05', loanId: 'loan_012', amount: (p) => p.payoffAmount, prepay: true },
      {
        on: '2026-10-22',
        loanId: 'loan_005',
        amount: (p) => roundDownToRupee(((p.penalUnpaid + p.overdueInterest) * 3) / 5),
      },
      {
        on: '2026-10-22',
        loanId: 'loan_003',
        amount: (p) => p.penalUnpaid + p.overdueInterest + rupees(1_000),
      },
    ],
    withheld: [],
  },
};

/** Scenario A, the clean run the app opens in. */
export const buildScenarioA = (): Seed => buildScenario('A');

export function buildScenario(key: ScenarioKey): Seed {
  const script = SCRIPTS[key];
  const dice = new Dice(20_261_029);
  const policy: Policy = DEFAULT_POLICY;
  const members = buildMembers(dice);
  const memberById = new Map(members.map((m) => [m.id, m]));

  // Applications, numbered in the order a society would have received them.
  const applications: LoanApplication[] = [];
  const pools: Pool[] = [];
  let appSeq = 0;
  const nextAppId = () => `app_${pad(++appSeq, 3)}`;

  for (const plan of POOLS) {
    const ids: ID[] = [];
    plan.members.forEach((n, i) => {
      const member = memberById.get(memberId(plan.societyId, n))!;
      const appliedOn = addDays(plan.appliedFrom, Math.floor(i / 2));
      const status = plan.pool.status === 'OPEN' ? 'APPROVED' : 'POOLED';
      const application = buildApplication(dice, policy, member, nextAppId(), appliedOn, plan.decidedOn, {
        kind: 'POOL',
        poolId: plan.pool.id,
        status,
      });
      applications.push(application);
      ids.push(application.id);
    });
    const pooled = applications.filter((a) => ids.includes(a.id));
    pools.push({
      ...plan.pool,
      applicationIds: ids,
      requestedAmount: pooled.reduce((t, a) => t + a.decision!.sanctionedAmount, 0),
      requestedTenureMonths: Math.max(...pooled.map((a) => a.decision!.tenureMonths)),
    });
  }
  for (const loose of LOOSE) {
    const member = memberById.get(memberId(loose.societyId, loose.member))!;
    applications.push(
      buildApplication(dice, policy, member, nextAppId(), loose.appliedOn, addDays(loose.appliedOn, 12), loose.stage),
    );
  }

  // The member login belongs to the first member of the demo society's pool.
  const users = USERS.map((u) =>
    u.role === 'MEMBER' ? { ...u, name: memberById.get(u.memberId!)!.name } : u,
  );

  // Of the members with nothing on file, every other one has gone quiet.
  const applicants = new Set(applications.map((a) => a.memberId));
  let quiet = 0;
  const membersWithStatus = members.map((m) =>
    !applicants.has(m.id) && quiet++ % 2 === 0 ? { ...m, status: 'DORMANT' as const } : m,
  );

  const base: WorldBase = {
    clock: SEED_START,
    policy,
    federation: FEDERATION,
    societies: SOCIETIES.map((p) => p.society),
    users,
    members: membersWithStatus,
    applications,
    pools,
  };

  // Drive the reducer through the year, recording each event as it lands.
  let state: WorldState = createWorld(base);
  const events: WorldEvent[] = [];
  const emit = (event: WorldEvent) => {
    state = applyEvent(state, event);
    events.push(event);
  };
  const advance = (to: ISODate) => {
    if (compareISO(to, state.clock) > 0) emit({ type: 'CLOCK_ADVANCED', to });
  };

  advance('2026-01-02');
  for (const plan of SOCIETIES) {
    emit({ type: 'RESERVES_OPENED', on: state.clock, societyId: plan.society.id, amount: plan.reserves });
  }

  // Every date anything happens, in order.
  const dates = new Set<ISODate>([SEED_TODAY]);
  for (const t of TRANCHES) {
    dates.add(t.sanctionedOn);
    dates.add(t.drawnOn);
  }
  for (const r of script.receipts) dates.add(r.on);
  // Instalment dates are added as loans are disbursed; walk until nothing is left.
  let paymentSeq = 0;
  let remittanceSeq = 0;
  const receiptSeq: Record<ID, number> = {};

  const pending = () => [...dates].filter((d) => compareISO(d, state.clock) >= 0).sort(compareISO);
  let cursor = pending();
  while (cursor.length > 0) {
    const today = cursor[0]!;
    advance(today);

    for (const t of TRANCHES) {
      const pool = pools.find((p) => p.id === t.poolId)!;
      if (t.sanctionedOn === today) {
        emit({
          type: 'TRANCHE_SANCTIONED',
          on: today,
          trancheId: t.trancheId,
          poolId: t.poolId,
          sanctionRef: t.sanctionRef,
          sanctionedAmount: pool.requestedAmount,
          wholesaleRateBps: policy.wholesaleRateBps,
          tenureMonths: pool.requestedTenureMonths,
          remarks: 'Sanctioned in full. Society repayment record satisfactory.',
          recordedBy: 'usr_apex',
        });
      }
      if (t.drawnOn === today) {
        const toDisburse = pool.applicationIds.slice(0, t.disburse);
        const amount = toDisburse.reduce(
          (sum, id) => sum + applications.find((a) => a.id === id)!.decision!.sanctionedAmount,
          0,
        );
        const secretary = SECRETARY_OF[pool.societyId]!;
        emit({ type: 'TRANCHE_DRAWN', on: today, trancheId: t.trancheId, amount, recordedBy: secretary });
        toDisburse.forEach((applicationId) => {
          emit({
            type: 'LOAN_DISBURSED',
            on: today,
            loanId: `loan_${applicationId.slice(4)}`,
            applicationId,
            trancheId: t.trancheId,
            firstDueOn: t.firstDueOn,
            recordedBy: secretary,
          });
        });
        for (const id of toDisburse) {
          for (const row of state.loans[`loan_${id.slice(4)}`]!.schedule) {
            if (compareISO(row.dueOn, SEED_TODAY) <= 0) dates.add(row.dueOn);
          }
        }
      }
    }

    const receive = (loanId: ID, amount: Paise, mode: PaymentMode, electPrepayment: boolean) => {
      const societyId = state.loans[loanId]!.loan.societyId;
      const society = SOCIETIES.find((p) => p.society.id === societyId)!.society;
      receiptSeq[society.id] = (receiptSeq[society.id] ?? 0) + 1;
      emit({
        type: 'PAYMENT_RECEIVED',
        on: today,
        paymentId: `pay_${pad(++paymentSeq, 5)}`,
        loanId,
        amount,
        mode,
        receiptNo: `${society.code}/R/${pad(receiptSeq[society.id]!, 5)}`,
        source: 'CASH',
        electPrepayment,
        recordedBy: OFFICER_OF[society.id]!,
      });
    };

    // Collections: on its due date each member pays everything owed, unless
    // the script has them let it pass.
    for (const entry of Object.values(state.loans)) {
      if (entry.loan.status !== 'ACTIVE') continue;
      if (!entry.schedule.some((row) => row.dueOn === today)) continue;
      if (script.misses[entry.loan.id]?.includes(today)) continue;
      const due = positionOf(state, entry.loan.id).totalDueNow;
      if (due <= 0) continue;
      const mode: PaymentMode = dice.chance(0.55) ? 'CASH' : dice.chance(0.8) ? 'UPI' : 'BANK_TRANSFER';
      receive(entry.loan.id, due, mode, false);
    }
    for (const extra of script.receipts.filter((r) => r.on === today)) {
      const amount = extra.amount(positionOf(state, extra.loanId));
      receive(extra.loanId, amount, 'CASH', extra.prepay ?? false);
    }

    // Remittances: each society pays the federation on the date, in full
    // unless the script has it hold the principal back.
    for (const t of TRANCHES) {
      if (!state.tranches[t.trancheId]) continue;
      if (nextRemittanceDate(state, t.trancheId) !== today) continue;
      const due = remittanceDueFor(state, t.trancheId, today);
      const withheld = script.withheld.some((w) => w.trancheId === t.trancheId && w.dueOn === today);
      emit({
        type: 'REMITTANCE_RECORDED',
        on: today,
        remittanceId: `rem_${pad(++remittanceSeq, 5)}`,
        trancheId: t.trancheId,
        dueOn: today,
        interestPaid: due.interestDue,
        principalPaid: withheld ? 0 : due.principalDue,
        recordedBy: SECRETARY_OF[state.tranches[t.trancheId]!.tranche.societyId]!,
      });
    }

    cursor = pending().filter((d) => compareISO(d, today) > 0);
  }

  return { base, events };
}
