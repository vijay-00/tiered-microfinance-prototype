import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../interest';
import { mulRate, sum } from '../money';
import {
  ReconciliationError,
  applyHeldAdvance,
  computeRemittance,
  loanPosition,
  reconcileReceipt,
  remittanceDates,
  validateAllocationOrder,
  type FundedLoan,
  type ReceiptRecord,
  type ReceiptSource,
  type RemittanceRecord,
} from '../reconciliation';
import { DEFAULT_POLICY, type AllocationBucket, type Paise, type ScheduleRow } from '../types';
import reference from './fixtures/reference-loan.json';

const schedule = generateSchedule(reference.input);
const loan = {
  id: 'loan_ref',
  disbursedOn: '2026-04-15',
  firstDueOn: reference.input.firstDueOn,
  status: 'ACTIVE' as const,
  rateBps: reference.input.annualBps,
  emi: reference.emi,
};
const WHOLESALE = reference.wholesaleBps;

interface ReceiveOptions {
  fees?: Paise;
  source?: ReceiptSource;
  prepay?: boolean;
  clock?: string;
  order?: AllocationBucket[];
}

/**
 * Records one receipt against the reference loan and returns the grown
 * history, and the schedule to use from now on: rescheduled if it prepaid.
 */
function receive(
  history: readonly ReceiptRecord[],
  amount: Paise,
  receivedOn: string,
  options: ReceiveOptions = {},
  current: readonly ScheduleRow[] = schedule,
) {
  const source = options.source ?? 'CASH';
  const out = reconcileReceipt({
    loan,
    schedule: current,
    priorReceipts: history,
    feesCharged: options.fees ?? 0,
    receipt: { amount, receivedOn, source, electPrepayment: options.prepay ?? false },
    clock: options.clock ?? receivedOn,
    wholesaleRateBps: WHOLESALE,
    policy: { ...DEFAULT_POLICY, allocationOrder: options.order ?? DEFAULT_POLICY.allocationOrder },
  });
  const record: ReceiptRecord = {
    receivedOn,
    amount,
    source,
    allocation: out.reconciliation.allocation,
  };
  return { out, history: [...history, record], schedule: out.rescheduled ?? current };
}

function expectCode(fn: () => unknown, code: ReconciliationError['code']) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ReconciliationError);
    expect((error as ReconciliationError).code).toBe(code);
    return error as ReconciliationError;
  }
  throw new Error(`expected ${code} to be thrown`);
}

describe('the TDD split table, period by period', () => {
  let history: ReceiptRecord[] = [];
  const results = reference.rows.map((row) => {
    const step = receive(history, row.instalment, row.dueOn);
    history = step.history;
    return step.out;
  });

  for (const [index, expected] of reference.rows.entries()) {
    it(`period ${expected.period}: Rs ${expected.wholesaleInterest / 100} to the federation, Rs ${expected.margin / 100} kept`, () => {
      const result = results[index]!.reconciliation;
      expect(result.allocation.currentInterest).toBe(expected.interest);
      expect(result.allocation.currentPrincipal).toBe(expected.principal);
      expect(result.federation.wholesaleInterestShare).toBe(expected.wholesaleInterest);
      expect(result.federation.principalPassThrough).toBe(expected.principal);
      expect(result.society.netInterestIncome).toBe(expected.margin);
      expect(result.balancesAfter.loanOutstanding).toBe(expected.closing);
    });
  }

  it('period 1 remits Rs 8,695.34 and keeps Rs 166.66, as the TDD diagram shows', () => {
    const first = results[0]!.reconciliation;
    expect(first.federation.remittanceShare).toBe(869_534);
    expect(first.society.netInterestIncome).toBe(16_666);
    expect(first.federation.remittanceShare + first.society.netInterestIncome).toBe(886_200);
  });

  it('totals Rs 5,235.53 to the federation and Rs 1,102.22 kept', () => {
    const wholesale = results.reduce((total, r) => total + r.reconciliation.federation.wholesaleInterestShare, 0);
    const margin = results.reduce((total, r) => total + r.reconciliation.society.netInterestIncome, 0);
    expect(wholesale).toBe(reference.totals.wholesaleInterest);
    expect(margin).toBe(reference.totals.margin);
  });

  it('closes the loan on the final instalment and not before', () => {
    expect(results.slice(0, -1).every((r) => !r.closesLoan)).toBe(true);
    expect(results.at(-1)!.closesLoan).toBe(true);
  });
});

