import { describe, expect, it } from 'vitest';
import {
  amortiseAtInstalment,
  brokenPeriodDays,
  emi,
  exactEmi,
  generateSchedule,
  outstandingAfter,
  rowInterestAt,
  rowsDueBy,
  scheduleTotals,
} from '../interest';
import { firstCollectionDay } from '../origination';
import reference from './fixtures/reference-loan.json';

describe('emi', () => {
  it('matches the reference loan: Rs 1,00,000 at 11.5% over 12 months is Rs 8,862', () => {
    expect(emi(reference.input.principal, reference.input.annualBps, 12)).toBe(reference.emi);
  });

  it('rounds to a whole rupee', () => {
    expect(emi(10_000_000, 1150, 12) % 100).toBe(0);
    expect(emi(3_333_333, 1799, 7) % 100).toBe(0);
  });

  it('divides evenly at a zero rate', () => {
    expect(emi(1_200_000, 0, 12)).toBe(100_000);
  });

  it('rejects inputs that cannot produce a schedule', () => {
    expect(() => emi(0, 1150, 12)).toThrow(/principal/);
    expect(() => emi(1_000_000, 1150, 0)).toThrow(/tenureMonths/);
    expect(() => emi(1_000_000, 1150, 2.5)).toThrow(/tenureMonths/);
    expect(() => emi(1_000_000.5, 1150, 12)).toThrow(/paise/);
  });
});

describe('generateSchedule: the golden fixture', () => {
  const schedule = generateSchedule(reference.input);

  it('has one row per month of tenure', () => {
    expect(schedule).toHaveLength(12);
  });

  // Asserted row by row and column by column, so a failure names the exact cell.
  for (const expected of reference.rows) {
    it(`period ${expected.period} matches to the paise`, () => {
      const row = schedule[expected.period - 1];
      expect(row).toBeDefined();
      expect({
        period: row?.period,
        dueOn: row?.dueOn,
        opening: row?.opening,
        instalment: row?.instalment,
        interest: row?.interest,
        principal: row?.principal,
        closing: row?.closing,
      }).toEqual({
        period: expected.period,
        dueOn: expected.dueOn,
        opening: expected.opening,
        instalment: expected.instalment,
        interest: expected.interest,
        principal: expected.principal,
        closing: expected.closing,
      });
    });
  }

  it('totals Rs 1,06,337.75 collected, of which Rs 6,337.75 is interest', () => {
    expect(scheduleTotals(schedule)).toEqual({
      collected: reference.totals.collected,
      interest: reference.totals.interest,
      principal: reference.totals.principal,
    });
  });

  it('makes the final instalment the plug: Rs 6.25 lighter than the EMI', () => {
    const last = schedule[11];
    expect(last?.instalment).toBe(885_575);
    expect(reference.emi - (last?.instalment ?? 0)).toBe(625);
  });

  it('is frozen, so nothing downstream can rewrite a schedule in place', () => {
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Object.isFrozen(schedule[0])).toBe(true);
  });
});

describe('generateSchedule: small loans', () => {
  // Found by the property tests. Rs 1,000 over 53 months at 10.17% has an
  // exact EMI near Rs 23.50; rounded up to Rs 24 it retired the loan early and
  // left trailing instalments of Rs 0.
  const input = {
    loanId: 'loan_tiny',
    principal: 100_000,
    annualBps: 1017,
    tenureMonths: 53,
    firstDueOn: '2020-01-01',
  };

  it('would overpay if the EMI were rounded to a rupee', () => {
    expect(emi(input.principal, input.annualBps, input.tenureMonths)).toBeGreaterThan(
      exactEmi(input.principal, input.annualBps, input.tenureMonths),
    );
  });

  it('falls back to the paise-exact EMI, so no instalment is zero', () => {
    const schedule = generateSchedule(input);
    expect(schedule).toHaveLength(53);
    expect(schedule[0]!.instalment).toBe(exactEmi(input.principal, input.annualBps, 53));
    expect(schedule.every((row) => row.instalment > 0 && row.principal > 0)).toBe(true);
    expect(schedule.at(-1)!.closing).toBe(0);
  });
});

