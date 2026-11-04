import { ExternalLink, LocateFixed, MapPin } from 'lucide-react';
import { DocumentList } from '@/components/Documents';
import type { FieldVisit } from '@/domain/types';
import { Pill } from '@/features/apex/glass';
import { formatDate } from '@/lib/format';
import { mapLink, type VisitLocation } from '@/lib/geo';

/** The geo-tag as a pin on a plain grid, with its coordinates. */
export function GeoTag({ location }: { location: VisitLocation }) {
  const gps = location.locationSource === 'GPS';
  return (
    <div className="g-geo">
      <div className="g-geo-map" aria-hidden>
        <span className="g-geo-road a" />
        <span className="g-geo-road b" />
        <span className="g-geo-pulse" />
        <MapPin className="g-geo-pin" />
      </div>
      <div className="g-geo-info">
        <div className="flex flex-wrap items-center gap-2">
          <b className="num">
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
          </b>
          <Pill tone={gps ? 'good' : 'neutral'} icon={<LocateFixed aria-hidden />}>
            {gps ? 'Device GPS' : 'Demo location'}
          </Pill>
        </div>
        <span className="g-sub m-0">Within about {location.accuracyMetres} metres</span>
        <a href={mapLink(location.lat, location.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--g-accent)]">
          Open on a map <ExternalLink size={13} aria-hidden />
        </a>
      </div>
    </div>
  );
}

/** A visit on file, for the secretary and anyone reviewing the application. */
export function VisitSummary({ visit, officerName }: { visit: FieldVisit; officerName: string }) {
  return (
    <section className="g-card g-blur flex flex-col gap-3" aria-label="Field visit">
      <div className="g-cardhead">
        <span className="g-strong">Field visit</span>
        <span className="g-ref">
          {officerName} · {formatDate(visit.on)}
        </span>
      </div>
      <GeoTag location={visit} />
      {visit.notes ? <p className="g-sub m-0">“{visit.notes}”</p> : null}
      <DocumentList documents={visit.documents} empty="No documents uploaded from the visit." />
    </section>
  );
}