describe('the allocation waterfall', () => {
  it('fills interest before principal: Rs 5,000 against an Rs 8,862 instalment', () => {
    const { out } = receive([], 500_000, '2026-05-15');
    expect(out.reconciliation.allocation).toMatchObject({
      currentInterest: 95_833,
      currentPrincipal: 404_167,
      advance: 0,
    });
  });

  it('takes penal interest first once the grace period has passed', () => {
    // Nothing paid until 30 June. May's instalment is 39 days past its grace
    // period, June's is 8: 886,200 x 47 paise-days at 2% p.a. is Rs 22.82.
    const position = loanPosition({
      schedule,
      receipts: [],
      feesCharged: 0,
      asOf: '2026-06-30',
      penalRateBps: DEFAULT_POLICY.penalRateBps,
      graceDays: DEFAULT_POLICY.graceDays,
    });
    expect(position.penalAccrued).toBe(2_282);
    expect(position.daysPastDue).toBe(46);

    const due = 2_282 + 95_833 + 790_367 + 88_259 + 797_941;
    const { out } = receive([], due, '2026-06-30');
    expect(out.reconciliation.allocation).toEqual({
      penalInterest: 2_282,
      fees: 0,
      overdueInterest: 95_833,
      overduePrincipal: 790_367,
      currentInterest: 88_259,
      currentPrincipal: 797_941,
      prepaidPrincipal: 0,
      advance: 0,
    });
    expect(out.reconciliation.society.penalIncome).toBe(2_282);
  });

  it('charges no penal interest inside the grace period', () => {
    const position = loanPosition({
      schedule,
      receipts: [],
      feesCharged: 0,
      asOf: '2026-05-22',
      penalRateBps: DEFAULT_POLICY.penalRateBps,
      graceDays: DEFAULT_POLICY.graceDays,
    });
    expect(position.penalAccrued).toBe(0);
  });

  it('does not let a late payment erase penal interest already earned', () => {
    const late = 2_282 + 95_833 + 790_367 + 88_259 + 797_941;
    const { history } = receive([], late, '2026-06-30');
    const later = loanPosition({
      schedule,
      receipts: history,
      feesCharged: 0,
      asOf: '2026-07-10',
      penalRateBps: DEFAULT_POLICY.penalRateBps,
      graceDays: DEFAULT_POLICY.graceDays,
    });
    expect(later.penalAccrued).toBe(2_282);
    expect(later.penalUnpaid).toBe(0);
  });

  it('follows a different policy order, which changes a delinquent member outcome', () => {
    const interestFirst: AllocationBucket[] = [
      'OVERDUE_INTEREST',
      'CURRENT_INTEREST',
      'PENAL_INTEREST',
      'FEES',
      'OVERDUE_PRINCIPAL',
      'CURRENT_PRINCIPAL',
      'ADVANCE',
    ];
    const { out } = receive([], 200_000, '2026-06-30', { order: interestFirst });
    expect(out.reconciliation.allocation).toMatchObject({
      overdueInterest: 95_833,
      currentInterest: 88_259,
      penalInterest: 2_282,
      overduePrincipal: 200_000 - 95_833 - 88_259 - 2_282,
    });
  });

  it('rejects an incoherent allocation order', () => {
    const base = DEFAULT_POLICY.allocationOrder;
    expectCode(() => validateAllocationOrder(base.slice(0, -1)), 'INVALID_ALLOCATION_ORDER');
    expectCode(
      () => validateAllocationOrder(['ADVANCE', ...base.slice(0, -1)]),
      'INVALID_ALLOCATION_ORDER',
    );
    expectCode(
      () =>
        validateAllocationOrder([
          'PENAL_INTEREST',
          'FEES',
          'CURRENT_INTEREST',
          'OVERDUE_INTEREST',
          'OVERDUE_PRINCIPAL',
          'CURRENT_PRINCIPAL',
          'ADVANCE',
        ]),
      'INVALID_ALLOCATION_ORDER',
    );
  });
});

