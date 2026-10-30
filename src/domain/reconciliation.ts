import { addDaysISO, compareISO, daysBetween, maxISO } from './dates';
import { MONTHS_PER_YEAR, amortiseAtInstalment, generateSchedule, rowInterestAt } from './interest';
import { BPS_SCALE, assertNonNegative, assertPaise, mulRate, mulRateDays, roundHalfUp, sum } from './money';
import { allocationBuckets } from './types';
import type {
  Allocation,
  AllocationBucket,
  Bps,
  ID,
  ISODate,
  Loan,
  Paise,
  Policy,
  ReconciliationPolicy,
  ReconciliationResult,
  ScheduleRow,
  Tranche,
} from './types';

/**
 * The reconciliation engine: how each receipt from a member splits into what
 * the society owes the federation and what it keeps, and what the society owes
 * the federation for a tranche in a given period.
 *
 * Two amounts are authoritative because an outside party can dispute them:
 * retail interest, computed per loan, and wholesale interest, computed per
 * tranche on the tranche's own balance. The society's margin is the residual.
 *
 * Every function is pure. Nothing reads a clock: today is always an argument.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ReconciliationErrorCode =
  | 'NON_POSITIVE_AMOUNT'
  | 'LOAN_NOT_ACTIVE'
  | 'BEFORE_DISBURSEMENT'
  | 'AFTER_CLOCK'
  | 'OUT_OF_ORDER'
  | 'EXCEEDS_CEILING'
  | 'INSUFFICIENT_ADVANCE'
  | 'ADVANCE_EXCEEDS_DUE'
  | 'INVALID_ALLOCATION_ORDER'
  | 'REMITTANCE_WINDOW'
  | 'REMITTANCE_EXCEEDS_BALANCE';

export class ReconciliationError extends Error {
  constructor(
    readonly code: ReconciliationErrorCode,
    message: string,
    readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ReconciliationError';
  }
}

// ---------------------------------------------------------------------------
// Receipts and allocations
// ---------------------------------------------------------------------------

/**
 * CASH is money arriving from the member. ADVANCE is money the society already
 * holds for the member, from an earlier overpayment, being applied to an
 * instalment that has since fallen due.
 */
export type ReceiptSource = 'CASH' | 'ADVANCE';

/** A receipt as history: what arrived, when, and how it was allocated. */
export interface ReceiptRecord {
  receivedOn: ISODate;
  amount: Paise;
  source: ReceiptSource;
  allocation: Allocation;
}

export interface Prepayment {
  on: ISODate;
  principal: Paise;
}

export const ZERO_ALLOCATION: Readonly<Allocation> = Object.freeze({
  penalInterest: 0,
  fees: 0,
  overdueInterest: 0,
  overduePrincipal: 0,
  currentInterest: 0,
  currentPrincipal: 0,
  prepaidPrincipal: 0,
  advance: 0,
});

export function allocationTotal(allocation: Allocation): Paise {
  return sum([
    allocation.penalInterest,
    allocation.fees,
    allocation.overdueInterest,
    allocation.overduePrincipal,
    allocation.currentInterest,
    allocation.currentPrincipal,
    allocation.prepaidPrincipal,
    allocation.advance,
  ]);
}

export function interestPortion(allocation: Allocation): Paise {
  return allocation.overdueInterest + allocation.currentInterest;
}

/** All principal a receipt repaid, including any prepayment. */
export function principalPortion(allocation: Allocation): Paise {
  return regularPrincipal(allocation) + allocation.prepaidPrincipal;
}

/**
 * Principal repaid against schedule rows. A prepayment is not in here: it
 * reschedules the loan instead, so the rows that remain already exclude it.
 */
export function regularPrincipal(allocation: Allocation): Paise {
  return allocation.overduePrincipal + allocation.currentPrincipal;
}

