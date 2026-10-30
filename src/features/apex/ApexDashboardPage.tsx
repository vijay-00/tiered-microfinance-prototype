import { ArrowUpRight, Check, ChevronRight, CircleAlert, Clock, Download, Eye, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { FederationHome, FederationTrends } from '@/domain/federation';
import { downloadCsv, rupeesCell, toCsv } from '@/lib/csv';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { ExposureDonut, InterestSplit, PurposeChart, RemittanceChart } from './charts';
import { Avatar, BigMoney, LimitBar, Loading, Money, PageHead, Pill } from './glass';

/** E1: the federation's book across its societies. */
export function ApexDashboardPage() {
  const federation = useAppStore((s) => s.world.federation);
  const clock = useAppStore((s) => s.world.clock);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const { data, error } = useQuery(`apex-home:${version}`, () => repositories.apex.getHome());
  const { data: trends } = useQuery(`apex-trends:${version}`, () => repositories.apex.getTrends());

  return (
    <>
      <PageHead
        title="Exposure"
        sub={`${federation.name} · ${data ? plural(data.societies.length, 'member society', 'member societies') : 'member societies'} as they stand today`}
        actions={
          data ? (
            <button type="button" className="g-btn" onClick={() => downloadCsv(`${federation.shortName}-exposure-${clock}.csv`, exposureCsv(data))}>
              <Download aria-hidden /> Export CSV
            </button>
          ) : null
        }
      />
      {error ? <p className="g-error">The figures could not be loaded: {error}</p> : null}
      {!data ? <Loading /> : <Exposure data={data} trends={trends} />}
    </>
  );
}

function Exposure({ data, trends }: { data: FederationHome; trends: FederationTrends | undefined }) {
  const graceDays = useAppStore((s) => s.world.policy.graceDays);
  const { totals } = data;
  const used = totals.creditLimit > 0 ? totals.sanctioned / totals.creditLimit : 0;
  const oldest = data.requests[0];
  return (
    <div className="g-dash">
      <section className="g-card g-blur g-s8" aria-label="Owed to the federation">
        <div className="g-cardhead">
          <span className="g-lbl">Owed to the federation</span>
          <Link to="/apex/societies" className="g-btn ghost sm">
            Societies <ChevronRight aria-hidden />
          </Link>
        </div>
        <BigMoney paise={totals.outstanding} />
        <div className="g-sub">
          Principal outstanding from {plural(data.societies.length, 'society', 'societies')} · <Money paise={totals.repaidYear} className="g-strong" /> repaid since{' '}
          {formatDate(data.yearFrom).replace(/ \d{4}$/, '')}
        </div>
        <div style={{ marginTop: 26 }}>
          <div className="g-limh">
            <span>Credit limits used</span>
            <span>
              <b className="num">
                <Money paise={totals.sanctioned} />
              </b>{' '}
              of <Money paise={totals.creditLimit} /> · {(used * 100).toFixed(1)}%
            </span>
          </div>
          <LimitBar limit={totals.creditLimit} drawn={totals.drawn} undrawn={totals.undrawn} hatched height={10} className="mt-2.5" />
          <div className="g-leg" style={{ marginTop: 12 }}>
            <span>
              <i className="g-key g-fedfill" />
              Drawn <b className="num"><Money paise={totals.drawn} /></b>
            </span>
            <span>
              <i className="g-key g-hatch" />
              Sanctioned, not drawn <b className="num"><Money paise={totals.undrawn} /></b>
            </span>
            <span>
              <i className="g-key head" />
              Headroom <b className="num"><Money paise={totals.headroom} /></b>
            </span>
          </div>
        </div>
      </section>

      <section className="g-card g-blur g-s4 g-col" aria-label="Awaiting your decision">
        <div className="g-cardhead">
          <span className="g-lbl">Awaiting your decision</span>
          {oldest ? (
            <Pill tone={oldest.waitingDays > 14 ? 'bad' : 'warn'} icon={<Clock aria-hidden />}>
              Waiting {plural(oldest.waitingDays, 'day')}
            </Pill>
          ) : null}
        </div>
        {oldest ? (
          <>
            <div className="g-mid num">
              <Money paise={oldest.pool.requestedAmount} />
            </div>
            <div className="g-sub">
              <b>{oldest.society.name.replace(/ Credit Society$/, '')}</b> · {plural(oldest.members, 'member')} · longest loan{' '}
              {oldest.pool.requestedTenureMonths} months
            </div>
            {data.requests.length > 1 ? <div className="g-sub">and {plural(data.requests.length - 1, 'more request')} behind it</div> : null}
            <div className="g-foot">
              <span>{oldest.pool.reference}</span>
              <Link to={`/apex/requests/${oldest.pool.id}`} className="g-btn sm">
                Review
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="g-mid">Nothing waiting</div>
            <div className="g-sub">Every batch submitted has been decided.</div>
          </>
        )}
      </section>

      <section className="g-card g-blur g-s4" aria-label="Undrawn commitments">
        <div className="g-cardhead">
          <span className="g-lbl">Undrawn commitments</span>
          <Link to="/apex/societies" aria-label="See the societies" className="g-muted">
            <ArrowUpRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="g-fig num">
          <Money paise={totals.undrawn} />
        </div>
        <div className="g-sub">
          {data.undrawn.length === 0
            ? 'Every sanction is fully drawn'
            : data.undrawn
                .map((u) => `${u.society.name.replace(/ Credit Society$/, '')}, ${u.rescope ? 'sanctioned short, awaiting re-scope' : 'sanctioned, not yet drawn'}`)
                .join('; ')}
        </div>
      </section>

      <section className="g-card g-blur g-s4" aria-label="Wholesale interest received">
        <div className="g-cardhead">
          <span className="g-lbl">Wholesale interest received · this year</span>
        </div>
        <div className="g-fig num">
          <Money paise={totals.interestYear} />
        </div>
        <div className="g-sub">
          {totals.remittancesYear > 0
            ? `${plural(totals.remittancesYear, 'remittance')} since ${formatDate(totals.firstRemittanceYear!)}, ${totals.onTimeYear} on the day`
            : 'No remittances yet this year'}
        </div>
        {trends ? <InterestSplit split={trends.interestSplit} /> : null}
      </section>

      <section className="g-card g-blur g-s4" aria-label="Member loans late">
        <div className="g-cardhead">
          <span className="g-lbl">Member loans over {graceDays} days late</span>
          {totals.late.loans > 0 ? (
            <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
              {plural(totals.late.loans, 'loan')}
            </Pill>
          ) : (
            <Pill tone="good" icon={<Check aria-hidden />}>
              None
            </Pill>
          )}
        </div>
        <div className="g-fig num">
          <Money paise={totals.late.principal} />
        </div>
        <div className="g-sub">
          {totals.late.loans > 0
            ? `Principal at ${totals.late.societies.map((n) => n.replace(/ Credit Society$/, '')).join(' and ')}`
            : 'Every member in every society is within grace'}
        </div>
      </section>

      {trends ? (
        <>
          <RemittanceChart months={trends.months} />
          <ExposureDonut societies={data.societies} />
          <PurposeChart purposes={trends.purposes} />
        </>
      ) : null}

      <section className="g-card g-blur flush g-s12" aria-label="Societies">
        <div className="g-listhead">
          <b>Societies</b>
          <div className="rt">
            <span>
              <i className="g-key g-fedfill" />
              Drawn
            </span>
            <span>
              <i className="g-key g-hatch" />
              Sanctioned, not drawn
            </span>
            <span>
              <i className="g-key head" />
              Headroom
            </span>
          </div>
        </div>
        <div className="g-scroll">
          <table className="g-table tall">
            <caption className="sr-only">Exposure to each society against its credit limit</caption>
            <thead>
              <tr>
                <th scope="col">Society</th>
                <th scope="col">Limit used</th>
                <th scope="col" className="r">Outstanding</th>
                <th scope="col">Remittances</th>
                <th scope="col">Members late</th>
                <th scope="col" className="r">Interest this year</th>
                <th scope="col">Batches</th>
              </tr>
            </thead>
            <tbody>
              {data.societies.map((row) => {
                const onTime = row.punctuality.filter((p) => p === 'ON_TIME').length;
                const usedPct = row.society.creditLimit > 0 ? Math.round((row.sanctioned / row.society.creditLimit) * 100) : 0;
                return (
                  <tr key={row.society.id}>
                    <th scope="row" style={{ textAlign: 'left', fontWeight: 400 }}>
                      <div className="g-who">
                        <Avatar name={row.society.name} />
                        <div>
                          <Link to={`/apex/societies/${row.society.id}`}>
                            <b>{row.society.name}</b>
                          </Link>
                          <span>
                            {row.society.district} · limit <Money paise={row.society.creditLimit} />
                          </span>
                        </div>
                      </div>
                    </th>
                    <td style={{ minWidth: 150, width: 190 }}>
                      <LimitBar limit={row.society.creditLimit} drawn={row.drawn} undrawn={row.undrawn} hatched />
                      <div className="g-limh" style={{ marginTop: 8, fontSize: 12 }}>
                        <b>{usedPct}%</b>
                        <span>
                          <Money paise={row.headroom} /> headroom
                        </span>
                      </div>
                    </td>
                    <td className="r">
                      <b className="num"><Money paise={row.outstanding} /></b>
                    </td>
                    <td>
                      <div className="g-stk">
                        {row.track.remittancesOverdue > 0 ? (
                          <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
                            {plural(row.track.remittancesOverdue, 'remittance')} overdue
                          </Pill>
                        ) : (
                          <Pill tone="good" icon={<Check aria-hidden />}>
                            Current
                          </Pill>
                        )}
                        <small>{row.punctuality.length ? `${onTime} of ${row.punctuality.length} on the day` : 'None due yet'}</small>
                      </div>
                    </td>
                    <td>
                      <div className="g-stk">
                        {row.track.atRisk.loans > 0 ? (
                          <>
                            <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
                              {row.track.atRisk.loans} late
                            </Pill>
                            <small>
                              <Money paise={row.track.atRisk.amount} /> principal
                            </small>
                          </>
                        ) : (
                          <Pill tone="good" icon={<Check aria-hidden />}>
                            None late
                          </Pill>
                        )}
                      </div>
                    </td>
                    <td className="r">
                      <Money paise={row.interestYear} />
                    </td>
                    <td>
                      <div className="g-stk">
                        {row.awaitingReview.length > 0 ? (
                          <Link to={`/apex/requests/${row.awaitingReview[0]!.id}`} className="g-pill warn">
                            <Eye aria-hidden /> {row.awaitingReview.length} to review <ChevronRight aria-hidden />
                          </Link>
                        ) : null}
                        {row.rescopePending.length > 0 ? (
                          <Pill tone="warn" icon={<RotateCcw aria-hidden />}>
                            Re-scope pending
                          </Pill>
                        ) : null}
                        {row.awaitingReview.length === 0 && row.rescopePending.length === 0 ? <span className="g-muted">— None</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function exposureCsv(data: FederationHome): string {
  return toCsv(
    ['Society', 'Credit limit', 'Sanctioned', 'Drawn', 'Outstanding', 'Headroom', 'On the day', 'Remittances', 'Members late', 'Late principal', 'Interest this year'],
    data.societies.map((r) => [
      r.society.name,
      rupeesCell(r.society.creditLimit),
      rupeesCell(r.sanctioned),
      rupeesCell(r.drawn),
      rupeesCell(r.outstanding),
      rupeesCell(r.headroom),
      r.punctuality.filter((p) => p === 'ON_TIME').length,
      r.punctuality.length,
      r.track.atRisk.loans,
      rupeesCell(r.track.atRisk.amount),
      rupeesCell(r.interestYear),
    ]),
  );
}
