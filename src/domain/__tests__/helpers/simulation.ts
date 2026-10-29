import { compareISO } from '../../dates';
import { assertInvariants, type World } from '../../invariants';
import type { RemittanceDue, ReceiptSource } from '../../reconciliation';
import {
  DEFAULT_POLICY,
  type ID,
  type ISODate,
  type JournalEntry,
  type LoanApplication,
  type Member,
  type Paise,
  type Policy,
  type Pool,
  type PoolStatus,
} from '../../types';
import {
  applyEvent,
  createWorld,
  journalOf,
  loanOf,
  positionOf,
  remittanceDueFor,
  societySlice,
  trancheOf,
  type LoanState,
  type ReceiptEntry,
  type TrancheState,
  type WorldEvent,
  type WorldState,
} from '../../world';

/**
 * Drives one society through a lending cycle by dispatching events to the
 * same reducer the app uses. It exists for the phase gate: every action is one
 * event, and after each the twelve invariants are asserted.
 */

export interface LoanSpec {
  id: ID;
  principal: Paise;
  tenureMonths: number;
}

const SOCIETY = 'soc_1';
const POOL = 'pool_01';
const APEX_OFFICER = 'usr_apex';
const SECRETARY = 'usr_secretary';

export class Simulation {
  state: WorldState;
  /** Actions taken, each followed by an invariant check when enabled. */
  actions = 0;
  invariantChecks = 0;

  private paymentSeq = 0;
  private remittanceSeq = 0;
  private readonly checkEveryStep: boolean;

  constructor(options: {
    start: ISODate;
    specs: readonly LoanSpec[];
    policy?: Partial<Policy>;
    checkEveryStep?: boolean;
  }) {
    const policy = { ...DEFAULT_POLICY, ...options.policy };
    this.checkEveryStep = options.checkEveryStep ?? true;

    const members: Member[] = options.specs.map((spec, i) => ({
      id: `mem_${spec.id}`,
      societyId: SOCIETY,
      membershipNo: `M-${String(i + 1).padStart(4, '0')}`,
      name: `Member ${i + 1}`,
      village: 'Test village',
      phone: '+91 90000 00000',
      joinedOn: '2025-01-01',
      shareCapital: 100_000,
      occupation: 'Farmer',
      internalScore: 700,
      status: 'ACTIVE',
    }));
    const applications: LoanApplication[] = options.specs.map((spec) => ({
      id: `app_${spec.id}`,
      memberId: `mem_${spec.id}`,
      societyId: SOCIETY,
      requestedAmount: spec.principal,
      requestedTenureMonths: spec.tenureMonths,
      purpose: 'TRADE',
      appliedOn: options.start,
      status: 'APPROVED',
      decision: {
        by: 'usr_secretary',
        on: options.start,
        outcome: 'APPROVED',
        sanctionedAmount: spec.principal,
        tenureMonths: spec.tenureMonths,
        rateBps: policy.retailRateBps,
      },
      poolId: POOL,
    }));
    const pool: Pool = {
      id: POOL,
      societyId: SOCIETY,
      reference: 'POOL/TEST/001',
      applicationIds: applications.map((a) => a.id),
      requestedAmount: options.specs.reduce((t, s) => t + s.principal, 0),
      requestedTenureMonths: Math.max(...options.specs.map((s) => s.tenureMonths)),
      createdOn: options.start,
      status: 'OPEN',
    };

    this.state = createWorld({
      clock: options.start,
      policy,
      federation: { id: 'fed_1', name: 'Test Federation', shortName: 'TF', registeredOffice: 'Test' },
      societies: [
        {
          id: SOCIETY,
          federationId: 'fed_1',
          name: 'Test Society',
          code: 'TST',
          district: 'Test',
          registrationNo: 'TEST/1',
          creditLimit: 1_000_000_000,
          openedOn: '2020-01-01',
        },
      ],
      users: [
        { id: APEX_OFFICER, name: 'Apex Officer', role: 'APEX_OFFICER', title: 'Credit Officer' },
        { id: 'usr_secretary', name: 'Secretary', role: 'SECRETARY', title: 'Secretary', societyId: SOCIETY },
      ],
      members,
      applications,
      pools: [pool],
    });
  }

