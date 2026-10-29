import { financialYear } from '@/domain/dates';
import { collectionsQueue } from '@/domain/servicing';
import type { ID, ISODate, LoanPurpose, Paise, PaymentMode } from '@/domain/types';
import type { ReceiptSource } from '@/domain/reconciliation';
import { societyOf, type WorldEvent, type WorldState } from '@/domain/world';

/**
 * Turning what someone asked for into a complete event: fresh ids, the next
 * receipt number in the society's series, and who is doing it. The reducer
 * then decides whether it is allowed.
 */

function highest(values: Iterable<string>, pattern: RegExp): number {
  let max = 0;
  for (const value of values) {
    const match = pattern.exec(value);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

/** The highest number after `prefix` among the values that start with it. */
function highestAfter(values: Iterable<string>, prefix: string): number {
  let max = 0;
  for (const value of values) {
    if (!value.startsWith(prefix)) continue;
    const n = Number(value.slice(prefix.length));
    if (Number.isInteger(n)) max = Math.max(max, n);
  }
  return max;
}

const pad = (n: number) => String(n).padStart(5, '0');

function receiptsOf(world: WorldState) {
  return Object.values(world.loans).flatMap((l) => l.receipts.map((r) => ({ receipt: r, societyId: l.loan.societyId })));
}

/** The next `count` payment ids and receipt numbers for a society, in order. */
export function nextPaymentNumbers(
  world: WorldState,
  societyId: ID,
  count = 1,
): Array<{ paymentId: ID; receiptNo: string }> {
  const all = receiptsOf(world);
  const code = societyOf(world, societyId).code;
  const lastPayment = highest(all.map((x) => x.receipt.id), /^pay_(\d+)$/);
  const lastReceipt = highest(
    all.filter((x) => x.societyId === societyId).map((x) => x.receipt.receiptNo),
    new RegExp(`^${code}/R/(\\d+)$`),
  );
  return Array.from({ length: count }, (_, i) => ({
    paymentId: `pay_${pad(lastPayment + i + 1)}`,
    receiptNo: `${code}/R/${pad(lastReceipt + i + 1)}`,
  }));
}

export function nextRemittanceId(world: WorldState): ID {
  const ids = Object.values(world.tranches).flatMap((t) => t.remittances.map((r) => r.id));
  return `rem_${pad(highest(ids, /^rem_(\d+)$/) + 1)}`;
}

export interface RecordPaymentInput {
  loanId: ID;
  amount: Paise;
  mode: PaymentMode;
  source: ReceiptSource;
  electPrepayment: boolean;
}

export function paymentEvent(world: WorldState, input: RecordPaymentInput, recordedBy: ID): WorldEvent {
  const loan = world.loans[input.loanId]?.loan;
  if (!loan) throw new Error(`no loan ${input.loanId}`);
  const [numbers] = nextPaymentNumbers(world, loan.societyId);
  return { type: 'PAYMENT_RECEIVED', on: world.clock, ...numbers!, ...input, recordedBy };
}

export interface RecordRemittanceInput {
  trancheId: ID;
  dueOn: ISODate;
  interestPaid: Paise;
  principalPaid: Paise;
}

export function remittanceEvent(world: WorldState, input: RecordRemittanceInput, recordedBy: ID): WorldEvent {
  return {
    type: 'REMITTANCE_RECORDED',
    on: world.clock,
    remittanceId: nextRemittanceId(world),
    ...input,
    recordedBy,
  };
}

/** A receipt in full, in cash, for every instalment that fell due today. */
export function dueTodayEvents(world: WorldState, societyId: ID, recordedBy: ID): WorldEvent[] {
  const due = collectionsQueue(world, societyId).dueToday;
  const numbers = nextPaymentNumbers(world, societyId, due.length);
  return due.map((row, i) => ({
    type: 'PAYMENT_RECEIVED' as const,
    on: world.clock,
    ...numbers[i]!,
    loanId: row.loanId,
    amount: row.amountDue,
    mode: 'CASH' as const,
    source: 'CASH' as const,
    electPrepayment: false,
    recordedBy,
  }));
}

// ---------------------------------------------------------------------------
// Origination
// ---------------------------------------------------------------------------

export function nextApplicationId(world: WorldState): ID {
  return `app_${String(highest(world.applications.map((a) => a.id), /^app_(\d+)$/) + 1).padStart(3, '0')}`;
}

export function nextPoolId(world: WorldState): ID {
  return `pool_${String(highest(world.pools.map((p) => p.id), /^pool_(\d+)$/) + 1).padStart(2, '0')}`;
}

/** ANN/POOL/2026-27/03: the society's pools are numbered afresh each financial year. */
export function nextPoolReference(world: WorldState, societyId: ID): string {
  const prefix = `${societyOf(world, societyId).code}/POOL/${financialYear(world.clock)}/`;
  const last = highestAfter(world.pools.map((p) => p.reference), prefix);
  return `${prefix}${String(last + 1).padStart(2, '0')}`;
}

export function nextTrancheId(world: WorldState): ID {
  return `trn_${String(highest(Object.keys(world.tranches), /^trn_(\d+)$/) + 1).padStart(2, '0')}`;
}

/** PACF/SAN/2026-27/022: the federation numbers its sanctions across all societies. */
export function nextSanctionRef(world: WorldState): string {
  const prefix = `${world.federation.shortName}/SAN/${financialYear(world.clock)}/`;
  const last = highestAfter(Object.values(world.tranches).map((t) => t.tranche.sanctionRef), prefix);
  return `${prefix}${String(last + 1).padStart(3, '0')}`;
}

/** loan_042 for app_042, so a loan can be traced to its application at a glance. */
export function loanIdFor(world: WorldState, applicationId: ID, taken: ReadonlySet<ID> = new Set()): ID {
  const suffix = /^app_(\d+)$/.exec(applicationId)?.[1];
  const preferred = suffix ? `loan_${suffix}` : undefined;
  if (preferred && !world.loans[preferred] && !taken.has(preferred)) return preferred;
  const ids = [...Object.keys(world.loans), ...taken];
  return `loan_${String(highest(ids, /^loan_(\d+)$/) + 1).padStart(3, '0')}`;
}

export interface SubmitApplicationInput {
  memberId: ID;
  requestedAmount: Paise;
  requestedTenureMonths: number;
  purpose: LoanPurpose;
}

export function applicationEvent(world: WorldState, input: SubmitApplicationInput, recordedBy: ID): WorldEvent {
  return {
    type: 'APPLICATION_SUBMITTED',
    on: world.clock,
    applicationId: nextApplicationId(world),
    ...input,
    recordedBy,
  };
}

export interface AppraiseInput {
  applicationId: ID;
  monthlyIncome: Paise;
  existingObligations: Paise;
  recommendedAmount: Paise;
  notes: string;
}

export function appraisalEvent(world: WorldState, input: AppraiseInput, recordedBy: ID): WorldEvent {
  return { type: 'APPLICATION_APPRAISED', on: world.clock, ...input, recordedBy };
}

export interface DecideInput {
  applicationId: ID;
  outcome: 'APPROVED' | 'REJECTED';
  sanctionedAmount: Paise;
  tenureMonths: number;
  reason?: string;
}

export function decisionEvent(world: WorldState, input: DecideInput, recordedBy: ID): WorldEvent {
  return { type: 'APPLICATION_DECIDED', on: world.clock, ...input, recordedBy };
}

export interface SavePoolInput {
  societyId: ID;
  /** Absent to open a new pool. */
  poolId?: ID;
  applicationIds: ID[];
}

/** Opens a pool or changes what an open one holds; submitting adds the status change. */
export function savePoolEvents(
  world: WorldState,
  input: SavePoolInput,
  recordedBy: ID,
  submit: boolean,
): { poolId: ID; events: WorldEvent[] } {
  const on = world.clock;
  const poolId = input.poolId ?? nextPoolId(world);
  const events: WorldEvent[] = input.poolId
    ? [{ type: 'POOL_APPLICATIONS_SET', on, poolId, applicationIds: input.applicationIds, recordedBy }]
    : [
        {
          type: 'POOL_CREATED',
          on,
          poolId,
          reference: nextPoolReference(world, input.societyId),
          applicationIds: input.applicationIds,
          recordedBy,
        },
      ];
  if (submit) events.push({ type: 'POOL_STATUS_CHANGED', on, poolId, to: 'SUBMITTED', recordedBy });
  return { poolId, events };
}

export interface RescopeInput {
  poolId: ID;
  method: 'PRO_RATA' | 'REMOVE';
  keep: Array<{ applicationId: ID; amount: Paise }>;
}

export function rescopeEvent(world: WorldState, input: RescopeInput, recordedBy: ID): WorldEvent {
  return { type: 'POOL_RESCOPED', on: world.clock, ...input, recordedBy };
}

export interface SanctionInput {
  poolId: ID;
  sanctionedAmount: Paise;
  wholesaleRateBps: number;
  tenureMonths: number;
  remarks: string;
}

export function sanctionEvent(world: WorldState, input: SanctionInput, recordedBy: ID): WorldEvent {
  return {
    type: 'TRANCHE_SANCTIONED',
    on: world.clock,
    trancheId: nextTrancheId(world),
    sanctionRef: nextSanctionRef(world),
    ...input,
    recordedBy,
  };
}

export interface DrawAndDisburseInput {
  trancheId: ID;
  applicationIds: ID[];
  firstDueOn: ISODate;
}

/**
 * One drawdown for exactly what the chosen loans need beyond cash already
 * drawn and not yet lent, then a disbursement per loan. Dispatched together,
 * so the society never holds federation money it has not lent.
 */
export function drawAndDisburseEvents(
  world: WorldState,
  input: DrawAndDisburseInput,
  recordedBy: ID,
): { drawn: Paise; loanIds: ID[]; events: WorldEvent[] } {
  const entry = world.tranches[input.trancheId];
  if (!entry) throw new Error(`no tranche ${input.trancheId}`);
  const on = world.clock;
  const lent = entry.fundedLoanIds.reduce((t, id) => t + (world.loans[id]?.loan.principal ?? 0), 0);
  const idle = entry.tranche.drawdowns.reduce((t, d) => t + d.amount, 0) - lent;
  const needed = input.applicationIds.reduce(
    (t, id) => t + (world.applications.find((a) => a.id === id)?.decision?.sanctionedAmount ?? 0),
    0,
  );
  const drawn = Math.max(0, needed - idle);
  const events: WorldEvent[] = [];
  if (drawn > 0) events.push({ type: 'TRANCHE_DRAWN', on, trancheId: entry.tranche.id, amount: drawn, recordedBy });
  const taken = new Set<ID>();
  const loanIds = input.applicationIds.map((applicationId) => {
    const loanId = loanIdFor(world, applicationId, taken);
    taken.add(loanId);
    events.push({
      type: 'LOAN_DISBURSED',
      on,
      loanId,
      applicationId,
      trancheId: entry.tranche.id,
      firstDueOn: input.firstDueOn,
      recordedBy,
    });
    return loanId;
  });
  return { drawn, loanIds, events };
}
