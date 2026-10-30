import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

/**
 * The Phase 3 gate, from the TDD: a full monthly cycle — collect from twelve
 * members, remit to the federation, and read the retained margin off the
 * screen — without opening a console. Driven through the screens alone.
 */

const demoBar = () => screen.getByRole('region', { name: 'Demo controls' });
const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
const toNovember15 = (store: Parameters<NonNullable<Parameters<typeof renderApp>[1]>>[0]) =>
  store.getState().advanceClock('2026-11-15');

describe('the monthly cycle, through the screens', () => {
  it('collects from twelve members, remits to the federation, and shows the margin kept', async () => {
    const { user, store } = renderApp('/collections');
    await screen.findByText('Every member is up to date.');

    // Move the clock to the demo pool's next instalment date.
    await user.click(within(demoBar()).getByRole('button', { name: 'Next due date' }));
    await user.click(within(demoBar()).getByRole('button', { name: 'Next due date' }));
    expect(store.getState().world.clock).toBe('2026-11-15');
    expect(await screen.findByRole('heading', { name: 'Due today · 12' })).toBeInTheDocument();

    // Collect: one confirmation records all twelve instalments.
    await user.click(screen.getByRole('button', { name: 'Record all due today' }));
    const confirm = await screen.findByRole('dialog', { name: 'Record 12 payments?' });
    await user.click(within(confirm).getByRole('button', { name: 'Record 12 payments' }));
    expect(await screen.findByText('Nothing falls due today. Use Next due date in the demo bar to move to the next instalment date.')).toBeInTheDocument();
    const collected = screen.getByRole('region', { name: 'Collected today' });
    expect(within(collected).getByText('12 receipts')).toBeInTheDocument();
    expect(within(collected).getByText('Kept by the society')).toBeInTheDocument();

    // Remit: from Funding, open the facility and pay the federation in full.
    await user.click(within(sidebar()).getByRole('link', { name: 'Funding' }));
    await user.click(await screen.findByRole('link', { name: 'PACF/SAN/2026-27/014' }));
    const next = await screen.findByRole('region', { name: 'Next remittance' });
    expect(within(next).getByText('Next remittance · 15 Nov 2026')).toBeInTheDocument();
    expect(within(next).getByText(/Members have paid in enough to cover it/)).toBeInTheDocument();
    await user.click(within(next).getByRole('button', { name: 'Record remittance' }));
    const remit = await screen.findByRole('dialog', { name: 'Remit to the federation' });
    await user.click(within(remit).getByRole('button', { name: /^Remit ₹/ }));

    // Read the margin: November's row now heads the remittance history.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Next remittance · 15 Dec 2026')).toBeInTheDocument();
    // A month early, nothing is short: December's instalments are simply not due yet.
    const december = screen.getByRole('region', { name: 'Next remittance' });
    expect(within(december).getByText('No member payments have come in towards it yet.')).toBeInTheDocument();
    expect(within(december).queryByText(/come from the society's reserves/)).not.toBeInTheDocument();
    const history = screen.getByRole('table', { name: 'Remittances made, with the margin each period earned' });
    const november = within(history).getAllByRole('row')[1]!;
    const cells = within(november).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('15 Nov 2026');
    expect(cells[6]).toHaveTextContent(/^₹\d/);
    expect(cells[4]).toHaveTextContent('₹0');
  });
});

describe('the payment drawer', () => {
  it('previews the split, refuses too much and offers the maximum, then posts what it previewed', async () => {
    const { user } = renderApp('/collections', toNovember15);
    const buttons = await screen.findAllByRole('button', { name: /^Record payment from / });
    await user.click(buttons[0]!);

    const drawer = await screen.findByRole('dialog', { name: 'Record a payment' });
    const preview = within(drawer).getByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('This instalment’s interest')).toBeInTheDocument();
    expect(within(preview).getByText('To the federation')).toBeInTheDocument();
    expect(within(preview).getByText('Kept by the society')).toBeInTheDocument();

    const amount = within(drawer).getByLabelText('Amount received (₹)');
    await user.clear(amount);
    await user.type(amount, '9999999');
    expect(await within(drawer).findByText(/the most this loan can accept today is/)).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: /^Use ₹.* to pay off the loan$/ }));
    expect(within(drawer).getByLabelText('Apply anything extra to principal')).toBeChecked();
    expect(within(drawer).queryByText(/the most this loan can accept today is/)).not.toBeInTheDocument();
    expect(within(drawer).getByText('This payment repays the loan in full.')).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: 'Amount due' }));
    await user.click(within(drawer).getByRole('button', { name: /^Record ₹/ }));
    expect(await within(drawer).findByText('Receipt ANN/R/00073 recorded')).toBeInTheDocument();
    expect(within(drawer).getByText(/^Posted to the ledger as je_/)).toBeInTheDocument();
  });
});

describe('who may do what', () => {
  it('lets only the secretary remit', async () => {
    const { user } = renderApp('/tranches/trn_01', toNovember15);
    await user.selectOptions(within(demoBar()).getByRole('combobox'), 'Auditor');
    const next = await screen.findByRole('region', { name: 'Next remittance' });
    expect(within(next).getByText("Only the society's secretary can record a remittance.")).toBeInTheDocument();
    expect(within(next).queryByRole('button', { name: 'Record remittance' })).not.toBeInTheDocument();
  });

  it('shows the auditor the desk but no way to record', async () => {
    const { user } = renderApp('/collections', toNovember15);
    await user.selectOptions(within(demoBar()).getByRole('combobox'), 'Auditor');
    expect(await screen.findByText('You can see the desk but not record payments in this role.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Record payment from / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record all due today' })).not.toBeInTheDocument();
  });
});

describe('loan detail', () => {
  it('shows the society the schedule, and each receipt’s split and journal entry', async () => {
    const { user } = renderApp('/loans/loan_001');
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Schedule for loan loan_001' })).toBeInTheDocument();
    const summary = screen.getByText('ANN/R/00061');
    await user.click(summary);
    const payment = summary.closest('details')!;
    expect(payment).toHaveAttribute('open');
    expect(within(payment).getByRole('table', { name: /^Journal entry je_/ })).toBeInTheDocument();
    expect(within(payment).getByText('Recorded by Karthik Rajan')).toBeInTheDocument();
  });

  it('shows the member their schedule and payments, and nothing of the federation', async () => {
    const { user, router } = renderApp('/dashboard');
    await user.selectOptions(within(demoBar()).getByRole('combobox'), 'Member');
    await user.click(await screen.findByRole('link', { name: 'Your schedule and payments' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/loans/loan_001'));
    expect(await screen.findByRole('heading', { name: 'Your schedule' })).toBeInTheDocument();
    const payments = screen.getByRole('table', { name: 'Your payments and how each was applied' });
    expect(within(payments).getAllByRole('row')).toHaveLength(1 + 6);
    expect(screen.getByRole('main')).not.toHaveTextContent(/wholesale|margin|federation|9\.5%/i);
  });
});
