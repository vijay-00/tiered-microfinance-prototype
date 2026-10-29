import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  CHART_OF_ACCOUNTS,
  LedgerError,
  credit,
  debit,
  disbursementEntry,
  drawdownEntry,
  makeEntry,
  openingReservesEntry,
  periodCloseEntry,
  receiptEntry,
  remittanceEntry,
  writeOffEntry,
  type EntryHeader,
} from '../ledger';
import {
  balanceOf,
  balanceSheet,
  incomeStatement,
  tAccount,
  trialBalance,
} from '../statements';
import type { Allocation, JournalEntry } from '../types';

let seq = 0;
const header = (on = '2026-05-15'): EntryHeader => ({
  id: `je_${++seq}`,
  on,
  narration: 'test',
  sourceType: 'PAYMENT',
  sourceId: 'src',
});

const allocation = (overrides: Partial<Allocation> = {}): Allocation => ({
  penalInterest: 0,
  fees: 0,
  overdueInterest: 0,
  overduePrincipal: 0,
  currentInterest: 0,
  currentPrincipal: 0,
  prepaidPrincipal: 0,
  advance: 0,
  ...overrides,
});

const linesOf = (entry: JournalEntry) =>
  Object.fromEntries(entry.lines.map((l) => [l.accountCode, l.dr > 0 ? l.dr : -l.cr]));

describe('the chart of accounts', () => {
  it('has eleven accounts with unique codes', () => {
    expect(CHART_OF_ACCOUNTS).toHaveLength(11);
    expect(new Set(CHART_OF_ACCOUNTS.map((a) => a.code)).size).toBe(11);
  });

  it('puts every account on the side its type implies', () => {
    for (const account of CHART_OF_ACCOUNTS) {
      const expected = account.type === 'ASSET' || account.type === 'EXPENSE' ? 'DR' : 'CR';
      expect(account.normal).toBe(expected);
    }
  });
});

describe('makeEntry', () => {
  it('refuses an entry that does not balance', () => {
    expect(() =>
      makeEntry(header(), [debit(ACCOUNTS.CASH, 100), credit(ACCOUNTS.INTEREST_INCOME, 99)]),
    ).toThrow(LedgerError);
  });

  it('refuses fewer than two non-zero lines', () => {
    expect(() =>
      makeEntry(header(), [debit(ACCOUNTS.CASH, 0), credit(ACCOUNTS.INTEREST_INCOME, 0)]),
    ).toThrow(/two non-zero/);
  });

  it('refuses a line that debits and credits at once, or carries a negative', () => {
    expect(() =>
      makeEntry(header(), [
        { accountCode: ACCOUNTS.CASH, dr: 100, cr: 100 },
        credit(ACCOUNTS.INTEREST_INCOME, 0),
      ]),
    ).toThrow(/debit and credit/);
    expect(() =>
      makeEntry(header(), [debit(ACCOUNTS.CASH, -100), credit(ACCOUNTS.INTEREST_INCOME, -100)]),
    ).toThrow(/negative/);
  });

  it('refuses an account that is not in the chart, including the dropped 1250', () => {
    expect(() =>
      makeEntry(header(), [
        { accountCode: 1250, dr: 100, cr: 0 },
        credit(ACCOUNTS.CASH, 100),
      ]),
    ).toThrow(/no account 1250/);
  });

  it('drops zero lines and freezes what it keeps', () => {
    const entry = makeEntry(header(), [
      debit(ACCOUNTS.CASH, 100),
      credit(ACCOUNTS.INTEREST_INCOME, 100),
      credit(ACCOUNTS.PENAL_FEE_INCOME, 0),
    ]);
    expect(entry.lines).toHaveLength(2);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.lines)).toBe(true);
  });
});

