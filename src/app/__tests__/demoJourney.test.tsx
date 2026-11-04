import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorldError, type WorldEvent } from '@/domain/world';
import { applyEvent } from '@/domain/world';
import type { LoanPurpose } from '@/domain/types';
import { fieldVisits, noticesFor } from '@/domain/views';
import { selectInvariantHealth } from '@/store/selectors';
import { renderApp } from '@/test/renderApp';

/**
 * The real demo, as main.tsx starts it: one society, five members, nothing on
 * file. A member asks the federation directly for more than the apex officer
 * may sanction, so the application climbs every rung: documents, the field
 * officer's geo-tagged visit, the secretary, the General Manager, then payout
 * and a UPI payment that every other role sees.
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

    // The federation hears, and can watch it climb.
    await viewAs(user, 'Apex Officer');
    expect(await screen.findByRole('dialog', { name: 'A member applied to the federation' })).toBeInTheDocument();
    await closePopups(user);
    await user.click(within(sidebar()).getByRole('link', { name: /^Funding requests/ }));
    expect(await screen.findByRole('region', { name: 'Direct applications on their way' })).toHaveTextContent('Veerappan Pandian');

    // The secretary cannot appraise before the visit.
    await viewAs(user, 'Society Secretary');
    await closePopups(user);
    await user.click(within(sidebar()).getByRole('link', { name: /^Applications/ }));
    await user.click(await screen.findByRole('link', { name: 'Veerappan Pandian' }));
    expect(await screen.findByText('Waiting for the field officer to visit the member.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record appraisal' })).not.toBeInTheDocument();

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

    // The secretary is told, sees the visit, appraises and approves; it goes up on its own.
    await viewAs(user, 'Society Secretary');
    const visited = await screen.findByRole('dialog', { name: 'Field visit done' });
    await user.click(within(visited).getByRole('button', { name: 'Open the proposal' }));
    expect(await screen.findByRole('region', { name: 'Field visit' })).toHaveTextContent('Shop open, stock as stated');
    expect(screen.getByRole('region', { name: 'Documents' })).toHaveTextContent('Aadhaar card');
    await user.type(await screen.findByLabelText('Monthly income (₹)'), '80000');
    await user.click(screen.getByRole('button', { name: 'Record appraisal' }));
    const decision = await screen.findByRole('region', { name: 'Decision' });
    await user.click(within(decision).getByRole('button', { name: /^Approve ₹1,50,000$/ }));
    await waitFor(() => expect(world().pools).toHaveLength(1));
    expect(world().pools[0]).toMatchObject({ status: 'SUBMITTED', applicationIds: ['app_001'] });

    // Above the apex officer's limit: they can review, not sanction.
    await viewAs(user, 'Apex Officer');
    await closePopups(user);
    await user.click(within(sidebar()).getByRole('link', { name: /^Funding requests/ }));
    expect(await screen.findByText('Member’s direct request')).toBeInTheDocument();
    await user.click(await screen.findByRole('link', { name: world().pools[0]!.reference }));
    await user.click(await screen.findByRole('button', { name: 'Begin review' }));
    const terms = await screen.findByRole('region', { name: 'Terms' });
    expect(terms).toHaveTextContent('Above your ₹1,00,000 limit');
    expect(within(terms).getByRole('button', { name: /^Sanction ₹1,50,000$/ })).toBeDisabled();

    // The Assistant Registrar sees it and can change nothing.
    await viewAs(user, 'Assistant Registrar');
    expect(await within(sidebar().parentElement!).findByText('Read only')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Terms' })).not.toBeInTheDocument());
    expect(await screen.findByRole('region', { name: 'The request' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The General Manager is told, and sanctions.
    await viewAs(user, 'General Manager');
    const needed = await screen.findByRole('dialog', { name: 'A batch needs your sanction' });
    await user.click(within(needed).getByRole('button', { name: 'Open the request' }));
    const gmTerms = await screen.findByRole('region', { name: 'Terms' });
    expect(gmTerms).not.toHaveTextContent('Above your');
    await user.click(within(gmTerms).getByRole('button', { name: /^Sanction ₹1,50,000$/ }));
    await waitFor(() => expect(Object.values(world().tranches)).toHaveLength(1));
    expect(Object.values(world().tranches)[0]!.tranche.sanctionedAmount).toBe(15_000_000);

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
    expect(selectInvariantHealth(world()).ok).toBe(true);
  }, 60_000);
});

describe('the ladder’s rules, in the reducer', () => {
  const start = (purpose: LoanPurpose = 'MORTGAGE', requestedAmount = 4_000_000) => {
    const { store } = renderApp('/', undefined, DEMO);
    const on = store.getState().world.clock;
    const apply: WorldEvent = {
      type: 'APPLICATION_SUBMITTED', on, applicationId: 'app_900', memberId: 'mem_001',
      requestedAmount, requestedTenureMonths: 24, purpose, recordedBy: 'usr_member',
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
      { type: 'TRANCHE_SANCTIONED', on, trancheId: 'trn_90', poolId: 'pool_90', sanctionRef: 'PACF/SAN/TEST/01', sanctionedAmount: MAX, wholesaleRateBps: 950, tenureMonths: 24, remarks: '', recordedBy: 'usr_gm' },
      { type: 'TRANCHE_DRAWN', on, trancheId: 'trn_90', amount: MAX, recordedBy: 'usr_secretary' },
      { type: 'LOAN_DISBURSED', on, loanId: 'loan_900', applicationId: 'app_900', trancheId: 'trn_90', firstDueOn: '2027-01-01', recordedBy: 'usr_secretary' },
    ];
    const paidOut = steps.reduce(applyEvent, world);
    expect(paidOut.loans.loan_900!.loan.principal).toBe(MAX);
    expect(() => start('CONSTRUCTION', MAX + 100)).toThrow(/a loan must be between ₹5,000 and ₹50,00,000/);
  });

  it('keeps the field officer to the visit, and the visit to the field officer', () => {
    const { world, on } = start();
    const visited = applyEvent(world, visit(on, 'usr_officer'));
    expect(() => applyEvent(visited, appraise(on, 'usr_officer'))).toThrow(/visits members in the field/);
    expect(() => applyEvent(world, visit(on, 'usr_secretary'))).toThrow(WorldError);
    expect(() => applyEvent(visited, visit(on, 'usr_officer'))).toThrow(/already been visited/);
  });
});
