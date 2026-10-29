import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

/**
 * The Phase 5 gate, from the TDD: every figure on the society dashboard is
 * traceable to journal lines in at most two clicks. Each click is counted.
 */

const valueOf = (tile: HTMLElement) => tile.querySelectorAll('p')[1]!.textContent!;
const traceTotal = async () => (await screen.findByRole('region', { name: 'Trace' })).textContent!;

describe('the dashboard, traced to the journal', () => {
  it('opens the journal lines behind each balance and each earnings figure in one click', async () => {
    const { user, router } = renderApp('/dashboard');
    const labels = [
      'Loans outstanding',
      'Owed to the federation',
      'Cash and bank',
      'Advances held for members',
      'Net interest income, this month',
      'Net interest income, this year',
      'Penal interest and fees, this year',
    ];
    for (const label of labels) {
      const tile = await screen.findByRole('link', { name: new RegExp(`^${label}`) });
      const value = valueOf(tile);
      await user.click(tile); // one
      expect(await traceTotal()).toContain(`Total${value}`);
      if (value !== '₹0.00') {
        const journal = screen.getByRole('table', { name: 'Journal entries, newest first' });
        expect(within(journal).getAllByRole('row').length).toBeGreaterThan(1);
      }
      await act(() => router.navigate('/dashboard'));
    }
  });

  it('reaches a loan’s lines from an ageing bucket in two clicks', async () => {
    const { user } = renderApp('/dashboard');
    const ageing = await screen.findByRole('region', { name: 'Ageing' });
    await user.click(within(ageing).getByRole('link', { name: /^Current · 12/ })); // one
    const loans = await screen.findByRole('table', { name: 'Loans and their principal outstanding' });
    const amount = within(loans).getAllByTitle('The journal lines behind this balance')[0]!;
    const balance = amount.textContent!;
    await user.click(amount); // two
    expect(await traceTotal()).toContain(`Total${balance}`);
  });

  it('reaches the realised margin’s lines in two clicks, and says why it differs from theory', async () => {
    const { user } = renderApp('/dashboard');
    await user.click(await screen.findByRole('link', { name: /^Realised against theoretical margin/ })); // one
    const year = await screen.findByRole('region', { name: 'Margin: This financial year' });
    expect(within(year).getByText(/of rounding: the federation's interest is rounded once/)).toBeInTheDocument();
    const realised = within(year).getByTitle('The journal lines behind this figure');
    const value = realised.textContent!;
    await user.click(realised); // two
    expect(await traceTotal()).toContain(`Total${value}`);
  });

  it('reaches the receipts behind collection efficiency in two clicks', async () => {
    const { user } = renderApp('/dashboard');
    await user.click(await screen.findByRole('link', { name: /^Collection efficiency, Oct 2026/ })); // one
    const dues = await screen.findByRole('table', { name: 'Each instalment due in the month, and what was paid against it' });
    await user.click(within(dues).getAllByTitle("This member's receipts in the journal")[0]!); // two
    const trace = await screen.findByRole('region', { name: 'Trace' });
    expect(trace).toHaveTextContent(/receipt entries only, for loan_0\d\d/);
  });
});

describe('statements and the trial balance', () => {
  it('balances, and opens the lines behind a statement line', async () => {
    const { user } = renderApp('/ledger/statements');
    const sheet = await screen.findByRole('region', { name: 'Balance sheet' });
    expect(within(sheet).getByText('Balances')).toBeInTheDocument();
    const income = screen.getByRole('region', { name: 'Income statement' });
    const line = within(income).getByRole('link', { name: 'Net interest income' });
    const value = line.closest('div')!.querySelector('dd')!.textContent!;
    await user.click(line);
    expect(await traceTotal()).toContain(`Total${value}`);
  });

  it('balances the trial balance and opens an account as a T', async () => {
    const { user } = renderApp('/ledger?view=trial');
    const trial = await screen.findByRole('region', { name: 'Trial balance' });
    expect(within(trial).getByText('Balanced')).toBeInTheDocument();
    await user.click(within(trial).getByRole('link', { name: /Member Loans Receivable/ }));
    const t = await screen.findByRole('region', { name: 'T-account 1100' });
    expect(within(t).getByRole('region', { name: 'Debit' })).toHaveTextContent(/Disbursement to/);
    expect(within(t).getByRole('region', { name: 'Credit' })).toHaveTextContent(/Receipt ANN\/R\//);
  });
});
