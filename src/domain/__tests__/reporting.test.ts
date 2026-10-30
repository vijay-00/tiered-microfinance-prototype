import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadScenarioA } from '@/data/seed';
import { addDaysISO, endOfMonth, financialYearStart, startOfFinancialQuarter, startOfMonth } from '../dates';
import { ACCOUNTS, accountFor } from '../ledger';
import { sum } from '../money';
import {
  ageingReport,
  collectionEfficiency,
  ledgerTrace,
  marginAnalysis,
  marginFor,
  periodPresets,
  poolPerformance,
  societyDashboard,
  statementsFor,
  tAccountView,
  trialBalanceOf,
  type LedgerQuery,
  type TracedFigure,
} from '../reporting';
import { accountBalances, incomeStatement } from '../statements';
import { applyEvent, createWorld, journalOf, positionOf, replay, type WorldState } from '../world';
import { dueDates, POOL_OF_TWELVE, setUpPool } from './helpers/simulation';

/**
 * Phase 5: ledger and reporting. Each figure is checked against an
 * independent fold of the journal, and the lines a figure links to must add
 * up to it.
 */

const SOCIETIES = ['soc_1', 'soc_2', 'soc_3'];

const seedWorld = (): WorldState => {
  const seed = loadScenarioA();
  return replay(createWorld(seed.base), seed.events);
};

/** Re-adds a traced figure from the raw lines it links to, signs and all. */
function resum(state: WorldState, societyId: string, query: LedgerQuery): number {
  const trace = ledgerTrace(state, societyId, query);
  const sign = new Map<number, number>([...query.plus.map((c) => [c, 1] as const), ...(query.minus ?? []).map((c) => [c, -1] as const)]);
  return sum(
    trace.lines.map(({ line }) => {
      const normalDr = accountFor(line.accountCode).normal === 'DR';
      return sign.get(line.accountCode)! * (normalDr ? line.dr - line.cr : line.cr - line.dr);
    }),
  );
}

function expectTraced(state: WorldState, societyId: string, figure: TracedFigure) {
  expect(resum(state, societyId, figure.trace)).toBe(figure.value);
  for (const entry of ledgerTrace(state, societyId, figure.trace).entries) {
    if (figure.trace.from) expect(entry.on >= figure.trace.from).toBe(true);
    if (figure.trace.to) expect(entry.on <= figure.trace.to).toBe(true);
  }
}

describe('the Phase 5 gate: every dashboard figure traces to journal lines', () => {
  it('adds each figure up from the lines its link selects, and agrees with an independent fold', () => {
    const world = seedWorld();
    for (const societyId of SOCIETIES) {
      const d = societyDashboard(world, societyId);
      const journal = journalOf(world, societyId);
      const balances = accountBalances(journal);
      const traced = [
        d.books.loansOutstanding,
        d.books.federationPayable,
        d.books.cash,
        d.books.advancesHeld,
        d.earnings.month,
        d.earnings.year,
        d.earnings.penalAndFeesYear,
        d.margin.realised,
        d.margin.receivedRetail,
        d.margin.paidWholesale,
        d.ageing.ledger,
        ...(d.collections ? [d.collections.received] : []),
      ];
      for (const figure of traced) expectTraced(world, societyId, figure);

      expect(d.books.loansOutstanding.value).toBe(balances.get(ACCOUNTS.LOANS_RECEIVABLE)!.balance);
      expect(d.books.cash.value).toBe(d.summary.cash);
      expect(d.books.federationPayable.value).toBe(d.summary.federationPayable);
      const year = { from: financialYearStart(world.clock), to: world.clock };
      expect(d.earnings.year.value).toBe(incomeStatement(journal, year).netInterestIncome);
      expect(d.earnings.month.value).toBe(incomeStatement(journal, { from: startOfMonth(world.clock), to: world.clock }).netInterestIncome);
      expect(d.ageing.total).toBe(d.ageing.ledger.value);
    }
  });

  it('balances the trial balance and the balance sheet at every month end since inception, for every society', () => {
    const world = seedWorld();
    for (const societyId of SOCIETIES) {
      for (let m = '2026-01-01'; m <= world.clock; m = addDaysISO(endOfMonth(m), 1)) {
        const to = endOfMonth(m) < world.clock ? endOfMonth(m) : world.clock;
        expect(trialBalanceOf(world, societyId, to).balanced).toBe(true);
        const s = statementsFor(world, societyId, { from: m, to });
        expect(s.balance.balanced).toBe(true);
        expect(s.trialBalanced).toBe(true);
      }
    }
  });
});