/** The prepayments in a receipt history, for the tranche's pass-through. */
export function prepaymentsFrom(receipts: readonly ReceiptRecord[]): Prepayment[] {
  return receipts
    .filter((receipt) => receipt.allocation.prepaidPrincipal > 0)
    .map((receipt) => ({ on: receipt.receivedOn, principal: receipt.allocation.prepaidPrincipal }));
}

/**
 * The allocation order is a policy value, but not every order is coherent.
 * Each bucket must appear exactly once, ADVANCE must come last, and overdue
 * amounts must be served before current ones for both interest and principal.
 *
 * That last rule is what lets payments be attributed to schedule rows oldest
 * first without storing a per-row breakdown on every receipt. An order that
 * paid this month's principal before last month's would make the per-row
 * picture, and so the penal interest, disagree with the bucket totals.
 */
export function validateAllocationOrder(order: readonly AllocationBucket[]): void {
  const fail = (message: string): never => {
    throw new ReconciliationError('INVALID_ALLOCATION_ORDER', message, { order });
  };
  if (order.length !== allocationBuckets.length || new Set(order).size !== order.length) {
    fail(`allocation order must list each of the ${allocationBuckets.length} buckets exactly once`);
  }
  for (const bucket of allocationBuckets) {
    if (!order.includes(bucket)) fail(`allocation order is missing ${bucket}`);
  }
  if (order.at(-1) !== 'ADVANCE') fail('ADVANCE must be the last bucket in the allocation order');
  const at = (bucket: AllocationBucket): number => order.indexOf(bucket);
  if (at('OVERDUE_INTEREST') > at('CURRENT_INTEREST')) {
    fail('overdue interest must be served before current interest');
  }
  if (at('OVERDUE_PRINCIPAL') > at('CURRENT_PRINCIPAL')) {
    fail('overdue principal must be served before current principal');
  }
}

// ---------------------------------------------------------------------------
// Loan position
// ---------------------------------------------------------------------------

export interface RowState {
  readonly row: ScheduleRow;
  readonly interestUnpaid: Paise;
  readonly principalUnpaid: Paise;
}

export interface PositionInput {
  /**
   * The loan's current schedule. After any prepayment this must be the
   * rescheduled one the receipt returned; the original no longer applies.
   */
  schedule: readonly ScheduleRow[];
  receipts: readonly ReceiptRecord[];
  /** Total fees levied on the loan to date, including any foreclosure fee. */
  feesCharged: Paise;
  asOf: ISODate;
  penalRateBps: Bps;
  graceDays: number;
}

export interface LoanPosition {
  readonly asOf: ISODate;
  readonly rows: readonly RowState[];
  /** Rows due on or before asOf. */
  readonly dueCount: number;
  readonly overdueInterest: Paise;
  readonly overduePrincipal: Paise;
  readonly currentInterest: Paise;
  readonly currentPrincipal: Paise;
  readonly penalAccrued: Paise;
  readonly penalUnpaid: Paise;
  readonly feesUnpaid: Paise;
  /** Every unpaid rupee of principal, due or not. */
  readonly principalOutstanding: Paise;
  readonly principalNotYetDue: Paise;
  /** Advances held for the member, a liability of the society. */
  readonly unappliedReceipts: Paise;
  /** Everything owed right now, excluding principal that has not fallen due. */
  readonly totalDueNow: Paise;
  /** What the member would pay today to close the loan, before any fee. */
  readonly payoffAmount: Paise;
  readonly daysPastDue: number;
  readonly paid: {
    readonly interest: Paise;
    /** Against schedule rows. */
    readonly principal: Paise;
    readonly prepaid: Paise;
    readonly penal: Paise;
    readonly fees: Paise;
  };
}

/** Receipts in date order, keeping the given order within a single day. */
function inDateOrder(receipts: readonly ReceiptRecord[]): ReceiptRecord[] {
  return receipts
    .map((receipt, index) => ({ receipt, index }))
    .sort((a, b) => compareISO(a.receipt.receivedOn, b.receipt.receivedOn) || a.index - b.index)
    .map(({ receipt }) => receipt);
}

