import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS } from '@/domain/ledger';
import { fundingRequests } from '@/domain/origination';
import { memberLoanDetail, remittancePreview } from '@/domain/servicing';
import { balanceOf } from '@/domain/statements';
import { advanceToRemit, applyEvent, journalOf, WorldError, type WorldEvent } from '@/domain/world';
import type { ApplicationRoute, LoanPurpose } from '@/domain/types';
import { fieldVisits, noticesFor } from '@/domain/views';
import { advanceEvent, paymentEvent, remittanceEvent } from '@/store/commands';
import { selectInvariantHealth } from '@/store/selectors';
import { renderApp } from '@/test/renderApp';

/**
 * The real demo, as main.tsx starts it: one society, five members, nothing on
 * file. A member asks the federation directly: documents, the field officer's
 * geo-tagged visit, then the federation appraises, approves and sanctions,
 * with the General Manager and the Assistant Registrar watching. The society
 * pays it out, and a UPI payment reaches every role that needs it.
 */

const DEMO = { demo: { societyId: 'soc_1', members: 5 }, startAs: 'APEX_OFFICER' as const };
const demoBar = () => screen.getByRole('region', { name: 'Demo controls' });
const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
type Ui = ReturnType<typeof renderApp>['user'];
const viewAs = (user: Ui, role: string) => user.selectOptions(within(demoBar()).getByRole('combobox'), role);

/** Closes whatever pop-ups are showing, for the steps that are not about them. */
async function closePopups(user: Ui) {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 30));
    const dialog = screen.queryByRole('dialog');
    if (!dialog) return;
    await user.click(within(dialog).getByRole('button', { name: /^(Close|Later)$/ }));
  }
}