describe('ledger traces', () => {
  it('lists one loan’s lines on the receivable, adding up to its principal outstanding', () => {
    const world = seedWorld();
    const trace = ledgerTrace(world, 'soc_1', { plus: [ACCOUNTS.LOANS_RECEIVABLE], loanId: 'loan_001' });
    expect(trace.total).toBe(positionOf(world, 'loan_001').principalOutstanding);
    expect(trace.entries.map((e) => e.sourceType)).toContain('DISBURSEMENT');
    // Newest first.
    expect(trace.entries[0]!.on >= trace.entries.at(-1)!.on).toBe(true);
  });

  it('leaves period-close entries out of income traces, as the income statement does', () => {
    let world = seedWorld();
    const query: LedgerQuery = { plus: [ACCOUNTS.INTEREST_INCOME], minus: [ACCOUNTS.INTEREST_EXPENSE] };
    const before = ledgerTrace(world, 'soc_1', query).total;
    world = applyEvent(world, { type: 'PERIOD_CLOSED', on: world.clock, societyId: 'soc_1' });
    const after = ledgerTrace(world, 'soc_1', query);
    expect(after.total).toBe(before);
    expect(after.excludesClosing).toBe(true);
    expect(after.entries.some((e) => e.sourceType === 'CLOSE')).toBe(false);
    // The close moved the surplus into reserves; the balance sheet still balances.
    const s = statementsFor(world, 'soc_1', { from: '2026-04-01', to: world.clock });
    expect(s.balance).toMatchObject({ balanced: true, currentSurplus: 0, reserves: 25_000_000 + before });
    expect(s.openSurplusFrom).toBe(addDaysISO(world.clock, 1));
  });

  it('brings a T-account down from before its range and carries it to the balance at the end', () => {
    const world = seedWorld();
    const view = tAccountView(world, 'soc_1', ACCOUNTS.CASH, { from: '2026-10-01', to: '2026-10-20' });
    const journal = journalOf(world, 'soc_1');
    expect(view.opening).toBe(accountBalances(journal, { to: '2026-09-30' }).get(ACCOUNTS.CASH)!.balance);
    expect(view.closing).toBe(accountBalances(journal, { to: '2026-10-20' }).get(ACCOUNTS.CASH)!.balance);
    expect(view.closing).toBe(view.opening + view.totalDr - view.totalCr);
  });
});

describe('periods', () => {
  it('runs quarters and years from April', () => {
    const presets = Object.fromEntries(periodPresets('2027-02-10', '2026-01-02').map((p) => [p.id, [p.from, p.to]]));
    expect(presets).toEqual({
      MONTH: ['2027-02-01', '2027-02-10'],
      LAST_MONTH: ['2027-01-01', '2027-01-31'],
      QUARTER: ['2027-01-01', '2027-02-10'],
      YEAR: ['2026-04-01', '2027-02-10'],
      LAST_YEAR: ['2025-04-01', '2026-03-31'],
      INCEPTION: ['2026-01-02', '2027-02-10'],
    });
    expect(startOfFinancialQuarter('2026-06-30')).toBe('2026-04-01');
    expect(startOfFinancialQuarter('2026-12-31')).toBe('2026-10-01');
  });
});

describe('ageing, collections and margin, as members fall behind', () => {
  // Scenario A's pool at Annapoorani: twelve loans, first instalments on 15 May 2026.
  function lateMay() {
    const sim = setUpPool({ checkEveryStep: false });
    sim.advanceTo('2026-05-15');
    sim.collectAllDue(['loan_01', 'loan_02']);
    sim.remit('trn_01');
    return sim;
  }

  it('puts late loans in their buckets, still tying to the books', () => {
    const sim = lateMay();
    sim.advanceTo('2026-06-01');
    const ageing = ageingReport(sim.state, 'soc_1');
    const bucket = (key: string) => ageing.buckets.find((b) => b.key === key)!;
    expect(bucket('UPTO_30').loans.map((l) => l.loanId)).toEqual(['loan_01', 'loan_02']);
    expect(bucket('CURRENT').loans).toHaveLength(10);
    expect(ageing.total).toBe(ageing.ledger.value);
    expect(ageing.atRisk.loans).toBe(2);
    expect(ageing.atRisk.amount).toBe(bucket('UPTO_30').amount);
  });

  it('counts what was collected against what fell due each month', () => {
    const sim = lateMay();
    sim.advanceTo('2026-05-31');
    const may = collectionEfficiency(sim.state, 'soc_1').find((m) => m.month === '2026-05')!;
    const missed = sum(['loan_01', 'loan_02'].map((id) => sim.loans.get(id)!.schedule[0]!.instalment));
    expect(may.instalments).toBe(12);
    expect(may.paidInFull).toBe(10);
    expect(may.due - may.collected).toBe(missed);
    expect(may.rate).toBeCloseTo(may.collected / may.due, 10);
    // Paid in June, May stays as it was at May's end.
    sim.advanceTo('2026-06-15');
    sim.collectAllDue();
    expect(collectionEfficiency(sim.state, 'soc_1').find((m) => m.month === '2026-05')!.collected).toBe(may.collected);
  });

  it('explains a margin gap from late members, and from principal held back from the federation', () => {
    const sim = lateMay();
    sim.advanceTo('2026-05-31');
    const may = marginFor(sim.state, 'soc_1', { from: '2026-05-01', to: '2026-05-31' }, 'May');
    const missedInterest = sum(['loan_01', 'loan_02'].map((id) => sim.loans.get(id)!.schedule[0]!.interest));
    expect(may.reasons).toContainEqual({ kind: 'MEMBERS_BEHIND', amount: missedInterest });
    expect(may.reasons.every((r) => r.kind === 'MEMBERS_BEHIND' || r.kind === 'ROUNDING')).toBe(true);
    expect(may.difference).toBe(
      may.receivedRetail.value - may.scheduledRetail - (may.paidWholesale.value - may.scheduledWholesale),
    );

    // June: they catch up, but the society remits nothing on the 15th.
    sim.advanceTo('2026-06-15');
    sim.collectAllDue();
    sim.remit('trn_01', { interestPaid: 0, principalPaid: 0 });
    sim.advanceTo('2026-06-30');
    const june = marginFor(sim.state, 'soc_1', { from: '2026-06-01', to: '2026-06-30' }, 'June');
    expect(june.reasons.map((r) => r.kind)).toEqual(['MEMBERS_AHEAD', 'WHOLESALE_NOT_YET_PAID']);

    // July: everything paid in full, but the tranche balance stayed high for a month.
    sim.advanceTo('2026-07-15');
    sim.collectAllDue();
    sim.remit('trn_01');
    sim.advanceTo('2026-07-31');
    const july = marginFor(sim.state, 'soc_1', { from: '2026-07-01', to: '2026-07-31' }, 'July');
    expect(july.reasons.map((r) => r.kind)).toContain('WHOLESALE_ABOVE_SCHEDULE');
  });

  it('reports each funded batch, its repayment and its margin', () => {
    const sim = lateMay();
    const [pool] = poolPerformance(sim.state, 'soc_1');
    expect(pool).toMatchObject({ loans: 12, activeLoans: 12, remittancesMade: 1, remittancesOnTime: 1 });
    expect(pool!.disbursed).toBe(sum(POOL_OF_TWELVE.map((s) => s.principal)));
    expect(pool!.margin).toBe(pool!.interestReceived - pool!.wholesalePaid);
  });
});