/** Applies cumulative interest and regular principal paid to the schedule, oldest first. */
function rowStates(
  schedule: readonly ScheduleRow[],
  paidInterest: Paise,
  paidPrincipal: Paise,
): RowState[] {
  let interestLeft = paidInterest;
  let principalLeft = paidPrincipal;
  return schedule.map((row) => {
    const interestTaken = Math.min(interestLeft, row.interest);
    interestLeft -= interestTaken;
    const principalTaken = Math.min(principalLeft, row.principal);
    principalLeft -= principalTaken;
    return {
      row,
      interestUnpaid: row.interest - interestTaken,
      principalUnpaid: row.principal - principalTaken,
    };
  });
}

/**
 * Penal interest accrues day by day on each overdue instalment's unpaid
 * amount, starting once the grace period after its due date has passed.
 *
 * It is computed by walking the receipt history, because the unpaid amount
 * changes at every receipt. Computing it only on what is unpaid today would let
 * a member who finally pays erase the penalty already earned on the days they
 * were late. The sum is kept in paise-days, an exact integer, and rounded once.
 *
 * A rescheduled tail never disturbs this: a prepayment is only accepted once
 * everything due is paid, so every rescheduled row falls due after it.
 */
function penalPaiseDays(
  schedule: readonly ScheduleRow[],
  receipts: readonly ReceiptRecord[],
  asOf: ISODate,
  graceDays: number,
): number {
  const firstDue = schedule[0]?.dueOn;
  if (firstDue === undefined) return 0;

  let paidInterest = 0;
  let paidPrincipal = 0;
  let total = 0;

  const accrue = (from: ISODate, to: ISODate): void => {
    if (compareISO(to, from) <= 0) return;
    for (const state of rowStates(schedule, paidInterest, paidPrincipal)) {
      const unpaid = state.interestUnpaid + state.principalUnpaid;
      if (unpaid === 0) continue;
      const start = maxISO(from, addDaysISO(state.row.dueOn, graceDays));
      if (compareISO(start, to) >= 0) continue;
      total += unpaid * daysBetween(start, to);
    }
  };

  let segmentStart = firstDue;
  for (const receipt of receipts) {
    if (compareISO(receipt.receivedOn, segmentStart) > 0) {
      accrue(segmentStart, receipt.receivedOn);
      segmentStart = receipt.receivedOn;
    }
    paidInterest += interestPortion(receipt.allocation);
    paidPrincipal += regularPrincipal(receipt.allocation);
  }
  accrue(segmentStart, asOf);

  if (!Number.isSafeInteger(total)) throw new Error('penal accrual left the safe integer range');
  return total;
}