  // Views the gate tests read --------------------------------------------

  get clock(): ISODate {
    return this.state.clock;
  }

  get policy(): Policy {
    return this.state.policy;
  }

  get journal(): readonly JournalEntry[] {
    return journalOf(this.state, SOCIETY);
  }

  get loans(): Map<ID, LoanState> {
    return new Map(Object.entries(this.state.loans));
  }

  get tranches(): Map<ID, TrancheState> {
    return new Map(Object.entries(this.state.tranches));
  }

  world(): World {
    return societySlice(this.state, SOCIETY);
  }

  position(loanId: ID) {
    return positionOf(this.state, loanId);
  }

  // Actions -----------------------------------------------------------------

  private dispatch(event: WorldEvent): void {
    this.state = applyEvent(this.state, event);
    this.actions += 1;
    if (this.checkEveryStep) {
      assertInvariants(this.world());
      this.invariantChecks += 1;
    }
  }

  advanceTo(date: ISODate): void {
    if (compareISO(date, this.state.clock) < 0) throw new Error('the clock only moves forward');
    this.dispatch({ type: 'CLOCK_ADVANCED', to: date });
  }

  openReserves(amount: Paise): void {
    this.dispatch({ type: 'RESERVES_OPENED', on: this.clock, societyId: SOCIETY, amount });
  }

  movePool(to: PoolStatus): void {
    // The society builds and submits; the federation reviews.
    const recordedBy = to === 'UNDER_APEX_REVIEW' || to === 'DECLINED' ? APEX_OFFICER : SECRETARY;
    this.dispatch({ type: 'POOL_STATUS_CHANGED', on: this.clock, poolId: POOL, to, recordedBy });
  }

  sanction(spec: { id: ID; amount: Paise; tenureMonths: number }): void {
    this.dispatch({
      type: 'TRANCHE_SANCTIONED',
      on: this.clock,
      trancheId: spec.id,
      poolId: POOL,
      sanctionRef: `SAN/${spec.id}`,
      sanctionedAmount: spec.amount,
      wholesaleRateBps: this.policy.wholesaleRateBps,
      tenureMonths: spec.tenureMonths,
      remarks: 'Sanctioned in full',
      recordedBy: APEX_OFFICER,
    });
  }

  drawdown(trancheId: ID, amount: Paise): void {
    this.dispatch({ type: 'TRANCHE_DRAWN', on: this.clock, trancheId, amount, recordedBy: SECRETARY });
  }

  disburse(trancheId: ID, spec: LoanSpec, firstDueOn: ISODate): void {
    this.dispatch({
      type: 'LOAN_DISBURSED',
      on: this.clock,
      loanId: spec.id,
      applicationId: `app_${spec.id}`,
      trancheId,
      firstDueOn,
      recordedBy: SECRETARY,
    });
  }

  chargeFee(loanId: ID, amount: Paise): void {
    this.dispatch({ type: 'FEE_CHARGED', on: this.clock, loanId, amount, reason: 'Foreclosure fee' });
  }

  receive(
    loanId: ID,
    amount: Paise,
    options: { prepay?: boolean; source?: ReceiptSource } = {},
  ): ReceiptEntry {
    this.paymentSeq += 1;
    const seq = String(this.paymentSeq).padStart(5, '0');
    this.dispatch({
      type: 'PAYMENT_RECEIVED',
      on: this.clock,
      paymentId: `pay_${seq}`,
      loanId,
      amount,
      mode: 'CASH',
      receiptNo: `TST/${seq}`,
      source: options.source ?? 'CASH',
      electPrepayment: options.prepay ?? false,
      recordedBy: SECRETARY,
    });
    return loanOf(this.state, loanId).receipts.at(-1)!;
  }

