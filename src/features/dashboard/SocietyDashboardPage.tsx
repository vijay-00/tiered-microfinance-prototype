import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { StatTile } from '@/components/finance/StatTile';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ACCOUNTS } from '@/domain/ledger';
import { formatBps } from '@/domain/money';
import { monthLabel, type SocietyDashboard } from '@/domain/reporting';
import { AgeingBar, BUCKET_TONE } from '@/features/reports/AgeingPanel';
import { cn } from '@/lib/cn';
import { formatDate, plural } from '@/lib/format';
import { percent } from '@/lib/labels';
import { tAccountHref, traceHref } from '@/lib/ledgerLinks';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

/**
 * The society's position at a glance. Every amount is a link: a balance opens
 * the journal lines that make it, a figure not yet in the books opens the
 * schedule or report it comes from. Nothing here is more than two clicks from
 * the entries behind it.
 */
export function SocietyDashboardPage() {
  const user = useAppStore(selectCurrentUser);
  const societies = useAppStore((s) => s.world.societies);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const society = societies.find((s) => s.id === societyId);
  const { data, loading, error } = useQuery(`society-dashboard:${societyId}:${version}`, () =>
    repositories.society.getDashboard(societyId),
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={data ? `${society?.name} · as of ${formatDate(data.summary.asOf)}` : society?.name}
      />
      {error ? <p className="mb-4 text-sm text-bad">The figures could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={8} className="sm:grid-cols-2 xl:grid-cols-4" />
      ) : (
        <div aria-busy={loading} className={cn('space-y-5', loading && 'opacity-80 transition-opacity')}>
          <Books data={data} />
          <Earnings data={data} />
          <Collections data={data} />
          <Ageing data={data} />
        </div>
      )}
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h2>
      {children}
    </section>
  );
}

function Books({ data }: { data: SocietyDashboard }) {
  const { books, summary } = data;
  return (
    <Section label="Position">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Loans outstanding"
          href={traceHref(books.loansOutstanding.trace)}
          value={<MoneyText paise={books.loansOutstanding.value} />}
          detail={`${plural(summary.activeLoans, 'active loan')}, ${summary.closedLoans} closed`}
        />
        <StatTile
          label="Owed to the federation"
          href={traceHref(books.federationPayable.trace)}
          value={<MoneyText paise={books.federationPayable.value} />}
          detail="Principal outstanding on tranches"
        />
        <StatTile
          label="Cash and bank"
          href={traceHref(books.cash.trace)}
          value={<MoneyText paise={books.cash.value} />}
          tone={summary.liquidityBreach ? 'bad' : 'neutral'}
          detail={summary.liquidityBreach ? 'Below zero: a liquidity breach' : "Including the society's reserves"}
        />
        <StatTile
          label="Advances held for members"
          href={traceHref(books.advancesHeld.trace)}
          value={<MoneyText paise={books.advancesHeld.value} />}
          detail="Paid ahead, applied as instalments fall due"
        />
      </div>
    </Section>
  );
}

function Earnings({ data }: { data: SocietyDashboard }) {
  const { earnings, margin } = data;
  const close = Math.abs(margin.difference) <= 100;
  return (
    <Section label="Earnings">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Net interest income, this month"
          href={traceHref(earnings.month.trace)}
          value={<MoneyText paise={earnings.month.value} />}
          tone="good"
          detail={`Since ${formatDate(earnings.month.trace.from!)}: member interest less federation interest`}
        />
        <StatTile
          label="Net interest income, this year"
          href={traceHref(earnings.year.trace)}
          value={<MoneyText paise={earnings.year.value} />}
          tone="good"
          detail={`Financial year from ${formatDate(earnings.year.trace.from!)}`}
        />
        <StatTile
          label="Realised against theoretical margin"
          href="/reports"
          value={<MoneyText paise={margin.realised.value} />}
          tone={close ? 'good' : margin.difference < 0 ? 'warn' : 'good'}
          detail={
            close ? (
              <>
                Theoretical <MoneyText paise={margin.theoretical} />: on schedule
              </>
            ) : (
              <>
                Theoretical <MoneyText paise={margin.theoretical} />, <MoneyText paise={margin.difference} /> apart
              </>
            )
          }
        />
        <StatTile
          label="Penal interest and fees, this year"
          href={traceHref(earnings.penalAndFeesYear.trace)}
          value={<MoneyText paise={earnings.penalAndFeesYear.value} />}
          detail="Kept by the society in full"
        />
      </div>
    </Section>
  );
}