export function loanPosition(input: PositionInput): LoanPosition {
  const { schedule, feesCharged, asOf, penalRateBps, graceDays } = input;
  assertNonNegative(feesCharged, 'feesCharged');

  const receipts = inDateOrder(input.receipts).filter(
    (receipt) => compareISO(receipt.receivedOn, asOf) <= 0,
  );

  let paidInterest = 0;
  let paidPrincipal = 0;
  let paidPrepaid = 0;
  let paidPenal = 0;
  let paidFees = 0;
  let advancesHeld = 0;
  for (const receipt of receipts) {
    paidInterest += interestPortion(receipt.allocation);
    paidPrincipal += regularPrincipal(receipt.allocation);
    paidPrepaid += receipt.allocation.prepaidPrincipal;
    paidPenal += receipt.allocation.penalInterest;
    paidFees += receipt.allocation.fees;
    advancesHeld += receipt.allocation.advance;
    if (receipt.source === 'ADVANCE') advancesHeld -= receipt.amount;
  }

  const rows = rowStates(schedule, paidInterest, paidPrincipal);
  const due = rows.filter((state) => compareISO(state.row.dueOn, asOf) <= 0);
  const current = due.at(-1);
  const overdue = due.slice(0, -1);

  const overdueInterest = sum(overdue.map((state) => state.interestUnpaid));
  const overduePrincipal = sum(overdue.map((state) => state.principalUnpaid));
  const currentInterest = current?.interestUnpaid ?? 0;
  const currentPrincipal = current?.principalUnpaid ?? 0;
  const principalOutstanding = sum(rows.map((state) => state.principalUnpaid));
  const principalNotYetDue = sum(
    rows
      .filter((state) => compareISO(state.row.dueOn, asOf) > 0)
      .map((state) => state.principalUnpaid),
  );

  const paiseDays = penalPaiseDays(schedule, receipts, asOf, graceDays);
  const penalProduct = paiseDays * penalRateBps;
  if (!Number.isSafeInteger(penalProduct)) throw new Error('penal accrual left the safe integer range');
  const penalAccrued = paiseDays === 0 ? 0 : roundHalfUp(penalProduct / (BPS_SCALE * 365));
  const penalUnpaid = Math.max(0, penalAccrued - paidPenal);
  const feesUnpaid = Math.max(0, feesCharged - paidFees);

  const oldestUnpaid = due.find((state) => state.interestUnpaid + state.principalUnpaid > 0);
  const totalDueNow =
    penalUnpaid +
    feesUnpaid +
    overdueInterest +
    overduePrincipal +
    currentInterest +
    currentPrincipal;

  return Object.freeze({
    asOf,
    rows: Object.freeze(rows),
    dueCount: due.length,
    overdueInterest,
    overduePrincipal,
    currentInterest,
    currentPrincipal,
    penalAccrued,
    penalUnpaid,
    feesUnpaid,
    principalOutstanding,
    principalNotYetDue,
    unappliedReceipts: advancesHeld,
    totalDueNow,
    payoffAmount: totalDueNow + principalNotYetDue,
    daysPastDue: oldestUnpaid ? daysBetween(oldestUnpaid.row.dueOn, asOf) : 0,
    paid: Object.freeze({
      interest: paidInterest,
      principal: paidPrincipal,
      prepaid: paidPrepaid,
      penal: paidPenal,
      fees: paidFees,
    }),
  });
}

// ---------------------------------------------------------------------------
// Reconciling one receipt
// ---------------------------------------------------------------------------

export interface ReceiptInput {
  amount: Paise;
  receivedOn: ISODate;
  source: ReceiptSource;
  /**
   * Apply anything beyond what is due to principal not yet due, rather than
   * hold it as an advance. The loan is then rescheduled at the same EMI over a
   * shorter tenure; prepaying all of it forecloses the loan.
   */
  electPrepayment: boolean;
}

export interface ReconcileInput {
  loan: Pick<Loan, 'id' | 'disbursedOn' | 'firstDueOn' | 'status' | 'rateBps' | 'emi'>;
  schedule: readonly ScheduleRow[];
  priorReceipts: readonly ReceiptRecord[];
  feesCharged: Paise;
  receipt: ReceiptInput;
  /** The simulated date. A receipt cannot be dated after it. */
  clock: ISODate;
  wholesaleRateBps: Bps;
  policy: Pick<Policy, 'penalRateBps' | 'graceDays' | 'allocationOrder'>;
}

export interface ReconcileOutput {
  /** Frozen onto the payment record. Never recomputed on read. */
  readonly reconciliation: ReconciliationResult;
  readonly closesLoan: boolean;
  /**
   * Present when the receipt prepaid principal. It replaces the loan's
   * schedule: rows already due are kept as history, and what remains is
   * re-amortised at the same EMI. Empty after a foreclosure before any row
   * fell due. The caller must store it; every later position depends on it.
   */
  readonly rescheduled: readonly ScheduleRow[] | undefined;
  readonly positionBefore: LoanPosition;
}

/**
 * The wholesale interest attributable to this loan's rows, given cumulative
 * retail interest paid. Attribution is cumulative and rounded, so the shares
 * across several part-payments of one row telescope to exactly the row's
 * wholesale interest once the row is fully paid. Rounding each part-payment
 * on its own would leave a paise or two stranded per row.
 */