  /** Every active loan, bar the skipped ones, pays everything due today in full. */
  collectAllDue(skip: readonly ID[] = []): ReceiptEntry[] {
    const receipts: ReceiptEntry[] = [];
    for (const [loanId, entry] of this.loans) {
      if (entry.loan.status !== 'ACTIVE' || skip.includes(loanId)) continue;
      const due = this.position(loanId).totalDueNow;
      if (due > 0) receipts.push(this.receive(loanId, due));
    }
    return receipts;
  }

  remit(
    trancheId: ID,
    how: 'FULL' | { interestPaid: Paise; principalPaid: Paise } = 'FULL',
  ): RemittanceDue {
    const due = remittanceDueFor(this.state, trancheId, this.clock);
    const paid =
      how === 'FULL' ? { interestPaid: due.interestDue, principalPaid: due.principalDue } : how;
    this.remittanceSeq += 1;
    this.dispatch({
      type: 'REMITTANCE_RECORDED',
      on: this.clock,
      remittanceId: `rem_${String(this.remittanceSeq).padStart(5, '0')}`,
      trancheId,
      dueOn: this.clock,
      ...paid,
      recordedBy: SECRETARY,
    });
    return trancheOf(this.state, trancheId).remittances.at(-1)!.due;
  }

  closePeriod(): void {
    this.dispatch({ type: 'PERIOD_CLOSED', on: this.clock, societyId: SOCIETY });
  }
}

/**
 * Twelve members, Rs 8,80,000 between them, on mixed tenures of 6 to 24 months
 * so the tranche's remittance windows are exercised as loans drop out.
 */
export const POOL_OF_TWELVE: readonly LoanSpec[] = [
  { id: 'loan_01', principal: 2_500_000, tenureMonths: 12 },
  { id: 'loan_02', principal: 4_000_000, tenureMonths: 12 },
  { id: 'loan_03', principal: 5_000_000, tenureMonths: 12 },
  { id: 'loan_04', principal: 6_000_000, tenureMonths: 12 },
  { id: 'loan_05', principal: 7_500_000, tenureMonths: 12 },
  { id: 'loan_06', principal: 8_000_000, tenureMonths: 12 },
  { id: 'loan_07', principal: 10_000_000, tenureMonths: 18 },
  { id: 'loan_08', principal: 10_000_000, tenureMonths: 18 },
  { id: 'loan_09', principal: 12_000_000, tenureMonths: 18 },
  { id: 'loan_10', principal: 15_000_000, tenureMonths: 24 },
  { id: 'loan_11', principal: 3_500_000, tenureMonths: 24 },
  { id: 'loan_12', principal: 4_500_000, tenureMonths: 6 },
];

export const POOL_TOTAL = POOL_OF_TWELVE.reduce((total, spec) => total + spec.principal, 0);

/**
 * Scenario A's starting state: reserves, the pool taken through submission and
 * review, sanctioned, drawn and disbursed. The reducer moves the pool to
 * SANCTIONED, DISBURSED and SERVICING itself as those events land.
 */
export function setUpPool(options: { policy?: Partial<Policy>; checkEveryStep?: boolean } = {}) {
  const sim = new Simulation({ start: '2026-04-01', specs: POOL_OF_TWELVE, ...options });
  sim.openReserves(20_000_000); // Rs 2,00,000 of the society's own funds
  for (const status of ['READY', 'SUBMITTED', 'UNDER_APEX_REVIEW'] as const) sim.movePool(status);
  sim.sanction({ id: 'trn_01', amount: POOL_TOTAL, tenureMonths: 24 });
  sim.advanceTo('2026-04-15');
  sim.drawdown('trn_01', POOL_TOTAL);
  for (const spec of POOL_OF_TWELVE) sim.disburse('trn_01', spec, '2026-05-15');
  return sim;
}

/** The 24 monthly due dates, 15 May 2026 to 15 April 2028. */
export function dueDates(sim: Simulation): ISODate[] {
  const dates = new Set<ISODate>();
  for (const entry of sim.loans.values()) for (const row of entry.schedule) dates.add(row.dueOn);
  return [...dates].sort(compareISO);
}
