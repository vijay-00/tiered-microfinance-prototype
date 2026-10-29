import { assertPaise, sum } from './money';
import { interestPortion, principalPortion, type ReceiptSource } from './reconciliation';
import type { Allocation, ID, ISODate, JournalEntry, JournalLine, JournalSourceType, Paise } from './types';

/**
 * Double-entry posting. Every money movement becomes one balanced journal
 * entry, and every balance in the app is folded from these entries rather than
 * stored. A posting that does not balance is refused, not corrected.
 */

export const ACCOUNTS = {
  CASH: 1000,
  LOANS_RECEIVABLE: 1100,
  INTEREST_RECEIVABLE: 1150,
  FEDERATION_PAYABLE: 2000,
  INTEREST_PAYABLE: 2050,
  UNAPPLIED_RECEIPTS: 2100,
  SOCIETY_RESERVES: 3000,
  INTEREST_INCOME: 4000,
  PENAL_FEE_INCOME: 4100,
  INTEREST_EXPENSE: 5000,
  PROVISION_WRITEOFF: 5200,
} as const;

export type AccountCode = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface Account {
  readonly code: AccountCode;
  readonly name: string;
  readonly type: AccountType;
  /** The side on which the account's balance normally sits. */
  readonly normal: 'DR' | 'CR';
}

/**
 * Eleven accounts. The TDD's draft also listed 1250 Principal Timing Gap; it
 * was dropped because paying a liability down faster creates no asset. The
 * timing gap under independent amortisation is a reported figure, not a
 * balance (see computeRemittance's principalTimingGap).
 */
export const CHART_OF_ACCOUNTS: readonly Account[] = Object.freeze([
  { code: ACCOUNTS.CASH, name: 'Cash and Bank', type: 'ASSET', normal: 'DR' },
  { code: ACCOUNTS.LOANS_RECEIVABLE, name: 'Member Loans Receivable', type: 'ASSET', normal: 'DR' },
  { code: ACCOUNTS.INTEREST_RECEIVABLE, name: 'Interest Receivable from Members', type: 'ASSET', normal: 'DR' },
  { code: ACCOUNTS.FEDERATION_PAYABLE, name: 'Federation Loan Payable', type: 'LIABILITY', normal: 'CR' },
  { code: ACCOUNTS.INTEREST_PAYABLE, name: 'Interest Payable to Federation', type: 'LIABILITY', normal: 'CR' },
  { code: ACCOUNTS.UNAPPLIED_RECEIPTS, name: 'Unapplied Member Receipts', type: 'LIABILITY', normal: 'CR' },
  { code: ACCOUNTS.SOCIETY_RESERVES, name: 'Society Reserves', type: 'EQUITY', normal: 'CR' },
  { code: ACCOUNTS.INTEREST_INCOME, name: 'Interest Income - Members', type: 'INCOME', normal: 'CR' },
  { code: ACCOUNTS.PENAL_FEE_INCOME, name: 'Penal Interest and Fee Income', type: 'INCOME', normal: 'CR' },
  { code: ACCOUNTS.INTEREST_EXPENSE, name: 'Interest Expense - Federation', type: 'EXPENSE', normal: 'DR' },
  { code: ACCOUNTS.PROVISION_WRITEOFF, name: 'Provision and Write-offs', type: 'EXPENSE', normal: 'DR' },
]);

const accountsByCode = new Map<number, Account>(
  CHART_OF_ACCOUNTS.map((account) => [account.code, account]),
);

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function accountFor(code: number): Account {
  const account = accountsByCode.get(code);
  if (!account) throw new LedgerError(`no account ${code} in the chart of accounts`);
  return account;
}

export interface EntryHeader {
  id: ID;
  on: ISODate;
  narration: string;
  sourceType: JournalSourceType;
  sourceId: ID;
}

export const debit = (accountCode: AccountCode, amount: Paise): JournalLine => ({
  accountCode,
  dr: amount,
  cr: 0,
});

export const credit = (accountCode: AccountCode, amount: Paise): JournalLine => ({
  accountCode,
  dr: 0,
  cr: amount,
});

/**
 * Validates and freezes an entry. Zero lines are dropped so templates can
 * list every possible line unconditionally; what survives must balance.
 */
export function makeEntry(header: EntryHeader, lines: readonly JournalLine[]): JournalEntry {
  const kept: JournalLine[] = [];
  for (const line of lines) {
    accountFor(line.accountCode);
    assertPaise(line.dr, `debit to ${line.accountCode}`);
    assertPaise(line.cr, `credit to ${line.accountCode}`);
    if (line.dr < 0 || line.cr < 0) {
      throw new LedgerError(`a journal line cannot carry a negative amount (${line.accountCode})`);
    }
    if (line.dr > 0 && line.cr > 0) {
      throw new LedgerError(`a journal line cannot debit and credit at once (${line.accountCode})`);
    }
    if (line.dr === 0 && line.cr === 0) continue;
    kept.push(Object.freeze({ ...line }));
  }
  if (kept.length < 2) {
    throw new LedgerError(`entry ${header.id} needs at least two non-zero lines`);
  }
  const debits = sum(kept.map((line) => line.dr));
  const credits = sum(kept.map((line) => line.cr));
  if (debits !== credits) {
    throw new LedgerError(
      `entry ${header.id} does not balance: debits ${debits}, credits ${credits}`,
    );
  }
  return Object.freeze({ ...header, lines: Object.freeze(kept) as JournalLine[] });
}

