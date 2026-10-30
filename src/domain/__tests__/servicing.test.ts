import { describe, expect, it } from 'vitest';
import { loadScenarioA } from '@/data/seed';
import { dueTodayEvents, paymentEvent } from '@/store/commands';
import { sum } from '../money';
import {
  collectionsOn,
  collectionsQueue,
  loanDetail,
  memberLoanDetail,
  NotYourLoanError,
  previewPayment,
  remittancePreview,
  trancheDetail,
  trancheSummaries,
} from '../servicing';
import { applyEvent, createWorld, replay, type WorldState } from '../world';

const seedWorld = (): WorldState => {
  const seed = loadScenarioA();
  return replay(createWorld(seed.base), seed.events);
};
const at = (world: WorldState, to: string) => applyEvent(world, { type: 'CLOCK_ADVANCED', to });
const collectAll = (world: WorldState, societyId = 'soc_1') =>
  dueTodayEvents(world, societyId, 'usr_officer').reduce(applyEvent, world);

describe('the collections queue', () => {
  const world = seedWorld();

  it('is empty on the seed date, with nothing in the next week', () => {
    const queue = collectionsQueue(world, 'soc_1');
    expect([queue.dueToday.length, queue.overdue.length, queue.upcoming.length]).toEqual([0, 0, 0]);
  });

  it('shows the demo batch coming up, then due, then in grace, then overdue with penal', () => {
    expect(collectionsQueue(at(world, '2026-11-10'), 'soc_1').upcoming).toHaveLength(12);
    expect(collectionsQueue(at(world, '2026-11-15'), 'soc_1').dueToday).toHaveLength(12);

    const inGrace = collectionsQueue(at(world, '2026-11-20'), 'soc_1').overdue;
    expect(inGrace.every((r) => r.status === 'IN_GRACE' && r.daysPastDue === 5 && r.penalDue === 0)).toBe(true);

    const late = collectionsQueue(at(world, '2026-11-25'), 'soc_1').overdue;
    expect(late.every((r) => r.status === 'OVERDUE' && r.penalDue > 0 && r.dueOn === '2026-11-15')).toBe(true);
  });

  it('does not show one society another’s members', () => {
    const queue = collectionsQueue(at(world, '2026-11-10'), 'soc_1');
    expect(queue.upcoming.every((r) => r.memberId.startsWith('mem_0'))).toBe(true);
  });
});

describe('the day’s collections', () => {
  const collected = collectAll(at(seedWorld(), '2026-11-15'));
  const totals = collectionsOn(collected, 'soc_1');

  it('counts every receipt and splits the cash exactly', () => {
    expect(totals.receipts).toBe(12);
    expect(totals.toFederation + totals.retained + totals.heldAsAdvance).toBe(totals.cashReceived);
    expect(totals.toFederation).toBe(totals.wholesaleInterest + totals.principal);
    expect(totals.margin).toBeGreaterThan(0);
    expect(totals.penalAndFees).toBe(0);
  });

  it('empties the queue', () => {
    expect(collectionsQueue(collected, 'soc_1').dueToday).toHaveLength(0);
  });
});

describe('the payment preview', () => {
  const world = at(seedWorld(), '2026-11-15');
  const due = collectionsQueue(world, 'soc_1').dueToday[0]!;

  it('previews exactly what recording the payment then posts', () => {
    const preview = previewPayment(world, due.loanId, { amount: due.amountDue, source: 'CASH', electPrepayment: false });
    expect(preview.ok).toBe(true);
    const event = paymentEvent(
      world,
      { loanId: due.loanId, amount: due.amountDue, mode: 'CASH', source: 'CASH', electPrepayment: false },
      'usr_officer',
    );
    const recorded = applyEvent(world, event).loans[due.loanId]!.receipts.at(-1)!;
    if (preview.ok) expect(preview.output.reconciliation).toEqual(recorded.reconciliation);
  });

  it('refuses more than the loan can take, and says how much it can', () => {
    const preview = previewPayment(world, due.loanId, { amount: 999_999_999, source: 'CASH', electPrepayment: false });
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.code).toBe('EXCEEDS_CEILING');
      expect(preview.maxAcceptable).toBe(preview.position.payoffAmount);
    }
  });

  it('shows what a part-prepayment does to the schedule', () => {
    const preview = previewPayment(world, due.loanId, {
      amount: due.amountDue + 1_000_000,
      source: 'CASH',
      electPrepayment: true,
    });
    expect(preview.ok && preview.reschedule).toBeTruthy();
    if (preview.ok && preview.reschedule) {
      expect(preview.reschedule.interestSaved).toBeGreaterThan(0);
      expect(preview.reschedule.lastDueOn! <= preview.reschedule.previousLastDueOn!).toBe(true);
    }
  });
});

