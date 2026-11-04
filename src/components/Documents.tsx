import { Check, FileText, Paperclip, X } from 'lucide-react';
import type { ChangeEvent } from 'react';
import type { AttachedDocument } from '@/domain/types';

/**
 * Documents on an application. Mock by design: picking a file records its name
 * and size and nothing more, so no contents are stored or sent anywhere.
 */

const kb = (size: number) => (size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`);

const sampleFor = (label: string): AttachedDocument => ({
  label,
  fileName: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
  size: 180_000 + label.length * 7_000,
});

const fromInput = (label: string, e: ChangeEvent<HTMLInputElement>): AttachedDocument | undefined => {
  const file = e.target.files?.[0];
  e.target.value = '';
  return file ? { label, fileName: file.name, size: file.size } : undefined;
};

/** A fixed list of documents to attach, each with its own file or a sample. */
export function DocumentSlots(props: {
  slots: readonly string[];
  value: readonly AttachedDocument[];
  onChange: (value: AttachedDocument[]) => void;
  invalid?: boolean;
}) {
  const { slots, value, onChange } = props;
  const put = (doc: AttachedDocument | undefined) => {
    if (doc) onChange([...value.filter((d) => d.label !== doc.label), doc]);
  };
  const missing = slots.filter((s) => !value.some((d) => d.label === s));
  return (
    <div className="g-docs" role="group" aria-label="Documents">
      <div className="g-docs-head">
        <span>
          {value.length} of {slots.length} attached
        </span>
        {missing.length > 0 ? (
          <button type="button" className="g-btn sm" onClick={() => onChange([...value, ...missing.map(sampleFor)])}>
            Use sample files
          </button>
        ) : null}
      </div>
      {slots.map((slot) => {
        const doc = value.find((d) => d.label === slot);
        return (
          <div key={slot} className={`g-doc${doc ? ' on' : props.invalid ? ' miss' : ''}`}>
            <span className="g-doc-icon" aria-hidden>
              {doc ? <Check /> : <FileText />}
            </span>
            <span className="g-doc-name">
              <b>{slot}</b>
              <small>{doc ? `${doc.fileName} · ${kb(doc.size)}` : 'Not attached yet'}</small>
            </span>
            {doc ? (
              <button type="button" className="g-btn sm ghost" aria-label={`Remove ${slot}`} onClick={() => onChange(value.filter((d) => d !== doc))}>
                <X aria-hidden />
              </button>
            ) : (
              <label className="g-btn sm">
                <Paperclip aria-hidden /> Attach
                <input type="file" className="sr-only" aria-label={`Attach ${slot}`} onChange={(e) => put(fromInput(slot, e))} />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Any number of documents, named by the person adding them. */
export function DocumentAdder(props: { value: readonly AttachedDocument[]; onChange: (value: AttachedDocument[]) => void }) {
  const { value, onChange } = props;
  return (
    <div className="g-docs" role="group" aria-label="Documents from the visit">
      {value.map((doc, i) => (
        <div key={`${doc.fileName}-${i}`} className="g-doc on">
          <span className="g-doc-icon" aria-hidden>
            <Check />
          </span>
          <span className="g-doc-name">
            <b>{doc.label}</b>
            <small>
              {doc.fileName} · {kb(doc.size)}
            </small>
          </span>
          <button type="button" className="g-btn sm ghost" aria-label={`Remove ${doc.label}`} onClick={() => onChange(value.filter((d) => d !== doc))}>
            <X aria-hidden />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <label className="g-btn sm">
          <Paperclip aria-hidden /> Upload a document or photo
          <input
            type="file"
            className="sr-only"
            aria-label="Upload a document or photo"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const doc = file ? fromInput(file.name.replace(/\.[^.]+$/, ''), e) : undefined;
              if (doc) onChange([...value, doc]);
            }}
          />
        </label>
        <button
          type="button"
          className="g-btn sm"
          onClick={() => onChange([...value, sampleFor(value.length === 0 ? 'Photo of the business' : `Visit photo ${value.length + 1}`)])}
        >
          Add a sample photo
        </button>
      </div>
    </div>
  );
}

/** Documents on file, to read. */
export function DocumentList({ documents, empty }: { documents: readonly AttachedDocument[]; empty?: string }) {
  if (documents.length === 0) return <p className="g-sub m-0">{empty ?? 'No documents on file.'}</p>;
  return (
    <div className="g-docs">
      {documents.map((doc, i) => (
        <div key={`${doc.label}-${i}`} className="g-doc on">
          <span className="g-doc-icon" aria-hidden>
            <Check />
          </span>
          <span className="g-doc-name">
            <b>{doc.label}</b>
            <small>
              {doc.fileName} · {kb(doc.size)}
            </small>
          </span>
        </div>
      ))}
    </div>
  );
}
