import {
  addDaysISO,
  addMonthsISO,
  compareISO,
  endOfMonth,
  financialYearStart,
  minISO,
  startOfFinancialQuarter,
  startOfMonth,
} from './dates';
import { MONTHS_PER_YEAR, rowInterestAt } from './interest';
import { ACCOUNTS, accountFor, type Account, type AccountCode } from './ledger';
import { mulRate, sum } from './money';
import { societyTrackRecord, type SocietyTrackRecord } from './origination';
import { interestPortion } from './reconciliation';
import {
  accountBalances,
  balanceSheet,
  incomeStatement,
  trialBalance,
  type BalanceSheet,
  type DateRange,
  type IncomeStatement,
  type TrialBalance,
} from './statements';
import type { ID, ISODate, JournalEntry, JournalLine, JournalSourceType, Paise, Pool, Tranche } from './types';
import { apexExposure, societySummary, type DueBucket, type ExposureRow, type SocietySummary } from './views';
import { journalOf, memberOf, positionOf, type WorldState } from './world';

/**
 * Ledger and reporting read models. Every money figure a report shows is
 * either folded from the journal, with the query that folds it alongside so
 * the screen can link to the very lines, or derived from schedules and
 * receipts with the books it ties to stated next to it.
 */

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type PeriodId = 'MONTH' | 'LAST_MONTH' | 'QUARTER' | 'YEAR' | 'LAST_YEAR' | 'INCEPTION';

export interface Period {
  readonly id: PeriodId;
  readonly label: string;
  readonly from: ISODate;
  readonly to: ISODate;
}

/** The periods a statement can be run for, ending no later than today. */
export function periodPresets(clock: ISODate, inception: ISODate): Period[] {
  const lastMonthStart = addMonthsISO(startOfMonth(clock), -1);
  const yearStart = financialYearStart(clock);
  const lastYearStart = addMonthsISO(yearStart, -12);
  return [
    { id: 'MONTH', label: 'This month', from: startOfMonth(clock), to: clock },
    { id: 'LAST_MONTH', label: 'Last month', from: lastMonthStart, to: endOfMonth(lastMonthStart) },
    { id: 'QUARTER', label: 'This quarter', from: startOfFinancialQuarter(clock), to: clock },
    { id: 'YEAR', label: 'This financial year', from: yearStart, to: clock },
    { id: 'LAST_YEAR', label: 'Last financial year', from: lastYearStart, to: addDaysISO(yearStart, -1) },
    { id: 'INCEPTION', label: 'Since inception', from: inception, to: clock },
  ];
}

/** The day of a society's first journal entry, or today if it has none. */
export function inceptionOf(state: WorldState, societyId: ID): ISODate {
  return journalOf(state, societyId)[0]?.on ?? state.clock;
}

// ---------------------------------------------------------------------------
// Ledger traces
// ---------------------------------------------------------------------------

/**
 * A figure as a question to the journal: these accounts' balances, added or
 * subtracted, over these dates. The same query computes the figure and lists
 * the lines behind it, so the two cannot disagree.
 */
export interface LedgerQuery {
  readonly plus: readonly AccountCode[];
  readonly minus?: readonly AccountCode[];
  /** Inclusive. */
  readonly from?: ISODate;
  /** Inclusive. */
  readonly to?: ISODate;
  readonly source?: JournalSourceType;
  /** Only entries about this loan: its disbursement and its receipts. */
  readonly loanId?: ID;
}

export interface TracedFigure {
  readonly value: Paise;
  readonly trace: LedgerQuery;
}

export interface TraceLine {
  readonly entry: JournalEntry;
  readonly line: JournalLine;
  readonly account: Account;
}

export interface TraceAccount {
  readonly account: Account;
  readonly sign: 1 | -1;
  readonly dr: Paise;
  readonly cr: Paise;
  /** On the account's normal side. */
  readonly balance: Paise;
}

export interface LedgerTrace {
  readonly query: LedgerQuery;
  /** The entries the query selects, newest first. */
  readonly entries: readonly JournalEntry[];
  /** Each selected entry's lines on the queried accounts, or every line when none are named. */
  readonly lines: readonly TraceLine[];
  readonly accounts: readonly TraceAccount[];
  /** The added balances less the subtracted ones. Zero when no account is named. */
  readonly total: Paise;
  /** Period-close entries are left out when every account is income or expense, as on the income statement. */
  readonly excludesClosing: boolean;
}