function attributedWholesale(
  rows: readonly RowState[],
  cumulativeInterestPaid: Paise,
  wholesaleRateBps: Bps,
): Paise {
  let left = cumulativeInterestPaid;
  let total = 0;
  for (const { row } of rows) {
    if (left <= 0) break;
    const portion = Math.min(left, row.interest);
    left -= portion;
    if (row.interest === 0) continue;
    const rowWholesale = rowInterestAt(row, wholesaleRateBps);
    total += roundHalfUp((rowWholesale * portion) / row.interest);
  }
  return total;
}

/**
 * The schedule after a prepayment. Rows due on or before the receipt are kept;
 * they are all paid, because a prepayment is only reached once everything due
 * has been. The balance left is re-amortised at the loan's EMI from the next
 * period. A prepayment reduces the balance for the whole of the period it is
 * made in: there is no broken-period interest, matching a foreclosure.
 */
function rescheduleAfterPrepayment(
  loan: ReconcileInput['loan'],
  schedule: readonly ScheduleRow[],
  receivedOn: ISODate,
  balance: Paise,
): readonly ScheduleRow[] {
  const kept = schedule.filter((row) => compareISO(row.dueOn, receivedOn) <= 0);
  const tail =
    balance > 0
      ? amortiseAtInstalment({
          loanId: loan.id,
          principal: balance,
          annualBps: loan.rateBps,
          instalment: loan.emi,
          anchorDueOn: loan.firstDueOn,
          firstPeriod: (kept.at(-1)?.period ?? 0) + 1,
          maxPeriods: schedule.length - kept.length,
        })
      : [];
  return Object.freeze([...kept, ...tail]);
}

