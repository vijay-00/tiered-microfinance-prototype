import { CalendarDays, CheckCircle2, ChevronDown, CircleAlert, Compass, RotateCcw } from 'lucide-react';
import { VISIBLE_ROLES } from '@/app/roles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { addDaysISO, addMonthsISO } from '@/domain/dates';
import type { Role } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatDate, formatDateLong, plural } from '@/lib/format';
import { useAppStore } from '@/store/context';
import { useWalkthrough, useWalkthroughs } from './Walkthrough';
import {
  selectCurrentUser,
  selectInvariantHealth,
  selectInvariants,
  selectNextDueDateForViewer,
  selectScenarios,
} from '@/store/selectors';

/**
 * The demo controls. Pinned above every screen and tinted apart from the app,
 * so nobody mistakes them for a feature. Nothing here posts an entry on its
 * own: the clock changes what is due, and only people record payments.
 */

const stripButton = 'border-demo-border bg-card/70 text-foreground hover:bg-card';

function RoleSwitcher() {
  const user = useAppStore(selectCurrentUser);
  const switchRole = useAppStore((s) => s.switchRole);
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-medium">Viewing as</span>
      <select
        value={user.role}
        onChange={(event) => switchRole(event.target.value as Role)}
        className="ui-select h-7 rounded-md border border-demo-border bg-card px-2 text-sm text-foreground"
      >
        {VISIBLE_ROLES.map((r) => (
          <option key={r.role} value={r.role}>
            {r.label}
          </option>
        ))}
      </select>
      <span className="hidden text-xs xl:inline">{user.name}</span>
    </label>
  );
}

/**
 * Society roles exist at more than one society; this picks which one's books
 * the demo is looking at. A menu rather than a select, so the role select
 * stays the bar's only combobox.
 */