describe('loan detail', () => {
  const world = at(seedWorld(), '2026-11-15');
  const detail = loanDetail(world, 'loan_001');

  it('marks each schedule row by where it stands today', () => {
    const statuses = detail.schedule.map((l) => l.status);
    expect(statuses.slice(0, 6).every((s) => s === 'PAID')).toBe(true);
    expect(statuses[6]).toBe('DUE_TODAY');
    expect(statuses.slice(7).every((s) => s === 'UPCOMING')).toBe(true);
  });

  it('pairs every receipt with the journal entry it posted, newest first', () => {
    expect(detail.receipts).toHaveLength(6);
    expect(detail.receipts.every((r) => r.journal?.sourceId === r.receipt.id)).toBe(true);
    expect(detail.receipts[0]!.receipt.receivedOn).toBe('2026-10-15');
    expect(detail.receipts[0]!.recordedByName).toBe('Karthik Rajan');
  });

  it('totals the margin kept from the loan', () => {
    const margins = sum(detail.receipts.map((r) => r.receipt.reconciliation.society.netInterestIncome));
    expect(detail.totals.marginRetained).toBe(margins);
    expect(detail.totals.interestPaid - detail.totals.wholesaleShare).toBe(margins);
  });
});

describe('the member’s own loan', () => {
  const world = seedWorld();

  it('refuses a loan that is not theirs', () => {
    expect(() => memberLoanDetail(world, 'loan_002', 'mem_001')).toThrow(NotYourLoanError);
  });

  it('carries nothing about the federation or the society’s margin', () => {
    const detail = memberLoanDetail(world, 'loan_001', 'mem_001');
    expect(detail.payments).toHaveLength(6);
    expect(JSON.stringify(detail)).not.toMatch(/wholesale|margin|federation|remittance/i);
  });
});

describe('remittances', () => {
  it('lists the society’s tranche with its next remittance', () => {
    const [summary] = trancheSummaries(seedWorld(), 'soc_1');
    expect(summary).toMatchObject({ fundedLoans: 12, activeLoans: 12 });
    expect(summary!.next).toMatchObject({ dueOn: '2026-11-15', overdue: false });
  });

  it('cannot be recorded before its date', () => {
    expect(remittancePreview(seedWorld(), 'trn_01')).toMatchObject({ dueOn: '2026-11-15', canRecord: false });
  });

  it('says the reserves must cover all of it before anyone has paid', () => {
    const preview = remittancePreview(at(seedWorld(), '2026-11-15'), 'trn_01')!;
    expect(preview.collectedSinceLast.receipts).toBe(0);
    expect(preview.fromReserves).toBe(preview.due.totalDue);
  });

  it('is covered by the members once they pay, give or take a paise of rounding per loan', () => {
    const preview = remittancePreview(collectAll(at(seedWorld(), '2026-11-15')), 'trn_01')!;
    expect(preview.collectedSinceLast.receipts).toBe(12);
    expect(Math.abs(preview.due.totalDue - preview.collectedSinceLast.toFederation)).toBeLessThanOrEqual(12);
    expect(preview.fromReserves).toBeLessThanOrEqual(12);
    expect(preview.collectedSinceLast.margin).toBeGreaterThan(0);
  });
});

describe('tranche detail', () => {
  const detail = trancheDetail(seedWorld(), 'trn_01');

  it('accounts for the margin period by period', () => {
    expect(detail.history).toHaveLength(6);
    expect(sum(detail.history.map((p) => p.margin))).toBe(detail.totals.marginRetained);
    expect(detail.history.every((p) => p.carriedForward === 0)).toBe(true);
  });

  it('projects the rest of the facility so that every rupee drawn is repaid', () => {
    const remaining = sum(detail.projection.map((p) => p.principal));
    expect(detail.totals.principalRepaid + remaining).toBe(detail.drawn);
    expect(detail.projection[0]!.dueOn).toBe('2026-11-15');
  });
});
