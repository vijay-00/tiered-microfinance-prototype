import { describe, expect, it } from 'vitest';
import { loadSeed, type SeedScenario } from '@/data/seed';
import { MONTHS_PER_YEAR } from '../interest';
import { mulRate, sum } from '../money';
import { ageingReport, marginFor, trialBalanceOf } from '../reporting';
import { applyEvent, createWorld, positionOf, remittanceDueFor, replay, type WorldEvent, type WorldState } from '../world';

/**
 * Phase 6: the three prepared scenarios each prove what the TDD says they
 * prove, from the committed seed.
 */

const world = (id: SeedScenario): WorldState => {
  const seed = loadSeed(id);
  return replay(createWorld(seed.base), seed.events);
};

const YEAR = { from: '2026-04-01', to: '2026-10-29' };
const LATE = ['loan_003', 'loan_005', 'loan_007'];

function pay(state: WorldState, loanId: string, amount: number, n: number): WorldEvent {
  return {
    type: 'PAYMENT_RECEIVED',
    on: state.clock,
    paymentId: `pay_t${n}`,
    loanId,
    amount,
    mode: 'CASH',
    receiptNo: `ANN/R/T${n}`,
    source: 'CASH',
    electPrepayment: false,
    recordedBy: 'usr_officer',
  };
}

describe('scenario B: delinquency', () => {
  const b = world('B');

  it('has three members behind at Annapoorani, one past ninety days, and one who caught up with penal interest', () => {
    const ageing = ageingReport(b, 'soc_1');
    const bucket = (key: string) => ageing.buckets.find((x) => x.key === key)!.loans.map((l) => [l.loanId, l.daysPastDue]);
    expect(bucket('UPTO_60')).toEqual([
      ['loan_003', 44],
      ['loan_007', 44],
    ]);
    expect(bucket('OVER_90')).toEqual([['loan_005', 106]]);
    expect(positionOf(b, 'loan_010').daysPastDue).toBe(0);
    expect(positionOf(b, 'loan_010').paid.penal).toBeGreaterThan(0);
    expect(ageing.total).toBe(ageing.ledger.value);
  });

  it('remits to the federation in full and on the day regardless, from reserves', () => {
    const remittances = b.tranches.trn_01!.remittances;
    expect(remittances).toHaveLength(6);
    for (const r of remittances) {
      expect(r.paidOn).toBe(r.dueOn);
      expect([r.interestPaid, r.principalPaid]).toEqual([r.interestDue, r.principalDue]);
    }
    const cash = (state: WorldState) => trialBalanceOf(state, 'soc_1').rows.find((r) => r.account.code === 1000)!;
    const a = world('A');
    expect(cash(b).dr - cash(b).cr).toBeLessThan(cash(a).dr - cash(a).cr);
  });

  it('shows realised margin below theoretical, explained by interest members still owe', () => {
    const margin = marginFor(b, 'soc_1', YEAR, 'Year');
    const behind = margin.reasons.find((r) => r.kind === 'MEMBERS_BEHIND')!;
    const owed = sum(LATE.map((id) => positionOf(b, id).overdueInterest + positionOf(b, id).currentInterest));
    expect(behind.amount).toBe(owed);
    expect(margin.reasons.every((r) => r.kind === 'MEMBERS_BEHIND' || r.kind === 'ROUNDING')).toBe(true);
  });

  it('recovers the margin in full when the members catch up, with penal interest on top', () => {
    let state = b;
    LATE.forEach((id, i) => {
      state = applyEvent(state, pay(state, id, positionOf(state, id).totalDueNow, i));
    });
    const margin = marginFor(state, 'soc_1', YEAR, 'Year');
    expect(margin.reasons.every((r) => r.kind === 'ROUNDING')).toBe(true);
    expect(Math.abs(margin.difference)).toBeLessThan(100);
    expect(margin.penalAndFees.value).toBeGreaterThan(marginFor(b, 'soc_1', YEAR, 'Year').penalAndFees.value);
  });

  it('loses margin for good at Grama Valarchi, where August’s principal was held back', () => {
    const august = b.tranches.trn_02!.remittances.find((r) => r.dueOn === '2026-08-10')!;
    expect(august.principalPaid).toBe(0);
    const september = marginFor(b, 'soc_2', { from: '2026-09-01', to: '2026-09-30' }, 'Sep');
    const extra = september.reasons.find((r) => r.kind === 'WHOLESALE_ABOVE_SCHEDULE')!;
    // A month of wholesale interest on the principal that stayed with the society.
    const expected = mulRate(august.principalDue, b.tranches.trn_02!.tranche.wholesaleRateBps, MONTHS_PER_YEAR);
    expect(Math.abs(extra.amount - expected)).toBeLessThanOrEqual(14);
  });
});

