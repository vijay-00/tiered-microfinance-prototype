import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { positionOf } from '@/domain/world';
import { selectInvariantHealth } from '@/store/selectors';
import { renderApp } from '@/test/renderApp';

/**
 * The whole chain, end to end, through the screens alone: a member applies
 * for themselves, the society appraises, approves and pools the application,
 * the federation sanctions the pool, the society draws down and pays out,
 * the member repays, and the society remits to the federation. The member
 * follows their application on their own home screen at each step.
 */

const demoBar = () => screen.getByRole('region', { name: 'Demo controls' });
const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
type Ui = ReturnType<typeof renderApp>['user'];
const viewAs = (user: Ui, role: string) => user.selectOptions(within(demoBar()).getByRole('combobox'), role);
const tracker = () => screen.findByRole('region', { name: 'Your application' });

describe('from a member’s application to the federation’s remittance', () => {
  it('runs every step, by every role, and keeps the books whole', async () => {
    const { user, store, router } = renderApp('/dashboard');
    const world = () => store.getState().world;

    // The member applies for themselves, seeing the instalment as they type.
    await viewAs(user, 'Member');
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
    await user.click(within(sidebar()).getByRole('link', { name: 'Apply for a loan' }));
    await user.type(await screen.findByLabelText('How much do you need? (₹)'), '40000');
    const quote = screen.getByRole('region', { name: 'What you would pay' });
    expect(quote).toHaveTextContent(/₹[\d,]+ a month/);
    await user.click(screen.getByRole('button', { name: 'Send application' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
    expect(await tracker()).toHaveTextContent('Sent to the society');
    expect(await tracker()).toHaveTextContent('Next: the field officer visits to appraise it.');
    const application = world().applications.find((a) => a.memberId === 'mem_001' && a.status === 'SUBMITTED')!;
    expect(application.id).toBe('app_070');
    // Nothing on the member's screen speaks of wholesale pricing.
    expect(screen.getByRole('main')).not.toHaveTextContent(/9\.5%|wholesale|margin|federation/i);

    // The field officer finds it in the queue, appraises it and, within the limit, approves it.
    // A pop-up tells the field officer of the new proposal, and opens it.
    await viewAs(user, 'Loan Officer');
    const proposal = await screen.findByRole('dialog', { name: 'New loan proposal' });
    expect(proposal).toHaveTextContent('Veerappan Pandian has applied for ₹40,000 for trade over 12 months.');
    await user.click(within(proposal).getByRole('button', { name: 'Open the proposal' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications/app_070'));
    await user.type(await screen.findByLabelText('Monthly income (₹)'), '40000');
    expect(screen.getByText(/within the 50% cap for microfinance loans/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record appraisal' }));
    const decision = await screen.findByRole('region', { name: 'Decision' });
    await user.click(within(decision).getByRole('button', { name: /^Approve ₹40,000$/ }));
    expect(await screen.findByRole('heading', { name: 'Approved' })).toBeInTheDocument();

    // A pop-up tells the member it is approved; it is waiting to go for funding.
    await viewAs(user, 'Member');
    const approved = await screen.findByRole('dialog', { name: 'Your loan is approved' });
    expect(approved).toHaveTextContent('The society approved ₹40,000 for trade over 12 months.');
    await user.click(within(approved).getByRole('button', { name: 'See where it stands' }));
    expect(await tracker()).toHaveTextContent('Approved for ₹40,000.');
    expect(await tracker()).toHaveTextContent('Next: the society sends it, with others, for funding.');

    // The secretary pools it with the other approved applications and submits the pool.
    await viewAs(user, 'Society Secretary');
    await user.click(within(sidebar()).getByRole('link', { name: 'Pools' }));
    await user.click(await screen.findByRole('link', { name: 'Add to ANN/POOL/2026-27/02' }));
    const pool = await screen.findByRole('region', { name: 'The pool' });
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(within(pool).getByText('12 of 10–20 members')).toBeInTheDocument();
    await user.click(within(pool).getByRole('button', { name: 'Submit to the federation' }));
    const confirm = await screen.findByRole('dialog', { name: 'Submit ANN/POOL/2026-27/02?' });
    await user.click(within(confirm).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Waiting for the federation to take it up/)).toBeInTheDocument();

    // The federation reviews the pool and sanctions it in full.
    await viewAs(user, 'Apex Officer');
    await user.click(within(sidebar()).getByRole('link', { name: /^Funding requests/ }));
    await user.click(await screen.findByRole('link', { name: 'ANN/POOL/2026-27/02' }));
    await user.click(await screen.findByRole('button', { name: 'Begin review' }));
    const terms = await screen.findByRole('region', { name: 'Terms' });
    await user.click(within(terms).getByRole('button', { name: /^Sanction ₹7,50,000$/ }));
    expect(await screen.findByRole('heading', { name: 'Sanctioned as PACF/SAN/2026-27/022' })).toBeInTheDocument();

    // The member sees the funding approved, and waiting to be paid out.
    await viewAs(user, 'Member');
    expect(await tracker()).toHaveTextContent('Next: the money is paid out to you.');

    // The secretary draws the tranche down and pays the twelve members out.
    await viewAs(user, 'Society Secretary');
    await user.click(within(sidebar()).getByRole('link', { name: 'Funding' }));
    await user.click(await screen.findByRole('link', { name: 'PACF/SAN/2026-27/022' }));
    const waiting = await screen.findByRole('region', { name: 'Awaiting disbursement' });
    await user.click(within(waiting).getByRole('button', { name: 'Draw down and disburse' }));
    const disburse = await screen.findByRole('dialog', { name: 'Draw down and disburse' });
    await user.click(within(disburse).getByRole('button', { name: 'Disburse 12 loans' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Drew ₹7,50,000 and paid out 12 loans');
    const loan = Object.values(world().loans).find((l) => l.loan.applicationId === 'app_070')!;
    const firstDue = loan.schedule[0]!.dueOn;

    // A pop-up tells the member the loan is paid out; it has its whole-rupee instalment, and no application pending.
    await viewAs(user, 'Member');
    const paid = await screen.findByRole('dialog', { name: 'Your loan is paid out' });
    expect(paid).toHaveTextContent('₹40,000 has been paid out to you.');
    await user.click(within(paid).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const newLoan = await screen.findByRole('region', { name: 'Loan of 40000' });
    expect(within(newLoan).getByText('0 of 12')).toBeInTheDocument();
    expect(loan.loan.emi % 100).toBe(0);
    expect(screen.queryByRole('region', { name: 'Your application' })).not.toBeInTheDocument();

    // A month on, the field officer collects the first instalments.
    await viewAs(user, 'Loan Officer');
    await user.click(within(sidebar()).getByRole('link', { name: 'Collections' }));
    for (let i = 0; i < 6 && world().clock < firstDue; i += 1) {
      await user.click(within(demoBar()).getByRole('button', { name: 'Next due date' }));
    }
    expect(world().clock).toBe(firstDue);
    expect(await screen.findByRole('heading', { name: 'Due today · 12' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record all due today' }));
    const record = await screen.findByRole('dialog', { name: 'Record 12 payments?' });
    await user.click(within(record).getByRole('button', { name: 'Record 12 payments' }));
    await waitFor(() => expect(positionOf(world(), loan.loan.id).rows[0]!.principalUnpaid).toBe(0));

    // The secretary remits the federation's share of those instalments.
    await viewAs(user, 'Society Secretary');
    await act(() => router.navigate('/tranches'));
    await user.click(await screen.findByRole('link', { name: 'PACF/SAN/2026-27/022' }));
    const next = await screen.findByRole('region', { name: 'Next remittance' });
    expect(within(next).getByText(/Members have paid in enough to cover it/)).toBeInTheDocument();
    await user.click(within(next).getByRole('button', { name: 'Record remittance' }));
    const remit = await screen.findByRole('dialog', { name: 'Remit to the federation' });
    await user.click(within(remit).getByRole('button', { name: /^Remit ₹/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const tranche = Object.values(world().tranches).find((t) => t.tranche.sanctionRef === 'PACF/SAN/2026-27/022')!;
    expect(tranche.remittances).toHaveLength(1);
    expect(tranche.remittances[0]!.dueOn).toBe(firstDue);

    // The member's first instalment is paid; the books balance and every invariant holds.
    await viewAs(user, 'Member');
    expect(within(await screen.findByRole('region', { name: 'Loan of 40000' })).getByText('1 of 12')).toBeInTheDocument();
    expect(selectInvariantHealth(world()).ok).toBe(true);
  }, 60_000);

  it('lets a member apply only for themselves', async () => {
    const { store } = renderApp('/me');
    const result = store.getState().dispatch({
      type: 'APPLICATION_SUBMITTED',
      on: store.getState().world.clock,
      applicationId: 'app_900',
      memberId: 'mem_002',
      requestedAmount: 4_000_000,
      requestedTenureMonths: 12,
      purpose: 'TRADE',
      recordedBy: 'usr_member',
    });
    expect(result.ok).toBe(false);
    expect(store.getState().world.applications.some((a) => a.id === 'app_900')).toBe(false);
  });
});

describe('pop-ups about a member’s application', () => {
  it('tells the member when the society turns it down, once', async () => {
    const { user, store } = renderApp('/dashboard');
    await viewAs(user, 'Member');
    await user.click(await within(await screen.findByRole('navigation', { name: 'Main' })).findByRole('link', { name: 'Apply for a loan' }));
    await user.type(await screen.findByLabelText('How much do you need? (₹)'), '25000');
    await user.click(screen.getByRole('button', { name: 'Send application' }));
    await screen.findByRole('region', { name: 'Your application' });

    // The secretary rejects it, straight from the events the screens would post.
    const on = store.getState().world.clock;
    store.getState().switchRole('SECRETARY');
    const appraised = store.getState().dispatch({
      type: 'APPLICATION_APPRAISED', on, applicationId: 'app_070', monthlyIncome: 600_000,
      existingObligations: 0, recommendedAmount: 0, notes: 'Income too irregular', recordedBy: 'usr_secretary',
    });
    expect(appraised).toEqual({ ok: true });
    const decided = store.getState().dispatch({
      type: 'APPLICATION_DECIDED', on, applicationId: 'app_070', outcome: 'REJECTED', sanctionedAmount: 0,
      tenureMonths: 12, reason: 'income too irregular for now', recordedBy: 'usr_secretary',
    });
    expect(decided).toEqual({ ok: true });

    await viewAs(user, 'Member');
    const popup = await screen.findByRole('dialog', { name: 'Your application was not approved' });
    expect(popup).toHaveTextContent('income too irregular for now');
    await user.click(within(popup).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Seen once is enough: switching away and back does not raise it again.
    await viewAs(user, 'Loan Officer');
    await viewAs(user, 'Member');
    expect(await screen.findByRole('region', { name: 'Your application' })).toHaveTextContent('Not approved');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('raises nothing for applications taken by staff', async () => {
    const { user } = renderApp('/dashboard');
    await viewAs(user, 'Loan Officer');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
