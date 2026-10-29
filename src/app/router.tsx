import type { ReactElement } from 'react';
import { createBrowserRouter, Link, useRouteError, type RouteObject } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { ApexDashboardPage } from '@/features/apex/ApexDashboardPage';
import { FundingRequestsPage } from '@/features/apex/FundingRequestsPage';
import { PoolReviewPage } from '@/features/apex/PoolReviewPage';
import { SocietiesPage } from '@/features/apex/SocietiesPage';
import { SocietyDetailPage } from '@/features/apex/SocietyDetailPage';
import { ApplicationDetailPage } from '@/features/applications/ApplicationDetailPage';
import { ApplicationsPage } from '@/features/applications/ApplicationsPage';
import { NewApplicationPage } from '@/features/applications/NewApplicationPage';
import { CollectionsPage } from '@/features/collections/CollectionsPage';
import { SocietyDashboardPage } from '@/features/dashboard/SocietyDashboardPage';
import { GeneralLedgerPage } from '@/features/ledger/GeneralLedgerPage';
import { StatementsPage } from '@/features/ledger/StatementsPage';
import { LoanDetailPage } from '@/features/loans/LoanDetailPage';
import { MemberHomePage } from '@/features/member/MemberHomePage';
import { MemberLoanPage } from '@/features/member/MemberLoanPage';
import { MemberProfilePage } from '@/features/members/MemberProfilePage';
import { MembersPage } from '@/features/members/MembersPage';
import { PlaceholderPage } from '@/features/placeholder/PlaceholderPage';
import { PoolBuilderPage } from '@/features/pools/PoolBuilderPage';
import { PoolDetailPage } from '@/features/pools/PoolDetailPage';
import { PoolsPage } from '@/features/pools/PoolsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TrancheDetailPage } from '@/features/tranches/TrancheDetailPage';
import { TranchesPage } from '@/features/tranches/TranchesPage';
import { AppShell } from './AppShell';
import { HomeRedirect, RequireTier } from './guards';
import { SCREENS, type Screen } from './screens';

const BUILT: Record<string, () => ReactElement> = {
  '/dashboard': () => <SocietyDashboardPage />,
  '/members': () => <MembersPage />,
  '/members/:memberId': () => <MemberProfilePage />,
  '/applications': () => <ApplicationsPage />,
  '/applications/new': () => <NewApplicationPage />,
  '/applications/:applicationId': () => <ApplicationDetailPage />,
  '/pools': () => <PoolsPage />,
  '/pools/new': () => <PoolBuilderPage />,
  '/pools/:poolId': () => <PoolDetailPage />,
  '/collections': () => <CollectionsPage />,
  '/loans/:loanId': () => <LoanDetailPage />,
  '/ledger': () => <GeneralLedgerPage />,
  '/ledger/statements': () => <StatementsPage />,
  '/reports': () => <ReportsPage />,
  '/settings': () => <SettingsPage />,
  '/tranches': () => <TranchesPage />,
  '/tranches/:trancheId': () => <TrancheDetailPage />,
  '/apex': () => <ApexDashboardPage />,
  '/apex/requests': () => <FundingRequestsPage />,
  '/apex/requests/:poolId': () => <PoolReviewPage />,
  '/apex/societies': () => <SocietiesPage />,
  '/apex/societies/:societyId': () => <SocietyDetailPage />,
  '/me': () => <MemberHomePage />,
  '/me/loans/:loanId': () => <MemberLoanPage />,
};

/** Whether a screen in the inventory has its page, rather than the placeholder. */
export const isBuilt = (path: string): boolean => path in BUILT;

function pageFor(screen: Screen): ReactElement {
  return BUILT[screen.path]?.() ?? <PlaceholderPage screen={screen} />;
}

function NotFound() {
  return (
    <PageHeader
      title="No such page"
      description={
        <>
          Nothing lives at this address. <Link className="text-primary underline" to="/">Go to your home screen</Link>.
        </>
      }
    />
  );
}

function RouteError() {
  const error = useRouteError();
  return (
    <div className="p-8">
      <PageHeader
        title="Something went wrong"
        description={error instanceof Error ? error.message : 'An unexpected error stopped this page from rendering.'}
      />
      <Link className="text-sm text-primary underline" to="/">Back to your home screen</Link>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      ...SCREENS.map((screen) => ({
        path: screen.path,
        element: <RequireTier tier={screen.tier}>{pageFor(screen)}</RequireTier>,
      })),
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const ROUTER_FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

export function createAppRouter() {
  return createBrowserRouter(routes, { future: ROUTER_FUTURE });
}
