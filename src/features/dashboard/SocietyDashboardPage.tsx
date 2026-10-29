import { CalendarDays, Check, ChevronRight, CircleAlert, Clock, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { MoneyText } from '@/components/finance/MoneyText';
import { StatTile } from '@/components/finance/StatTile';
import { daysBetween } from '@/domain/dates';
import { ACCOUNTS } from '@/domain/ledger';
import { formatBps } from '@/domain/money';
import { monthLabel, type SocietyDashboard } from '@/domain/reporting';
import { BigMoney, Money, PageHead, Pill } from '@/features/apex/glass';
import { AgeingBar, BUCKET_TONE } from '@/features/reports/AgeingPanel';
import { cn } from '@/lib/cn';
import { formatDate, formatDateLong, plural } from '@/lib/format';
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
  const society = useAppStore((s) => s.world.societies.find((x) => x.id === user.societyId));
  const clock = useAppStore((s) => s.world.clock);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const { data, loading, error } = useQuery(`society-dashboard:${societyId}:${version}`, () =>
    repositories.society.getDashboard(societyId),
  );
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const short = society?.name.replace(/ Credit Society$/, '') ?? '';

  return (
    <>
      <PageHead
        title={`${greeting}, ${user.name.replace(/^(Dr|Mr|Mrs|Ms)\.? /, '').split(' ')[0]}`}
        sub={`${formatDateLong(clock)} · ${short}’s books as they stand today`}
      />
      {error ? <p className="g-error">The figures could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={8} className="sm:grid-cols-2 xl:grid-cols-4" />
      ) : (
        <div aria-busy={loading} className={cn('g-dash', loading && 'opacity-80 transition-opacity')}>
          <Margin data={data} />
          <NextRemittance data={data} />
          <Books data={data} />
          <Earnings data={data} />
          <Ageing data={data} />
        </div>
      )}
    </>
  );
}

function Margin({ data }: { data: SocietyDashboard }) {
  const { margin } = data;
  const close = Math.abs(margin.difference) <= 100;
  const share = margin.theoretical > 0 ? Math.max(0, Math.min(1, margin.realised.value / margin.theoretical)) : undefined;
  const behind = margin.scheduledRetail - margin.receivedRetail.value;
  return (
    <Link to="/reports" className="g-card g-blur g-s8 block transition-shadow hover:shadow-lg">
      <div className="g-cardhead">
        <span className="g-lbl">Realised against theoretical margin · this year</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold whitespace-nowrap text-[var(--g-accent)]">
          Margin report <ChevronRight size={14} aria-hidden />
        </span>
      </div>
      <BigMoney paise={margin.realised.value} />
      <div className="g-sub">
        {close ? (
          'On schedule: members paid what the schedules promised'
        ) : margin.difference < 0 ? (
          <>
            <b className="g-neg num">
              <Money paise={-margin.difference} /> below
            </b>{' '}
            what the schedules promised
          </>
        ) : (
          <>
            <b className="num">
              <Money paise={margin.difference} /> above
            </b>{' '}
            what the schedules promised
          </>
        )}
      </div>
      {share !== undefined ? (
        <>
          <div className="g-bar mt-6" style={{ height: 10 }} aria-hidden>
            <span style={{ width: `${share * 100}%`, background: 'var(--g-accent)', borderRadius: 999 }} />
          </div>
          <div className="g-limh mt-2.5">
            <span>
              <b className="g-strong">{Math.round(share * 100)}%</b> of the theoretical margin realised
            </span>
            <span className="num">
              Theoretical <MoneyText paise={margin.theoretical} />
            </span>
          </div>
        </>
      ) : null}
      {behind > 100 ? (
        <p className="g-sub mt-4 flex items-start gap-2 border-t pt-3" style={{ borderColor: 'var(--g-line2)' }}>
          <Info size={14} className="mt-0.5 shrink-0 text-[var(--g-warn)]" aria-hidden />
          <span>
            Members are <Money paise={behind} /> behind on interest; it comes back as they catch up, with penal interest on top.
          </span>
        </p>
      ) : null}
    </Link>
  );
}

