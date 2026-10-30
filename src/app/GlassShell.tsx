import { ChevronRight, Menu } from 'lucide-react';
import { forwardRef, Fragment, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CrumbSlot } from '@/components/Breadcrumb';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { stageOf } from '@/domain/origination';
import type { WorldState } from '@/domain/world';
import { Avatar } from '@/features/apex/glass';
import { useAppStore } from '@/store/context';
import { selectCurrentUser, selectRoleInfo } from '@/store/selectors';
import { NAV } from './nav';
import { NoticePopup } from './NoticePopup';
import type { Tier } from './roles';
import '@/features/apex/glass.css';

/**
 * The glass shell, for the federation and the society screens: a floating
 * sidebar and a top bar with the breadcrumb. The demo bar stays above it.
 * A page with its own Breadcrumb portals it into the top bar; otherwise the
 * crumb comes from where the path sits in the navigation.
 */

type Crumb = { label: string; to?: string };

function crumbsFor(pathname: string, tier: Tier, world: WorldState): Crumb[] {
  if (tier === 'apex') {
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
  // The longest nav path that prefixes this one names the section.
  let best: { group?: string; label: string; to: string } | undefined;
  for (const group of NAV[tier]) {
    for (const item of group.items) {
      const match = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (match && (!best || item.to.length > best.to.length)) best = { group: group.label, label: item.label, to: item.to };
    }
  }
  if (!best) return [];
  return best.group ? [{ label: best.group }, { label: best.label }] : [{ label: best.label }];
}

function useWaiting(tier: Tier): Record<string, number> {
  const societyId = useAppStore(selectCurrentUser).societyId;
  const requests = useAppStore((s) => s.world.pools.filter((p) => p.status === 'SUBMITTED' || p.status === 'UNDER_APEX_REVIEW').length);
  const applications = useAppStore(
    (s) =>
      s.world.applications.filter(
        (a) => a.societyId === societyId && (stageOf(a) === 'NEEDS_APPRAISAL' || stageOf(a) === 'AWAITING_DECISION'),
      ).length,
  );
  // A sanction not yet drawn: the society's next step after the federation says yes.
  const toDraw = useAppStore(
    (s) =>
      Object.values(s.world.tranches).filter((t) => t.tranche.societyId === societyId && t.tranche.status === 'SANCTIONED')
        .length,
  );
  return tier === 'apex'
    ? { '/apex/requests': requests }
    : { '/applications': applications, '/tranches': toDraw };
}

function GlassSidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const user = useAppStore(selectCurrentUser);
  const info = useAppStore(selectRoleInfo);
  const federation = useAppStore((s) => s.world.federation);
  const society = useAppStore((s) => s.world.societies.find((x) => x.id === user.societyId));
  const waiting = useWaiting(info.tier);
  const org =
    info.tier === 'apex'
      ? { name: federation.name.replace(/ Credit Federation$/, ''), sub: `Credit federation · ${federation.shortName}` }
      : { name: society?.name.replace(/ Credit Society$/, '') ?? '', sub: `Credit society · ${society?.district ?? ''}` };
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : undefined);
  return (
    <aside className={`g-side g-blur ${className ?? ''}`}>
      <div className="g-org">
        <div className="g-logo" aria-hidden>
          {org.name[0]}
        </div>
        <div>
          <b>{org.name}</b>
          <span>{org.sub}</span>
        </div>
      </div>
      <nav className="g-nav" aria-label="Main">
        {NAV[info.tier].map((group, i) => (
          <Fragment key={group.label ?? i}>
            {group.label ? <div className="grp">{group.label}</div> : null}
            {group.items.map((item) => {
              const count = waiting[item.to] ?? 0;
              return (
                <NavLink key={item.to} to={item.to} end={item.end} className={link} onClick={onNavigate}>
                  <item.icon aria-hidden /> {item.label}
                  {count > 0 ? <em aria-label={`${count} waiting`}>{count}</em> : null}
                </NavLink>
              );
            })}
          </Fragment>
        ))}
      </nav>
      <div className="g-me">
        <Avatar name={user.name} />
        <div>
          <b>{user.name}</b>
          <span>
            {user.title}
            {info.readOnly ? <span className="g-pill neutral ml-1.5">Read only</span> : null}
          </span>
        </div>
      </div>
    </aside>
  );
}

export const GlassShell = forwardRef<HTMLElement>(function GlassShell(_props, mainRef) {
  const { pathname } = useLocation();
  const world = useAppStore((s) => s.world);
  const tier = useAppStore(selectRoleInfo).tier;
  const [menu, setMenu] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const crumbs = crumbsFor(pathname, tier, world);
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
            <div ref={setSlot} className="g-crumb-slot" />
            <nav aria-label="Breadcrumb" className="g-crumb g-crumb-default">
              {crumbs.map((c, i) => (
                <Fragment key={c.label}>
                  {i > 0 ? <ChevronRight size={12} aria-hidden /> : null}
                  {c.to ? <Link to={c.to}>{c.label}</Link> : i === crumbs.length - 1 ? <b>{c.label}</b> : <span>{c.label}</span>}
                </Fragment>
              ))}
            </nav>
          </header>
          <main id="main" ref={mainRef} tabIndex={-1} className="g-content">
            <CrumbSlot.Provider value={slot}>
              <Outlet />
            </CrumbSlot.Provider>
          </main>
        </div>
      </div>
      <NoticePopup />
    </div>
  );
});