function SocietySwitcher() {
  const user = useAppStore(selectCurrentUser);
  const users = useAppStore((s) => s.world.users);
  const societies = useAppStore((s) => s.world.societies);
  const switchUser = useAppStore((s) => s.switchUser);
  const peers = users.filter((u) => u.role === user.role && u.societyId);
  const current = societies.find((s) => s.id === user.societyId);
  // Members are picked by name, below; they share one society's books.
  if (user.role === 'MEMBER' || !current || peers.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={stripButton} aria-label={`Society: ${current.name}`}>
          {current.name}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Show the books of</DropdownMenuLabel>
        {peers.map((u) => {
          const society = societies.find((s) => s.id === u.societyId)!;
          return (
            <DropdownMenuItem key={u.id} onSelect={() => switchUser(u.id)}>
              <span className="font-medium">
                {society.name}
                {u.id === user.id ? ' (current)' : ''}
              </span>
              <span className="text-xs text-muted-foreground">
                {u.name}, {u.title}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Viewing as a member, this picks which one: each has a login of their own. */
function MemberSwitcher() {
  const user = useAppStore(selectCurrentUser);
  const users = useAppStore((s) => s.world.users);
  const members = useAppStore((s) => s.world.members);
  const switchUser = useAppStore((s) => s.switchUser);
  if (user.role !== 'MEMBER') return null;
  const logins = users.filter((u) => u.role === 'MEMBER');
  if (logins.length < 2) return null;
  const villageOf = (u: (typeof logins)[number]) => members.find((m) => m.id === u.memberId)?.village;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={stripButton} aria-label={`Member: ${user.name}`}>
          {user.name}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>View as member</DropdownMenuLabel>
        {logins.map((u) => (
          <DropdownMenuItem key={u.id} onSelect={() => switchUser(u.id)}>
            <span className="font-medium">
              {u.name}
              {u.id === user.id ? ' (current)' : ''}
            </span>
            <span className="text-xs text-muted-foreground">{villageOf(u)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ClockControl() {
  const clock = useAppStore((s) => s.world.clock);
  const nextDue = useAppStore(selectNextDueDateForViewer);
  const advance = useAppStore((s) => s.advanceClock);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Simulated clock">
      <CalendarDays className="size-4" aria-hidden />
      <span className="text-xs font-medium">Today</span>
      <time dateTime={clock} aria-live="polite" className="font-semibold tabular-nums">
        {formatDateLong(clock)}
      </time>
      <Button size="sm" variant="outline" className={stripButton} onClick={() => advance(addDaysISO(clock, 1))}>
        +1 day
      </Button>
      <Button size="sm" variant="outline" className={stripButton} onClick={() => advance(addMonthsISO(clock, 1))}>
        +1 month
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={stripButton}
        disabled={!nextDue}
        onClick={() => nextDue && advance(nextDue)}
        title={nextDue ? `Jump to ${formatDate(nextDue)}` : 'No instalments ahead'}
      >
        Next due date
      </Button>
    </div>
  );
}

function ScenarioMenu() {
  const current = useAppStore((s) => s.scenarioId);
  const changes = useAppStore((s) => s.userEvents.length);
  const load = useAppStore((s) => s.loadScenario);
  const reset = useAppStore((s) => s.reset);
  const scenarios = useAppStore(selectScenarios);
  const currentName = scenarios.find((s) => s.id === current)?.name ?? '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={stripButton}>
          {scenarios.length > 1 ? `Scenario ${current} · ${currentName}` : currentName}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{scenarios.length > 1 ? 'Load a scenario' : 'The demo'}</DropdownMenuLabel>
        {scenarios.map((s) => (
          <DropdownMenuItem key={s.id} disabled={!s.load} onSelect={() => load(s.id)}>
            <span className="font-medium">
              {s.id}. {s.name}
              {s.id === current ? ' (current)' : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {s.load ? s.summary : `Arrives in ${s.availableIn}`}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={reset}>
          <span className="flex items-center gap-1.5 font-medium">
            <RotateCcw aria-hidden /> Reset demo data
          </span>
          <span className="text-xs text-muted-foreground">
            {changes === 0 ? 'Nothing has changed since the seed' : `Discards ${plural(changes, 'change')} made since the seed`}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WalkthroughMenu() {
  const { start } = useWalkthrough();
  const walkthroughs = useWalkthroughs();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={stripButton}>
          <Compass aria-hidden />
          Walkthrough
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Guided walkthroughs</DropdownMenuLabel>
        {walkthroughs.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => start(w.id)}>
            <span className="font-medium">{w.title}</span>
            <span className="max-w-72 text-xs text-muted-foreground">{w.summary}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InvariantsPanel() {
  const world = useAppStore((s) => s.world);
  const bySociety = selectInvariants(world);
  return (
    <>
      <SheetHeader>
        <SheetTitle>Invariants</SheetTitle>
        <SheetDescription>
          Checked against every society's books after every change. A red check is a bug, not a warning.
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {world.societies.map((society) => {
          const results = bySociety[society.id] ?? [];
          const failing = results.filter((r) => !r.ok).length;
          return (
            <section key={society.id} aria-label={society.name}>
              <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">
                {society.name}
                <Badge tone={failing ? 'bad' : 'good'}>{failing ? `${failing} failing` : 'All passing'}</Badge>
              </h3>
              <ol className="mt-2 divide-y rounded-md border">
                {results.map((r) => (
                  <li key={r.id} className="flex gap-2.5 px-3 py-2 text-sm">
                    {r.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-label="Passing" />
                    ) : (
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-label="Failing" />
                    )}
                    <div className="min-w-0">
                      <p>
                        <span className="text-muted-foreground tabular-nums">{r.id}.</span> {r.name}
                      </p>
                      {r.detail ? <p className="mt-0.5 text-xs break-words text-muted-foreground">{r.detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </>
  );
}

function InvariantsIndicator() {
  const health = useAppStore((s) => selectInvariantHealth(s.world));
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={stripButton}
          aria-label={`Invariants: ${health.passing} of ${health.total} passing`}
        >
          <span aria-hidden className={cn('size-2.5 rounded-full', health.ok ? 'bg-good' : 'bg-bad')} />
          Invariants
          <span className="tabular-nums">
            {health.passing}/{health.total}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent aria-describedby={undefined}>
        <InvariantsPanel />
      </SheetContent>
    </Sheet>
  );
}

export function DemoToolbar() {
  return (
    <div
      role="region"
      aria-label="Demo controls"
      className="sticky top-0 z-30 border-b border-demo-border bg-demo text-demo-foreground"
    >
      {/* One swipeable row on phones; wraps from tablet width up. */}
      <div className="flex items-center gap-x-4 gap-y-2 overflow-x-auto px-4 py-2 text-sm whitespace-nowrap md:flex-wrap md:overflow-visible [&>*]:shrink-0">
        <span className="rounded border border-demo-border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider">
          DEMO
        </span>
        <RoleSwitcher />
        <SocietySwitcher />
        <MemberSwitcher />
        <span aria-hidden className="hidden h-5 w-px bg-demo-border md:block" />
        <ClockControl />
        <span aria-hidden className="hidden h-5 w-px bg-demo-border md:block" />
        <ScenarioMenu />
        <WalkthroughMenu />
        <div className="ml-auto">
          <InvariantsIndicator />
        </div>
      </div>
    </div>
  );
}