function inRange(on: ISODate, range: DateRange): boolean {
  if (range.from !== undefined && compareISO(on, range.from) < 0) return false;
  if (range.to !== undefined && compareISO(on, range.to) > 0) return false;
  return true;
}

/** The journal source ids that concern a loan: its disbursement and each receipt. */
function sourcesOfLoan(state: WorldState, loanId: ID): Set<ID> {
  const entry = state.loans[loanId];
  return new Set(entry ? [loanId, ...entry.receipts.map((r) => r.id)] : []);
}

export function ledgerTrace(state: WorldState, societyId: ID, query: LedgerQuery): LedgerTrace {
  const signs = new Map<number, 1 | -1>();
  for (const code of query.plus) signs.set(code, 1);
  for (const code of query.minus ?? []) signs.set(code, -1);
  const named = signs.size > 0;
  const excludesClosing =
    named && [...signs.keys()].every((code) => ['INCOME', 'EXPENSE'].includes(accountFor(code).type));
  const loanSources = query.loanId ? sourcesOfLoan(state, query.loanId) : undefined;

  const selected = journalOf(state, societyId).filter(
    (entry) =>
      inRange(entry.on, query) &&
      (query.source === undefined || entry.sourceType === query.source) &&
      (loanSources === undefined || loanSources.has(entry.sourceId)) &&
      !(excludesClosing && entry.sourceType === 'CLOSE') &&
      (!named || entry.lines.some((line) => signs.has(line.accountCode))),
  );

  const lines: TraceLine[] = [];
  const totals = new Map<number, { dr: Paise; cr: Paise }>();
  for (const code of signs.keys()) totals.set(code, { dr: 0, cr: 0 });
  for (const entry of selected) {
    for (const line of entry.lines) {
      if (named && !signs.has(line.accountCode)) continue;
      lines.push({ entry, line, account: accountFor(line.accountCode) });
      const total = totals.get(line.accountCode);
      if (total) {
        total.dr += line.dr;
        total.cr += line.cr;
      }
    }
  }
  const accounts: TraceAccount[] = [...signs].map(([code, sign]) => {
    const account = accountFor(code);
    const { dr, cr } = totals.get(code)!;
    return { account, sign, dr, cr, balance: account.normal === 'DR' ? dr - cr : cr - dr };
  });
  return {
    query,
    entries: [...selected].reverse(),
    lines,
    accounts,
    total: sum(accounts.map((a) => a.sign * a.balance)),
    excludesClosing,
  };
}

function traced(state: WorldState, societyId: ID, query: LedgerQuery): TracedFigure {
  return { value: ledgerTrace(state, societyId, query).total, trace: query };
}

// ---------------------------------------------------------------------------
// T-accounts, trial balance and statements
// ---------------------------------------------------------------------------

export interface TAccountLine {
  readonly entryId: ID;
  readonly on: ISODate;
  readonly narration: string;
  readonly sourceType: JournalSourceType;
  readonly sourceId: ID;
  readonly amount: Paise;
}

export interface TAccountView {
  readonly account: Account;
  readonly range: DateRange;
  /** Brought down from before the range, on the normal side. */
  readonly opening: Paise;
  readonly debits: readonly TAccountLine[];
  readonly credits: readonly TAccountLine[];
  readonly totalDr: Paise;
  readonly totalCr: Paise;
  /** Carried down at the end of the range, on the normal side. */
  readonly closing: Paise;
}

export function tAccountView(state: WorldState, societyId: ID, code: AccountCode, range: DateRange = {}): TAccountView {
  const account = accountFor(code);
  const journal = journalOf(state, societyId);
  const opening =
    range.from === undefined ? 0 : accountBalances(journal, { to: addDaysISO(range.from, -1) }).get(code)!.balance;
  const debits: TAccountLine[] = [];
  const credits: TAccountLine[] = [];
  for (const entry of journal) {
    if (!inRange(entry.on, range)) continue;
    for (const line of entry.lines) {
      if (line.accountCode !== code) continue;
      const base = {
        entryId: entry.id,
        on: entry.on,
        narration: entry.narration,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
      };
      if (line.dr > 0) debits.push({ ...base, amount: line.dr });
      if (line.cr > 0) credits.push({ ...base, amount: line.cr });
    }
  }
  const totalDr = sum(debits.map((l) => l.amount));
  const totalCr = sum(credits.map((l) => l.amount));
  const movement = account.normal === 'DR' ? totalDr - totalCr : totalCr - totalDr;
  return { account, range, opening, debits, credits, totalDr, totalCr, closing: opening + movement };
}

