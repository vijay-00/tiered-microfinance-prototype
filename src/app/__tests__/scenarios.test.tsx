import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

/**
 * The Phase 6 gate, from the TDD: the delinquency scenario tells its story,
 * theoretical against realised margin with the difference explained on
 * screen, to someone who has not seen the app before. Driven through the
 * demo bar and the screens alone.
 */

const demoBar = () => screen.getByRole('region', { name: 'Demo controls' });
const sidebar = () => screen.getByRole('navigation', { name: 'Main' });

describe('the delinquency scenario, through the screens', () => {
  it('shows margin below theory, says why, and recovers it when the members catch up', async () => {
    const { user, store } = renderApp('/dashboard');

    await user.click(within(demoBar()).getByRole('button', { name: /^Scenario A/ }));
    await user.click(await screen.findByRole('menuitem', { name: /^B\. Delinquency/ }));
    expect(store.getState().scenarioId).toBe('B');

    // The dashboard puts the two margins side by side.
    const tile = await screen.findByRole('link', { name: /^Realised against theoretical margin/ });
    expect(tile).toHaveTextContent('₹3,200');
    expect(tile).toHaveTextContent('Theoretical ₹7,115');

    // One click explains the difference in words.
    await user.click(tile);
    const year = await screen.findByRole('region', { name: 'Margin: This financial year' });
    expect(year).toHaveTextContent(
      'Members paid ₹3,915 less interest than fell due. Their arrears are still owed, so this comes back as they catch up, with penal interest on top.',
    );

    // Who is behind.
    await user.click(screen.getByRole('tab', { name: 'Ageing' }));
    const loans = await screen.findByRole('table', { name: 'Loans and their principal outstanding' });
    for (const name of ['Rekha Krishnan', 'Iyyappan Selvaraj', 'Mahesh Velusamy']) {
      expect(within(loans).getByRole('link', { name })).toBeInTheDocument();
    }

    // They catch up at the collections desk, one receipt each.
    await user.click(within(sidebar()).getByRole('link', { name: 'Collections' }));
    for (const name of ['Iyyappan Selvaraj', 'Mahesh Velusamy', 'Rekha Krishnan']) {
      await user.click(await screen.findByRole('button', { name: `Record payment from ${name}` }));
      const drawer = await screen.findByRole('dialog', { name: 'Record a payment' });
      await user.click(within(drawer).getByRole('button', { name: 'Amount due' }));
      await user.click(within(drawer).getByRole('button', { name: /^Record ₹/ }));
      await within(drawer).findByText(/^Receipt ANN\/R\/\d+ recorded$/);
      await user.click(within(drawer).getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }

    // The margin is back, with penal interest on top.
    await user.click(within(sidebar()).getByRole('link', { name: 'Reports' }));
    const after = await screen.findByRole('region', { name: 'Margin: This financial year' });
    expect(after).not.toHaveTextContent('Members paid');
    expect(after).toHaveTextContent(/of rounding/);
    expect(after).toHaveTextContent(/Penal interest and fees, not part of the margin, brought in a further ₹/);
  }, 30_000);
});

describe('the walkthrough', () => {
  it('takes a newcomer through the delinquency story, scenario, person and screen at each step', async () => {
    const { user, store, router } = renderApp('/dashboard');
    await user.click(within(demoBar()).getByRole('button', { name: /Walkthrough/ }));
    await user.click(await screen.findByRole('menuitem', { name: /^When members fall behind/ }));

    const panel = await screen.findByRole('complementary', { name: 'Walkthrough' });
    expect(store.getState().scenarioId).toBe('B');
    expect(panel).toHaveTextContent('step 1 of 8');
    expect(router.state.location.pathname).toBe('/dashboard');

    const next = () => user.click(within(panel).getByRole('button', { name: /Next/ }));
    await next();
    expect(router.state.location.pathname).toBe('/reports');
    await next();
    expect(router.state.location.search).toBe('?tab=ageing');
    for (let i = 0; i < 4; i += 1) await next();
    expect(panel).toHaveTextContent('Holding principal back costs margin for good');
    expect(store.getState().session.userId).toBe('usr_secretary_2');
    await next();
    expect(router.state.location.pathname).toBe('/apex');
    await user.click(within(panel).getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('complementary', { name: 'Walkthrough' })).not.toBeInTheDocument();
  });
});

describe('demo controls', () => {
  it('switches to another society’s books', async () => {
    const { user } = renderApp('/dashboard');
    await user.click(within(demoBar()).getByRole('button', { name: 'Society: Annapoorani Credit Society' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Grama Valarchi Credit Society/ }));
    expect(await within(sidebar().parentElement!).findByText('Grama Valarchi')).toBeInTheDocument();
    expect(within(demoBar()).getByRole('button', { name: 'Society: Grama Valarchi Credit Society' })).toBeInTheDocument();
  });

  it('loads a scenario from settings, after asking', async () => {
    const { user, store } = renderApp('/settings');
    const scenarios = await screen.findByRole('region', { name: 'Scenarios' });
    const card = within(scenarios).getByText('C. Prepayment and recovery').closest('div.rounded-md') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Load' }));
    const confirm = await screen.findByRole('dialog', { name: 'Load scenario C?' });
    await user.click(within(confirm).getByRole('button', { name: 'Load' }));
    expect(store.getState().scenarioId).toBe('C');
  });

  it('folds the sidebar into a menu on narrow screens, which closes on navigating', async () => {
    const { user, router } = renderApp('/dashboard');
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const menu = await screen.findByRole('dialog', { name: 'Navigation' });
    await user.click(within(menu).getByRole('link', { name: 'Reports' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/reports');
  });
});