// ---------------------------------------------------------------------------
// Templates: one per domain event
// ---------------------------------------------------------------------------

/** The society's own funds at the start of the demo. */
export function openingReservesEntry(header: EntryHeader, amount: Paise): JournalEntry {
  return makeEntry(header, [
    debit(ACCOUNTS.CASH, amount),
    credit(ACCOUNTS.SOCIETY_RESERVES, amount),
  ]);
}

export function drawdownEntry(header: EntryHeader, amount: Paise): JournalEntry {
  return makeEntry(header, [
    debit(ACCOUNTS.CASH, amount),
    credit(ACCOUNTS.FEDERATION_PAYABLE, amount),
  ]);
}

export function disbursementEntry(header: EntryHeader, amount: Paise): JournalEntry {
  return makeEntry(header, [
    debit(ACCOUNTS.LOANS_RECEIVABLE, amount),
    credit(ACCOUNTS.CASH, amount),
  ]);
}

/**
 * The only template with a variable set of credit lines. They come straight
 * from the allocation the reconciliation engine returned, which keeps the
 * engine and the ledger in step by construction.
 */
export function receiptEntry(
  header: EntryHeader,
  receipt: { amount: Paise; source: ReceiptSource; allocation: Allocation; accrualBasis: boolean },
): JournalEntry {
  const { amount, source, allocation, accrualBasis } = receipt;
  return makeEntry(header, [
    debit(source === 'CASH' ? ACCOUNTS.CASH : ACCOUNTS.UNAPPLIED_RECEIPTS, amount),
    credit(ACCOUNTS.LOANS_RECEIVABLE, principalPortion(allocation)),
    credit(
      accrualBasis ? ACCOUNTS.INTEREST_RECEIVABLE : ACCOUNTS.INTEREST_INCOME,
      interestPortion(allocation),
    ),
    credit(ACCOUNTS.PENAL_FEE_INCOME, allocation.penalInterest + allocation.fees),
    credit(ACCOUNTS.UNAPPLIED_RECEIPTS, allocation.advance),
  ]);
}

export function remittanceEntry(
  header: EntryHeader,
  remittance: { interestPaid: Paise; principalPaid: Paise; accrualBasis: boolean },
): JournalEntry {
  const { interestPaid, principalPaid, accrualBasis } = remittance;
  return makeEntry(header, [
    debit(ACCOUNTS.FEDERATION_PAYABLE, principalPaid),
    debit(accrualBasis ? ACCOUNTS.INTEREST_PAYABLE : ACCOUNTS.INTEREST_EXPENSE, interestPaid),
    credit(ACCOUNTS.CASH, interestPaid + principalPaid),
  ]);
}

/** Period-end accrual of retail interest due but not yet received. */
export function interestAccrualEntry(header: EntryHeader, amount: Paise): JournalEntry {
  return makeEntry(header, [
    debit(ACCOUNTS.INTEREST_RECEIVABLE, amount),
    credit(ACCOUNTS.INTEREST_INCOME, amount),
  ]);
}

/** Period-end accrual of wholesale interest owed but not yet remitted. */
export function wholesaleAccrualEntry(header: EntryHeader, amount: Paise): JournalEntry {
  return makeEntry(header, [
    debit(ACCOUNTS.INTEREST_EXPENSE, amount),
    credit(ACCOUNTS.INTEREST_PAYABLE, amount),
  ]);
}

export function writeOffEntry(header: EntryHeader, amount: Paise): JournalEntry {
  return makeEntry(header, [
    debit(ACCOUNTS.PROVISION_WRITEOFF, amount),
    credit(ACCOUNTS.LOANS_RECEIVABLE, amount),
  ]);
}

/**
 * Folds income and expense into reserves. Takes the balances as arguments so
 * the ledger does not depend on the statements module that computes them.
 */
export function periodCloseEntry(
  header: EntryHeader,
  balances: ReadonlyArray<{ code: AccountCode; balance: Paise }>,
): JournalEntry {
  const lines: JournalLine[] = [];
  let surplus = 0;
  for (const { code, balance } of balances) {
    const account = accountFor(code);
    if (balance === 0) continue;
    if (account.type === 'INCOME') {
      lines.push(balance > 0 ? debit(code, balance) : credit(code, -balance));
      surplus += balance;
    } else if (account.type === 'EXPENSE') {
      lines.push(balance > 0 ? credit(code, balance) : debit(code, -balance));
      surplus -= balance;
    } else {
      throw new LedgerError(`only income and expense accounts close to reserves, not ${code}`);
    }
  }
  lines.push(
    surplus >= 0
      ? credit(ACCOUNTS.SOCIETY_RESERVES, surplus)
      : debit(ACCOUNTS.SOCIETY_RESERVES, -surplus),
  );
  return makeEntry(header, lines);
}
