import { screen, waitFor, within } from '@testing-library/react';
import { isBuilt } from '@/app/router';
import { SCREENS } from '@/app/screens';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

/**
 * The Phase 2 gate, from the TDD: scenario A loads from mock JSON, the clock
 * advances, the invariants dot is green, and the role switcher changes the
 * sidebar. Mounted whole, on a fresh store, with repository latency at zero.
 */

const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
const demoBar = () => screen.getByRole('region', { name: 'Demo controls' });

describe('the app shell', () => {
  it('opens scenario A on the secretary’s dashboard, with figures from the seed', async () => {
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Meenakshi$/ })).toBeInTheDocument();
    expect(await screen.findByText('Loans outstanding')).toBeInTheDocument();
    expect(screen.getByText('12 active loans, 0 closed')).toBeInTheDocument();
    expect(screen.getByText('Every member is up to date')).toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: 'Collections' })).toBeInTheDocument();
  });

  it('shows a green invariants indicator, and the twelve checks for each society', async () => {
    const { user } = renderApp('/dashboard');
    const indicator = within(demoBar()).getByRole('button', { name: 'Invariants: 36 of 36 passing' });
    await user.click(indicator);
    const panel = await screen.findByRole('dialog');
    for (const name of ['Annapoorani Credit Society', 'Grama Valarchi Credit Society', 'Sakthi Mahalir Credit Society']) {
      const section = within(panel).getByRole('region', { name });
      expect(within(section).getByText('All passing')).toBeInTheDocument();
      expect(within(section).getAllByRole('listitem')).toHaveLength(12);
    }
  });

  it('advances the clock, and the dashboard follows', async () => {
    const { user, store } = renderApp('/dashboard');
    await screen.findByText('Every member is up to date');
    expect(within(demoBar()).getByText(/29 Oct 2026/)).toBeInTheDocument();

    // The next instalment date anywhere is Grama Valarchi's, on the 10th.
    await user.click(within(demoBar()).getByRole('button', { name: 'Next due date' }));
    expect(store.getState().world.clock).toBe('2026-11-10');

    // A month on, Annapoorani's 15 November instalments are 25 days late.
    await user.click(within(demoBar()).getByRole('button', { name: '+1 month' }));
    expect(within(demoBar()).getByText(/10 Dec 2026/)).toBeInTheDocument();
    expect(await screen.findByText('12 loans')).toBeInTheDocument();
    expect(screen.getByText(/12 past the grace period/)).toBeInTheDocument();
    expect(screen.getByText(/Overdue since 15 Nov 2026/)).toBeInTheDocument();
  });

  it('changes the sidebar and the home screen when the role changes', async () => {
    const { user, router } = renderApp('/dashboard');
    await user.selectOptions(within(demoBar()).getByRole('combobox'), 'Apex Officer');

    await waitFor(() => expect(router.state.location.pathname).toBe('/apex'));
    expect(within(sidebar()).getByRole('link', { name: /^Funding requests/ })).toBeInTheDocument();
    expect(within(sidebar()).queryByRole('link', { name: 'Collections' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exposure', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('rowheader', { name: /Sakthi Mahalir Credit Society/ })).toBeInTheDocument();
  });

  it('shows a member their loan at the retail rate, and nothing about wholesale pricing', async () => {
    const { user, router } = renderApp('/dashboard');
    await user.selectOptions(within(demoBar()).getByRole('combobox'), 'Member');

    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
    expect(await screen.findByText('11.5% a year')).toBeInTheDocument();
    expect(screen.getByText('6 of 12', { exact: false })).toBeInTheDocument();
    const main = screen.getByRole('main');
    // The wholesale rate as a rate: a bare "9.5" would also match amounts like Rs 2,659.50.
    expect(main).not.toHaveTextContent(/9\.5%|wholesale|margin|federation/i);
  });

  it('marks the auditor read only', async () => {
    const { user } = renderApp('/dashboard');
    await user.selectOptions(within(demoBar()).getByRole('combobox'), 'Auditor');
    expect(await within(sidebar().parentElement!).findByText('Read only')).toBeInTheDocument();
  });

  it('sends a role away from another tier’s screens', async () => {
    const { user, router } = renderApp('/collections');
    await user.selectOptions(within(demoBar()).getByRole('combobox'), 'Member');
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
  });

  it('builds every screen in the inventory', async () => {
    expect(SCREENS.filter((s) => !isBuilt(s.path)).map((s) => s.path)).toEqual([]);
    renderApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText(/^Built in Phase/)).not.toBeInTheDocument();
  });

  it('says so when a page does not exist', async () => {
    renderApp('/nowhere');
    expect(await screen.findByRole('heading', { name: 'No such page' })).toBeInTheDocument();
  });
});