export function reconcileReceipt(input: ReconcileInput): ReconcileOutput {
  const { loan, schedule, priorReceipts, feesCharged, receipt, clock, wholesaleRateBps, policy } =
    input;

  validateAllocationOrder(policy.allocationOrder);
  assertPaise(receipt.amount, 'receipt amount');

  if (receipt.amount <= 0) {
    throw new ReconciliationError('NON_POSITIVE_AMOUNT', 'a receipt must be greater than zero');
  }
  if (loan.status !== 'ACTIVE') {
    throw new ReconciliationError(
      'LOAN_NOT_ACTIVE',
      `cannot take a payment against a ${loan.status} loan`,
      { status: loan.status },
    );
  }
  if (compareISO(receipt.receivedOn, loan.disbursedOn) < 0) {
    throw new ReconciliationError(
      'BEFORE_DISBURSEMENT',
      `a receipt cannot be dated before disbursement on ${loan.disbursedOn}`,
    );
  }
  if (compareISO(receipt.receivedOn, clock) > 0) {
    throw new ReconciliationError(
      'AFTER_CLOCK',
      `a receipt cannot be dated after today, ${clock}`,
    );
  }
  // Backdating a receipt would change the penal interest already frozen onto
  // every later receipt, so history is append-only.
  const latestPrior = inDateOrder(priorReceipts).at(-1);
  if (latestPrior && compareISO(receipt.receivedOn, latestPrior.receivedOn) < 0) {
    throw new ReconciliationError(
      'OUT_OF_ORDER',
      `a receipt cannot be dated before the last one, on ${latestPrior.receivedOn}`,
    );
  }

  const position = loanPosition({
    schedule,
    receipts: priorReceipts,
    feesCharged,
    asOf: receipt.receivedOn,
    penalRateBps: policy.penalRateBps,
    graceDays: policy.graceDays,
  });

  if (receipt.source === 'CASH') {
    const ceiling = position.payoffAmount - position.unappliedReceipts;
    if (receipt.amount > ceiling) {
      throw new ReconciliationError(
        'EXCEEDS_CEILING',
        `the most this loan can accept today is ${ceiling} paise`,
        { maxAcceptable: Math.max(0, ceiling) },
      );
    }
  } else if (receipt.amount > position.unappliedReceipts) {
    throw new ReconciliationError(
      'INSUFFICIENT_ADVANCE',
      `only ${position.unappliedReceipts} paise is held in advance for this member`,
      { held: position.unappliedReceipts },
    );
  }

  // The waterfall, in policy order. ADVANCE is always last and is handled as
  // whatever remains, so it is skipped here.
  const owed: Record<Exclude<AllocationBucket, 'ADVANCE'>, Paise> = {
    PENAL_INTEREST: position.penalUnpaid,
    FEES: position.feesUnpaid,
    OVERDUE_INTEREST: position.overdueInterest,
    OVERDUE_PRINCIPAL: position.overduePrincipal,
    CURRENT_INTEREST: position.currentInterest,
    CURRENT_PRINCIPAL: position.currentPrincipal,
  };
  const taken: Record<Exclude<AllocationBucket, 'ADVANCE'>, Paise> = {
    PENAL_INTEREST: 0,
    FEES: 0,
    OVERDUE_INTEREST: 0,
    OVERDUE_PRINCIPAL: 0,
    CURRENT_INTEREST: 0,
    CURRENT_PRINCIPAL: 0,
  };
  let remaining = receipt.amount;
  for (const bucket of policy.allocationOrder) {
    if (bucket === 'ADVANCE') continue;
    const portion = Math.min(remaining, owed[bucket]);
    taken[bucket] = portion;
    remaining -= portion;
  }

  let prepaidPrincipal = 0;
  let advance = 0;
  if (remaining > 0 && receipt.electPrepayment) {
    prepaidPrincipal = Math.min(remaining, position.principalNotYetDue);
    remaining -= prepaidPrincipal;
  }
  if (remaining > 0) {
    if (receipt.source === 'ADVANCE') {
      throw new ReconciliationError(
        'ADVANCE_EXCEEDS_DUE',
        'an advance can only be applied to amounts that have fallen due, or prepaid',
        { excess: remaining },
      );
    }
    advance = remaining;
  }

  const allocation: Allocation = Object.freeze({
    penalInterest: taken.PENAL_INTEREST,
    fees: taken.FEES,
    overdueInterest: taken.OVERDUE_INTEREST,
    overduePrincipal: taken.OVERDUE_PRINCIPAL,
    currentInterest: taken.CURRENT_INTEREST,
    currentPrincipal: taken.CURRENT_PRINCIPAL,
    prepaidPrincipal,
    advance,
  });
  if (allocationTotal(allocation) !== receipt.amount) {
    throw new Error('allocation does not sum to the receipt; the waterfall is broken');
  }

  const interestNow = interestPortion(allocation);
  const principalNow = principalPortion(allocation);
  const wholesaleShare =
    attributedWholesale(position.rows, position.paid.interest + interestNow, wholesaleRateBps) -
    attributedWholesale(position.rows, position.paid.interest, wholesaleRateBps);

  const loanOutstanding = position.principalOutstanding - principalNow;
  const unappliedAfter =
    position.unappliedReceipts + advance - (receipt.source === 'ADVANCE' ? receipt.amount : 0);

  const rescheduled =
    prepaidPrincipal > 0
      ? rescheduleAfterPrepayment(
          loan,
          schedule,
          receipt.receivedOn,
          position.principalNotYetDue - prepaidPrincipal,
        )
      : undefined;

  const reconciliation: ReconciliationResult = Object.freeze({
    allocation,
    federation: Object.freeze({
      wholesaleInterestShare: wholesaleShare,
      principalPassThrough: principalNow,
      remittanceShare: wholesaleShare + principalNow,
    }),
    society: Object.freeze({
      netInterestIncome: interestNow - wholesaleShare,
      penalIncome: allocation.penalInterest,
      feeIncome: allocation.fees,
    }),
    balancesAfter: Object.freeze({
      loanOutstanding,
      unappliedReceipts: unappliedAfter,
    }),
  });

  const closesLoan =
    loanOutstanding === 0 &&
    position.overdueInterest + position.currentInterest - interestNow === 0 &&
    position.penalUnpaid - allocation.penalInterest === 0 &&
    position.feesUnpaid - allocation.fees === 0;

  return Object.freeze({ reconciliation, closesLoan, rescheduled, positionBefore: position });
}