describe('part-payments of one instalment', () => {
  it('attribute wholesale interest so the shares sum to the row exactly', () => {
    const first = receive([], 50_000, '2026-05-15');
    const second = receive(first.history, 836_200, '2026-05-20');
    const shares =
      first.out.reconciliation.federation.wholesaleInterestShare +
      second.out.reconciliation.federation.wholesaleInterestShare;
    expect(shares).toBe(79_167);
    expect(second.out.reconciliation.balancesAfter.loanOutstanding).toBe(9_209_633);
  });
});

describe('advances', () => {
  it('holds an overpayment and applies it when the next instalment falls due', () => {
    const paid = receive([], 1_772_400, '2026-05-15');
    expect(paid.out.reconciliation.allocation.advance).toBe(886_200);
    expect(paid.out.reconciliation.balancesAfter.unappliedReceipts).toBe(886_200);
    // An advance is a liability, not principal: nothing of it reduces the loan yet.
    expect(paid.out.reconciliation.balancesAfter.loanOutstanding).toBe(9_209_633);

    const applied = applyHeldAdvance({
      loan,
      schedule,
      priorReceipts: paid.history,
      feesCharged: 0,
      on: '2026-06-15',
      clock: '2026-06-15',
      wholesaleRateBps: WHOLESALE,
      policy: DEFAULT_POLICY,
    });
    expect(applied.reconciliation.allocation).toMatchObject({
      currentInterest: 88_259,
      currentPrincipal: 797_941,
      advance: 0,
    });
    expect(applied.reconciliation.balancesAfter.unappliedReceipts).toBe(0);
    expect(applied.reconciliation.balancesAfter.loanOutstanding).toBe(8_411_692);
  });

  it('refuses to apply an advance when nothing has fallen due', () => {
    const paid = receive([], 1_772_400, '2026-05-15');
    expectCode(
      () =>
        applyHeldAdvance({
          loan,
          schedule,
          priorReceipts: paid.history,
          feesCharged: 0,
          on: '2026-05-20',
          clock: '2026-05-20',
          wholesaleRateBps: WHOLESALE,
          policy: DEFAULT_POLICY,
        }),
      'NON_POSITIVE_AMOUNT',
    );
  });
});

describe('foreclosure', () => {
  // Three instalments on time, then a full payoff on the fourth due date
  // with a Rs 500 foreclosure fee.
  let history: ReceiptRecord[] = [];
  for (const row of reference.rows.slice(0, 3)) history = receive(history, row.instalment, row.dueOn).history;
  const fee = 50_000;
  const payoff = fee + 72_892 + 813_308 + 6_792_796;
  const { out, history: after, schedule: rescheduled } = receive(history, payoff, '2026-08-15', {
    fees: fee,
    prepay: true,
  });

  it('clears all remaining principal, the current instalment and the fee', () => {
    expect(out.reconciliation.allocation).toEqual({
      penalInterest: 0,
      fees: fee,
      overdueInterest: 0,
      overduePrincipal: 0,
      currentInterest: 72_892,
      currentPrincipal: 813_308,
      prepaidPrincipal: 6_792_796,
      advance: 0,
    });
    expect(out.closesLoan).toBe(true);
    expect(out.reconciliation.society.feeIncome).toBe(fee);
  });

  it('passes the prepaid principal through, so the federation is owed it', () => {
    expect(out.reconciliation.federation.principalPassThrough).toBe(813_308 + 6_792_796);
  });

  it('reschedules to just the four rows that were paid', () => {
    expect(rescheduled.map((row) => row.period)).toEqual([1, 2, 3, 4]);
  });

  it('owes no interest or penal on the months after closure', () => {
    const later = loanPosition({
      schedule: rescheduled,
      receipts: after,
      feesCharged: fee,
      asOf: '2027-06-30',
      penalRateBps: DEFAULT_POLICY.penalRateBps,
      graceDays: DEFAULT_POLICY.graceDays,
    });
    expect(later.principalOutstanding).toBe(0);
    expect(later.totalDueNow).toBe(0);
    expect(later.penalAccrued).toBe(0);
    expect(later.paid.prepaid).toBe(6_792_796);
  });
});

