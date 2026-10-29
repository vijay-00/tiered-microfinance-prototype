import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { journalOf } from '@/domain/world';
import { selectInvariantHealth } from '@/store/selectors';
import { renderApp } from '@/test/renderApp';

/**
 * The Phase 4 gate, from the TDD: a loan goes from a member's application to a
 * disbursed, scheduled, serviceable loan with correct journal entries at every
 * step. Driven through the screens alone, by each role in turn.
 */

const demoBar = () => screen.getByRole('region', { name: 'Demo controls' });
const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
type Ui = ReturnType<typeof renderApp>['user'];
const viewAs = (user: Ui, role: string) => user.selectOptions(within(demoBar()).getByRole('combobox'), role);

describe('origination, through the screens', () => {
  it('takes a member from application to a disbursed loan', async () => {
    const { user, store, router } = renderApp('/applications/new');
    const journalBefore = journalOf(store.getState().world, 'soc_1').length;

    // The field officer takes the application, with the EMI shown as it is typed.
    await viewAs(user, 'Loan Officer');
    await user.selectOptions(await screen.findByLabelText('Member'), 'mem_030');
    await user.type(screen.getByLabelText('Amount (₹)'), '40000');
    const quote = screen.getByRole('region', { name: 'What the member would pay' });
    expect(within(quote).getByText('Monthly instalment')).toBeInTheDocument();
    expect(within(quote).getByText('Officer can decide')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('heading', { name: 'Deepa Duraisamy' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/applications/app_070');

    // Appraises it, seeing the repayment burden against the cap.
    await user.type(screen.getByLabelText('Monthly income (₹)'), '18000');
    expect(screen.getByText(/within the 50% cap for microfinance loans/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record appraisal' }));

    // And, being within the officer limit, approves it.
    const decision = await screen.findByRole('region', { name: 'Decision' });
    await user.click(within(decision).getByRole('button', { name: /^Approve ₹40,000\.00$/ }));
    expect(await screen.findByRole('heading', { name: 'Approved' })).toBeInTheDocument();
    expect(screen.getByText(/Waiting to be pooled/)).toBeInTheDocument();
    expect(journalOf(store.getState().world, 'soc_1')).toHaveLength(journalBefore);

    // The secretary adds it, and the other approved applications, to the open pool and submits it.
    await viewAs(user, 'Society Secretary');
    await user.click(within(sidebar()).getByRole('link', { name: 'Pools' }));
    await user.click(await screen.findByRole('link', { name: 'Add to ANN/POOL/2026-27/02' }));
    const pool = await screen.findByRole('region', { name: 'The pool' });
    expect(within(pool).getByText('8 of 10–20 members')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(within(pool).getByText('12 of 10–20 members')).toBeInTheDocument();
    expect(within(pool).getByText('Kept by the society, a 2% spread')).toBeInTheDocument();
    await user.click(within(pool).getByRole('button', { name: 'Submit to the federation' }));
    const confirm = await screen.findByRole('dialog', { name: 'Submit ANN/POOL/2026-27/02?' });
    await user.click(within(confirm).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Waiting for the federation to take it up/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/pools/pool_04');

    // The federation takes it up and sanctions it in full.
    await viewAs(user, 'Apex Officer');
    await user.click(within(sidebar()).getByRole('link', { name: /^Funding requests/ }));
    await user.click(await screen.findByRole('link', { name: 'ANN/POOL/2026-27/02' }));
    await user.click(await screen.findByRole('button', { name: 'Begin review' }));
    const terms = await screen.findByRole('region', { name: 'Terms' });
    await user.click(within(terms).getByRole('button', { name: /^Sanction ₹7,50,000\.00$/ }));
    expect(await screen.findByRole('heading', { name: 'Sanctioned as PACF/SAN/2026-27/022' })).toBeInTheDocument();
    expect(journalOf(store.getState().world, 'soc_1')).toHaveLength(journalBefore);

    // The secretary draws it down and pays the twelve members out.
    await viewAs(user, 'Society Secretary');
    await user.click(within(sidebar()).getByRole('link', { name: 'Funding' }));
    await user.click(await screen.findByRole('link', { name: 'PACF/SAN/2026-27/022' }));
    const waiting = await screen.findByRole('region', { name: 'Awaiting disbursement' });
    expect(within(waiting).getByText('12 members awaiting disbursement')).toBeInTheDocument();
    await user.click(within(waiting).getByRole('button', { name: 'Draw down and disburse' }));
    const disburse = await screen.findByRole('dialog', { name: 'Draw down and disburse' });
    await user.click(within(disburse).getByRole('button', { name: 'Disburse 12 loans' }));
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Drew ₹7,50,000.00 and paid out 12 loans');

    // One drawdown and twelve disbursements posted, and the books still balance.
    const posted = journalOf(store.getState().world, 'soc_1').slice(journalBefore);
    expect(posted.map((e) => e.sourceType)).toEqual(['DRAWDOWN', ...Array(12).fill('DISBURSEMENT')]);
    expect(selectInvariantHealth(store.getState().world).ok).toBe(true);

    // The loan is scheduled and waiting to be serviced.
    await user.click(within(done).getByRole('link', { name: 'loan_070' }));
    expect(await screen.findByRole('table', { name: 'Schedule for loan loan_070' })).toBeInTheDocument();
  }, 30_000);
});

describe('the officer approval limit', () => {
  it('sends a decision above the limit to the secretary', async () => {
    const { user } = renderApp('/applications/app_065');
    await viewAs(user, 'Loan Officer');
    const decision = await screen.findByRole('region', { name: 'Decision' });
    expect(within(decision).getByText('Secretary decides')).toBeInTheDocument();
    expect(within(decision).getByRole('alert')).toHaveTextContent(
      '₹70,000.00 is above the ₹50,000.00 officer limit, so the secretary decides.',
    );
    expect(within(decision).getByRole('button', { name: /^Approve/ })).toBeDisabled();

    await viewAs(user, 'Society Secretary');
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Decision' })).getByRole('button', { name: /^Approve/ })).toBeEnabled(),
    );
  });
});

describe('the pool builder', () => {
  it('will not submit below ten members, and says how many more', async () => {
    const { user } = renderApp('/pools/new?pool=pool_04');
    const pool = await screen.findByRole('region', { name: 'The pool' });
    expect(within(pool).getByText('Add 2 more members: a pool needs at least 10.')).toBeInTheDocument();
    expect(within(pool).getByRole('button', { name: 'Submit to the federation' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Include Gomathi Govindan' }));
    await user.click(screen.getByRole('checkbox', { name: 'Include Thangaraj Subramani' }));
    expect(within(pool).getByText('10 of 10–20 members')).toBeInTheDocument();
    expect(within(pool).getByRole('button', { name: 'Submit to the federation' })).toBeEnabled();
  });
});

describe('the federation', () => {
  it('declines a pool with remarks, releasing its applications', async () => {
    const { user, store } = renderApp('/apex/requests/pool_05', (s) => s.getState().switchRole('APEX_OFFICER'));
    const terms = await screen.findByRole('region', { name: 'Terms' });
    await user.click(within(terms).getByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline GRM/POOL/2026-27/02?' });
    expect(within(dialog).getByRole('button', { name: 'Decline the pool' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Remarks for the society'), 'Two members are already late elsewhere.');
    await user.click(within(dialog).getByRole('button', { name: 'Decline the pool' }));
    expect(await screen.findByRole('heading', { name: 'Declined' })).toBeInTheDocument();
    const released = store.getState().world.applications.filter((a) => a.societyId === 'soc_2' && a.status === 'APPROVED');
    expect(released).toHaveLength(10);
  });
});

describe('an under-sanctioned pool', () => {
  it('goes back to the secretary to re-scope before anything is drawn', async () => {
    const { user } = renderApp('/tranches/trn_04', (store) => {
      const { world, dispatch, switchUser } = store.getState();
      const result = dispatch({
        type: 'TRANCHE_SANCTIONED',
        on: world.clock,
        trancheId: 'trn_04',
        poolId: 'pool_05',
        sanctionRef: 'PACF/SAN/2026-27/022',
        sanctionedAmount: 60_000_000,
        wholesaleRateBps: 950,
        tenureMonths: 24,
        remarks: '',
        recordedBy: 'usr_apex',
      });
      if (!result.ok) throw new Error(result.error);
      switchUser('usr_secretary_2');
    });
    const notice = await screen.findByRole('region', { name: 'Re-scope needed' });
    expect(notice).toHaveTextContent('ask for ₹7,50,000.00 against the ₹6,00,000.00 the federation sanctioned');
    expect(screen.queryByRole('button', { name: 'Draw down and disburse' })).not.toBeInTheDocument();

    await user.click(within(notice).getByRole('button', { name: 'Re-scope the pool' }));
    const dialog = await screen.findByRole('dialog', { name: 'Re-scope GRM/POOL/2026-27/02' });
    // Pro rata is offered first, and nothing happens until the members' agreement is confirmed.
    expect(within(dialog).getByRole('radio', { name: /Cut every loan pro rata/ })).toHaveAttribute('aria-checked', 'true');
    const save = within(dialog).getByRole('button', { name: 'Re-scope the pool' });
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByLabelText('Each member has agreed to the reduced amount and instalment'));
    await user.click(save);

    const waiting = await screen.findByRole('region', { name: 'Awaiting disbursement' });
    expect(within(waiting).getByText('10 members awaiting disbursement')).toBeInTheDocument();
    expect(within(waiting).getByRole('button', { name: 'Draw down and disburse' })).toBeInTheDocument();
  });
});
