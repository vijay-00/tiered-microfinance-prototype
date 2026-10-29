import { compareISO } from './dates';
import { ACCOUNTS, CHART_OF_ACCOUNTS, accountFor, type Account, type AccountCode } from './ledger';
import { sum } from './money';
import type { ISODate, JournalEntry, Paise } from './types';

/**
 * Financial statements, folded from the journal on demand. Nothing here is
 * stored, so nothing here can drift from the entries that produced it.
 */

export interface DateRange {
  /** Inclusive. Omitted means from the beginning. */
  from?: ISODate;
  /** Inclusive. Omitted means to the end. */
  to?: ISODate;
}

export interface AccountBalance {
  readonly account: Account;
  readonly dr: Paise;
  readonly cr: Paise;
  /** Positive when the balance sits on the account's normal side. */
  readonly balance: Paise;
}

function inRange(entry: JournalEntry, range: DateRange): boolean {
  if (range.from !== undefined && compareISO(entry.on, range.from) < 0) return false;
  if (range.to !== undefined && compareISO(entry.on, range.to) > 0) return false;
  return true;
}

export function accountBalances(
  entries: readonly JournalEntry[],
  range: DateRange & { excludeClosing?: boolean } = {},
): Map<AccountCode, AccountBalance> {
  const totals = new Map<AccountCode, { dr: Paise; cr: Paise }>();
  for (const account of CHART_OF_ACCOUNTS) totals.set(account.code, { dr: 0, cr: 0 });

  for (const entry of entries) {
    if (!inRange(entry, range)) continue;
    if (range.excludeClosing && entry.sourceType === 'CLOSE') continue;
    for (const line of entry.lines) {
      const code = accountFor(line.accountCode).code;
      const total = totals.get(code)!;
      total.dr += line.dr;
      total.cr += line.cr;
    }
  }

  const balances = new Map<AccountCode, AccountBalance>();
  for (const account of CHART_OF_ACCOUNTS) {
    const { dr, cr } = totals.get(account.code)!;
    balances.set(account.code, {
      account,
      dr,
      cr,
      balance: account.normal === 'DR' ? dr - cr : cr - dr,
    });
  }
  return balances;
}

export function balanceOf(
  entries: readonly JournalEntry[],
  code: AccountCode,
  range: DateRange = {},
): Paise {
  return accountBalances(entries, range).get(code)!.balance;
}

export interface TrialBalance {
  readonly rows: readonly AccountBalance[];
  readonly totalDr: Paise;
  readonly totalCr: Paise;
  readonly balanced: boolean;
}

export function trialBalance(entries: readonly JournalEntry[], range: DateRange = {}): TrialBalance {
  const rows = [...accountBalances(entries, range).values()];
  const totalDr = sum(rows.map((row) => row.dr));
  const totalCr = sum(rows.map((row) => row.cr));
  return { rows, totalDr, totalCr, balanced: totalDr === totalCr };
}

export interface IncomeStatement {
  readonly interestIncome: Paise;
  readonly interestExpense: Paise;
  readonly netInterestIncome: Paise;
  readonly penalFeeIncome: Paise;
  readonly provisions: Paise;
  readonly surplus: Paise;
}

/**
 * Activity over a period. Closing entries are excluded: they move the period's
 * result into reserves, and counting them would net every period to zero.
 */
export function incomeStatement(
  entries: readonly JournalEntry[],
  range: DateRange = {},
): IncomeStatement {
  const balances = accountBalances(entries, { ...range, excludeClosing: true });
  const of = (code: AccountCode): Paise => balances.get(code)!.balance;
  const interestIncome = of(ACCOUNTS.INTEREST_INCOME);
  const interestExpense = of(ACCOUNTS.INTEREST_EXPENSE);
  const penalFeeIncome = of(ACCOUNTS.PENAL_FEE_INCOME);
  const provisions = of(ACCOUNTS.PROVISION_WRITEOFF);
  const netInterestIncome = interestIncome - interestExpense;
  return {
    interestIncome,
    interestExpense,
    netInterestIncome,
    penalFeeIncome,
    provisions,
    surplus: netInterestIncome + penalFeeIncome - provisions,
  };
}

export interface BalanceSheet {
  readonly assets: readonly AccountBalance[];
  readonly liabilities: readonly AccountBalance[];
  readonly reserves: Paise;
  /** Income less expense not yet closed into reserves. */
  readonly currentSurplus: Paise;
  readonly totalAssets: Paise;
  readonly totalLiabilities: Paise;
  readonly totalEquity: Paise;
  readonly balanced: boolean;
}

/**
 * Asserted separately from the trial balance, because a sign error in one
 * template can leave debits equal to credits while still putting an amount on
 * the wrong side of the balance sheet.
 */
export function balanceSheet(entries: readonly JournalEntry[], asOf?: ISODate): BalanceSheet {
  const range: DateRange = asOf === undefined ? {} : { to: asOf };
  const rows = [...accountBalances(entries, range).values()];
  const ofType = (type: Account['type']) => rows.filter((row) => row.account.type === type);

  const assets = ofType('ASSET');
  const liabilities = ofType('LIABILITY');
  const reserves = sum(ofType('EQUITY').map((row) => row.balance));
  const currentSurplus =
    sum(ofType('INCOME').map((row) => row.balance)) -
    sum(ofType('EXPENSE').map((row) => row.balance));

  const totalAssets = sum(assets.map((row) => row.balance));
  const totalLiabilities = sum(liabilities.map((row) => row.balance));
  const totalEquity = reserves + currentSurplus;
  return {
    assets,
    liabilities,
    reserves,
    currentSurplus,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

export interface TAccountLine {
  readonly entryId: string;
  readonly on: ISODate;
  readonly narration: string;
  readonly amount: Paise;
}

export interface TAccount {
  readonly account: Account;
  readonly debits: readonly TAccountLine[];
  readonly credits: readonly TAccountLine[];
  readonly balance: Paise;
}

export function tAccount(entries: readonly JournalEntry[], code: AccountCode): TAccount {
  const account = accountFor(code);
  const debits: TAccountLine[] = [];
  const credits: TAccountLine[] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode !== code) continue;
      const base = { entryId: entry.id, on: entry.on, narration: entry.narration };
      if (line.dr > 0) debits.push({ ...base, amount: line.dr });
      if (line.cr > 0) credits.push({ ...base, amount: line.cr });
    }
  }
  const dr = sum(debits.map((line) => line.amount));
  const cr = sum(credits.map((line) => line.amount));
  return { account, debits, credits, balance: account.normal === 'DR' ? dr - cr : cr - dr };
}
