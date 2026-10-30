import { Check, ChevronRight, Clock, Download, Eye, Send, TriangleAlert, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { FundingDesk } from '@/domain/federation';
import { downloadCsv, rupeesCell, toCsv } from '@/lib/csv';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { Avatar, Loading, Money, PageHead, Pill, WaitTicks } from './glass';

const short = (name: string) => name.replace(/ Credit Society$/, '');

/** E2: pools submitted by societies, oldest first, and the decisions already taken. */
export function FundingRequestsPage() {
  const version = useAppStore((s) => s.world.eventCount);
  const federation = useAppStore((s) => s.world.federation);
  const clock = useAppStore((s) => s.world.clock);
  const repositories = useRepositories();
  const { data, error } = useQuery(`apex-desk:${version}`, () => repositories.apex.getDesk());

  return (
    <>
      <PageHead
        title="Funding requests"
        sub="Batches submitted by societies, oldest first"
        actions={
          data ? (
            <button type="button" className="g-btn" onClick={() => downloadCsv(`${federation.shortName}-requests-${clock}.csv`, deskCsv(data))}>
              <Download aria-hidden /> Export CSV
            </button>
          ) : null
        }
      />
      {error ? <p className="g-error">The requests could not be loaded: {error}</p> : null}
      {!data ? <Loading /> : <Desk data={data} />}
    </>
  );
}

function Desk({ data }: { data: FundingDesk }) {
  const { stats } = data;
  return (
    <>
      <div className="g-sum">
        <div>
          <span className="g-lbl">Waiting for a decision</span>
          <div className="g-fig">{plural(data.requests.length, 'request')}</div>
        </div>
        <div>
          <span className="g-lbl">Requested</span>
          <div className="g-fig num"><Money paise={stats.requested} /></div>
        </div>
        <div>
          <span className="g-lbl">Oldest waiting</span>
          <div className="g-fig">{data.requests.length ? plural(stats.oldestDays, 'day') : '–'}</div>
        </div>
        <div>
          <span className="g-lbl">Sanctioned this year</span>
          <div className="g-fig num"><Money paise={stats.sanctionedYear} /></div>
        </div>
        <div>
          <span className="g-lbl">Average time to decide</span>
          <div className="g-fig">{stats.averageDays === undefined ? '–' : plural(Math.round(stats.averageDays), 'day')}</div>
        </div>
      </div>

      <section className="g-card g-blur flush" aria-label="Waiting for a decision">
        <div className="g-listhead">
          <b>Waiting for a decision</b>
          <em>{data.requests.length}</em>
          <span className="rt">
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Clock size={14} aria-hidden /> Turns red after 14 days
            </span>
          </span>
        </div>
        {data.requests.length === 0 ? (
          <p className="g-sub" style={{ padding: '20px var(--g-pad)', margin: 0 }}>
            Nothing is waiting for a decision.
          </p>
        ) : (
          <div className="g-scroll">
            <table className="g-table" style={{ minWidth: 980 }}>
              <caption className="sr-only">Batches awaiting a decision</caption>
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col" className="r">Members</th>
                  <th scope="col" className="r">Requested</th>
                  <th scope="col">Longest loan</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Days waiting</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map(({ pool, society, members, waitingDays }) => (
                  <tr key={pool.id} style={{ height: 80 }}>
                    <td>
                      <div className="g-who">
                        <Avatar name={society.name} />
                        <div>
                          <b>{short(society.name)}</b>
                          <Link to={`/apex/requests/${pool.id}`} className="g-ref hover:underline">
                            {pool.reference}
                          </Link>
                        </div>
                      </div>
                    </td>
                    <td className="r">{members}</td>
                    <td className="r"><b className="num"><Money paise={pool.requestedAmount} /></b></td>
                    <td>{pool.requestedTenureMonths} months</td>
                    <td>{pool.submittedOn ? formatDate(pool.submittedOn) : '–'}</td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <WaitTicks days={waitingDays} />
                        <b className={waitingDays > 14 ? 'g-neg' : undefined}>{plural(waitingDays, 'day')}</b>
                      </span>
                    </td>
                    <td>
                      {pool.status === 'UNDER_APEX_REVIEW' ? (
                        <Pill tone="warn" icon={<Eye aria-hidden />}>Under review</Pill>
                      ) : (
                        <Pill tone="neutral" icon={<Send aria-hidden />}>Submitted</Pill>
                      )}
                    </td>
                    <td className="r">
                      <Link to={`/apex/requests/${pool.id}`} className="g-btn pri sm">
                        {pool.status === 'UNDER_APEX_REVIEW' ? 'Continue review' : 'Open'} <ChevronRight aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="g-card g-blur flush" aria-label="Decided">
        <div className="g-listhead">
          <b>Decided</b>
          <em>{data.decided.length}</em>
          <span className="rt">Newest first</span>
        </div>
        {data.decided.length === 0 ? (
          <p className="g-sub" style={{ padding: '20px var(--g-pad)', margin: 0 }}>
            No batch has been decided yet.
          </p>
        ) : (
          <div className="g-scroll">
            <table className="g-table" style={{ minWidth: 980 }}>
              <caption className="sr-only">Batches the federation has decided, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col" className="r">Members</th>
                  <th scope="col" className="r">Requested</th>
                  <th scope="col" className="r">Sanctioned</th>
                  <th scope="col">Decided</th>
                  <th scope="col" className="r">Took</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Sanction</th>
                </tr>
              </thead>
              <tbody>
                {data.decided.map((d) => {
                  const asked = d.pool.rescope?.askedBefore ?? d.pool.requestedAmount;
                  return (
                    <tr key={d.pool.id} style={{ height: 58 }}>
                      <td>
                        <div className="g-who">
                          <Avatar name={d.society.name} />
                          <div>
                            <b>{short(d.society.name)}</b>
                            <Link to={`/apex/requests/${d.pool.id}`} className="g-ref hover:underline">
                              {d.pool.reference}
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td className="r">{d.pool.applicationIds.length}</td>
                      <td className="r"><Money paise={asked} /></td>
                      <td className="r">
                        {d.outcome === 'DECLINED' ? (
                          <span className="g-muted">–</span>
                        ) : (
                          <>
                            <b className="num"><Money paise={d.sanctioned} /></b>
                            {d.outcome === 'SHORT' ? (
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--g-warn)', fontWeight: 500 }}>
                                {Math.round((d.sanctioned / asked) * 100)}% of the request
                              </span>
                            ) : (
                              <span style={{ display: 'block', fontSize: 12 }} className="g-muted">In full</span>
                            )}
                          </>
                        )}
                      </td>
                      <td>{formatDate(d.decidedOn)}</td>
                      <td className="r">{d.took === undefined ? '–' : plural(d.took, 'day')}</td>
                      <td>
                        {d.outcome === 'DECLINED' ? (
                          <Pill tone="bad" icon={<X aria-hidden />}>Declined</Pill>
                        ) : d.outcome === 'SHORT' ? (
                          <Pill tone="warn" icon={<TriangleAlert aria-hidden />}>Sanctioned short</Pill>
                        ) : (
                          <Pill tone="good" icon={<Check aria-hidden />}>Sanctioned</Pill>
                        )}
                      </td>
                      <td className="g-ref">{d.tranche?.sanctionRef ?? d.pool.apexReview?.remarks ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function deskCsv(data: FundingDesk): string {
  return toCsv(
    ['Batch', 'Society', 'Members', 'Requested', 'Status', 'Submitted', 'Days waiting', 'Sanctioned', 'Decided', 'Took (days)', 'Sanction'],
    [
      ...data.requests.map((r) => [r.pool.reference, r.society.name, r.members, rupeesCell(r.pool.requestedAmount), r.pool.status === 'UNDER_APEX_REVIEW' ? 'Under review' : 'Submitted', r.pool.submittedOn ?? '', r.waitingDays, '', '', '', '']),
      ...data.decided.map((d) => [
        d.pool.reference,
        d.society.name,
        d.pool.applicationIds.length,
        rupeesCell(d.pool.rescope?.askedBefore ?? d.pool.requestedAmount),
        d.outcome === 'DECLINED' ? 'Declined' : d.outcome === 'SHORT' ? 'Sanctioned short' : 'Sanctioned',
        d.pool.submittedOn ?? '',
        '',
        rupeesCell(d.sanctioned),
        d.decidedOn,
        d.took ?? '',
        d.tranche?.sanctionRef ?? '',
      ]),
    ],
  );
}
