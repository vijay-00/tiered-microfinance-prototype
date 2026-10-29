import { describe, expect, it } from 'vitest';
import { checkInvariants, type World } from '../invariants';
import { ACCOUNTS } from '../ledger';
import { mulRate, sum } from '../money';
import type { RemittanceDue } from '../reconciliation';
import { balanceOf, balanceSheet, incomeStatement, trialBalance } from '../statements';
import { POOL_OF_TWELVE, POOL_TOTAL, dueDates, setUpPool, type Simulation } from './helpers/simulation';

/**
 * The Phase 1 gate, from the TDD: the reference fixture passes row by row
 * (interest.test.ts), and all twelve invariants hold against a generated
 * twelve-loan pool. Here the pool is run through its whole life four ways,
 * with every invariant asserted after every single action.
 */

const RESERVES = 20_000_000;

/** What the model says the society earns if everyone pays on schedule. */
function theoreticalMargin(sim: Simulation): number {
  let total = 0;
  for (const { schedule } of sim.loans.values()) {
    for (const row of schedule) {
      total += row.interest - mulRate(row.opening, sim.policy.wholesaleRateBps, 12);
    }
  }
  return total;
}

function runToEnd(
  sim: Simulation,
  perDate: (date: string, sim: Simulation) => RemittanceDue | void = (_, s) => {
    s.collectAllDue();
    return s.remit('trn_01');
  },
): RemittanceDue[] {
  const dues: RemittanceDue[] = [];
  for (const date of dueDates(sim)) {
    sim.advanceTo(date);
    const due = perDate(date, sim);
    if (due) dues.push(due);
  }
  return dues;
}

function cash(sim: Simulation): number {
  return balanceOf(sim.journal, ACCOUNTS.CASH);
}

describe('scenario A: a clean run, every member and every remittance on time', () => {
  const sim = setUpPool();
  const dues = runToEnd(sim);
  const statement = incomeStatement(sim.journal);

  it('checked all twelve invariants after every one of several hundred actions', () => {
    expect(sim.invariantChecks).toBe(sim.actions);
    expect(sim.actions).toBeGreaterThan(200);
  });

  it('closes every loan and the tranche, with nothing left on either side', () => {
    expect([...sim.loans.values()].every((entry) => entry.loan.status === 'CLOSED')).toBe(true);
    expect(balanceOf(sim.journal, ACCOUNTS.LOANS_RECEIVABLE)).toBe(0);
    expect(balanceOf(sim.journal, ACCOUNTS.FEDERATION_PAYABLE)).toBe(0);
    expect(balanceOf(sim.journal, ACCOUNTS.UNAPPLIED_RECEIPTS)).toBe(0);
    expect(dues.reduce((total, due) => total + due.principalDue, 0)).toBe(POOL_TOTAL);
  });

  it('balances: trial balance and balance sheet', () => {
    expect(trialBalance(sim.journal).balanced).toBe(true);
    expect(balanceSheet(sim.journal).balanced).toBe(true);
  });

  it('keeps tranche and member wholesale interest within rounding every period', () => {
    for (const due of dues) {
      const loansInWindow = [...sim.loans.values()].filter((entry) =>
        entry.schedule.some((row) => row.dueOn === due.dueOn),
      ).length;
      expect(Math.abs(due.wholesaleVariance)).toBeLessThanOrEqual(Math.ceil(loansInWindow / 2));
    }
  });

  it('earns the theoretical margin, give or take that rounding', () => {
    const rounding = dues.reduce((total, due) => total + due.wholesaleVariance, 0);
    expect(statement.netInterestIncome).toBe(theoreticalMargin(sim) - rounding);
    expect(Math.abs(rounding)).toBeLessThan(100); // under a rupee across the whole pool
  });

  it('ends with the society holding its reserves plus exactly what it earned', () => {
    expect(cash(sim)).toBe(RESERVES + statement.surplus);
    expect(statement.penalFeeIncome).toBe(0);
  });

  it('folds the result into reserves on period close, and still balances', () => {
    sim.closePeriod();
    const sheet = balanceSheet(sim.journal);
    expect(sheet.currentSurplus).toBe(0);
    expect(sheet.reserves).toBe(RESERVES + statement.surplus);
    expect(incomeStatement(sim.journal).netInterestIncome).toBe(statement.netInterestIncome);
  });
});

