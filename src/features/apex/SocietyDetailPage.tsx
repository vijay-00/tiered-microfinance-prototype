import { CalendarDays, Check, CircleAlert, Clock, Download } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { FederationSocietyDetail } from '@/domain/federation';
import { formatBps, formatPaise } from '@/domain/money';
import { downloadCsv, rupeesCell, toCsv } from '@/lib/csv';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { BigMoney, LimitBar, Loading, Money, PageHead, Pill, PoolPill, PunctualityDots, TranchePill } from './glass';

const PUNCTUALITY_PILL = {
  ON_TIME: <Pill tone="good" icon={<Check aria-hidden />}>On the day</Pill>,
  LATE: <Pill tone="warn" icon={<Clock aria-hidden />}>Late</Pill>,
  SHORT: <Pill tone="bad" icon={<CircleAlert aria-hidden />}>Short</Pill>,
};

/** E5: one society as the federation sees it. */
export function SocietyDetailPage() {
  const { societyId = '' } = useParams();
  const version = useAppStore((s) => s.world.eventCount);
  const exists = useAppStore((s) => s.world.societies.some((x) => x.id === societyId));
  const repositories = useRepositories();
  const { data, error } = useQuery(`apex-society:${societyId}:${version}`, () =>
    exists ? repositories.apex.getSocietyDetail(societyId) : Promise.reject(new Error('missing')),
  );

  if (!exists) {
    return (
      <PageHead
        title="Society not found"
        sub={
          <>
            No society {societyId} belongs to the federation.{' '}
            <Link to="/apex/societies" className="underline">
              Back to societies
            </Link>
            .
          </>
        }
      />
    );
  }
  if (error) return <p className="g-error">The society could not be loaded: {error}</p>;
  if (!data) return <Loading />;
  return <Detail data={data} />;
}