function NextRemittance({ data }: { data: SocietyDashboard }) {
  const next = data.summary.nextRemittance;
  const clock = useAppStore((s) => s.world.clock);
  const federation = useAppStore((s) => s.world.federation);
  const inDays = next ? daysBetween(clock, next.dueOn) : 0;
  return (
    <section className="g-card g-blur g-s4 g-col" aria-label="Next remittance to the federation">
      <div className="g-cardhead">
        <span className="g-lbl">Next remittance</span>
        {next ? (
          <Pill tone={next.overdue ? 'bad' : 'neutral'} icon={<Clock aria-hidden />}>
            {next.overdue ? `${plural(-inDays, 'day')} overdue` : inDays === 0 ? 'Due today' : `In ${plural(inDays, 'day')}`}
          </Pill>
        ) : null}
      </div>
      {next ? (
        <>
          <div className="g-mid num">
            <Money paise={next.due.totalDue} />
          </div>
          <div className="g-sub inline-flex items-center gap-1.5">
            <CalendarDays size={14} aria-hidden /> {next.overdue ? 'Overdue since' : 'Due'} {formatDate(next.dueOn)} · to{' '}
            {federation.name.replace(/ Credit Federation$/, '')}
          </div>
          <div className="g-foot">
            <span>Tranche {next.sanctionRef}</span>
            <Link to={`/tranches/${next.trancheId}`} className="g-btn sm">
              Review
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="g-mid">None due</div>
          <div className="g-sub">No tranche is being serviced.</div>
        </>
      )}
    </section>
  );
}

function Books({ data }: { data: SocietyDashboard }) {
  const { books, summary } = data;
  return (
    <>
      <StatTile
        className="g-s3"
        label="Loans outstanding"
        href={traceHref(books.loansOutstanding.trace)}
        value={<MoneyText paise={books.loansOutstanding.value} />}
        detail={`${plural(summary.activeLoans, 'active loan')}, ${summary.closedLoans} closed`}
      />
      <StatTile
        className="g-s3"
        label="Owed to the federation"
        href={traceHref(books.federationPayable.trace)}
        value={<MoneyText paise={books.federationPayable.value} />}
        detail="Principal outstanding on tranches"
      />
      <StatTile
        className="g-s3"
        label="Cash and bank"
        href={traceHref(books.cash.trace)}
        value={<MoneyText paise={books.cash.value} />}
        tone={summary.liquidityBreach ? 'bad' : 'neutral'}
        detail={summary.liquidityBreach ? 'Below zero: a liquidity breach' : "Including the society's reserves"}
      />
      <StatTile
        className="g-s3"
        label="Advances held for members"
        href={traceHref(books.advancesHeld.trace)}
        value={<MoneyText paise={books.advancesHeld.value} />}
        detail="Paid ahead, applied as instalments fall due"
      />
    </>
  );
}