describe('scenario B: members fall behind, the society remits in full regardless', () => {
  // Three members miss July and August; one misses July to October.
  // Everyone catches up in full, penal included, the month after.
  const shortMissers = ['loan_03', 'loan_05', 'loan_08'];
  const longMisser = 'loan_10';
  const missing = (date: string): string[] => {
    const skip: string[] = [];
    if (date === '2026-07-15' || date === '2026-08-15') skip.push(...shortMissers, longMisser);
    if (date === '2026-09-15' || date === '2026-10-15') skip.push(longMisser);
    return skip;
  };

  const clean = setUpPool({ checkEveryStep: false });
  const late = setUpPool();
  let cleanAtWorst = { cash: 0, nii: 0 };
  let lateAtWorst = { cash: 0, nii: 0 };

  runToEnd(clean, (date, s) => {
    s.collectAllDue();
    const due = s.remit('trn_01');
    if (date === '2026-08-15') {
      cleanAtWorst = { cash: cash(s), nii: incomeStatement(s.journal).netInterestIncome };
    }
    return due;
  });
  runToEnd(late, (date, s) => {
    s.collectAllDue(missing(date));
    const due = s.remit('trn_01');
    if (date === '2026-08-15') {
      lateAtWorst = { cash: cash(s), nii: incomeStatement(s.journal).netInterestIncome };
    }
    return due;
  });

  it('holds every invariant throughout', () => {
    expect(late.invariantChecks).toBe(late.actions);
  });

  it('squeezes cash and realised margin while the arrears are outstanding', () => {
    expect(lateAtWorst.cash).toBeLessThan(cleanAtWorst.cash);
    expect(lateAtWorst.nii).toBeLessThan(cleanAtWorst.nii);
  });

  it('charges penal interest to the members who were late, and to nobody else', () => {
    const penalBy = (loanId: string) =>
      late.loans.get(loanId)!.receipts.reduce((t, r) => t + r.allocation.penalInterest, 0);
    for (const loanId of [...shortMissers, longMisser]) expect(penalBy(loanId)).toBeGreaterThan(0);
    expect(penalBy('loan_01')).toBe(0);
    expect(penalBy(longMisser)).toBeGreaterThan(penalBy('loan_03'));
  });

  it('recovers the full margin once everyone catches up, with penal income on top', () => {
    const lateStatement = incomeStatement(late.journal);
    const cleanStatement = incomeStatement(clean.journal);
    expect(lateStatement.netInterestIncome).toBe(cleanStatement.netInterestIncome);
    expect(lateStatement.surplus).toBe(cleanStatement.surplus + lateStatement.penalFeeIncome);
    expect([...late.loans.values()].every((entry) => entry.loan.status === 'CLOSED')).toBe(true);
  });
});

describe('scenario B variant: the society short-pays the federation for one month', () => {
  // In July the society pays the federation its interest but withholds the
  // principal, then pays everything owed in August.
  const clean = setUpPool({ checkEveryStep: false });
  const cleanDues = runToEnd(clean);
  const short = setUpPool();
  const shortDues = runToEnd(short, (date, s) => {
    s.collectAllDue();
    if (date === '2026-07-15') {
      const owed = cleanDues[2]!;
      return s.remit('trn_01', { interestPaid: owed.interestDue, principalPaid: 0 });
    }
    return s.remit('trn_01');
  });

  it('holds every invariant, including the tranche tracking its members with arrears', () => {
    expect(short.invariantChecks).toBe(short.actions);
  });

  it('carries the withheld principal into the next month, and only that', () => {
    const july = shortDues[2]!;
    const august = shortDues[3]!;
    expect(august.principalArrears).toBe(july.principalDue);
    expect(august.interestArrears).toBe(0);
  });

  it('does not let a missed remittance post an empty journal entry', () => {
    const sim = setUpPool({ checkEveryStep: false });
    sim.advanceTo('2026-05-15');
    const entriesBefore = sim.journal.length;
    sim.remit('trn_01', { interestPaid: 0, principalPaid: 0 });
    expect(sim.journal.length).toBe(entriesBefore);
    sim.advanceTo('2026-06-15');
    const june = sim.remit('trn_01');
    expect(june.interestArrears).toBeGreaterThan(0);
    expect(june.principalArrears).toBeGreaterThan(0);
  });

  it('charges wholesale interest on the higher balance: the squeeze, in rupees', () => {
    const extra = shortDues[3]!.wholesaleInterest - cleanDues[3]!.wholesaleInterest;
    // round(a + b) - round(a) can differ from round(b) by a paise, so the
    // extra charge is within one paise of a month's interest on the withheld sum.
    const direct = mulRate(shortDues[2]!.principalDue, short.policy.wholesaleRateBps, 12);
    expect(Math.abs(extra - direct)).toBeLessThanOrEqual(1);
    expect(incomeStatement(short.journal).netInterestIncome).toBe(
      incomeStatement(clean.journal).netInterestIncome - extra,
    );
  });

  it('still closes the tranche out', () => {
    expect(balanceOf(short.journal, ACCOUNTS.FEDERATION_PAYABLE)).toBe(0);
  });
});