describe('templates', () => {
  it('drawdown: cash in, federation payable up', () => {
    expect(linesOf(drawdownEntry(header(), 500))).toEqual({
      [ACCOUNTS.CASH]: 500,
      [ACCOUNTS.FEDERATION_PAYABLE]: -500,
    });
  });

  it('disbursement: receivable up, cash out', () => {
    expect(linesOf(disbursementEntry(header(), 500))).toEqual({
      [ACCOUNTS.LOANS_RECEIVABLE]: 500,
      [ACCOUNTS.CASH]: -500,
    });
  });

  it('receipt: credits each bucket to its own account', () => {
    const entry = receiptEntry(header(), {
      amount: 1_000,
      source: 'CASH',
      accrualBasis: false,
      allocation: allocation({
        penalInterest: 10,
        fees: 40,
        overdueInterest: 100,
        overduePrincipal: 200,
        currentInterest: 150,
        currentPrincipal: 300,
        prepaidPrincipal: 150,
        advance: 50,
      }),
    });
    expect(linesOf(entry)).toEqual({
      [ACCOUNTS.CASH]: 1_000,
      [ACCOUNTS.LOANS_RECEIVABLE]: -650,
      [ACCOUNTS.INTEREST_INCOME]: -250,
      [ACCOUNTS.PENAL_FEE_INCOME]: -50,
      [ACCOUNTS.UNAPPLIED_RECEIPTS]: -50,
    });
  });

  it('receipt from a held advance debits unapplied receipts, not cash', () => {
    const entry = receiptEntry(header(), {
      amount: 400,
      source: 'ADVANCE',
      accrualBasis: false,
      allocation: allocation({ currentInterest: 100, currentPrincipal: 300 }),
    });
    expect(linesOf(entry)[ACCOUNTS.UNAPPLIED_RECEIPTS]).toBe(400);
    expect(linesOf(entry)[ACCOUNTS.CASH]).toBeUndefined();
  });

  it('receipt on an accrual basis clears interest receivable instead of booking income', () => {
    const entry = receiptEntry(header(), {
      amount: 400,
      source: 'CASH',
      accrualBasis: true,
      allocation: allocation({ currentInterest: 100, currentPrincipal: 300 }),
    });
    expect(linesOf(entry)[ACCOUNTS.INTEREST_RECEIVABLE]).toBe(-100);
    expect(linesOf(entry)[ACCOUNTS.INTEREST_INCOME]).toBeUndefined();
  });

  it('remittance: payable and interest expense down, cash out', () => {
    expect(
      linesOf(remittanceEntry(header(), { interestPaid: 79_167, principalPaid: 790_367, accrualBasis: false })),
    ).toEqual({
      [ACCOUNTS.FEDERATION_PAYABLE]: 790_367,
      [ACCOUNTS.INTEREST_EXPENSE]: 79_167,
      [ACCOUNTS.CASH]: -869_534,
    });
  });

  it('write-off: provision expense against the receivable', () => {
    expect(linesOf(writeOffEntry(header(), 300))).toEqual({
      [ACCOUNTS.PROVISION_WRITEOFF]: 300,
      [ACCOUNTS.LOANS_RECEIVABLE]: -300,
    });
  });

  it('period close: zeroes income and expense into reserves, profit or loss', () => {
    const profit = periodCloseEntry(header(), [
      { code: ACCOUNTS.INTEREST_INCOME, balance: 1_000 },
      { code: ACCOUNTS.INTEREST_EXPENSE, balance: 800 },
    ]);
    expect(linesOf(profit)[ACCOUNTS.SOCIETY_RESERVES]).toBe(-200);
    const loss = periodCloseEntry(header(), [
      { code: ACCOUNTS.INTEREST_INCOME, balance: 500 },
      { code: ACCOUNTS.PROVISION_WRITEOFF, balance: 800 },
    ]);
    expect(linesOf(loss)[ACCOUNTS.SOCIETY_RESERVES]).toBe(300);
  });

  it('period close refuses to touch balance-sheet accounts', () => {
    expect(() => periodCloseEntry(header(), [{ code: ACCOUNTS.CASH, balance: 100 }])).toThrow(
      /only income and expense/,
    );
  });
});

describe('statements', () => {
  // The reference loan's first month, end to end.
  const journal: JournalEntry[] = [
    openingReservesEntry(header('2026-04-01'), 2_000_000),
    drawdownEntry(header('2026-04-15'), 10_000_000),
    disbursementEntry(header('2026-04-15'), 10_000_000),
    receiptEntry(header('2026-05-15'), {
      amount: 886_200,
      source: 'CASH',
      accrualBasis: false,
      allocation: allocation({ currentInterest: 95_833, currentPrincipal: 790_367 }),
    }),
    remittanceEntry(header('2026-05-15'), {
      interestPaid: 79_167,
      principalPaid: 790_367,
      accrualBasis: false,
    }),
  ];

  it('balances the trial balance', () => {
    const tb = trialBalance(journal);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDr).toBe(tb.totalCr);
  });

  it('shows the Rs 166.66 margin as net interest income', () => {
    expect(incomeStatement(journal)).toMatchObject({
      interestIncome: 95_833,
      interestExpense: 79_167,
      netInterestIncome: 16_666,
      surplus: 16_666,
    });
  });

  it('balances the balance sheet, with the month surplus in equity', () => {
    const sheet = balanceSheet(journal);
    expect(sheet.balanced).toBe(true);
    expect(sheet.currentSurplus).toBe(16_666);
    expect(balanceOf(journal, ACCOUNTS.CASH)).toBe(2_000_000 + 16_666);
    expect(balanceOf(journal, ACCOUNTS.LOANS_RECEIVABLE)).toBe(9_209_633);
    expect(balanceOf(journal, ACCOUNTS.FEDERATION_PAYABLE)).toBe(9_209_633);
  });

  it('filters by date, inclusive at both ends', () => {
    expect(incomeStatement(journal, { to: '2026-05-14' }).netInterestIncome).toBe(0);
    expect(incomeStatement(journal, { from: '2026-05-15', to: '2026-05-15' }).netInterestIncome).toBe(16_666);
  });

  it('excludes closing entries from the income statement but not from reserves', () => {
    const closed = [
      ...journal,
      {
        ...periodCloseEntry(header('2026-05-31'), [
          { code: ACCOUNTS.INTEREST_INCOME, balance: 95_833 },
          { code: ACCOUNTS.INTEREST_EXPENSE, balance: 79_167 },
        ]),
        sourceType: 'CLOSE' as const,
      },
    ];
    expect(incomeStatement(closed).netInterestIncome).toBe(16_666);
    expect(balanceSheet(closed)).toMatchObject({ reserves: 2_016_666, currentSurplus: 0, balanced: true });
  });

  it('lists a T-account from the journal', () => {
    const t = tAccount(journal, ACCOUNTS.CASH);
    expect(t.debits.map((l) => l.amount)).toEqual([2_000_000, 10_000_000, 886_200]);
    expect(t.credits.map((l) => l.amount)).toEqual([10_000_000, 869_534]);
    expect(t.balance).toBe(2_016_666);
  });
});