function Earnings({ data }: { data: SocietyDashboard }) {
  const { earnings, summary, collections } = data;
  const rateTone = collections?.rate === undefined ? 'neutral' : collections.rate >= 0.98 ? 'good' : collections.rate >= 0.9 ? 'warn' : 'bad';
  return (
    <>
      <StatTile
        className="g-s3"
        label="Net interest income, this month"
        href={traceHref(earnings.month.trace)}
        value={<MoneyText paise={earnings.month.value} />}
        tone={earnings.month.value < 0 ? 'bad' : 'neutral'}
        detail={`Since ${formatDate(earnings.month.trace.from!)}: member interest less federation interest`}
      />
      <StatTile
        className="g-s3"
        label="Net interest income, this year"
        href={traceHref(earnings.year.trace)}
        value={<MoneyText paise={earnings.year.value} />}
        detail={`Financial year from ${formatDate(earnings.year.trace.from!)}`}
      />
      <StatTile
        className="g-s3"
        label="Penal interest and fees, this year"
        href={traceHref(earnings.penalAndFeesYear.trace)}
        value={<MoneyText paise={earnings.penalAndFeesYear.value} />}
        detail="Kept by the society in full"
      />
      <section className="ui-card ui-stat g-s3 relative rounded-lg border bg-card" aria-label="Overdue">
        <div className="flex items-center justify-between gap-2">
          <Link to="/reports?tab=ageing" className="ui-stat-label text-xs font-medium text-muted-foreground hover:underline">
            Overdue
          </Link>
          {summary.overdue.count > 0 ? (
            <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
              Action needed
            </Pill>
          ) : (
            <Pill tone="good" icon={<Check aria-hidden />}>
              All current
            </Pill>
          )}
        </div>
        <p className="ui-stat-value mt-1 text-xl font-semibold tabular-nums">{plural(summary.overdue.count, 'loan')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.overdue.count > 0 ? (
            <>
              <MoneyText paise={summary.overdue.amount} /> · {summary.accruingPenal} past the grace period
            </>
          ) : (
            'Every member is up to date'
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.dueToday.count > 0 ? `${plural(summary.dueToday.count, 'instalment')} due today · ` : null}
          <Link
            to={collections ? `/reports?tab=collections&month=${collections.month}` : '/reports?tab=collections'}
            className="hover:underline"
          >
            {collections ? `Collection efficiency, ${monthLabel(collections.from)}` : 'Collection efficiency'}{' '}
            <b className={cn('tabular-nums', rateTone === 'bad' && 'text-bad', rateTone === 'warn' && 'text-warn')}>
              {collections?.rate !== undefined ? percent(collections.rate, 1) : '–'}
            </b>
          </Link>
        </p>
      </section>
    </>
  );
}

function Ageing({ data }: { data: SocietyDashboard }) {
  const { ageing } = data;
  const penalRate = useAppStore((s) => s.world.policy.penalRateBps);
  const ties = ageing.total === ageing.ledger.value;
  return (
    <section className="g-card g-blur g-s12" role="region" aria-label="Ageing">
      <div className="g-cardhead flex-wrap">
        <span className="g-lbl">Loans by days past due</span>
        <span className="flex flex-wrap gap-1.5">
          <Pill tone={ageing.atRisk.amount > 0 ? 'bad' : 'good'} icon={ageing.atRisk.amount > 0 ? <CircleAlert aria-hidden /> : <Check aria-hidden />}>
            {percent(ageing.atRisk.share, 1)} past grace
          </Pill>
          {ties ? (
            <Pill tone="good" icon={<Check aria-hidden />}>
              Ties to the books
            </Pill>
          ) : (
            <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
              Does not tie to the books
            </Pill>
          )}
        </span>
      </div>
      <div className="mt-4">
        <AgeingBar buckets={ageing.buckets} total={ageing.total} />
      </div>
      <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-x-6 gap-y-3 p-0 sm:grid-cols-3 xl:grid-cols-6">
        {ageing.buckets.map((b) => (
          <li key={b.key}>
            <Link
              to={`/reports?tab=ageing&bucket=${b.key}`}
              className={cn('block rounded-lg px-1 py-0.5 hover:bg-muted', b.amount === 0 && 'opacity-60')}
            >
              <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span aria-hidden className={cn('size-2.5 rounded-sm', BUCKET_TONE[b.key])} />
                {b.label} · {b.loans.length}
              </span>
              <b className="mt-0.5 block text-[13px] font-semibold tabular-nums">
                <MoneyText paise={b.amount} />
              </b>
            </Link>
          </li>
        ))}
      </ul>
      <p className="g-sub mt-4">
        The buckets add up to{' '}
        <Link to={tAccountHref(ACCOUNTS.LOANS_RECEIVABLE)} className="underline">
          Member Loans Receivable
        </Link>
        , <MoneyText paise={ageing.ledger.value} />. Penal interest of {formatBps(penalRate)} a year runs on loans past grace.
      </p>
    </section>
  );
}