describe('scenario C: a member forecloses in month four', () => {
  const clean = setUpPool({ checkEveryStep: false });
  runToEnd(clean);
  const sim = setUpPool();
  const FEE = 50_000;
  const dues = runToEnd(sim, (date, s) => {
    if (date === '2026-08-15') {
      s.chargeFee('loan_07', FEE);
      s.receive('loan_07', s.position('loan_07').payoffAmount, { prepay: true });
    }
    s.collectAllDue();
    return s.remit('trn_01');
  });
  const foreclosed = sim.loans.get('loan_07')!;
  const original = clean.loans.get('loan_07')!.schedule;
  const monthsNotBorrowed = original.filter((row) => row.dueOn > '2026-08-15');

  it('holds every invariant throughout', () => {
    expect(sim.invariantChecks).toBe(sim.actions);
  });

  it('closes the loan as FORECLOSED with the fee retained', () => {
    expect(foreclosed.loan.status).toBe('FORECLOSED');
    expect(foreclosed.schedule).toHaveLength(4);
    expect(incomeStatement(sim.journal).penalFeeIncome).toBe(FEE);
  });

  it('passes the Rs 79,237.23 straight to the federation the same day', () => {
    const august = dues.find((due) => due.dueOn === '2026-08-15')!;
    expect(august.prepaidPassThrough).toBe(7_923_723);
    expect(sum(monthsNotBorrowed.map((row) => row.principal))).toBe(7_923_723);
  });

  it('gives up only the margin on the months not borrowed, about Rs 1,011', () => {
    const forgoneMargin = sum(
      monthsNotBorrowed.map((row) => row.interest - mulRate(row.opening, sim.policy.wholesaleRateBps, 12)),
    );
    const shortfall =
      incomeStatement(clean.journal).netInterestIncome - incomeStatement(sim.journal).netInterestIncome;
    expect(Math.abs(shortfall - forgoneMargin)).toBeLessThan(100);
    expect(forgoneMargin).toBe(101_096);
  });

  it('keeps tranche wholesale interest within rounding of the members every period', () => {
    for (const due of dues) expect(Math.abs(due.wholesaleVariance)).toBeLessThanOrEqual(6);
    expect(balanceOf(sim.journal, ACCOUNTS.FEDERATION_PAYABLE)).toBe(0);
  });
});

describe('scenario D: a member prepays Rs 40,000 in month six', () => {
  const clean = setUpPool({ checkEveryStep: false });
  runToEnd(clean);
  const sim = setUpPool();
  const PREPAID = 4_000_000;
  const dues = runToEnd(sim, (date, s) => {
    s.collectAllDue();
    if (date === '2026-10-15') s.receive('loan_09', PREPAID, { prepay: true });
    return s.remit('trn_01');
  });
  const member = sim.loans.get('loan_09')!;
  const original = clean.loans.get('loan_09')!;

  it('holds every invariant throughout', () => {
    expect(sim.invariantChecks).toBe(sim.actions);
  });

  it('keeps the instalment and closes the loan early', () => {
    const tail = member.schedule.filter((row) => row.dueOn > '2026-10-15');
    for (const row of tail.slice(0, -1)) expect(row.instalment).toBe(original.loan.emi);
    expect(member.schedule.length).toBeLessThan(original.schedule.length);
    expect(member.loan.status).toBe('CLOSED');
  });

  it('saves the member interest, and costs the society some margin', () => {
    const paid = (entry: typeof member) =>
      entry.receipts.reduce((t, r) => t + r.allocation.overdueInterest + r.allocation.currentInterest, 0);
    expect(paid(member)).toBeLessThan(paid(original));
    expect(incomeStatement(sim.journal).netInterestIncome).toBeLessThan(
      incomeStatement(clean.journal).netInterestIncome,
    );
  });

  it('passes the prepayment through on the day', () => {
    expect(dues.find((due) => due.dueOn === '2026-10-15')!.prepaidPassThrough).toBe(PREPAID);
    expect(balanceOf(sim.journal, ACCOUNTS.FEDERATION_PAYABLE)).toBe(0);
  });

  it('catches a prepayment recorded without its rescheduled schedule', () => {
    const world = sim.world();
    const stale = world.loans.map((entry) =>
      entry.loan.id === 'loan_09' ? { ...entry, schedule: original.schedule } : entry,
    );
    const failed = checkInvariants({ ...world, loans: stale }).filter((r) => !r.ok).map((r) => r.id);
    expect(failed).toContain(6);
  });
});

