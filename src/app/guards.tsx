import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore } from '@/store/context';
import { selectRoleInfo } from '@/store/selectors';
import type { Tier } from './roles';

/** Sends a role to its own home if it opens a screen from another tier. */
export function RequireTier({ tier, children }: { tier: Tier; children: ReactNode }) {
  const info = useAppStore(selectRoleInfo);
  if (info.tier !== tier) return <Navigate to={info.home} replace />;
  return <>{children}</>;
}

/** `/` has no page of its own: each role lands on its home. */
export function HomeRedirect() {
  const info = useAppStore(selectRoleInfo);
  return <Navigate to={info.home} replace />;
}