describe('partial prepayment: same EMI, shorter tenure', () => {
  // Three instalments on time; on the fourth due date the member pays the
  // instalment and Rs 10,000 more, electing prepayment.
  let history: ReceiptRecord[] = [];
  for (const row of reference.rows.slice(0, 3)) history = receive(history, row.instalment, row.dueOn).history;
  const PREPAID = 1_000_000;
  const { out, history: after, schedule: rescheduled } = receive(
    history,
    886_200 + PREPAID,
    '2026-08-15',
    { prepay: true },
  );
  const tail = rescheduled.filter((row) => row.period > 4);

  it('pays the instalment first, then prepays the rest', () => {
    expect(out.reconciliation.allocation).toMatchObject({
      currentInterest: 72_892,
      currentPrincipal: 813_308,
      prepaidPrincipal: PREPAID,
      advance: 0,
    });
    expect(out.closesLoan).toBe(false);
  });

  it('keeps the paid rows and re-amortises the reduced balance from the next period', () => {
    expect(rescheduled.slice(0, 4)).toEqual(schedule.slice(0, 4));
    expect(tail[0]).toMatchObject({ period: 5, dueOn: '2026-09-15', opening: 6_792_796 - PREPAID });
    expect(tail[0]!.interest).toBe(55_514);
  });

  it('keeps the member Rs 8,862 instalment and ends the loan a month early', () => {
    for (const row of tail.slice(0, -1)) expect(row.instalment).toBe(reference.emi);
    expect(tail.at(-1)!.instalment).toBeLessThanOrEqual(reference.emi);
    expect(tail.at(-1)!.closing).toBe(0);
    expect(rescheduled.at(-1)!.period).toBe(11);
    expect(rescheduled.at(-1)!.dueOn).toBe('2027-03-15');
  });

  it('accounts for every rupee: rows plus prepayment equal the principal', () => {
    expect(sum(rescheduled.map((row) => row.principal)) + PREPAID).toBe(10_000_000);
  });

  it('saves the member interest', () => {
    expect(sum(rescheduled.map((row) => row.interest))).toBeLessThan(reference.totals.interest);
  });

  it('bills the next month on the rescheduled row', () => {
    const next = loanPosition({
      schedule: rescheduled,
      receipts: after,
      feesCharged: 0,
      asOf: '2026-09-15',
      penalRateBps: DEFAULT_POLICY.penalRateBps,
      graceDays: DEFAULT_POLICY.graceDays,
    });
    expect(next.currentInterest).toBe(55_514);
    expect(next.currentPrincipal).toBe(886_200 - 55_514);
    expect(next.principalOutstanding).toBe(6_792_796 - PREPAID);
  });

  it('passes the prepaid principal through to the federation', () => {
    expect(out.reconciliation.federation.principalPassThrough).toBe(813_308 + PREPAID);
  });

  it('can prepay from a held advance too', () => {
    const held = receive(history, 886_200 + 300_000, '2026-08-15');
    expect(held.out.reconciliation.allocation.advance).toBe(300_000);
    const applied = receive(held.history, 300_000, '2026-08-20', { source: 'ADVANCE', prepay: true });
    expect(applied.out.reconciliation.allocation.prepaidPrincipal).toBe(300_000);
    expect(applied.out.reconciliation.balancesAfter.unappliedReceipts).toBe(0);
    expect(applied.schedule.find((row) => row.period === 5)!.opening).toBe(6_792_796 - 300_000);
  });
});

