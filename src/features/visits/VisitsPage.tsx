import { Check, ChevronRight, Landmark, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import type { VisitRow } from '@/domain/views';
import { Money, PageHead, Pill } from '@/features/apex/glass';
import { formatDate } from '@/lib/format';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

/** The field officer's home: who to visit, and who has been visited. */
export function VisitsPage() {
  const user = useAppStore(selectCurrentUser);
  const society = useAppStore((s) => s.world.societies.find((x) => x.id === user.societyId));
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const { data, error } = useQuery(`visits:${societyId}:${version}`, () => repositories.visits.list(societyId));

  return (
    <>
      <PageHead title="Field visits" sub={`${user.name} · ${society?.name ?? ''}`} />
      {error ? <p className="g-error">The visits could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={2} />
      ) : (
        <>
          <section className="g-card g-blur flush" aria-label="To visit">
            <div className="g-listhead">
              <b>To visit</b>
              <em>{data.due.length}</em>
            </div>
            {data.due.length === 0 ? (
              <p className="g-sub" style={{ padding: '20px var(--g-pad)', margin: 0 }}>
                No visits waiting. A new loan proposal appears here as soon as a member applies.
              </p>
            ) : (
              data.due.map((row) => <Row key={row.applicationId} row={row} />)
            )}
          </section>
          {data.done.length > 0 ? (
            <section className="g-card g-blur flush" aria-label="Visited">
              <div className="g-listhead">
                <b>Visited</b>
                <em>{data.done.length}</em>
              </div>
              {data.done.map((row) => (
                <Row key={row.applicationId} row={row} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function Row({ row }: { row: VisitRow }) {
  return (
    <div className="g-row">
      <div className="t">
        <b>
          {row.memberName}
          {row.route === 'FEDERATION' ? (
            <Pill tone="accent" icon={<Landmark aria-hidden />}>
              To the federation
            </Pill>
          ) : null}
        </b>
        <span className="inline-flex items-center gap-1">
          <MapPin size={12} aria-hidden /> {row.village} · {PURPOSE_LABEL[row.purpose]} · <Money paise={row.amount} /> · applied {formatDate(row.appliedOn)}
        </span>
      </div>
      <div className="v">
        {row.visit ? (
          <Link to={`/visits/${row.applicationId}`} className="g-pill good">
            <Check aria-hidden /> Visited {formatDate(row.visit.on)}
          </Link>
        ) : (
          <Link to={`/visits/${row.applicationId}`} className="g-btn pri sm">
            Start visit <ChevronRight aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