describe('scenario A’s margin', () => {
  it('matches the schedules to within rounding, every month, at every society', () => {
    const world = seedWorld();
    for (const societyId of SOCIETIES) {
      for (const month of marginAnalysis(world, societyId).months) {
        expect(month.reasons.every((r) => r.kind === 'ROUNDING')).toBe(true);
      }
    }
  });
});

describe('every generated lifecycle', () => {
  it('keeps the trial balance and balance sheet balanced, ageing tied to the books, and the margin gap fully explained', () => {
    const dates = dueDates(setUpPool({ checkEveryStep: false })).slice(0, 8);
    const loanIds = POOL_OF_TWELVE.map((s) => s.id);
    const month = fc.record({
      skip: fc.subarray(loanIds, { maxLength: 4 }),
      prepay: fc.option(fc.record({ loan: fc.constantFrom(...loanIds), amount: fc.integer({ min: 100_000, max: 3_000_000 }) })),
      remit: fc.constantFrom('FULL', 'SHORT', 'NONE'),
    });
    fc.assert(
      fc.property(fc.array(month, { minLength: dates.length, maxLength: dates.length }), (plan) => {
        const sim = setUpPool({ checkEveryStep: false });
        plan.forEach((step, i) => {
          sim.advanceTo(dates[i]!);
          sim.collectAllDue(step.skip);
          if (step.prepay && sim.loans.get(step.prepay.loan)!.loan.status === 'ACTIVE') {
            const payoff = sim.position(step.prepay.loan).payoffAmount;
            sim.receive(step.prepay.loan, Math.min(payoff, step.prepay.amount), { prepay: true });
          }
          if (step.remit !== 'NONE') {
            const remit = sim.state.tranches.trn_01!;
            if (remit.tranche.status !== 'CLOSED') {
              sim.remit('trn_01', step.remit === 'FULL' ? 'FULL' : { interestPaid: 0, principalPaid: 0 });
            }
          }
          const monthEnd = endOfMonth(dates[i]!);
          sim.advanceTo(monthEnd);
          expect(trialBalanceOf(sim.state, 'soc_1').balanced).toBe(true);
          const s = statementsFor(sim.state, 'soc_1', { from: startOfMonth(monthEnd), to: monthEnd });
          expect(s.balance.balanced).toBe(true);
          const ageing = ageingReport(sim.state, 'soc_1');
          expect(ageing.total).toBe(ageing.ledger.value);
          const m = marginFor(sim.state, 'soc_1', { from: startOfMonth(monthEnd), to: monthEnd }, '');
          // Each reason moves the margin one way; rounding goes whichever way the wholesale gap does.
          const inTransit = m.reasons.find((r) => r.kind === 'PREPAYMENT_IN_TRANSIT')?.amount ?? 0;
          const wholesaleGap = m.paidWholesale.value - m.scheduledWholesale - inTransit;
          const effect = (kind: string, amount: number) =>
            kind === 'MEMBERS_AHEAD' || kind === 'WHOLESALE_NOT_YET_PAID' || (kind === 'ROUNDING' && wholesaleGap < 0)
              ? amount
              : -amount;
          expect(sum(m.reasons.map((r) => effect(r.kind, r.amount)))).toBe(m.difference);
        });
      }),
      { numRuns: 20 },
    );
  }, 60_000);
});