/**
 * Applies advances already held for the member to whatever has fallen due.
 * The clock never does this on its own; it is an explicit officer action.
 */
export function applyHeldAdvance(
  input: Omit<ReconcileInput, 'receipt'> & { on: ISODate },
): ReconcileOutput {
  const position = loanPosition({
    schedule: input.schedule,
    receipts: input.priorReceipts,
    feesCharged: input.feesCharged,
    asOf: input.on,
    penalRateBps: input.policy.penalRateBps,
    graceDays: input.policy.graceDays,
  });
  const amount = Math.min(position.unappliedReceipts, position.totalDueNow);
  if (amount <= 0) {
    throw new ReconciliationError(
      'NON_POSITIVE_AMOUNT',
      position.unappliedReceipts <= 0
        ? 'no advance is held for this member'
        : 'nothing has fallen due to apply the advance to',
    );
  }
  return reconcileReceipt({
    ...input,
    receipt: { amount, receivedOn: input.on, source: 'ADVANCE', electPrepayment: false },
  });
}

// ---------------------------------------------------------------------------
// The tranche side: what the society owes the federation in a period
// ---------------------------------------------------------------------------

export interface FundedLoan {
  loanId: ID;
  /** The loan's current schedule, rescheduled if it has been prepaid. */
  schedule: readonly ScheduleRow[];
  /** Principal prepaid by the member, passed to the federation at the next remittance. */
  prepayments?: readonly Prepayment[];
}

export interface RemittanceRecord {
  dueOn: ISODate;
  interestDue: Paise;
  principalDue: Paise;
  interestPaid: Paise;
  principalPaid: Paise;
}

export interface RemittanceInput {
  tranche: Pick<Tranche, 'id' | 'wholesaleRateBps' | 'tenureMonths' | 'drawdowns'>;
  fundedLoans: readonly FundedLoan[];
  priorRemittances: readonly RemittanceRecord[];
  dueOn: ISODate;
  policy: ReconciliationPolicy;
}

export interface RemittanceDue {
  readonly dueOn: ISODate;
  readonly period: number;
  /** Drawn less principal actually remitted: what wholesale interest is charged on. */
  readonly trancheOpening: Paise;
  readonly wholesaleInterest: Paise;
  readonly interestArrears: Paise;
  readonly principalScheduled: Paise;
  readonly principalArrears: Paise;
  readonly interestDue: Paise;
  readonly principalDue: Paise;
  readonly totalDue: Paise;
  /** Principal scheduled on member rows falling due in this period's window. */
  readonly memberPrincipalScheduled: Paise;
  /** Principal members prepaid in this window, passed straight through. */
  readonly prepaidPassThrough: Paise;
  /** Wholesale interest on each member row's own balance, summed. */
  readonly memberWholesaleScheduled: Paise;
  /** Zero under pass-through; the independent-schedule gap otherwise. */
  readonly principalTimingGap: Paise;
  /**
   * Tranche wholesale interest less the sum of per-row wholesale interest.
   * While everything is on schedule this is pure rounding, at most half a
   * paise per funded loan. Otherwise it measures a real cost: wholesale
   * interest on principal the federation is still owed, from a short
   * remittance, or from a prepayment held until the next remittance date.
   */
  readonly wholesaleVariance: Paise;
}

/** The dates remittances fall due: every distinct member due date, in order. */
export function remittanceDates(fundedLoans: readonly FundedLoan[]): ISODate[] {
  const dates = new Set<ISODate>();
  for (const loan of fundedLoans) for (const row of loan.schedule) dates.add(row.dueOn);
  return [...dates].sort(compareISO);
}

export function trancheDrawn(
  tranche: Pick<Tranche, 'drawdowns'>,
  asOf?: ISODate,
): Paise {
  return sum(
    tranche.drawdowns
      .filter((drawdown) => asOf === undefined || compareISO(drawdown.on, asOf) <= 0)
      .map((drawdown) => drawdown.amount),
  );
}