export function trialBalanceOf(state: WorldState, societyId: ID, asOf: ISODate = state.clock): TrialBalance {
  return trialBalance(journalOf(state, societyId), { to: asOf });
}

export interface Statements {
  readonly from: ISODate;
  readonly to: ISODate;
  readonly income: IncomeStatement;
  /** At the end of the period. */
  readonly balance: BalanceSheet;
  readonly trialBalanced: boolean;
  /**
   * Where the surplus not yet closed into reserves starts: the day after the
   * last period close on or before the period's end, else the beginning.
   */
  readonly openSurplusFrom: ISODate | undefined;
}

export function statementsFor(state: WorldState, societyId: ID, range: { from: ISODate; to: ISODate }): Statements {
  const journal = journalOf(state, societyId);
  const lastClose = journal.filter((e) => e.sourceType === 'CLOSE' && compareISO(e.on, range.to) <= 0).at(-1);
  return {
    from: range.from,
    to: range.to,
    income: incomeStatement(journal, range),
    balance: balanceSheet(journal, range.to),
    trialBalanced: trialBalance(journal, { to: range.to }).balanced,
    openSurplusFrom: lastClose ? addDaysISO(lastClose.on, 1) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

export type AgeingKey = 'CURRENT' | 'GRACE' | 'UPTO_30' | 'UPTO_60' | 'UPTO_90' | 'OVER_90';

export interface AgeingLoan {
  readonly loanId: ID;
  readonly memberId: ID;
  readonly memberName: string;
  readonly daysPastDue: number;
  /** Owed now and unpaid: zero for a loan that is current. */
  readonly arrears: Paise;
  readonly outstanding: Paise;
}

export interface AgeingBucket {
  readonly key: AgeingKey;
  readonly label: string;
  readonly loans: readonly AgeingLoan[];
  readonly amount: Paise;
}

export interface AgeingReport {
  readonly asOf: ISODate;
  readonly buckets: readonly AgeingBucket[];
  /** Principal outstanding across every bucket. */
  readonly total: Paise;
  /** The same figure from the books: Member Loans Receivable. */
  readonly ledger: TracedFigure;
  /** Past the grace period, as a share of principal outstanding. */
  readonly atRisk: { readonly amount: Paise; readonly share: number; readonly loans: number };
}

function ageingBands(graceDays: number): ReadonlyArray<{ key: AgeingKey; label: string; max: number }> {
  return [
    { key: 'CURRENT', label: 'Current', max: 0 },
    { key: 'GRACE', label: `1–${graceDays} days, in grace`, max: graceDays },
    { key: 'UPTO_30', label: `${graceDays + 1}–30 days`, max: 30 },
    { key: 'UPTO_60', label: '31–60 days', max: 60 },
    { key: 'UPTO_90', label: '61–90 days', max: 90 },
    { key: 'OVER_90', label: 'Over 90 days', max: Number.POSITIVE_INFINITY },
  ];
}

export function ageingReport(state: WorldState, societyId: ID): AgeingReport {
  const bands = ageingBands(state.policy.graceDays);
  const loans = Object.values(state.loans)
    .filter((l) => l.loan.societyId === societyId && l.loan.status === 'ACTIVE')
    .map((l): AgeingLoan => {
      const position = positionOf(state, l.loan.id);
      return {
        loanId: l.loan.id,
        memberId: l.loan.memberId,
        memberName: memberOf(state, l.loan.memberId).name,
        daysPastDue: position.daysPastDue,
        arrears: position.daysPastDue > 0 ? position.totalDueNow : 0,
        outstanding: position.principalOutstanding,
      };
    })
    .sort((a, b) => b.daysPastDue - a.daysPastDue || a.memberName.localeCompare(b.memberName));
  const buckets = bands.map((band, i) => {
    const min = i === 0 ? 0 : bands[i - 1]!.max + 1;
    const inBand = loans.filter((l) => l.daysPastDue >= min && l.daysPastDue <= band.max);
    return { key: band.key, label: band.label, loans: inBand, amount: sum(inBand.map((l) => l.outstanding)) };
  });
  const total = sum(buckets.map((b) => b.amount));
  const late = loans.filter((l) => l.daysPastDue > state.policy.graceDays);
  const lateAmount = sum(late.map((l) => l.outstanding));
  return {
    asOf: state.clock,
    buckets,
    total,
    ledger: traced(state, societyId, { plus: [ACCOUNTS.LOANS_RECEIVABLE] }),
    atRisk: { amount: lateAmount, share: total > 0 ? lateAmount / total : 0, loans: late.length },
  };
}

// ---------------------------------------------------------------------------
// Collection efficiency
// ---------------------------------------------------------------------------

export interface CollectionMonth {
  /** 'YYYY-MM' */
  readonly month: string;
  readonly from: ISODate;
  /** The month's end, or today for the month in progress. */
  readonly to: ISODate;
  readonly instalments: number;
  readonly paidInFull: number;
  readonly due: Paise;
  /** Paid against those instalments by `to`. */
  readonly collected: Paise;
  /** Undefined while nothing has fallen due. */
  readonly rate: number | undefined;
  /** Cash received from members over the month, from the books. */
  readonly received: TracedFigure;
}

export interface CollectionDue {
  readonly loanId: ID;
  readonly memberName: string;
  readonly dueOn: ISODate;
  readonly instalment: Paise;
  readonly paid: Paise;
}

function monthsBetween(first: ISODate, last: ISODate): ISODate[] {
  const months: ISODate[] = [];
  for (let m = startOfMonth(first); compareISO(m, last) <= 0; m = addMonthsISO(m, 1)) months.push(m);
  return months;
}

/** Each instalment due in the range, and what had been paid against it by the range's end. */
export function collectionDues(state: WorldState, societyId: ID, range: { from: ISODate; to: ISODate }): CollectionDue[] {
  const to = minISO(range.to, state.clock);
  const dues: CollectionDue[] = [];
  for (const entry of Object.values(state.loans)) {
    if (entry.loan.societyId !== societyId) continue;
    if (!entry.schedule.some((r) => inRange(r.dueOn, { from: range.from, to }))) continue;
    const position = positionOf(state, entry.loan.id, to);
    const memberName = memberOf(state, entry.loan.memberId).name;
    for (const { row, interestUnpaid, principalUnpaid } of position.rows) {
      if (!inRange(row.dueOn, { from: range.from, to })) continue;
      dues.push({
        loanId: entry.loan.id,
        memberName,
        dueOn: row.dueOn,
        instalment: row.instalment,
        paid: row.instalment - interestUnpaid - principalUnpaid,
      });
    }
  }
  return dues.sort((a, b) => compareISO(a.dueOn, b.dueOn) || a.memberName.localeCompare(b.memberName));
}

/** Month by month since the first instalment fell due, oldest first. */
export function collectionEfficiency(state: WorldState, societyId: ID): CollectionMonth[] {
  const firstDue = Object.values(state.loans)
    .filter((l) => l.loan.societyId === societyId)
    .map((l) => l.loan.firstDueOn)
    .sort(compareISO)[0];
  if (!firstDue || compareISO(firstDue, state.clock) > 0) return [];
  return monthsBetween(firstDue, state.clock).map((from) => {
    const to = minISO(endOfMonth(from), state.clock);
    const dues = collectionDues(state, societyId, { from, to });
    const due = sum(dues.map((d) => d.instalment));
    const collected = sum(dues.map((d) => d.paid));
    return {
      month: from.slice(0, 7),
      from,
      to,
      instalments: dues.length,
      paidInFull: dues.filter((d) => d.paid === d.instalment).length,
      due,
      collected,
      rate: due > 0 ? collected / due : undefined,
      received: traced(state, societyId, { plus: [ACCOUNTS.CASH], source: 'PAYMENT', from, to }),
    };
  });
}

// ---------------------------------------------------------------------------
// Margin: theoretical against realised
// ---------------------------------------------------------------------------

export type MarginReasonKind =
  | 'MEMBERS_BEHIND'
  | 'MEMBERS_AHEAD'
  | 'PREPAYMENT_IN_TRANSIT'
  | 'WHOLESALE_ABOVE_SCHEDULE'
  | 'WHOLESALE_NOT_YET_PAID'
  | 'ROUNDING';

export interface MarginReason {
  readonly kind: MarginReasonKind;
  /** Always positive; the kind says which way it moves the margin. */
  readonly amount: Paise;
}

export interface MarginPeriod {
  readonly label: string;
  readonly from: ISODate;
  readonly to: ISODate;
  /** Retail interest on the instalments that fell due. */
  readonly scheduledRetail: Paise;
  /** Wholesale interest on the same balances, at each tranche's rate. */
  readonly scheduledWholesale: Paise;
  /** Interest income in the books. */
  readonly receivedRetail: TracedFigure;
  /** Interest expense in the books. */
  readonly paidWholesale: TracedFigure;
  readonly theoretical: Paise;
  readonly realised: TracedFigure;
  /** Realised less theoretical. */
  readonly difference: Paise;
  readonly penalAndFees: TracedFigure;
  readonly reasons: readonly MarginReason[];
}

/**
 * The margin the schedules promised against the margin the books show, and
 * why they differ. Late members move retail interest out of the period and it
 * comes back when they pay; wholesale interest above schedule, from principal
 * held back or money drawn and not lent, is gone for good.
 */
export function marginFor(state: WorldState, societyId: ID, range: { from: ISODate; to: ISODate }, label: string): MarginPeriod {
  const to = minISO(range.to, state.clock);
  let scheduledRetail = 0;
  let scheduledWholesale = 0;
  let rows = 0;
  for (const entry of Object.values(state.loans)) {
    if (entry.loan.societyId !== societyId) continue;
    const rate = state.tranches[entry.loan.trancheId]!.tranche.wholesaleRateBps;
    for (const row of entry.schedule) {
      if (!inRange(row.dueOn, { from: range.from, to })) continue;
      rows += 1;
      scheduledRetail += row.interest;
      scheduledWholesale += rowInterestAt(row, rate);
    }
  }
  const window = { from: range.from, to };
  const receivedRetail = traced(state, societyId, { plus: [ACCOUNTS.INTEREST_INCOME], ...window });
  const paidWholesale = traced(state, societyId, { plus: [ACCOUNTS.INTEREST_EXPENSE], ...window });
  const realised = traced(state, societyId, {
    plus: [ACCOUNTS.INTEREST_INCOME],
    minus: [ACCOUNTS.INTEREST_EXPENSE],
    ...window,
  });
  const theoretical = scheduledRetail - scheduledWholesale;

  // A member who prepays between remittance dates stops paying interest on it
  // at once, but the federation charges until the next remittance passes it
  // on: a month's wholesale interest on the prepaid principal, paid with that
  // remittance.
  let inTransit = 0;
  for (const entry of Object.values(state.loans)) {
    if (entry.loan.societyId !== societyId) continue;
    const tranche = state.tranches[entry.loan.trancheId]!;
    for (const receipt of entry.receipts) {
      const prepaid = receipt.allocation.prepaidPrincipal;
      if (prepaid === 0 || entry.originalSchedule.some((r) => r.dueOn === receipt.receivedOn)) continue;
      const next = entry.originalSchedule.find((r) => compareISO(r.dueOn, receipt.receivedOn) > 0)?.dueOn;
      const remitted = tranche.remittances.find((r) => r.dueOn === next);
      if (!remitted || !inRange(remitted.paidOn, { from: range.from, to })) continue;
      inTransit += mulRate(prepaid, tranche.tranche.wholesaleRateBps, MONTHS_PER_YEAR);
      rows += 1;
    }
  }

  const reasons: MarginReason[] = [];
  const retailGap = receivedRetail.value - scheduledRetail;
  if (retailGap < 0) reasons.push({ kind: 'MEMBERS_BEHIND', amount: -retailGap });
  if (retailGap > 0) reasons.push({ kind: 'MEMBERS_AHEAD', amount: retailGap });
  if (inTransit > 0) reasons.push({ kind: 'PREPAYMENT_IN_TRANSIT', amount: inTransit });
  // Each row's share is rounded on its own and each tranche's interest once on
  // its whole balance: up to a paisa per row apart, by design.
  const wholesaleGap = paidWholesale.value - scheduledWholesale - inTransit;
  if (Math.abs(wholesaleGap) <= rows) {
    if (wholesaleGap !== 0) reasons.push({ kind: 'ROUNDING', amount: Math.abs(wholesaleGap) });
  } else if (wholesaleGap > 0) {
    reasons.push({ kind: 'WHOLESALE_ABOVE_SCHEDULE', amount: wholesaleGap });
  } else {
    reasons.push({ kind: 'WHOLESALE_NOT_YET_PAID', amount: -wholesaleGap });
  }

  return {
    label,
    from: range.from,
    to,
    scheduledRetail,
    scheduledWholesale,
    receivedRetail,
    paidWholesale,
    theoretical,
    realised,
    difference: realised.value - theoretical,
    penalAndFees: traced(state, societyId, { plus: [ACCOUNTS.PENAL_FEE_INCOME], ...window }),
    reasons,
  };
}

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (from: ISODate): string => `${MONTH_LABEL[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;

export interface MarginAnalysis {
  /** Oldest first. */
  readonly months: readonly MarginPeriod[];
  readonly sinceInception: MarginPeriod;
  readonly yearToDate: MarginPeriod;
}

export function marginAnalysis(state: WorldState, societyId: ID): MarginAnalysis {
  const inception = inceptionOf(state, societyId);
  return {
    months: monthsBetween(inception, state.clock).map((from) =>
      marginFor(state, societyId, { from, to: endOfMonth(from) }, monthLabel(from)),
    ),
    sinceInception: marginFor(state, societyId, { from: inception, to: state.clock }, 'Since inception'),
    yearToDate: marginFor(
      state,
      societyId,
      { from: financialYearStart(state.clock), to: state.clock },
      'This financial year',
    ),
  };
}

// ---------------------------------------------------------------------------
// Pool performance
// ---------------------------------------------------------------------------

export interface PoolPerformance {
  readonly pool: Pool;
  readonly tranche: Tranche;
  readonly loans: number;
  readonly activeLoans: number;
  readonly disbursed: Paise;
  readonly outstanding: Paise;
  /** Principal repaid as a share of principal lent. */
  readonly repaidShare: number;
  readonly lateLoans: number;
  /** Principal on loans past grace, as a share of what is outstanding. */
  readonly atRiskShare: number;
  readonly interestReceived: Paise;
  readonly wholesalePaid: Paise;
  readonly margin: Paise;
  readonly remittancesMade: number;
  readonly remittancesOnTime: number;
}

export function poolPerformance(state: WorldState, societyId: ID): PoolPerformance[] {
  return Object.values(state.tranches)
    .filter((t) => t.tranche.societyId === societyId && t.fundedLoanIds.length > 0)
    .map((t) => {
      const loans = t.fundedLoanIds.map((id) => state.loans[id]!);
      const active = loans.filter((l) => l.loan.status === 'ACTIVE');
      const positions = active.map((l) => positionOf(state, l.loan.id));
      const disbursed = sum(loans.map((l) => l.loan.principal));
      const outstanding = sum(positions.map((p) => p.principalOutstanding));
      const late = positions.filter((p) => p.daysPastDue > state.policy.graceDays);
      const interestReceived = sum(loans.flatMap((l) => l.receipts.map((r) => interestPortion(r.allocation))));
      const wholesalePaid = sum(t.remittances.map((r) => r.interestPaid));
      return {
        pool: state.pools.find((p) => p.id === t.tranche.poolId)!,
        tranche: t.tranche,
        loans: loans.length,
        activeLoans: active.length,
        disbursed,
        outstanding,
        repaidShare: disbursed > 0 ? (disbursed - outstanding) / disbursed : 0,
        lateLoans: late.length,
        atRiskShare: outstanding > 0 ? sum(late.map((p) => p.principalOutstanding)) / outstanding : 0,
        interestReceived,
        wholesalePaid,
        margin: interestReceived - wholesalePaid,
        remittancesMade: t.remittances.length,
        remittancesOnTime: t.remittances.filter(
          (r) => r.paidOn === r.dueOn && r.interestPaid === r.interestDue && r.principalPaid === r.principalDue,
        ).length,
      };
    })
    .sort((a, b) => compareISO(b.tranche.sanctionedOn, a.tranche.sanctionedOn));
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export interface SocietyDashboard {
  readonly summary: SocietySummary;
  readonly books: {
    readonly loansOutstanding: TracedFigure;
    readonly federationPayable: TracedFigure;
    readonly cash: TracedFigure;
    readonly advancesHeld: TracedFigure;
  };
  readonly earnings: {
    readonly month: TracedFigure;
    readonly year: TracedFigure;
    readonly penalAndFeesYear: TracedFigure;
  };
  /** This month if anything has fallen due in it yet, else last month. */
  readonly collections: CollectionMonth | undefined;
  readonly ageing: AgeingReport;
  readonly margin: MarginPeriod;
}

export function societyDashboard(state: WorldState, societyId: ID): SocietyDashboard {
  const clock = state.clock;
  const nii = (from: ISODate): TracedFigure =>
    traced(state, societyId, {
      plus: [ACCOUNTS.INTEREST_INCOME],
      minus: [ACCOUNTS.INTEREST_EXPENSE],
      from,
      to: clock,
    });
  const months = collectionEfficiency(state, societyId);
  const latest = months.at(-1);
  return {
    summary: societySummary(state, societyId),
    books: {
      loansOutstanding: traced(state, societyId, { plus: [ACCOUNTS.LOANS_RECEIVABLE] }),
      federationPayable: traced(state, societyId, { plus: [ACCOUNTS.FEDERATION_PAYABLE] }),
      cash: traced(state, societyId, { plus: [ACCOUNTS.CASH] }),
      advancesHeld: traced(state, societyId, { plus: [ACCOUNTS.UNAPPLIED_RECEIPTS] }),
    },
    earnings: {
      month: nii(startOfMonth(clock)),
      year: nii(financialYearStart(clock)),
      penalAndFeesYear: traced(state, societyId, {
        plus: [ACCOUNTS.PENAL_FEE_INCOME],
        from: financialYearStart(clock),
        to: clock,
      }),
    },
    collections: latest && latest.instalments === 0 ? (months.at(-2) ?? latest) : latest,
    ageing: ageingReport(state, societyId),
    margin: marginFor(state, societyId, { from: financialYearStart(clock), to: clock }, 'This financial year'),
  };
}

export interface ApexSocietyRow extends ExposureRow {
  readonly track: SocietyTrackRecord;
  /** Wholesale interest the society has paid this financial year. */
  readonly interestYear: Paise;
}

export interface ApexOverview {
  readonly asOf: ISODate;
  readonly yearFrom: ISODate;
  readonly totals: {
    readonly creditLimit: Paise;
    readonly sanctioned: Paise;
    readonly drawn: Paise;
    readonly undrawn: Paise;
    readonly outstanding: Paise;
    readonly interestYear: Paise;
    readonly awaitingReview: DueBucket;
    /** Member loans past grace across every society, as a share of what members owe. */
    readonly atRisk: { readonly amount: Paise; readonly share: number; readonly loans: number };
  };
  readonly societies: readonly ApexSocietyRow[];
}

export function apexOverview(state: WorldState): ApexOverview {
  const yearFrom = financialYearStart(state.clock);
  const societies = apexExposure(state).map((row) => {
    const remittances = Object.values(state.tranches)
      .filter((t) => t.tranche.societyId === row.society.id)
      .flatMap((t) => t.remittances);
    return {
      ...row,
      track: societyTrackRecord(state, row.society.id),
      interestYear: sum(remittances.filter((r) => compareISO(r.paidOn, yearFrom) >= 0).map((r) => r.interestPaid)),
    };
  });
  const memberOwed = sum(
    Object.values(state.loans)
      .filter((l) => l.loan.status === 'ACTIVE')
      .map((l) => positionOf(state, l.loan.id).principalOutstanding),
  );
  const atRiskAmount = sum(societies.map((s) => s.track.atRisk.amount));
  return {
    asOf: state.clock,
    yearFrom,
    totals: {
      creditLimit: sum(societies.map((s) => s.creditLimit)),
      sanctioned: sum(societies.map((s) => s.sanctioned)),
      drawn: sum(societies.map((s) => s.drawn)),
      undrawn: sum(societies.map((s) => s.sanctioned - s.drawn)),
      outstanding: sum(societies.map((s) => s.outstanding)),
      interestYear: sum(societies.map((s) => s.interestYear)),
      awaitingReview: {
        count: sum(societies.map((s) => s.awaitingReview.count)),
        amount: sum(societies.map((s) => s.awaitingReview.amount)),
      },
      atRisk: {
        amount: atRiskAmount,
        share: memberOwed > 0 ? atRiskAmount / memberOwed : 0,
        loans: sum(societies.map((s) => s.track.atRisk.loans)),
      },
    },
    societies,
  };
}
