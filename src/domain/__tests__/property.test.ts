import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDaysISO, addMonthsISO, daysBetween, daysInMonth, parseISODate } from '../dates';
import { emi, exactEmi, generateSchedule } from '../interest';
import { allocate, mulRate, sum } from '../money';
import {
  allocationTotal,
  loanPosition,
  reconcileReceipt,
  type ReceiptRecord,
} from '../reconciliation';
import { DEFAULT_POLICY } from '../types';

/**
 * Property tests over generated loans: principals from Rs 1,000 to Rs 5,00,000,
 * rates from 1% to 36% a year, tenures from 3 to 60 months. These find the
 * arithmetic corners example tests miss: a plug larger than the EMI, a receipt
 * that exactly clears penal interest and nothing more.
 */

const RUNS = { numRuns: 300 };

const principalArb = fc.integer({ min: 100_000, max: 50_000_000 });
const rateArb = fc.integer({ min: 100, max: 3_600 });
const tenureArb = fc.integer({ min: 3, max: 60 });
const dateArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2035 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([year, month, day]) => {
    const d = Math.min(day, daysInMonth(year, month));
    return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

const loanArb = fc.record({
  principal: principalArb,
  annualBps: rateArb,
  tenureMonths: tenureArb,
  firstDueOn: dateArb,
});

describe('every generated schedule', () => {
  it('closes at exactly zero, and every row retires some principal', () => {
    fc.assert(
      fc.property(loanArb, (input) => {
        const schedule = generateSchedule({ loanId: 'p', ...input });
        expect(schedule).toHaveLength(input.tenureMonths);
        expect(schedule.at(-1)!.closing).toBe(0);
        for (const row of schedule) {
          expect(row.interest).toBeGreaterThanOrEqual(0);
          // Strictly positive: a zero row would mean the loan retired early
          // and the member is shown an instalment of nothing.
          expect(row.principal).toBeGreaterThan(0);
          expect(row.instalment).toBeGreaterThan(0);
          expect(row.closing).toBeGreaterThanOrEqual(0);
        }
      }),
      RUNS,
    );
  });

  it('repays exactly the principal, and chains each closing into the next opening', () => {
    fc.assert(
      fc.property(loanArb, (input) => {
        const schedule = generateSchedule({ loanId: 'p', ...input });
        expect(sum(schedule.map((row) => row.principal))).toBe(input.principal);
        let opening = input.principal;
        for (const row of schedule) {
          expect(row.opening).toBe(opening);
          expect(row.instalment).toBe(row.interest + row.principal);
          expect(row.closing).toBe(row.opening - row.principal);
          opening = row.closing;
        }
      }),
      RUNS,
    );
  });

  it('charges one EMI on every row but the plug: rupee-rounded, or paise-exact for tiny loans', () => {
    fc.assert(
      fc.property(loanArb, (input) => {
        const schedule = generateSchedule({ loanId: 'p', ...input });
        const rounded = emi(input.principal, input.annualBps, input.tenureMonths);
        const exact = exactEmi(input.principal, input.annualBps, input.tenureMonths);
        const charged = new Set(schedule.slice(0, -1).map((row) => row.instalment));
        expect(charged.size).toBeLessThanOrEqual(1);
        const [instalment] = charged;
        if (instalment !== undefined) expect([rounded, exact]).toContain(instalment);
      }),
      RUNS,
    );
  });

  it('uses the rupee-rounded EMI for everything at or above the Rs 5,000 minimum ticket', () => {
    fc.assert(
      fc.property(
        loanArb.filter((input) => input.principal >= DEFAULT_POLICY.minTicket),
        (input) => {
          const schedule = generateSchedule({ loanId: 'p', ...input });
          expect(schedule[0]!.instalment % 100).toBe(0);
        },
      ),
      RUNS,
    );
  });
});

describe('every generated receipt', () => {
  // Pay the first k instalments on time, then take one receipt of a random
  // amount on a random later day, up to the most the loan can accept.
  const scenarioArb = loanArb.chain((input) =>
    fc.record({
      input: fc.constant(input),
      paidOnTime: fc.integer({ min: 0, max: input.tenureMonths - 1 }),
      daysAfter: fc.integer({ min: 0, max: 120 }),
      fraction: fc.double({ min: 0.0001, max: 1, noNaN: true }),
      prepay: fc.boolean(),
    }),
  );

  it('allocates exactly its amount, never more to a bucket than was owed', () => {
    fc.assert(
      fc.property(scenarioArb, ({ input, paidOnTime, daysAfter, fraction, prepay }) => {
        const schedule = generateSchedule({ loanId: 'p', ...input });
        const loan = {
          id: 'p',
          disbursedOn: addMonthsISO(input.firstDueOn, -1),
          firstDueOn: input.firstDueOn,
          status: 'ACTIVE' as const,
          rateBps: input.annualBps,
          emi: schedule[0]!.instalment,
        };
        const policy = { ...DEFAULT_POLICY, retailRateBps: input.annualBps };
        let history: ReceiptRecord[] = [];
        for (const row of schedule.slice(0, paidOnTime)) {
          const out = reconcileReceipt({
            loan,
            schedule,
            priorReceipts: history,
            feesCharged: 0,
            receipt: { amount: row.instalment, receivedOn: row.dueOn, source: 'CASH', electPrepayment: false },
            clock: row.dueOn,
            wholesaleRateBps: 950,
            policy,
          });
          history = [
            ...history,
            { receivedOn: row.dueOn, amount: row.instalment, source: 'CASH', allocation: out.reconciliation.allocation },
          ];
        }

        const on = addDaysISO(schedule[paidOnTime]!.dueOn, daysAfter);
        const before = loanPosition({
          schedule,
          receipts: history,
          feesCharged: 0,
          asOf: on,
          penalRateBps: policy.penalRateBps,
          graceDays: policy.graceDays,
        });
        const amount = Math.max(1, Math.floor(before.payoffAmount * fraction));

        const { reconciliation, rescheduled } = reconcileReceipt({
          loan,
          schedule,
          priorReceipts: history,
          feesCharged: 0,
          receipt: { amount, receivedOn: on, source: 'CASH', electPrepayment: prepay },
          clock: on,
          wholesaleRateBps: 950,
          policy,
        });
        const a = reconciliation.allocation;
        expect(allocationTotal(a)).toBe(amount);
        expect(a.penalInterest).toBeLessThanOrEqual(before.penalUnpaid);
        expect(a.overdueInterest).toBeLessThanOrEqual(before.overdueInterest);
        expect(a.overduePrincipal).toBeLessThanOrEqual(before.overduePrincipal);
        expect(a.currentInterest).toBeLessThanOrEqual(before.currentInterest);
        expect(a.currentPrincipal).toBeLessThanOrEqual(before.currentPrincipal);
        expect(a.prepaidPrincipal).toBeLessThanOrEqual(before.principalNotYetDue);
        // Penal comes first under the default order: a receipt smaller than
        // the penal owed goes entirely to penal.
        if (amount <= before.penalUnpaid) expect(a.penalInterest).toBe(amount);
        expect(reconciliation.federation.wholesaleInterestShare).toBeGreaterThanOrEqual(0);
        expect(reconciliation.balancesAfter.loanOutstanding).toBeGreaterThanOrEqual(0);

        // A prepayment reschedules: same EMI, never a longer tenure, and the
        // rows plus the prepayment still account for every rupee lent.
        if (!prepay) expect(a.prepaidPrincipal).toBe(0);
        if (a.prepaidPrincipal === 0) {
          expect(rescheduled).toBeUndefined();
          return;
        }
        expect(rescheduled).toBeDefined();
        const rows = rescheduled!;
        expect(sum(rows.map((row) => row.principal)) + a.prepaidPrincipal).toBe(input.principal);
        expect(rows.length).toBeLessThanOrEqual(schedule.length);
        const tail = rows.filter((row) => row.dueOn > on);
        // With a tail, it closes at zero. Without one the loan was foreclosed,
        // and the last kept row's scheduled closing is what the prepayment cleared.
        const finalBalance =
          tail.length > 0
            ? tail.at(-1)!.closing
            : (rows.at(-1)?.closing ?? input.principal) - a.prepaidPrincipal;
        expect(finalBalance).toBe(0);
        for (const row of tail.slice(0, -1)) expect(row.instalment).toBe(loan.emi);
        // The plug stays within the EMI, or within the original plug when the
        // EMI was rounded down and the original schedule ended above it.
        const originalPlug = schedule.at(-1)!.instalment;
        if (tail.length > 0) {
          expect(tail.at(-1)!.instalment).toBeLessThanOrEqual(Math.max(loan.emi, originalPlug));
        }
        expect(reconciliation.balancesAfter.loanOutstanding).toBe(sum(tail.map((row) => row.principal)));
      }),
      {
        numRuns: 1_000,
        // Counterexamples found earlier, kept so they are checked on every run.
        examples: [
          // One paisa prepaid on a loan whose EMI was rounded down.
          [
            {
              input: { principal: 100_003, annualBps: 243, tenureMonths: 30, firstDueOn: '2030-02-22' },
              paidOnTime: 0,
              daysAfter: 0,
              fraction: 0.033940083428138035,
              prepay: true,
            },
          ],
          // A full foreclosure on the very first due date.
          [
            {
              input: { principal: 45_252_969, annualBps: 108, tenureMonths: 5, firstDueOn: '2020-04-27' },
              paidOnTime: 0,
              daysAfter: 0,
              fraction: 1,
              prepay: true,
            },
          ],
        ],
      },
    );
  });

  it('attributes wholesale interest so a fully repaid loan totals the per-row figure exactly', () => {
    // Each instalment paid in two random parts on its due date: the rounded
    // shares must still telescope to the exact per-row wholesale interest.
    fc.assert(
      fc.property(
        loanArb.filter((input) => input.annualBps >= 950),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        (input, split) => {
          const schedule = generateSchedule({ loanId: 'p', ...input });
          const loan = {
            id: 'p',
            disbursedOn: addMonthsISO(input.firstDueOn, -1),
            firstDueOn: input.firstDueOn,
            status: 'ACTIVE' as const,
            rateBps: input.annualBps,
            emi: schedule[0]!.instalment,
          };
          let history: ReceiptRecord[] = [];
          let shares = 0;
          let margins = 0;
          for (const row of schedule) {
            const first = Math.max(1, Math.floor(row.instalment * split));
            for (const amount of [first, row.instalment - first]) {
              if (amount <= 0) continue;
              const out = reconcileReceipt({
                loan,
                schedule,
                priorReceipts: history,
                feesCharged: 0,
                receipt: { amount, receivedOn: row.dueOn, source: 'CASH', electPrepayment: false },
                clock: row.dueOn,
                wholesaleRateBps: 950,
                policy: DEFAULT_POLICY,
              });
              shares += out.reconciliation.federation.wholesaleInterestShare;
              margins += out.reconciliation.society.netInterestIncome;
              history = [
                ...history,
                { receivedOn: row.dueOn, amount, source: 'CASH', allocation: out.reconciliation.allocation },
              ];
            }
          }
          const perRow = sum(schedule.map((row) => mulRate(row.opening, 950, 12)));
          const interest = sum(schedule.map((row) => row.interest));
          expect(shares).toBe(perRow);
          expect(margins).toBe(interest - perRow);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never lets penal interest fall as the clock moves forward', () => {
    fc.assert(
      fc.property(loanArb, fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 200 }), (input, a, gap) => {
        const schedule = generateSchedule({ loanId: 'p', ...input });
        const at = (days: number) =>
          loanPosition({
            schedule,
            receipts: [],
            feesCharged: 0,
            asOf: addDaysISO(input.firstDueOn, days),
            penalRateBps: DEFAULT_POLICY.penalRateBps,
            graceDays: DEFAULT_POLICY.graceDays,
          }).penalAccrued;
        expect(at(a + gap)).toBeGreaterThanOrEqual(at(a));
      }),
      RUNS,
    );
  });
});

describe('allocate', () => {
  it('splits an amount into parts that sum to it exactly, each within a paise of exact', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 25 }).filter(
          (weights) => weights.some((w) => w > 0),
        ),
        (amount, weights) => {
          const parts = allocate(amount, weights);
          const total = weights.reduce((a, b) => a + b, 0);
          expect(sum(parts)).toBe(amount);
          parts.forEach((part, i) => {
            expect(part).toBeGreaterThanOrEqual(0);
            expect(Math.abs(part - (amount * weights[i]!) / total)).toBeLessThan(1);
          });
        },
      ),
      RUNS,
    );
  });
});

describe('date arithmetic', () => {
  it('agrees with the UTC calendar on the distance between any two dates', () => {
    // Date.UTC is allowed here in a test, as an independent oracle; the domain
    // layer itself never constructs a Date.
    const utc = (iso: string) => {
      const { year, month, day } = parseISODate(iso);
      return Date.UTC(year, month - 1, day) / 86_400_000;
    };
    fc.assert(
      fc.property(dateArb, dateArb, (a, b) => {
        expect(daysBetween(a, b)).toBe(utc(b) - utc(a));
      }),
      RUNS,
    );
  });

  it('round-trips adding days', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -3_000, max: 3_000 }), (date, days) => {
        const moved = addDaysISO(date, days);
        expect(daysBetween(date, moved)).toBe(days);
        expect(addDaysISO(moved, -days)).toBe(date);
      }),
      RUNS,
    );
  });

  it('adds months without overshooting the end of the target month', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -60, max: 60 }), (date, months) => {
        const from = parseISODate(date);
        const to = parseISODate(addMonthsISO(date, months));
        expect((to.year - from.year) * 12 + (to.month - from.month)).toBe(months);
        expect(to.day).toBe(Math.min(from.day, daysInMonth(to.year, to.month)));
      }),
      RUNS,
    );
  });
});