function Detail({ data }: { data: FederationSocietyDetail }) {
  const clock = useAppStore((s) => s.world.clock);
  const { row, next } = data;
  const { society, track } = row;
  const used = society.creditLimit > 0 ? (row.sanctioned / society.creditLimit) * 100 : 0;
  const onTime = row.punctuality.filter((p) => p === 'ON_TIME').length;
  const submitted = data.pools.filter((p) => p.pool.submittedOn).length;
  const building = data.pools.filter((p) => !p.pool.submittedOn);

  return (
    <>
      <PageHead
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {society.name}
            {track.remittancesOverdue > 0 ? (
              <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
                {plural(track.remittancesOverdue, 'remittance')} overdue
              </Pill>
            ) : (
              <Pill tone="good" icon={<Check aria-hidden />}>
                Remittances current
              </Pill>
            )}
          </span>
        }
        sub={[
          `${society.district} district`,
          data.secretary ? `Secretary ${data.secretary.name}` : undefined,
          `${plural(row.members, 'member')}, ${row.borrowing} borrowing`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <button type="button" className="g-btn" onClick={() => downloadCsv(`${society.code}-remittances-${clock}.csv`, remittancesCsv(data))}>
            <Download aria-hidden /> Export CSV
          </button>
        }
      />
      <div className="g-dash">
        <section className="g-card g-blur g-s8" aria-label="Owed to the federation">
          <div className="g-cardhead">
            <span className="g-lbl">Owed to the federation</span>
            {track.atRisk.loans > 0 ? (
              <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
                {plural(track.atRisk.loans, 'member')} late
              </Pill>
            ) : (
              <Pill tone="good" icon={<Check aria-hidden />}>
                No member late
              </Pill>
            )}
          </div>
          <BigMoney paise={row.outstanding} />
          <div className="g-sub">
            {data.firstDrawOn ? (
              <>
                <Money paise={data.repaid} className="g-strong" /> repaid of the <Money paise={row.drawn} /> drawn since{' '}
                {formatDate(data.firstDrawOn)} · <Money paise={row.interestYear} className="g-strong" /> interest paid this year
              </>
            ) : (
              'Nothing drawn yet'
            )}
          </div>
          <div className="g-limh mt-6">
            <span>Credit limit used</span>
            <span>
              <b className="g-strong">{used.toFixed(1)}%</b> of <Money paise={society.creditLimit} />
            </span>
          </div>
          <LimitBar limit={society.creditLimit} drawn={row.drawn} undrawn={row.undrawn} height={10} className="mt-2.5" />
          <div className="mt-3 grid grid-cols-3 gap-4 text-[13px]">
            {(
              [
                ['Drawn', 'g-fedfill', row.drawn],
                ['Sanctioned, not drawn', 'g-undrawn', row.undrawn],
                ['Headroom', 'head', row.headroom],
              ] as const
            ).map(([label, key, paise]) => (
              <div key={label}>
                <span className="g-muted">
                  <i className={`g-key ${key}`} />
                  {label}
                </span>
                <b className="g-strong num block">
                  <Money paise={paise} />
                </b>
              </div>
            ))}
          </div>
        </section>

        <section className="g-card g-blur g-s4 g-col" aria-label="Next remittance">
          <div className="g-cardhead">
            <span className="g-lbl">Next remittance</span>
            {next ? (
              <Pill tone={next.inDays < 0 ? 'bad' : 'neutral'} icon={<Clock aria-hidden />}>
                {next.inDays < 0 ? `${plural(-next.inDays, 'day')} overdue` : next.inDays === 0 ? 'Due today' : `In ${plural(next.inDays, 'day')}`}
              </Pill>
            ) : null}
          </div>
          {next ? (
            <>
              <div className="g-mid num">
                <Money paise={next.amount} />
              </div>
              <div className="g-sub inline-flex items-center gap-1.5">
                <CalendarDays size={14} aria-hidden /> {formatDate(next.dueOn)} · tranche {next.sanctionRef}
              </div>
            </>
          ) : (
            <>
              <div className="g-mid">Nothing due</div>
              <div className="g-sub">No tranche is being repaid.</div>
            </>
          )}
          <div className="g-foot mt-auto">
            {row.punctuality.length ? (
              <span className="inline-flex items-center gap-2.5">
                <PunctualityDots items={row.punctuality} />
                <span>
                  <b className="g-strong">
                    {onTime} of {row.punctuality.length}
                  </b>{' '}
                  remittances on the day
                </span>
              </span>
            ) : (
              <span>No remittance made yet</span>
            )}
          </div>
        </section>

        <section className="g-card g-blur flush g-s6" aria-label="Remittances">
          <div className="g-listhead">
            <b>Remittances</b>
            {row.punctuality.length ? (
              <span className="rt">
                <Pill tone={onTime === row.punctuality.length ? 'good' : 'warn'} icon={<Check aria-hidden />}>
                  {onTime} of {row.punctuality.length} on the day
                </Pill>
              </span>
            ) : null}
          </div>
          {data.remittances.length === 0 ? (
            <p className="g-sub" style={{ padding: '20px var(--g-pad)', margin: 0 }}>
              Nothing remitted yet.
            </p>
          ) : (
            <div className="g-scroll">
              <table className="g-table">
                <caption className="sr-only">Remittances received from this society, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Due</th>
                    <th scope="col">Tranche</th>
                    <th scope="col" className="r">Amount</th>
                    <th scope="col" className="r">Punctuality</th>
                  </tr>
                </thead>
                <tbody>
                  {data.remittances.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        <b>{formatDate(r.dueOn)}</b>
                        {r.daysLate > 0 ? <span className="g-ref block">paid {formatDate(r.paidOn)}</span> : null}
                      </td>
                      <td className="g-ref">{r.sanctionRef}</td>
                      <td className="r">
                        <b className="num"><Money paise={r.paid} /></b>
                      </td>
                      <td className="r">
                        {PUNCTUALITY_PILL[r.punctuality]}
                        {r.daysLate > 0 ? <span className="g-ref block">{plural(r.daysLate, 'day')} late</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="g-s6 flex flex-col gap-[var(--g-gap)]">
          <section className="g-card g-blur flush" aria-label="Tranches">
            <div className="g-listhead">
              <b>Tranches</b>
              <span className="rt">{data.tranches.length}</span>
            </div>
            {data.tranches.length === 0 ? (
              <p className="g-sub" style={{ padding: '20px var(--g-pad)', margin: 0 }}>
                Nothing sanctioned yet.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {data.tranches.map((t) => {
                  const firstDraw = t.tranche.drawdowns[0]?.on;
                  return (
                    <li key={t.tranche.id} className="g-row">
                      <div className="t">
                        <b>
                          {t.tranche.sanctionRef} <TranchePill status={t.tranche.status} />
                        </b>
                        <span>
                          {t.drawn > 0 ? (
                            <>
                              <Money paise={t.drawn} /> drawn on {formatDate(firstDraw!)}
                            </>
                          ) : (
                            <Money paise={t.tranche.sanctionedAmount} />
                          )}{' '}
                          · {formatBps(t.tranche.wholesaleRateBps)} a year · {t.tranche.tenureMonths} months · for {t.poolReference}
                        </span>
                      </div>
                      <div className="v">
                        <b className="num">
                          <Money paise={t.drawn > 0 ? t.outstanding : t.drawn} />
                        </b>
                        <span>{t.drawn > 0 ? 'outstanding' : 'drawn so far'}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="g-card g-blur flush" aria-label="Batches">
            <div className="g-listhead">
              <b>Batches</b>
              <span className="rt">
                {submitted} submitted{building.length ? ` · ${building.map((p) => '/' + p.pool.reference.split('/').pop()).join(', ')} being built` : ''}
              </span>
            </div>
            {data.pools.length === 0 ? (
              <p className="g-sub" style={{ padding: '20px var(--g-pad)', margin: 0 }}>
                No batch built yet.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {data.pools.map(({ pool, tranche, rescope, asked }) => {
                  const askedBefore = pool.rescope?.askedBefore ?? asked;
                  return (
                    <li key={pool.id} className="g-row">
                      <div className="t">
                        <b>
                          {pool.submittedOn ? (
                            <Link to={`/apex/requests/${pool.id}`} className="hover:underline">
                              {pool.reference}
                            </Link>
                          ) : (
                            pool.reference
                          )}{' '}
                          <PoolPill status={pool.status} rescope={rescope} />
                        </b>
                        <span>
                          {plural(pool.applicationIds.length, 'member')}
                          {tranche
                            ? tranche.sanctionedAmount >= askedBefore
                              ? ' · sanctioned in full'
                              : ` · asked ${formatPaise(askedBefore)}, sanctioned ${Math.round((tranche.sanctionedAmount / askedBefore) * 100)}%`
                            : pool.submittedOn
                              ? ` · submitted ${formatDate(pool.submittedOn)}`
                              : ''}
                        </span>
                      </div>
                      <div className="v">
                        <b className="num">
                          <Money paise={tranche ? tranche.sanctionedAmount : pool.requestedAmount} />
                        </b>
                        <span>{tranche ? 'sanctioned' : 'requested'}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function remittancesCsv(data: FederationSocietyDetail): string {
  return toCsv(
    ['Due', 'Paid on', 'Tranche', 'Amount', 'Punctuality', 'Days late'],
    data.remittances.map((r) => [
      r.dueOn,
      r.paidOn,
      r.sanctionRef,
      rupeesCell(r.paid),
      r.punctuality === 'ON_TIME' ? 'On the day' : r.punctuality === 'LATE' ? 'Late' : 'Short',
      r.daysLate,
    ]),
  );
}
