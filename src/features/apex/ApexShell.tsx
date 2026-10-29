import { ChevronRight, FileText, Landmark, LayoutGrid, Menu } from 'lucide-react';
import { forwardRef, Fragment, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { WorldState } from '@/domain/world';
import { useAppStore } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { Avatar } from './glass';
import './glass.css';

/**
 * The federation's own shell, in the glass design: a floating sidebar and a
 * top bar with the breadcrumb. The demo bar stays above it, as on every tier.
 */

type Crumb = { label: string; to?: string };

function crumbsFor(pathname: string, world: WorldState): Crumb[] {
  const [, , section, id] = pathname.split('/');
  if (section === 'requests') {
    if (!id) return [{ label: 'Lending' }, { label: 'Funding requests' }];
    const pool = world.pools.find((p) => p.id === id);
    return [{ label: 'Funding requests', to: '/apex/requests' }, { label: pool?.reference ?? id }];
  }
  if (section === 'societies') {
    if (!id) return [{ label: 'Lending' }, { label: 'Societies' }];
    const society = world.societies.find((s) => s.id === id);
    return [{ label: 'Societies', to: '/apex/societies' }, { label: society?.name ?? id }];
  }
  return [{ label: 'Exposure' }];
}

function GlassSidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const user = useAppStore(selectCurrentUser);
  const federation = useAppStore((s) => s.world.federation);
  const waiting = useAppStore(
    (s) => s.world.pools.filter((p) => p.status === 'SUBMITTED' || p.status === 'UNDER_APEX_REVIEW').length,
  );
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : undefined);
  return (
    <aside className={`g-side g-blur ${className ?? ''}`}>
      <div className="g-org">
        <div className="g-logo" aria-hidden>
          {federation.name[0]}
        </div>
        <div>
          <b>{federation.name.replace(/ Credit Federation$/, '')}</b>
          <span>Credit federation · {federation.shortName}</span>
        </div>
      </div>
      <nav className="g-nav" aria-label="Main">
        <NavLink to="/apex" end className={link} onClick={onNavigate}>
          <LayoutGrid aria-hidden /> Exposure
        </NavLink>
        <div className="grp">Lending</div>
        <NavLink to="/apex/requests" className={link} onClick={onNavigate}>
          <FileText aria-hidden /> Funding requests
          {waiting > 0 ? <em aria-label={`${waiting} waiting`}>{waiting}</em> : null}
        </NavLink>
        <NavLink to="/apex/societies" className={link} onClick={onNavigate}>
          <Landmark aria-hidden /> Societies
        </NavLink>
      </nav>
      <div className="g-me">
        <Avatar name={user.name} />
        <div>
          <b>{user.name}</b>
          <span>{user.title}</span>
        </div>
      </div>
    </aside>
  );
}

export const ApexShell = forwardRef<HTMLElement>(function ApexShell(_props, mainRef) {
  const { pathname } = useLocation();
  const world = useAppStore((s) => s.world);
  const [menu, setMenu] = useState(false);
  const crumbs = crumbsFor(pathname, world);
  return (
    <div className="glass flex-1">
      <div className="g-app">
        <GlassSidebar className="desktop" />
        <div className="g-main">
          <header className="g-top g-blur">
            <Sheet open={menu} onOpenChange={setMenu}>
              <SheetTrigger asChild>
                <button type="button" className="g-btn sm g-menu">
                  <Menu aria-hidden /> Menu
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="glass max-w-72 border-0 bg-transparent p-3" aria-describedby={undefined}>
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <GlassSidebar onNavigate={() => setMenu(false)} />
              </SheetContent>
            </Sheet>
            <nav aria-label="Breadcrumb" className="g-crumb">
              {crumbs.map((c, i) => (
                <Fragment key={c.label}>
                  {i > 0 ? <ChevronRight size={12} aria-hidden /> : null}
                  {c.to ? <Link to={c.to}>{c.label}</Link> : i === crumbs.length - 1 ? <b>{c.label}</b> : <span>{c.label}</span>}
                </Fragment>
              ))}
            </nav>
          </header>
          <main id="main" ref={mainRef} tabIndex={-1} className="g-content">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
});
