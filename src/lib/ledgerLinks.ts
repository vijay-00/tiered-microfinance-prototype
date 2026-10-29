import { accountFor, CHART_OF_ACCOUNTS, type AccountCode } from '@/domain/ledger';
import type { LedgerQuery } from '@/domain/reporting';
import type { DateRange } from '@/domain/statements';
import { journalSourceTypes, type JournalSourceType } from '@/domain/types';

/**
 * Ledger queries as addresses, so any figure can link to the journal lines
 * behind it and the ledger page can be bookmarked, shared, or opened from a
 * report. Subtracted accounts carry a minus sign: accounts=4000,-5000.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isCode = (n: number): n is AccountCode => CHART_OF_ACCOUNTS.some((a) => a.code === n);

function withRange(params: URLSearchParams, range: DateRange) {
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
}

export function traceHref(query: LedgerQuery): string {
  const params = new URLSearchParams();
  const accounts = [...query.plus.map(String), ...(query.minus ?? []).map((c) => `-${c}`)];
  if (accounts.length) params.set('accounts', accounts.join(','));
  withRange(params, query);
  if (query.source) params.set('source', query.source);
  if (query.loanId) params.set('loan', query.loanId);
  const search = params.toString().replace(/%2C/g, ',');
  return `/ledger${search ? `?${search}` : ''}`;
}

export function tAccountHref(code: AccountCode, range: DateRange = {}): string {
  const params = new URLSearchParams({ view: 'accounts', account: String(code) });
  withRange(params, range);
  return `/ledger?${params}`;
}

export function trialBalanceHref(asOf?: string): string {
  return asOf ? `/ledger?view=trial&to=${asOf}` : '/ledger?view=trial';
}

export function readRange(params: URLSearchParams): DateRange {
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  return { from: from && ISO.test(from) ? from : undefined, to: to && ISO.test(to) ? to : undefined };
}

/** The query in an address, ignoring anything it does not recognise. */
export function readTrace(params: URLSearchParams): LedgerQuery {
  const plus: AccountCode[] = [];
  const minus: AccountCode[] = [];
  for (const part of (params.get('accounts') ?? '').split(',')) {
    const n = Number(part.trim());
    if (!part.trim() || !Number.isInteger(Math.abs(n)) || !isCode(Math.abs(n))) continue;
    (part.trim().startsWith('-') ? minus : plus).push(Math.abs(n) as AccountCode);
  }
  const source = params.get('source');
  return {
    plus,
    minus,
    ...readRange(params),
    source: source && (journalSourceTypes as readonly string[]).includes(source) ? (source as JournalSourceType) : undefined,
    loanId: params.get('loan') ?? undefined,
  };
}

export function readAccount(params: URLSearchParams, fallback: AccountCode): AccountCode {
  const n = Number(params.get('account'));
  return isCode(n) ? n : fallback;
}

/** "Interest Income - Members less Interest Expense - Federation" */
export function describeAccounts(query: LedgerQuery): string {
  const names = (codes: readonly AccountCode[] | undefined) => (codes ?? []).map((c) => accountFor(c).name);
  const plus = names(query.plus).join(' and ');
  const minus = names(query.minus).join(' and ');
  return minus ? `${plus} less ${minus}` : plus;
}