function Collections({ data }: { data: SocietyDashboard }) {
  const { summary, collections } = data;
  return (
    <Section label="What is due">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Due today"
          href="/collections"
          value={plural(summary.dueToday.count, 'instalment')}
          tone={summary.dueToday.count > 0 ? 'warn' : 'neutral'}
          detail={summary.dueToday.count > 0 ? <MoneyText paise={summary.dueToday.amount} /> : 'Nothing falls due today'}
        />
        <StatTile
          label="Overdue"
          href="/reports?tab=ageing"
          value={plural(summary.overdue.count, 'loan')}
          tone={summary.overdue.count > 0 ? 'bad' : 'good'}
          detail={
            summary.overdue.count > 0 ? (
              <>
                <MoneyText paise={summary.overdue.amount} /> · {summary.accruingPenal} past the grace period
              </>
            ) : (
              'Every member is up to date'
            )
          }
        />
        <StatTile
          label={collections ? `Collection efficiency, ${monthLabel(collections.from)}` : 'Collection efficiency'}
          href={collections ? `/reports?tab=collections&month=${collections.month}` : '/reports?tab=collections'}
          value={collections?.rate !== undefined ? percent(collections.rate, 1) : '–'}
          tone={collections?.rate === undefined ? 'neutral' : collections.rate >= 0.98 ? 'good' : collections.rate >= 0.9 ? 'warn' : 'bad'}
          detail={
            collections?.rate !== undefined ? (
              <>
                <MoneyText paise={collections.collected} /> of <MoneyText paise={collections.due} /> due
              </>
            ) : (
              'Nothing has fallen due yet'
            )
          }
        />
        <StatTile
          label="Next remittance to the federation"
          href={summary.nextRemittance ? `/tranches/${summary.nextRemittance.trancheId}` : '/tranches'}
          value={summary.nextRemittance ? <MoneyText paise={summary.nextRemittance.due.totalDue} /> : 'None due'}
          tone={summary.nextRemittance?.overdue ? 'bad' : 'neutral'}
          detail={
            summary.nextRemittance
              ? `${summary.nextRemittance.overdue ? 'Overdue since' : 'Due'} ${formatDate(summary.nextRemittance.dueOn)} · ${summary.nextRemittance.sanctionRef}`
              : 'No tranche is being serviced'
          }
        />
      </div>
    </Section>
  );
}

function Ageing({ data }: { data: SocietyDashboard }) {
  const { ageing } = data;
  const penalRate = useAppStore((s) => s.world.policy.penalRateBps);
  const ties = ageing.total === ageing.ledger.value;
  return (
    <Card role="region" aria-label="Ageing">
      <CardHeader>
        <CardTitle>Loans by days past due</CardTitle>
        <span className="text-sm">
          Past grace{' '}
          <span className={cn('font-semibold', ageing.atRisk.amount > 0 ? 'text-bad' : 'text-good')}>{percent(ageing.atRisk.share, 1)}</span>
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <AgeingBar buckets={ageing.buckets} total={ageing.total} />
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {ageing.buckets.map((b) => (
            <li key={b.key}>
              <Link to={`/reports?tab=ageing&bucket=${b.key}`} className="flex items-center justify-between gap-3 rounded px-1 hover:bg-muted">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span aria-hidden className={cn('size-2.5 rounded-sm', BUCKET_TONE[b.key])} />
                  {b.label} · {b.loans.length}
                </span>
                <MoneyText paise={b.amount} />
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {ties ? <Badge tone="good">Ties to the books</Badge> : <Badge tone="bad">Does not tie to the books</Badge>}{' '}
          The buckets add up to{' '}
          <Link to={tAccountHref(ACCOUNTS.LOANS_RECEIVABLE)} className="underline">
            Member Loans Receivable
          </Link>
          , <MoneyText paise={ageing.ledger.value} />. Penal interest of {formatBps(penalRate)} a year runs on loans past grace.
        </p>
      </CardContent>
    </Card>
  );
}