describe('determinism', () => {
  const run = () => {
    const sim = setUpPool({ checkEveryStep: false });
    runToEnd(sim);
    return sim;
  };

  it('reaches byte-identical state from the same seed and actions', () => {
    expect(JSON.stringify(run().journal)).toBe(JSON.stringify(run().journal));
  });

  it('matches the committed trial balance snapshot', () => {
    const sim = run();
    const tb = trialBalance(sim.journal).rows.map((row) => ({
      code: row.account.code,
      dr: row.dr,
      cr: row.cr,
    }));
    expect({ tb, outstanding: [...sim.loans.values()].map((l) => l.loan.status) }).toMatchSnapshot();
  });
});

describe('the invariants are not vacuous: each catches the corruption it exists for', () => {
  const sim = setUpPool({ checkEveryStep: false });
  for (const date of dueDates(sim).slice(0, 3)) {
    sim.advanceTo(date);
    sim.collectAllDue();
    sim.remit('trn_01');
  }
  const healthy = sim.world();
  const failing = (world: World) =>
    checkInvariants(world)
      .filter((result) => !result.ok)
      .map((result) => result.id);

  it('starts healthy', () => {
    expect(failing(healthy)).toEqual([]);
  });

  it('an unbalanced entry slipped past makeEntry trips 1 and 2', () => {
    const bad = {
      id: 'je_bad',
      on: healthy.clock,
      narration: 'tampered',
      sourceType: 'PAYMENT' as const,
      sourceId: 'x',
      lines: [
        { accountCode: ACCOUNTS.CASH, dr: 100, cr: 0 },
        { accountCode: ACCOUNTS.INTEREST_INCOME, dr: 0, cr: 99 },
      ],
    };
    expect(failing({ ...healthy, journal: [...healthy.journal, bad] })).toEqual(
      expect.arrayContaining([1, 2]),
    );
  });

  it('a receipt dropped from the loan but left in the ledger trips 3 and 8', () => {
    const [first, ...rest] = healthy.loans;
    const tampered = { ...first!, receipts: first!.receipts.slice(0, -1) };
    expect(failing({ ...healthy, loans: [tampered, ...rest] })).toEqual(
      expect.arrayContaining([3, 8]),
    );
  });

  it('a remittance record altered without its journal trips 4 and 5', () => {
    const [tranche] = healthy.tranches;
    const remittances = tranche!.remittances.map((r, i) =>
      i === 0 ? { ...r, principalPaid: r.principalPaid - 100 } : r,
    );
    expect(failing({ ...healthy, tranches: [{ ...tranche!, remittances }] })).toEqual(
      expect.arrayContaining([4, 5]),
    );
  });

  it('a receipt whose buckets do not add up trips 7', () => {
    const [first, ...rest] = healthy.loans;
    const receipts = first!.receipts.map((r, i) =>
      i === 0 ? { ...r, allocation: { ...r.allocation, advance: r.allocation.advance + 1 } } : r,
    );
    expect(failing({ ...healthy, loans: [{ ...first!, receipts }, ...rest] })).toContain(7);
  });

  it('one application in two pools trips 9', () => {
    const pool = healthy.pools[0]!;
    const second = { id: 'pool_02', applicationIds: [pool.applicationIds[0]!], status: 'OPEN' as const };
    expect(failing({ ...healthy, pools: [...healthy.pools, second] })).toContain(9);
  });

  it('a pool submitted with nine members trips 10', () => {
    const small = {
      id: 'pool_03',
      applicationIds: Array.from({ length: 9 }, (_, i) => `app_x${i}`),
      status: 'SUBMITTED' as const,
    };
    expect(failing({ ...healthy, pools: [...healthy.pools, small] })).toContain(10);
  });

  it('a tranche drawn beyond its sanction trips 11', () => {
    const [entry] = healthy.tranches;
    const tranche = { ...entry!.tranche, sanctionedAmount: POOL_TOTAL - 1 };
    expect(failing({ ...healthy, tranches: [{ ...entry!, tranche }] })).toContain(11);
  });

  it('a schedule that does not close trips 6', () => {
    const [first, ...rest] = healthy.loans;
    const schedule = first!.schedule.map((row, i, all) =>
      i === all.length - 1 ? { ...row, closing: 1 } : row,
    );
    expect(failing({ ...healthy, loans: [{ ...first!, schedule }, ...rest] })).toContain(6);
  });

  it('covers every member of the pool used for the gate', () => {
    expect(healthy.loans).toHaveLength(POOL_OF_TWELVE.length);
  });
});
