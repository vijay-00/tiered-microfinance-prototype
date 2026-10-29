import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Repositories } from '@/data/repositories';
import type { AppStore, AppStoreState } from './appStore';

/**
 * The store and repositories are passed down rather than imported as module
 * singletons, so a test can mount the app on a fresh store of its own.
 */

const StoreContext = createContext<AppStore | null>(null);
const RepositoriesContext = createContext<Repositories | null>(null);

export function AppProviders(props: { store: AppStore; repositories: Repositories; children: ReactNode }) {
  return (
    <StoreContext.Provider value={props.store}>
      <RepositoriesContext.Provider value={props.repositories}>{props.children}</RepositoriesContext.Provider>
    </StoreContext.Provider>
  );
}

export function useAppStoreApi(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useAppStore must be used inside AppProviders');
  return store;
}

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  return useStore(useAppStoreApi(), selector);
}

export function useRepositories(): Repositories {
  const repositories = useContext(RepositoriesContext);
  if (!repositories) throw new Error('useRepositories must be used inside AppProviders');
  return repositories;
}
