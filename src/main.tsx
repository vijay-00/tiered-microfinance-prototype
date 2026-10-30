import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import { createAppRouter } from './app/router';
import { createRepositories } from './data/repositories';
import { createAppStore } from './store/appStore';
import { AppProviders } from './store/context';
import { browserStorage } from './store/persistence';

// The demo opens on the federation's view; the demo bar switches to any other role.
// It shows one society, the one the demo's member belongs to, on today's date
// where the person using it is.
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const store = createAppStore({ storage: browserStorage(), startAs: 'APEX_OFFICER', onlySociety: 'soc_1', today });
const repositories = createRepositories(store);
const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders store={store} repositories={repositories}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AppProviders>
  </StrictMode>,
);
