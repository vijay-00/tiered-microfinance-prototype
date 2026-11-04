import { Check, LocateFixed } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { DocumentAdder, DocumentList } from '@/components/Documents';
import { LoadingTiles } from '@/components/LoadingTiles';
import type { AttachedDocument } from '@/domain/types';
import type { VisitRow } from '@/domain/views';
import { formatTenure } from '@/domain/machines';
import { Money, PageHead } from '@/features/apex/glass';
import { formatDate } from '@/lib/format';
import { captureLocation, type VisitLocation } from '@/lib/geo';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { GeoTag, VisitSummary } from './VisitSummary';

/** One visit: who the member is, where the officer stood, and what they brought back. */
export function VisitDetailPage() {
  const { applicationId = '' } = useParams();
  const version = useAppStore((s) => s.world.eventCount);
  const users = useAppStore((s) => s.world.users);
  const repositories = useRepositories();
  const { data, error } = useQuery(`visit:${applicationId}:${version}`, () => repositories.visits.get(applicationId));

  if (error) return <p className="g-error">This visit could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={2} />;
  const officerName = users.find((u) => u.id === data.visit?.officerId)?.name ?? 'Field officer';
  const facts: [string, ReactNode][] = [
    ['Asked for', <Money key="a" paise={data.amount} />],
    ['Tenure', `${formatTenure(data.tenureMonths)}`],
    ['Loan type', PURPOSE_LABEL[data.purpose]],
    ['Occupation', data.occupation],
    ['Phone', data.phone],
    ['Applied', formatDate(data.appliedOn)],
  ];

  return (
    <>
      <Breadcrumb items={[{ label: 'Field visits', to: '/visits' }, { label: data.memberName }]} />
      <PageHead title={data.memberName} sub={`${data.village} · ${data.applicationId}`} />
      <div className="g-dash items-start">
        <div className="g-s5 flex flex-col gap-[var(--g-gap)]">
          <section className="g-card g-blur" aria-label="The application">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <span className="g-lbl">{label}</span>
                  <div className="g-strong num">{value}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="g-card g-blur flex flex-col gap-3" aria-label="Documents from the member">
            <span className="g-strong">Documents from the member</span>
            <DocumentList documents={data.documents} empty="The member attached no documents." />
          </section>
        </div>
        <div className="g-s7">{data.visit ? <VisitSummary visit={data.visit} officerName={officerName} /> : <VisitForm row={data} />}</div>
      </div>
    </>
  );
}

function VisitForm({ row }: { row: VisitRow }) {
  const repositories = useRepositories();
  const navigate = useNavigate();
  const [location, setLocation] = useState<VisitLocation>();
  const [locating, setLocating] = useState(false);
  const [documents, setDocuments] = useState<AttachedDocument[]>([]);
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function capture() {
    setLocating(true);
    setLocation(await captureLocation(row.village));
    setLocating(false);
  }

  async function complete() {
    if (!location) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.visits.record({ applicationId: row.applicationId, ...location, notes: notes.trim(), documents });
    setPending(false);
    if (result.ok) navigate('/visits');
    else setError(result.error);
  }

  return (
    <section className="g-card g-blur flex flex-col gap-4" aria-label="Record the visit">
      <div>
        <h2 className="g-strong m-0 text-lg">Record the visit</h2>
        <p className="g-sub m-0">Capture where you are with the member, add anything you collect, and finish. The secretary is told at once.</p>
      </div>

      <div className="g-field">
        <span className="g-lbl">1 · Location</span>
        {location ? (
          <GeoTag location={location} />
        ) : (
          <button type="button" className="g-btn pri" onClick={() => void capture()} disabled={locating} style={{ justifySelf: 'start' }}>
            <LocateFixed aria-hidden /> {locating ? 'Finding your location…' : 'Capture location'}
          </button>
        )}
      </div>

      <div className="g-field">
        <span className="g-lbl">2 · Documents and photos (optional)</span>
        <DocumentAdder value={documents} onChange={setDocuments} />
      </div>

      <div className="g-field">
        <label htmlFor="visit-notes">3 · What you saw</label>
        <textarea
          id="visit-notes"
          className="g-input"
          placeholder="The business, the household, references"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="g-error m-0">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--g-line2)' }}>
        {location ? <span className="g-sub m-0">Ready to record.</span> : <span className="g-sub m-0">Capture the location to finish.</span>}
        <div className="flex gap-2">
          <Link to="/visits" className="g-btn">
            Cancel
          </Link>
          <button type="button" className="g-btn pri" disabled={!location || pending} onClick={() => void complete()}>
            <Check aria-hidden /> {pending ? 'Saving…' : 'Complete visit'}
          </button>
        </div>
      </div>
    </section>
  );
}
