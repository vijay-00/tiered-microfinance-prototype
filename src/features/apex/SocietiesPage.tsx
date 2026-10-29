import { Check, ChevronRight, CircleAlert, Clock, Download, MapPin, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { FederationHome, FederationSocietyRow } from '@/domain/federation';
import { downloadCsv, rupeesCell, toCsv } from '@/lib/csv';
import { plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { Avatar, BigMoney, LimitBar, Loading, Money, PageHead, Pill, PunctualityDots } from './glass';

const short = (name: string) => name.replace(/ Credit Society$/, '');

/** E4: each member society as a card: what it may draw, what it owes and how it repays. */
export function SocietiesPage() {
  const version = useAppStore((s) => s.world.eventCount);
  const federation = useAppStore((s) => s.world.federation);
  const clock = useAppStore((s) => s.world.clock);
  const repositories = useRepositories();
  const { data, error } = useQuery(`apex-home:${version}`, () => repositories.apex.getHome());

  return (
    <>
      <PageHead
        title="Societies"
        sub={`${data ? plural(data.societies.length, 'society', 'societies') : 'Societies'} borrow from ${federation.name.replace(/ Credit Federation$/, '')}. What each may draw, what it owes and how it repays.`}
        actions={
          data ? (
            <button type="button" className="g-btn" onClick={() => downloadCsv(`${federation.shortName}-societies-${clock}.csv`, societiesCsv(data))}>
              <Download aria-hidden /> Export CSV
            </button>
          ) : null
        }
      />
      {error ? <p className="g-error">The societies could not be loaded: {error}</p> : null}
      {!data ? <Loading /> : <Cards data={data} />}
    </>
  );
}

function Cards({ data }: { data: FederationHome }) {
  const { totals } = data;
  return (
    <>
      <div className="g-sum">
        <div>
          <span className="g-lbl">Credit limits</span>
          <div className="g-fig num"><Money paise={totals.creditLimit} /></div>
        </div>
        <div>
          <span className="g-lbl">Sanctioned</span>
          <div className="g-fig num"><Money paise={totals.sanctioned} /></div>
        </div>
        <div>
          <span className="g-lbl">Owed to the federation</span>
          <div className="g-fig num"><Money paise={totals.outstanding} /></div>
        </div>
        <div>
          <span className="g-lbl">Headroom</span>
          <div className="g-fig num"><Money paise={totals.headroom} /></div>
        </div>
        <div>
          <span className="g-lbl">Wholesale interest this year</span>
          <div className="g-fig num"><Money paise={totals.interestYear} /></div>
        </div>
      </div>
      <ul className="m-0 grid list-none gap-[var(--g-gap)] p-0 md:grid-cols-2 xl:grid-cols-3" aria-label="Member societies">
        {data.societies.map((row) => (
          <li key={row.society.id} className="contents">
            <SocietyCard row={row} />
          </li>
        ))}
      </ul>
    </>
  );
}

function SocietyCard({ row }: { row: FederationSocietyRow }) {
  const clock = useAppStore((s) => s.world.clock);
  const { society, track } = row;
  const to = `/apex/societies/${society.id}`;
  const used = society.creditLimit > 0 ? (row.sanctioned / society.creditLimit) * 100 : 0;
  const onTime = row.punctuality.filter((p) => p === 'ON_TIME').length;
  const waiting = row.awaitingReview[0];
  const waitingDays = waiting?.submittedOn ? Math.max(0, Math.round((Date.parse(clock) - Date.parse(waiting.submittedOn)) / 86_400_000)) : 0;
  const rescope = row.rescopePending[0];
  return (
    <article className="g-card g-blur flex flex-col" aria-labelledby={`soc-${society.id}`}>
      <div className="flex items-center gap-3">
        <Avatar name={society.name} />
        <div className="min-w-0 flex-1">
          <h2 id={`soc-${society.id}`} className="g-strong m-0 text-base">
            <Link to={to} className="hover:underline">
              {short(society.name)}
            </Link>
          </h2>
          <span className="g-ref inline-flex items-center gap-1">
            <MapPin size={12} aria-hidden /> {society.district} · {plural(row.members, 'member')}
          </span>
        </div>
        <Link to={to} className="g-btn ghost sm" aria-hidden tabIndex={-1}>
          <ChevronRight />
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {track.remittancesOverdue > 0 ? (
          <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
            {plural(track.remittancesOverdue, 'remittance')} overdue
          </Pill>
        ) : (
          <Pill tone="good" icon={<Check aria-hidden />}>
            Remittances current
          </Pill>
        )}
        {row.rescopePending.length > 0 ? (
          <Pill tone="warn" icon={<RotateCcw aria-hidden />}>
            Re-scope pending
          </Pill>
        ) : null}
        {row.awaitingReview.length > 0 ? (
          <Pill tone="warn" icon={<Clock aria-hidden />}>
            {plural(row.awaitingReview.length, 'pool')} to review
          </Pill>
        ) : null}
      </div>

      <span className="g-lbl mt-5">Owed to the federation</span>
      <BigMoney paise={row.outstanding} className="sm" />

      <div className="g-limh mt-5">
        <span>Credit limit used</span>
        <span>
          <b className="g-strong">{used.toFixed(1)}%</b> of <Money paise={society.creditLimit} />
        </span>
      </div>
      <LimitBar limit={society.creditLimit} drawn={row.drawn} undrawn={row.undrawn} className="mt-2.5" />
      <dl className="g-facts mt-2 text-[13px]">
        <Line label="Drawn" keyClass="g-fedfill" paise={row.drawn} />
        <Line label="Sanctioned, not drawn" keyClass="g-undrawn" paise={row.undrawn} />
        <Line label="Headroom" keyClass="head" paise={row.headroom} />
      </dl>

      <dl className="g-facts mt-3 border-t text-[13px]" style={{ borderColor: 'var(--g-line)' }}>
        <div className="flex-wrap" style={{ rowGap: 8 }}>
          <dt className="whitespace-nowrap">Remittances on the day</dt>
          <dd className="m-0 flex items-center gap-2.5 whitespace-nowrap">
            {row.punctuality.length ? (
              <>
                <PunctualityDots items={row.punctuality} />
                <b>
                  {onTime} of {row.punctuality.length}
                </b>
              </>
            ) : (
              <span className="g-muted">None due yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Members late</dt>
          <dd className="m-0">
            <b className={track.atRisk.loans > 0 ? 'g-neg' : undefined}>{track.atRisk.loans}</b>
          </dd>
        </div>
        <div>
          <dt>Wholesale interest this year</dt>
          <dd className="m-0">
            <b className="num"><Money paise={row.interestYear} /></b>
          </dd>
        </div>
      </dl>

      <div className="g-foot mt-auto pt-4">
        {waiting ? (
          <>
            <span>
              {waiting.reference} · waiting {plural(waitingDays, 'day')}
            </span>
            <Link to={`/apex/requests/${waiting.id}`} className="g-btn pri sm">
              Review <span className="sr-only">{waiting.reference}</span>
            </Link>
          </>
        ) : (
          <>
            <span>{rescope ? `${rescope.reference} sanctioned short` : 'No requests waiting'}</span>
            <Link to={to} className="g-btn sm">
              Open <span className="sr-only">{society.name}</span>
            </Link>
          </>
        )}
      </div>
    </article>
  );
}

function Line({ label, keyClass, paise }: { label: string; keyClass: string; paise: number }) {
  return (
    <div style={{ padding: '6px 0', borderBottom: 0 }} className={paise === 0 ? 'opacity-60' : undefined}>
      <dt>
        <i className={`g-key ${keyClass}`} />
        {label}
      </dt>
      <dd className="m-0">
        <b className="num"><Money paise={paise} /></b>
      </dd>
    </div>
  );
}

function societiesCsv(data: FederationHome): string {
  return toCsv(
    ['Society', 'District', 'Members', 'Credit limit', 'Sanctioned', 'Drawn', 'Outstanding', 'Headroom', 'On the day', 'Remittances', 'Members late', 'Interest this year'],
    data.societies.map((r) => [
      r.society.name,
      r.society.district,
      r.members,
      rupeesCell(r.society.creditLimit),
      rupeesCell(r.sanctioned),
      rupeesCell(r.drawn),
      rupeesCell(r.outstanding),
      rupeesCell(r.headroom),
      r.punctuality.filter((p) => p === 'ON_TIME').length,
      r.punctuality.length,
      r.track.atRisk.loans,
      rupeesCell(r.interestYear),
    ]),
  );
}