export function computeRemittance(input: RemittanceInput): RemittanceDue {
  const { tranche, fundedLoans, priorRemittances, dueOn, policy } = input;

  const last = priorRemittances.at(-1);
  if (last && compareISO(dueOn, last.dueOn) <= 0) {
    throw new ReconciliationError(
      'REMITTANCE_WINDOW',
      `a remittance due ${dueOn} cannot follow one already due ${last.dueOn}`,
    );
  }

  const inWindow = (date: ISODate): boolean =>
    compareISO(date, dueOn) <= 0 && (!last || compareISO(date, last.dueOn) > 0);
  const windowRows = fundedLoans.flatMap((loan) =>
    loan.schedule.filter((row) => inWindow(row.dueOn)),
  );

  const memberPrincipalScheduled = sum(windowRows.map((row) => row.principal));
  const memberWholesaleScheduled = sum(windowRows.map((row) => rowInterestAt(row, tranche.wholesaleRateBps)));
  // The broken periods of loans first due in this window: the federation is
  // paid for the same days, on the same balances, as their members pay for.
  const brokenPeriodWholesale = sum(
    windowRows.map((row) =>
      row.brokenPeriodDays ? mulRateDays(row.opening, tranche.wholesaleRateBps, row.brokenPeriodDays) : 0,
    ),
  );
  const prepaidPassThrough = sum(
    fundedLoans.flatMap((loan) =>
      (loan.prepayments ?? []).filter((p) => inWindow(p.on)).map((p) => p.principal),
    ),
  );

  const principalRemitted = sum(priorRemittances.map((remittance) => remittance.principalPaid));
  const trancheOpening = trancheDrawn(tranche, dueOn) - principalRemitted;
  assertNonNegative(trancheOpening, 'tranche opening balance');

  const period = priorRemittances.length + 1;
  const wholesaleInterest =
    mulRate(trancheOpening, tranche.wholesaleRateBps, MONTHS_PER_YEAR) + brokenPeriodWholesale;
  // Each period's due already includes the arrears brought into it, so only
  // the most recent shortfall is carried, never the sum of all of them.
  const interestArrears = last ? last.interestDue - last.interestPaid : 0;
  const principalArrears = last ? last.principalDue - last.principalPaid : 0;

  let principalScheduled: Paise;
  if (policy === 'PASS_THROUGH') {
    principalScheduled = memberPrincipalScheduled + prepaidPassThrough;
  } else {
    // The tranche keeps its own annuity whatever members do; prepaid cash
    // stays with the society. That is the policy, and the gap reports it.
    const firstDue = remittanceDates(fundedLoans)[0] ?? dueOn;
    const trancheSchedule = generateSchedule({
      loanId: tranche.id,
      principal: trancheDrawn(tranche),
      annualBps: tranche.wholesaleRateBps,
      tenureMonths: tranche.tenureMonths,
      firstDueOn: firstDue,
    });
    principalScheduled = trancheSchedule[period - 1]?.principal ?? 0;
  }

  const principalDue = principalScheduled + principalArrears;
  if (principalDue > trancheOpening) {
    throw new ReconciliationError(
      'REMITTANCE_EXCEEDS_BALANCE',
      `principal due ${principalDue} exceeds the tranche balance ${trancheOpening}`,
    );
  }
  const interestDue = wholesaleInterest + interestArrears;

  return Object.freeze({
    dueOn,
    period,
    trancheOpening,
    wholesaleInterest,
    interestArrears,
    principalScheduled,
    principalArrears,
    interestDue,
    principalDue,
    totalDue: interestDue + principalDue,
    memberPrincipalScheduled,
    prepaidPassThrough,
    memberWholesaleScheduled,
    principalTimingGap: principalScheduled - memberPrincipalScheduled - prepaidPassThrough,
    wholesaleVariance: wholesaleInterest - memberWholesaleScheduled,
  });
}