describe('the demo, every rung of the ladder', () => {
  it('takes a direct request to the federation from documents to a UPI payment', async () => {
    const { user, store, router } = renderApp('/', undefined, DEMO);
    const world = () => store.getState().world;
    await waitFor(() => expect(router.state.location.pathname).toBe('/apex'));

    // The member addresses it to the federation, and must attach the documents.
    await viewAs(user, 'Member');
    await user.click(within(sidebar()).getByRole('link', { name: 'Apply for a loan' }));
    await user.click(await screen.findByRole('radio', { name: /^The federation/ }));
    expect(within(screen.getByLabelText('Loan type')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Construction Loan · 11.5% a year', 'Mortgage Loan · 11.5% a year']);
    await user.selectOptions(screen.getByLabelText('Loan type'), 'MORTGAGE');
    expect(screen.getByText('A field officer visits you for this loan.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('How much do you need? (₹)'), '150000');
    await user.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByText('Attach every document to send the application.')).toBeInTheDocument();
    expect(world().applications).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Use sample files' }));
    await user.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByRole('region', { name: 'Your application' })).toHaveTextContent('To the federation');
    expect(world().applications[0]).toMatchObject({ route: 'FEDERATION', selfApplied: true });
    expect(world().applications[0]!.documents).toHaveLength(5);

    // The society hears nothing: it is not the society's to decide.
    await viewAs(user, 'Society Secretary');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(within(sidebar()).getByRole('link', { name: /^Applications/ }));
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Veerappan Pandian' })).not.toBeInTheDocument();

    // The federation hears, and cannot appraise before the visit.
    await viewAs(user, 'Apex Officer');
    const direct = await screen.findByRole('dialog', { name: 'A member applied to the federation' });
    expect(direct).toHaveTextContent('The field officer visits first');
    await user.click(within(direct).getByRole('button', { name: 'Open the proposal' }));
    expect(await screen.findByText('Waiting for the field officer to visit the member.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record appraisal' })).not.toBeInTheDocument();
    await user.click(within(sidebar()).getByRole('link', { name: /^Funding requests/ }));
    expect(await screen.findByRole('region', { name: 'Direct applications' })).toHaveTextContent('Waiting for the field visit');

    // The field officer is told, goes, captures the geo-tag and adds a photo.
    await viewAs(user, 'Field Officer');
    await waitFor(() => expect(router.state.location.pathname).toBe('/visits'));
    const proposal = await screen.findByRole('dialog', { name: 'New loan proposal' });
    await user.click(within(proposal).getByRole('button', { name: 'Start the visit' }));
    await user.click(await screen.findByRole('button', { name: 'Capture location' }));
    expect(await screen.findByText('Demo location')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a sample photo' }));
    await user.type(screen.getByLabelText('3 · What you saw'), 'Shop open, stock as stated');
    await user.click(screen.getByRole('button', { name: 'Complete visit' }));
    await waitFor(() => expect(world().applications[0]!.fieldVisit).toBeDefined());
    expect(world().applications[0]!.fieldVisit).toMatchObject({ officerId: 'usr_officer', locationSource: 'DEMO' });

    // The secretary still hears nothing.
    await viewAs(user, 'Society Secretary');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The federation is told, sees the visit, appraises and approves, and goes on to the terms.
    await viewAs(user, 'Apex Officer');
    const visited = await screen.findByRole('dialog', { name: 'Field visit done' });
    await user.click(within(visited).getByRole('button', { name: 'Open the proposal' }));
    expect(await screen.findByRole('region', { name: 'Field visit' })).toHaveTextContent('Shop open, stock as stated');
    expect(screen.getByRole('region', { name: 'Documents' })).toHaveTextContent('Aadhaar card');
    await user.type(await screen.findByLabelText('Monthly income (₹)'), '80000');
    await user.click(screen.getByRole('button', { name: 'Record appraisal' }));
    const decision = await screen.findByRole('region', { name: 'Decision' });
    await user.click(within(decision).getByRole('button', { name: /^Approve ₹1,50,000$/ }));
    await waitFor(() => expect(world().pools).toHaveLength(1));
    expect(world().pools[0]).toMatchObject({ status: 'UNDER_APEX_REVIEW', applicationIds: ['app_001'] });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/apex/requests/${world().pools[0]!.id}`));
    expect(await screen.findByRole('region', { name: 'Terms' })).toBeInTheDocument();

    // The General Manager and the Assistant Registrar see it and can change nothing.
    for (const role of ['General Manager', 'Assistant Registrar']) {
      await viewAs(user, role);
      expect(await within(sidebar().parentElement!).findByText('Read only')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Terms' })).not.toBeInTheDocument());
      expect(await screen.findByRole('region', { name: 'The request' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }

    // The apex officer sanctions any amount, and is told nothing they did not ask for.
    await viewAs(user, 'Apex Officer');
    const terms = await screen.findByRole('region', { name: 'Terms' });
    await user.click(within(terms).getByRole('button', { name: /^Sanction ₹1,50,000$/ }));
    await waitFor(() => expect(Object.values(world().tranches)).toHaveLength(1));
    expect(Object.values(world().tranches)[0]!.tranche.sanctionedAmount).toBe(15_000_000);
    expect(await screen.findByRole('heading', { name: /^Sanctioned as/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The secretary draws down and pays out.
    await viewAs(user, 'Society Secretary');
    await closePopups(user);
    await user.click(within(sidebar()).getByRole('link', { name: /^Funding/ }));
    await user.click(await screen.findByRole('link', { name: /^PACF\/SAN/ }));
    const waiting = await screen.findByRole('region', { name: 'Awaiting disbursement' });
    await user.click(within(waiting).getByRole('button', { name: 'Draw down and disburse' }));
    const disburse = await screen.findByRole('dialog', { name: 'Draw down and disburse' });
    await user.click(within(disburse).getByRole('button', { name: 'Disburse 1 loan' }));
    await waitFor(() => expect(Object.values(world().loans)).toHaveLength(1));
    await user.keyboard('{Escape}');

    // The member pays by UPI: payment successful, a real receipt.
    await viewAs(user, 'Member');
    await closePopups(user);
    await user.click(await screen.findByRole('button', { name: 'Pay now' }));
    const pay = await screen.findByRole('dialog', { name: 'Make a payment' });
    await user.click(within(pay).getByRole('button', { name: 'Continue' }));
    const upi = await screen.findByRole('dialog', { name: 'Pay by UPI' });
    await user.click(within(upi).getByRole('button', { name: /^Pay ₹/ }));
    const done = await screen.findByRole('dialog', { name: 'Payment successful' });
    expect(done).toHaveTextContent('UPI reference');
    await user.click(within(done).getByRole('button', { name: 'Done' }));
    const receipt = Object.values(world().loans)[0]!.receipts[0]!;
    expect(receipt).toMatchObject({ mode: 'UPI', recordedBy: 'usr_member' });

    // The society hears at once, and the books hold.
    await viewAs(user, 'Society Secretary');
    const paid = await screen.findByRole('dialog', { name: 'Payment received by UPI' });
    expect(paid).toHaveTextContent('Veerappan Pandian paid');
    await closePopups(user);

    // Paid before it fell due: the society can send it on to the federation now.
    await user.click(within(sidebar()).getByRole('link', { name: /^Funding/ }));
    await user.click(await screen.findByRole('link', { name: /^PACF\/SAN/ }));
    const next = await screen.findByRole('region', { name: 'Next remittance' });
    await user.click(within(next).getByRole('button', { name: 'Pay advance to the federation' }));
    const send = await screen.findByRole('dialog', { name: 'Pay advance to the federation' });
    await user.click(within(send).getByRole('button', { name: /^Pay ₹/ }));
    await waitFor(() => expect(Object.values(world().tranches)[0]!.advancePaid).toBe(receipt.amount));
    expect(within(next).getByText('Already paid in advance')).toBeInTheDocument();
    expect(within(next).queryByRole('button', { name: 'Pay advance to the federation' })).not.toBeInTheDocument();

    // The member's schedule shows it paid.
    await viewAs(user, 'Member');
    await closePopups(user);
    await user.click(await screen.findByRole('link', { name: /schedule/i }));
    const schedule = await screen.findByRole('table', { name: 'Your repayment schedule' });
    expect(within(schedule).getByRole('columnheader', { name: 'Paid' })).toBeInTheDocument();
    expect(within(schedule).getAllByRole('row')[1]).toHaveTextContent('in advance');
    expect(within(schedule).getAllByRole('row')[1]).toHaveTextContent('Paid');
    expect(selectInvariantHealth(world()).ok).toBe(true);
  }, 60_000);

  it('leaves a society’s batch with the secretary until it is submitted', async () => {
    const { store, user } = renderApp('/applications/app_900', (s) => {
      const on = s.getState().world.clock;
      s.getState().dispatchMany([
        { type: 'APPLICATION_SUBMITTED', on, applicationId: 'app_900', memberId: 'mem_001', requestedAmount: 4_000_000, requestedTenureMonths: 24, purpose: 'MORTGAGE', recordedBy: 'usr_member' },
        { type: 'FIELD_VISIT_RECORDED', on, applicationId: 'app_900', lat: 10, lng: 78, accuracyMetres: 12, locationSource: 'DEMO', notes: '', documents: [], recordedBy: 'usr_officer' },
        { type: 'APPLICATION_APPRAISED', on, applicationId: 'app_900', monthlyIncome: 6_000_000, existingObligations: 0, recommendedAmount: 4_000_000, notes: '', recordedBy: 'usr_secretary' },
      ]);
      s.getState().switchUser('usr_secretary');
    }, DEMO);
    await closePopups(user);
    const decision = await screen.findByRole('region', { name: 'Decision' });
    await user.click(within(decision).getByRole('button', { name: /^Approve ₹40,000$/ }));
    await waitFor(() => expect(store.getState().world.applications.at(-1)!.status).toBe('APPROVED'));
    expect(store.getState().world.pools).toHaveLength(0);
    expect(fundingRequests(store.getState().world)).toHaveLength(0);
  });
});

/** The first of the month after next, a date an instalment can fall due. */
const remittancePreviewDate = (on: string) => {
  const d = new Date(`${on}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 1)).toISOString().slice(0, 10);
};

describe('the ladder’s rules, in the reducer', () => {
  const start = (purpose: LoanPurpose = 'MORTGAGE', requestedAmount = 4_000_000, route: ApplicationRoute = 'SOCIETY') => {
    const { store } = renderApp('/', undefined, DEMO);
    const on = store.getState().world.clock;
    const apply: WorldEvent = {
      type: 'APPLICATION_SUBMITTED', on, applicationId: 'app_900', memberId: 'mem_001',
      requestedAmount, requestedTenureMonths: 24, purpose, route, recordedBy: 'usr_member',
    };
    return { store, on, world: applyEvent(store.getState().world, apply) };
  };
  const appraise = (on: string, recordedBy: string): WorldEvent => ({
    type: 'APPLICATION_APPRAISED', on, applicationId: 'app_900', monthlyIncome: 6_000_000,
    existingObligations: 0, recommendedAmount: 4_000_000, notes: '', recordedBy,
  });
  const visit = (on: string, recordedBy: string): WorldEvent => ({
    type: 'FIELD_VISIT_RECORDED', on, applicationId: 'app_900', lat: 10, lng: 78, accuracyMetres: 12,
    locationSource: 'DEMO', notes: '', documents: [], recordedBy,
  });

  it('holds the appraisal until the field officer has visited', () => {
    const { world, on } = start();
    expect(() => applyEvent(world, appraise(on, 'usr_secretary'))).toThrow(/must visit the member/);
    expect(applyEvent(applyEvent(world, visit(on, 'usr_officer')), appraise(on, 'usr_secretary')).applications.at(-1)!.status).toBe('UNDER_APPRAISAL');
  });

  it.each(['JEWEL', 'FD'] as const)('sends a %s loan straight to appraisal, with no visit', (purpose) => {
    const { world, on } = start(purpose);
    expect(applyEvent(world, appraise(on, 'usr_secretary')).applications.at(-1)!.status).toBe('UNDER_APPRAISAL');
    expect(() => applyEvent(world, visit(on, 'usr_officer'))).toThrow(/only construction and mortgage/);
    expect(fieldVisits(world, 'soc_1').due).toHaveLength(0);
    expect(noticesFor(world, 'usr_officer')).toHaveLength(0);
    expect(noticesFor(world, 'usr_secretary').map((n) => n.kind)).toEqual(['PROPOSAL']);
  });

  it.each(['CONSTRUCTION', 'MORTGAGE'] as const)('requires a visit for a %s loan', (purpose) => {
    const { world, on } = start(purpose);
    expect(() => applyEvent(world, appraise(on, 'usr_secretary'))).toThrow(/must visit the member/);
    expect(fieldVisits(world, 'soc_1').due).toHaveLength(1);
    expect(noticesFor(world, 'usr_officer').map((n) => n.kind)).toEqual(['VISIT_DUE']);
    expect(noticesFor(world, 'usr_secretary')).toHaveLength(0);
  });

  it('takes a loan of the full Rs 50,00,000 from application to payout, and no more', () => {
    const MAX = 500_000_000;
    const { world, on } = start('CONSTRUCTION', MAX);
    expect(world.policy.maxTicket).toBe(MAX);
    const steps: WorldEvent[] = [
      visit(on, 'usr_officer'),
      { type: 'APPLICATION_APPRAISED', on, applicationId: 'app_900', monthlyIncome: 800_000_000, existingObligations: 0, recommendedAmount: MAX, notes: '', recordedBy: 'usr_secretary' },
      { type: 'APPLICATION_DECIDED', on, applicationId: 'app_900', outcome: 'APPROVED', sanctionedAmount: MAX, tenureMonths: 24, recordedBy: 'usr_secretary' },
      { type: 'POOL_CREATED', on, poolId: 'pool_90', reference: 'ANN/BATCH/TEST/01', applicationIds: ['app_900'], recordedBy: 'usr_secretary' },
      { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'SUBMITTED', recordedBy: 'usr_secretary' },
      { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'UNDER_APEX_REVIEW', recordedBy: 'usr_apex' },
      { type: 'TRANCHE_SANCTIONED', on, trancheId: 'trn_90', poolId: 'pool_90', sanctionRef: 'PACF/SAN/TEST/01', sanctionedAmount: MAX, wholesaleRateBps: 950, tenureMonths: 24, remarks: '', recordedBy: 'usr_apex' },
      { type: 'TRANCHE_DRAWN', on, trancheId: 'trn_90', amount: MAX, recordedBy: 'usr_secretary' },
      { type: 'LOAN_DISBURSED', on, loanId: 'loan_900', applicationId: 'app_900', trancheId: 'trn_90', firstDueOn: '2027-01-01', recordedBy: 'usr_secretary' },
    ];
    const paidOut = steps.reduce(applyEvent, world);
    expect(paidOut.loans.loan_900!.loan.principal).toBe(MAX);
    expect(() => start('CONSTRUCTION', MAX + 100)).toThrow(/a loan must be between ₹5,000 and ₹50,00,000/);
  });

  it('gives an application addressed to the federation to the federation alone', () => {
    const { world, on } = start('MORTGAGE', 4_000_000, 'FEDERATION');
    expect(noticesFor(world, 'usr_apex').map((n) => n.kind)).toEqual(['DIRECT']);
    expect(noticesFor(world, 'usr_secretary')).toHaveLength(0);
    const visited = applyEvent(world, visit(on, 'usr_officer'));
    expect(noticesFor(visited, 'usr_apex').map((n) => n.kind)).toEqual(['VISITED']);
    expect(noticesFor(visited, 'usr_secretary')).toHaveLength(0);
    expect(() => applyEvent(visited, appraise(on, 'usr_secretary'))).toThrow(WorldError);
    expect(() => applyEvent(visited, appraise(on, 'usr_gm'))).toThrow(WorldError);
    expect(applyEvent(visited, appraise(on, 'usr_apex')).applications.at(-1)!.status).toBe('UNDER_APPRAISAL');
  });

  it('keeps the apex officer out of an application addressed to the society', () => {
    const { world, on } = start();
    expect(() => applyEvent(applyEvent(world, visit(on, 'usr_officer')), appraise(on, 'usr_apex'))).toThrow(WorldError);
  });

  it('sends members’ advances to the federation, and the next remittance falls by that much', () => {
    const { store, on, world: applied } = start('MORTGAGE', 4_000_000);
    const state = () => store.getState().world;
    store.getState().dispatch({ type: 'APPLICATION_SUBMITTED', on, applicationId: 'app_900', memberId: 'mem_001', requestedAmount: 4_000_000, requestedTenureMonths: 24, purpose: 'MORTGAGE', recordedBy: 'usr_member' });
    expect(state().applications).toHaveLength(applied.applications.length);
    const loaned = store.getState().dispatchMany([
      visit(on, 'usr_officer'),
      appraise(on, 'usr_secretary'),
      { type: 'APPLICATION_DECIDED', on, applicationId: 'app_900', outcome: 'APPROVED', sanctionedAmount: 4_000_000, tenureMonths: 24, recordedBy: 'usr_secretary' },
      { type: 'POOL_CREATED', on, poolId: 'pool_90', reference: 'ANN/BATCH/TEST/01', applicationIds: ['app_900'], recordedBy: 'usr_secretary' },
      { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'SUBMITTED', recordedBy: 'usr_secretary' },
      { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'UNDER_APEX_REVIEW', recordedBy: 'usr_apex' },
      { type: 'TRANCHE_SANCTIONED', on, trancheId: 'trn_90', poolId: 'pool_90', sanctionRef: 'PACF/SAN/TEST/01', sanctionedAmount: 4_000_000, wholesaleRateBps: 950, tenureMonths: 24, remarks: '', recordedBy: 'usr_apex' },
      { type: 'TRANCHE_DRAWN', on, trancheId: 'trn_90', amount: 4_000_000, recordedBy: 'usr_secretary' },
      { type: 'LOAN_DISBURSED', on, loanId: 'loan_900', applicationId: 'app_900', trancheId: 'trn_90', firstDueOn: remittancePreviewDate(on), recordedBy: 'usr_secretary' },
    ]);
    expect(loaned).toEqual({ ok: true });

    // A member pays the first instalment, broken period and all, before it falls due.
    const emi = state().loans.loan_900!.schedule[0]!.instalment;
    const pay = paymentEvent(state(), { loanId: 'loan_900', amount: emi, mode: 'UPI', source: 'CASH', electPrepayment: false }, 'usr_member');
    expect(store.getState().dispatch(pay)).toEqual({ ok: true });
    expect(advanceToRemit(state(), 'trn_90')).toBe(emi);
    const first = memberLoanDetail(state(), 'loan_900', 'mem_001').schedule[0]!;
    expect(first).toMatchObject({ status: 'PAID', paid: first.row.instalment, inAdvance: first.row.instalment, unpaid: 0 });

    // No more than is held, and only the secretary.
    const cash = () => balanceOf(journalOf(state(), 'soc_1'), ACCOUNTS.CASH);
    const held = () => balanceOf(journalOf(state(), 'soc_1'), ACCOUNTS.ADVANCE_TO_FEDERATION);
    expect(store.getState().dispatch(advanceEvent(state(), { trancheId: 'trn_90', amount: emi + 1 }, 'usr_secretary')).ok).toBe(false);
    expect(store.getState().dispatch(advanceEvent(state(), { trancheId: 'trn_90', amount: emi }, 'usr_apex')).ok).toBe(false);

    const cashBefore = cash();
    expect(store.getState().dispatch(advanceEvent(state(), { trancheId: 'trn_90', amount: emi }, 'usr_secretary'))).toEqual({ ok: true });
    expect(cash()).toBe(cashBefore - emi);
    expect(held()).toBe(emi);
    expect(advanceToRemit(state(), 'trn_90')).toBe(0);
    expect(memberLoanDetail(state(), 'loan_900', 'mem_001').schedule[0]!.status).toBe('PAID');

    // On the date the society pays only what is left.
    const preview = remittancePreview(state(), 'trn_90')!;
    expect(preview.advancePaid).toBe(emi);
    expect(preview.payNow).toBe(Math.max(0, preview.due.totalDue - emi));
    expect(store.getState().advanceClock(preview.dueOn)).toEqual({ ok: true });
    const due = remittancePreview(state(), 'trn_90')!;
    // The member paid early, so the instalment is simply met on its day.
    const onTheDay = memberLoanDetail(state(), 'loan_900', 'mem_001');
    expect(onTheDay.schedule[0]).toMatchObject({ status: 'PAID', inAdvance: 0, unpaid: 0 });
    expect(onTheDay.dueNow).toBe(0);
    expect(onTheDay.payments).toHaveLength(1);
    expect(due.fromReserves).toBe(0);
    const cashOnTheDay = cash();
    const remit = remittanceEvent(state(), { trancheId: 'trn_90', dueOn: due.dueOn, interestPaid: due.due.interestDue, principalPaid: due.due.principalDue }, 'usr_secretary');
    expect(store.getState().dispatch(remit)).toEqual({ ok: true });
    const fromAdvance = Math.min(emi, due.due.totalDue);
    expect(cash()).toBe(cashOnTheDay - (due.due.totalDue - fromAdvance));
    expect(held()).toBe(emi - fromAdvance);
    expect(state().tranches.trn_90!.advancePaid).toBe(emi - fromAdvance);
    expect(advanceToRemit(state(), 'trn_90')).toBe(0);
    expect(selectInvariantHealth(state()).ok).toBe(true);
  });

  it('never lets the same advance go to the federation twice', () => {
    const { store, on } = start();
    const state = () => store.getState().world;
    const events: WorldEvent[] = [
      { type: 'APPLICATION_SUBMITTED', on, applicationId: 'app_900', memberId: 'mem_001', requestedAmount: 4_000_000, requestedTenureMonths: 24, purpose: 'MORTGAGE', recordedBy: 'usr_member' },
      visit(on, 'usr_officer'),
      appraise(on, 'usr_secretary'),
      { type: 'APPLICATION_DECIDED', on, applicationId: 'app_900', outcome: 'APPROVED', sanctionedAmount: 4_000_000, tenureMonths: 24, recordedBy: 'usr_secretary' },
      { type: 'POOL_CREATED', on, poolId: 'pool_90', reference: 'ANN/BATCH/TEST/01', applicationIds: ['app_900'], recordedBy: 'usr_secretary' },
      { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'SUBMITTED', recordedBy: 'usr_secretary' },
      { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'UNDER_APEX_REVIEW', recordedBy: 'usr_apex' },
      { type: 'TRANCHE_SANCTIONED', on, trancheId: 'trn_90', poolId: 'pool_90', sanctionRef: 'PACF/SAN/TEST/01', sanctionedAmount: 4_000_000, wholesaleRateBps: 950, tenureMonths: 24, remarks: '', recordedBy: 'usr_apex' },
      { type: 'TRANCHE_DRAWN', on, trancheId: 'trn_90', amount: 4_000_000, recordedBy: 'usr_secretary' },
      { type: 'LOAN_DISBURSED', on, loanId: 'loan_900', applicationId: 'app_900', trancheId: 'trn_90', firstDueOn: remittancePreviewDate(on), recordedBy: 'usr_secretary' },
    ];
    expect(store.getState().dispatchMany(events)).toEqual({ ok: true });
    const paying = state().loans.loan_900!.schedule[0]!.instalment;
    store.getState().dispatch(paymentEvent(state(), { loanId: 'loan_900', amount: paying, mode: 'UPI', source: 'CASH', electPrepayment: false }, 'usr_member'));
    store.getState().dispatch(advanceEvent(state(), { trancheId: 'trn_90', amount: paying }, 'usr_secretary'));

    // Even with the advance not yet applied, and the remittance using it up.
    const dueOn = remittancePreview(state(), 'trn_90')!.dueOn;
    store.getState().dispatch({ type: 'CLOCK_ADVANCED', to: dueOn });
    const due = remittancePreview(state(), 'trn_90')!.due;
    store.getState().dispatch(remittanceEvent(state(), { trancheId: 'trn_90', dueOn, interestPaid: due.interestDue, principalPaid: due.principalDue }, 'usr_secretary'));
    expect(advanceToRemit(state(), 'trn_90')).toBe(0);
    expect(store.getState().dispatch(advanceEvent(state(), { trancheId: 'trn_90', amount: 100 }, 'usr_secretary')).ok).toBe(false);
    expect(selectInvariantHealth(state()).ok).toBe(true);
  });

  it('lets only the apex officer sanction, at any amount', () => {
    const { world, on } = start('MORTGAGE', 4_000_000);
    const ready = ([
      visit(on, 'usr_officer'),
      appraise(on, 'usr_secretary'),
      { type: 'APPLICATION_DECIDED', on, applicationId: 'app_900', outcome: 'APPROVED', sanctionedAmount: 4_000_000, tenureMonths: 24, recordedBy: 'usr_secretary' },
      { type: 'POOL_CREATED', on, poolId: 'pool_90', reference: 'ANN/BATCH/TEST/01', applicationIds: ['app_900'], recordedBy: 'usr_secretary' },
      { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'SUBMITTED', recordedBy: 'usr_secretary' },
    ] as WorldEvent[]).reduce(applyEvent, world);
    const review = (recordedBy: string): WorldEvent => ({ type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'UNDER_APEX_REVIEW', recordedBy });
    expect(() => applyEvent(ready, review('usr_gm'))).toThrow(/cannot review a batch/);
    expect(() => applyEvent(ready, review('usr_registrar'))).toThrow(WorldError);
    const reviewing = applyEvent(ready, review('usr_apex'));
    const sanction = (recordedBy: string): WorldEvent => ({ type: 'TRANCHE_SANCTIONED', on, trancheId: 'trn_90', poolId: 'pool_90', sanctionRef: 'PACF/SAN/TEST/01', sanctionedAmount: 4_000_000, wholesaleRateBps: 950, tenureMonths: 24, remarks: '', recordedBy });
    expect(() => applyEvent(reviewing, sanction('usr_gm'))).toThrow(/cannot review a batch/);
    expect(applyEvent(reviewing, sanction('usr_apex')).tranches.trn_90).toBeDefined();
    // Nobody at the federation gets a pop-up for what they just did.
    expect(noticesFor(applyEvent(reviewing, sanction('usr_apex')), 'usr_apex')).toHaveLength(0);
    expect(noticesFor(applyEvent(reviewing, sanction('usr_apex')), 'usr_gm')).toHaveLength(0);
  });

  it('keeps the field officer to the visit, and the visit to the field officer', () => {
    const { world, on } = start();
    const visited = applyEvent(world, visit(on, 'usr_officer'));
    expect(() => applyEvent(visited, appraise(on, 'usr_officer'))).toThrow(/visits members in the field/);
    expect(() => applyEvent(world, visit(on, 'usr_secretary'))).toThrow(WorldError);
    expect(() => applyEvent(visited, visit(on, 'usr_officer'))).toThrow(/already been visited/);
  });
});