describe('generateSchedule: dates', () => {
  it('keeps a month-end due date on month-ends instead of drifting to the 28th', () => {
    const schedule = generateSchedule({
      loanId: 'loan_eom',
      principal: 1_200_000,
      annualBps: 1150,
      tenureMonths: 4,
      firstDueOn: '2027-01-31',
    });
    expect(schedule.map((row) => row.dueOn)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
  });

  it('handles a leap February', () => {
    const schedule = generateSchedule({
      loanId: 'loan_leap',
      principal: 1_200_000,
      annualBps: 1150,
      tenureMonths: 2,
      firstDueOn: '2028-01-30',
    });
    expect(schedule.map((row) => row.dueOn)).toEqual(['2028-01-30', '2028-02-29']);
  });
});

describe('generateSchedule: broken-period interest, the bank way', () => {
  // Rs 1,00,000 at 11.5% over 12 months, paid out on 30 October; EMI on the 1st.
  const base = { loanId: 'bpi', principal: 10_000_000, annualBps: 1150, tenureMonths: 12, firstDueOn: '2026-12-01' };
  const plain = generateSchedule(base);
  const broken = generateSchedule({ ...base, disbursedOn: '2026-10-30' });

  it('charges the two days before 1 November with the first instalment, actual/365', () => {
    expect(brokenPeriodDays('2026-10-30', '2026-12-01')).toBe(2);
    // 1,00,000 x 11.5% x 2 / 365 = Rs 63.01
    expect(broken[0]).toMatchObject({ brokenPeriodDays: 2, brokenPeriodInterest: 6_301 });
    expect(broken[0]!.interest).toBe(plain[0]!.interest + 6_301);
    expect(broken[0]!.instalment).toBe(plain[0]!.instalment + 6_301);
  });

  it('leaves the EMI, the principal and every later month exactly as they were', () => {
    expect(broken.map((r) => r.principal)).toEqual(plain.map((r) => r.principal));
    expect(broken.slice(1)).toEqual(plain.slice(1));
  });

  it('has no broken period when the loan is paid out on the 1st, or a month before its first due date', () => {
    expect(brokenPeriodDays('2026-11-01', '2026-12-01')).toBe(0);
    expect(generateSchedule({ ...base, disbursedOn: '2026-11-01' })).toEqual(plain);
    expect(brokenPeriodDays('2026-11-15', '2026-12-01')).toBe(0);
  });

  it('sets the first EMI on the 1st a month after the first full month begins', () => {
    expect(firstCollectionDay('2026-10-30')).toBe('2026-12-01');
    expect(firstCollectionDay('2026-10-10')).toBe('2026-12-01');
    expect(firstCollectionDay('2026-11-01')).toBe('2026-12-01');
    expect(firstCollectionDay('2026-12-31')).toBe('2027-02-01');
  });

  it('charges the federation the same days at its own rate', () => {
    // 1,00,000 x 9.5% / 12 = Rs 791.67, plus 1,00,000 x 9.5% x 2 / 365 = Rs 52.05
    expect(rowInterestAt(broken[0]!, 950)).toBe(79_167 + 5_205);
    expect(rowInterestAt(plain[0]!, 950)).toBe(79_167);
  });
});

describe('amortiseAtInstalment: rescheduling at the same EMI', () => {
  it('reproduces the original schedule when nothing was prepaid', () => {
    // Re-amortising period 5's scheduled balance at the same Rs 8,862 must
    // land on exactly the rows the generator produced, plug included.
    const schedule = generateSchedule(reference.input);
    const tail = amortiseAtInstalment({
      loanId: reference.input.loanId,
      principal: schedule[4]!.opening,
      annualBps: reference.input.annualBps,
      instalment: reference.emi,
      anchorDueOn: reference.input.firstDueOn,
      firstPeriod: 5,
    });
    expect(tail).toEqual(schedule.slice(4));
  });

  it('keeps month-end due dates anchored to the original day', () => {
    const tail = amortiseAtInstalment({
      loanId: 'loan_eom',
      principal: 1_000_000,
      annualBps: 1150,
      instalment: 300_000,
      anchorDueOn: '2027-01-31',
      firstPeriod: 2,
    });
    expect(tail.map((row) => row.dueOn)).toEqual(['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });

  it('never lengthens a loan, even when the EMI was rounded down', () => {
    // Found by the property tests. Rs 1,000.03 at 2.43% over 30 months has an
    // exact EMI near Rs 34.39, quoted as Rs 34, so the schedule ends on a plug
    // above Rs 34. One paisa prepaid in month one used to need a 31st month.
    const schedule = generateSchedule({
      loanId: 'loan_down',
      principal: 100_003,
      annualBps: 243,
      tenureMonths: 30,
      firstDueOn: '2030-02-22',
    });
    expect(schedule[0]!.instalment).toBe(3_400);
    expect(schedule.at(-1)!.instalment).toBeGreaterThan(3_400);

    const tail = amortiseAtInstalment({
      loanId: 'loan_down',
      principal: schedule[1]!.opening - 1,
      annualBps: 243,
      instalment: 3_400,
      anchorDueOn: '2030-02-22',
      firstPeriod: 2,
      maxPeriods: 29,
    });
    expect(tail).toHaveLength(29);
    expect(tail.at(-1)!.closing).toBe(0);
    expect(tail.at(-1)!.instalment).toBeLessThanOrEqual(schedule.at(-1)!.instalment);
  });

  it('refuses an instalment that does not cover the interest', () => {
    expect(() =>
      amortiseAtInstalment({
        loanId: 'x',
        principal: 10_000_000,
        annualBps: 1150,
        instalment: 50_000,
        anchorDueOn: '2026-05-15',
        firstPeriod: 1,
      }),
    ).toThrow(/does not cover interest/);
  });
});

describe('schedule helpers', () => {
  const schedule = generateSchedule(reference.input);

  it('reports the balance still owing after a period', () => {
    expect(outstandingAfter(schedule, 0)).toBe(10_000_000);
    expect(outstandingAfter(schedule, 1)).toBe(9_209_633);
    expect(outstandingAfter(schedule, 12)).toBe(0);
  });

  it('selects the rows that have fallen due by a date, inclusive', () => {
    expect(rowsDueBy(schedule, '2026-05-14')).toHaveLength(0);
    expect(rowsDueBy(schedule, '2026-05-15')).toHaveLength(1);
    expect(rowsDueBy(schedule, '2026-08-20')).toHaveLength(4);
  });
});