describe('scenario C: prepayment and recovery', () => {
  const c = world('C');

  it('shortens a part-prepaid loan and keeps its instalment', () => {
    const loan = c.loans.loan_006!;
    expect(loan.schedule.length).toBeLessThan(loan.originalSchedule.length);
    const after = loan.schedule.filter((r) => r.dueOn > '2026-07-20').slice(0, -1);
    expect(after.every((r) => r.instalment === loan.loan.emi)).toBe(true);
  });

  it('forecloses without a fee, and passes the principal to the federation at the next remittance', () => {
    const loan = c.loans.loan_012!;
    expect(loan.loan.status).toBe('FORECLOSED');
    expect(loan.feesCharged).toBe(0);
    const payoff = loan.receipts.at(-1)!;
    expect(payoff.allocation.fees).toBe(0);
    const august = c.tranches.trn_01!.remittances.find((r) => r.dueOn === '2026-08-15')!;
    expect(august.due.prepaidPassThrough).toBeGreaterThanOrEqual(payoff.allocation.prepaidPrincipal);
  });

  it('applies partial recoveries to penal and overdue interest before any principal', () => {
    const rekha = c.loans.loan_005!.receipts.at(-1)!.allocation;
    expect(rekha.overduePrincipal).toBe(0);
    expect(rekha.penalInterest).toBeGreaterThan(0);
    const iranna = c.loans.loan_003!.receipts.at(-1)!.allocation;
    expect(iranna.overduePrincipal).toBe(100_000);
    // Iyyappan's penal and overdue interest were cleared in full before principal took a paisa.
    const before = positionOf({ ...c, clock: '2026-10-22' }, 'loan_003', '2026-10-21');
    expect(iranna.overdueInterest).toBe(before.overdueInterest);
  });

  it('names prepayment timing as the cost of August’s prepayments', () => {
    const august = marginFor(c, 'soc_1', { from: '2026-08-01', to: '2026-08-31' }, 'Aug');
    const prepaid = sum([
      c.loans.loan_006!.receipts.find((r) => r.receivedOn === '2026-07-20')!.allocation.prepaidPrincipal,
      c.loans.loan_012!.receipts.at(-1)!.allocation.prepaidPrincipal,
    ]);
    expect(august.reasons).toContainEqual({ kind: 'PREPAYMENT_IN_TRANSIT', amount: mulRate(prepaid, 950, MONTHS_PER_YEAR) });
    expect(august.reasons.some((r) => r.kind === 'WHOLESALE_ABOVE_SCHEDULE')).toBe(false);
  });
});

describe('determinism', () => {
  it('reaches the same trial balances from each scenario and the same actions', () => {
    const snapshot = (['A', 'B', 'C'] as const).map((id) => {
      let state = applyEvent(world(id), { type: 'CLOCK_ADVANCED', to: '2026-11-15' });
      const due = remittanceDueFor(state, 'trn_01', '2026-11-15');
      state = applyEvent(state, {
        type: 'REMITTANCE_RECORDED',
        on: state.clock,
        remittanceId: 'rem_t1',
        trancheId: 'trn_01',
        dueOn: '2026-11-15',
        interestPaid: due.interestDue,
        principalPaid: due.principalDue,
        recordedBy: 'usr_secretary',
      });
      return {
        id,
        societies: ['soc_1', 'soc_2', 'soc_3'].map((s) =>
          trialBalanceOf(state, s)
            .rows.filter((r) => r.dr || r.cr)
            .map((r) => `${r.account.code} ${r.dr} ${r.cr}`),
        ),
      };
    });
    expect(snapshot).toMatchSnapshot();
  });
});
