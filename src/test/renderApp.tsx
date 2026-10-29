import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes, ROUTER_FUTURE } from '@/app/router';
import { createRepositories } from '@/data/repositories';
import { createAppStore, type AppStore } from '@/store/appStore';
import { AppProviders } from '@/store/context';

/**
 * Mounts the whole app on a fresh store, with repository latency at zero.
 * `prepare` runs against the store before the first render.
 */
export function renderApp(path = '/', prepare?: (store: AppStore) => void) {
  const store = createAppStore();
  prepare?.(store);
  const repositories = createRepositories(store, { min: 0, max: 0 });
  const router = createMemoryRouter(routes, { initialEntries: [path], future: ROUTER_FUTURE });
  render(
    <AppProviders store={store} repositories={repositories}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AppProviders>,
  );
  return { store, router, user: userEvent.setup() };
}