describe('guards', () => {
  it('refuses a zero receipt', () => {
    expectCode(() => receive([], 0, '2026-05-15'), 'NON_POSITIVE_AMOUNT');
  });

  it('refuses a receipt before disbursement', () => {
    expectCode(() => receive([], 100_000, '2026-04-01'), 'BEFORE_DISBURSEMENT');
  });

  it('refuses a receipt dated after the simulated clock', () => {
    expectCode(() => receive([], 100_000, '2026-05-15', { clock: '2026-05-14' }), 'AFTER_CLOCK');
  });

  it('refuses a backdated receipt, because history is append-only', () => {
    const { history } = receive([], 886_200, '2026-05-15');
    expectCode(() => receive(history, 100_000, '2026-05-10'), 'OUT_OF_ORDER');
  });

  it('refuses more than the loan can accept, and says how much it can', () => {
    const error = expectCode(() => receive([], 20_000_000, '2026-05-15'), 'EXCEEDS_CEILING');
    // Rs 1,00,000 principal plus May's interest: the full payoff on the first due date.
    expect(error.detail.maxAcceptable).toBe(10_095_833);
  });

  it('refuses to apply more advance than is held', () => {
    expectCode(
      () => receive([], 100_000, '2026-05-15', { source: 'ADVANCE' }),
      'INSUFFICIENT_ADVANCE',
    );
  });

  it('refuses a payment against a closed loan', () => {
    expectCode(
      () =>
        reconcileReceipt({
          loan: { ...loan, status: 'CLOSED' },
          schedule,
          priorReceipts: [],
          feesCharged: 0,
          receipt: { amount: 100, receivedOn: '2026-05-15', source: 'CASH', electPrepayment: false },
          clock: '2026-05-15',
          wholesaleRateBps: WHOLESALE,
          policy: DEFAULT_POLICY,
        }),
      'LOAN_NOT_ACTIVE',
    );
  });
});

describe('the tranche side', () => {
  const tranche = {
    id: 'trn_ref',
    wholesaleRateBps: WHOLESALE,
    tenureMonths: 12,
    drawdowns: [{ on: '2026-04-15', amount: 10_000_000 }],
  };
  const fundedLoans = [{ loanId: 'loan_ref', schedule }];

  function remitAll(policy: 'PASS_THROUGH' | 'INDEPENDENT_AMORTISATION') {
    const prior: RemittanceRecord[] = [];
    return remittanceDates(fundedLoans).map((dueOn) => {
      const due = computeRemittance({ tranche, fundedLoans, priorRemittances: prior, dueOn, policy });
      prior.push({
        dueOn,
        interestDue: due.interestDue,
        principalDue: due.principalDue,
        interestPaid: due.interestDue,
        principalPaid: due.principalDue,
      });
      return due;
    });
  }

  it('under pass-through, owes exactly what the member schedule passes through', () => {
    const dues = remitAll('PASS_THROUGH');
    for (const [index, expected] of reference.rows.entries()) {
      const due = dues[index]!;
      expect(due.trancheOpening).toBe(expected.opening);
      expect(due.wholesaleInterest).toBe(expected.wholesaleInterest);
      expect(due.principalDue).toBe(expected.principal);
      expect(due.principalTimingGap).toBe(0);
      expect(due.wholesaleVariance).toBe(0);
    }
    expect(dues.reduce((total, due) => total + due.principalDue, 0)).toBe(10_000_000);
  });

  it('under independent amortisation, shows the Rs 72.66 principal timing gap in month 1', () => {
    const first = remitAll('INDEPENDENT_AMORTISATION')[0]!;
    expect(first.totalDue).toBe(876_800);
    expect(first.principalTimingGap).toBe(7_266);
    // Collected Rs 8,862, remitted Rs 8,768: a Rs 94 cash surplus against Rs 166.66 accrued.
    expect(reference.emi - first.totalDue).toBe(9_400);
  });

  it('carries a short remittance forward, and the unpaid principal keeps attracting interest', () => {
    const first = computeRemittance({
      tranche,
      fundedLoans,
      priorRemittances: [],
      dueOn: '2026-05-15',
      policy: 'PASS_THROUGH',
    });
    const shortPaid: RemittanceRecord = {
      dueOn: '2026-05-15',
      interestDue: first.interestDue,
      principalDue: first.principalDue,
      interestPaid: first.interestDue,
      principalPaid: 0,
    };
    const second = computeRemittance({
      tranche,
      fundedLoans,
      priorRemittances: [shortPaid],
      dueOn: '2026-06-15',
      policy: 'PASS_THROUGH',
    });
    expect(second.trancheOpening).toBe(10_000_000);
    expect(second.principalArrears).toBe(790_367);
    expect(second.principalDue).toBe(790_367 + 797_941);
    // Charged on the full Rs 1,00,000 still owed, not on the member's Rs 92,096.33.
    expect(second.wholesaleInterest).toBe(79_167);
    expect(second.wholesaleVariance).toBe(79_167 - 72_910);
  });

  /** Remits every period up to and including `until`, in full. */
  function remitThrough(funded: FundedLoan[], until: string) {
    const prior: RemittanceRecord[] = [];
    const dues = [];
    for (const dueOn of remittanceDates(funded).filter((d) => d <= until)) {
      const due = computeRemittance({ tranche, fundedLoans: funded, priorRemittances: prior, dueOn, policy: 'PASS_THROUGH' });
      prior.push({ dueOn, interestDue: due.interestDue, principalDue: due.principalDue, interestPaid: due.interestDue, principalPaid: due.principalDue });
      dues.push(due);
    }
    return dues;
  }

  it('passes a prepayment made on a due date through that same day, with no carry', () => {
    let history: ReceiptRecord[] = [];
    for (const row of reference.rows.slice(0, 3)) history = receive(history, row.instalment, row.dueOn).history;
    const { schedule: rescheduled } = receive(history, 886_200 + 1_000_000, '2026-08-15', { prepay: true });
    const funded = [{ loanId: 'loan_ref', schedule: rescheduled, prepayments: [{ on: '2026-08-15', principal: 1_000_000 }] }];

    const dues = remitThrough(funded, '2027-03-15');
    expect(dues[3]).toMatchObject({ prepaidPassThrough: 1_000_000, principalDue: 813_308 + 1_000_000 });
    expect(dues[4]!.trancheOpening).toBe(6_792_796 - 1_000_000);
    for (const due of dues) expect(due.wholesaleVariance).toBe(0);
    expect(sum(dues.map((d) => d.principalDue))).toBe(10_000_000);
  });

  it('carries a mid-month prepayment until the next remittance, at one month of wholesale interest', () => {
    let history: ReceiptRecord[] = [];
    for (const row of reference.rows.slice(0, 4)) history = receive(history, row.instalment, row.dueOn).history;
    const { schedule: rescheduled } = receive(history, 1_000_000, '2026-08-25', { prepay: true });
    const funded = [{ loanId: 'loan_ref', schedule: rescheduled, prepayments: [{ on: '2026-08-25', principal: 1_000_000 }] }];

    const september = remitThrough(funded, '2026-09-15').at(-1)!;
    expect(september.prepaidPassThrough).toBe(1_000_000);
    expect(september.trancheOpening).toBe(6_792_796);
    // The federation charged a month on the Rs 10,000 the society held for three weeks.
    expect(Math.abs(september.wholesaleVariance - mulRate(1_000_000, WHOLESALE, 12))).toBeLessThanOrEqual(1);
    const october = remitThrough(funded, '2026-10-15').at(-1)!;
    expect(october.wholesaleVariance).toBe(0);
  });

  it('refuses a remittance that does not move forward in time', () => {
    const record: RemittanceRecord = {
      dueOn: '2026-05-15',
      interestDue: 0,
      principalDue: 0,
      interestPaid: 0,
      principalPaid: 0,
    };
    expectCode(
      () =>
        computeRemittance({
          tranche,
          fundedLoans,
          priorRemittances: [record],
          dueOn: '2026-05-15',
          policy: 'PASS_THROUGH',
        }),
      'REMITTANCE_WINDOW',
    );
  });
});
