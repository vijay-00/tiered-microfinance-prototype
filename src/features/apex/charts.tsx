import { useState } from 'react';
import type { FederationSocietyRow, FederationTrends } from '@/domain/federation';
import { formatPaise } from '@/domain/money';
import { plural } from '@/lib/format';
import { PURPOSE_LABEL } from '@/lib/labels';
import { Money } from './glass';

/** Charts on the federation's home screen, in plain HTML and SVG so they share the glass styles. */

const PLOT = 180;
const PRINCIPAL = 'var(--g-c-principal)';
const INTEREST = 'var(--g-c-interest)';
/** One colour per society, in register order, so a society keeps its colour on every chart. */
const SOCIETY_COLOURS = ['var(--g-c-principal)', 'var(--g-c-interest)', 'var(--g-c-third)'];

const DONUT = { size: 168, radius: 66, width: 18, gap: 2 };

/** Each society's share of what the federation is owed. Hover or focus a slice to read it in the middle. */
export function ExposureDonut({ societies }: { societies: readonly FederationSocietyRow[] }) {
  const [active, setActive] = useState<number>();
  const total = societies.reduce((a, r) => a + r.outstanding, 0);
  const circumference = 2 * Math.PI * DONUT.radius;
  const share = (n: number) => (total > 0 ? n / total : 0);
  const pct = (n: number) => `${Math.round(share(n) * 100)}%`;
  const short = (name: string) => name.replace(/ Credit Society$/, '');
  let offset = 0;
  const slices = societies.map((row, i) => {
    const length = share(row.outstanding) * circumference;
    const slice = { row, i, dash: Math.max(0, length - DONUT.gap), offset };
    offset += length;
    return slice;
  });
  const shown = active === undefined ? undefined : societies[active];
  // Concentration: how much of the book rests on one society.
  const largest = [...societies].sort((a, b) => b.outstanding - a.outstanding)[0];
  const c = DONUT.size / 2;

  return (
    <section className="g-card g-blur g-s3 g-col" aria-label="Owed by society">
      <div className="g-cardhead">
        <span className="g-lbl">Owed by society</span>
        <span className="g-ref">share of the book</span>
      </div>
      <div className="g-donut">
        <svg viewBox={`0 0 ${DONUT.size} ${DONUT.size}`} width={DONUT.size} height={DONUT.size} aria-hidden>
          <circle cx={c} cy={c} r={DONUT.radius} fill="none" stroke="var(--g-track)" strokeWidth={DONUT.width} />
          <g transform={`rotate(-90 ${c} ${c})`}>
            {slices.map((s) =>
              s.dash > 0 ? (
                <circle
                  key={s.row.society.id}
                  cx={c}
                  cy={c}
                  r={DONUT.radius}
                  fill="none"
                  stroke={SOCIETY_COLOURS[s.i % SOCIETY_COLOURS.length]}
                  strokeWidth={active === s.i ? DONUT.width + 6 : DONUT.width}
                  strokeDasharray={`${s.dash} ${circumference - s.dash}`}
                  strokeDashoffset={-s.offset}
                  opacity={active === undefined || active === s.i ? 1 : 0.4}
                  onMouseEnter={() => setActive(s.i)}
                  onMouseLeave={() => setActive(undefined)}
                  style={{ transition: 'opacity 0.15s, stroke-width 0.15s', cursor: 'default' }}
                />
              ) : null,
            )}
          </g>
        </svg>
        <div className="g-donut-mid" aria-live="polite">
          {shown ? (
            <>
              <span>{short(shown.society.name)}</span>
              <b className="num">{pct(shown.outstanding)}</b>
              <span className="num">{formatPaise(shown.outstanding)}</span>
            </>
          ) : (
            <>
              <span>Owed in all</span>
              <b className="num">{compact(total)}</b>
              <span>{plural(societies.length, 'society', 'societies')}</span>
            </>
          )}
        </div>
      </div>
      <ul className="m-0 mt-auto list-none p-0">
        {societies.map((row, i) => (
          <li
            key={row.society.id}
            className={`g-donut-row${active === i ? ' on' : ''}`}
            tabIndex={0}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(undefined)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(undefined)}
          >
            <i className="g-key" style={{ background: SOCIETY_COLOURS[i % SOCIETY_COLOURS.length] }} />
            <span className="min-w-0">
              <b className="g-strong block truncate">{short(row.society.name)}</b>
              <span className="g-ref num">
                <Money paise={row.outstanding} />
              </span>
            </span>
            <b className="g-strong num">{pct(row.outstanding)}</b>
          </li>
        ))}
      </ul>
      {largest && total > 0 ? (
        <p className="g-foot m-0">
          <span>
            Largest single exposure: <b className="g-strong">{short(largest.society.name)}</b>, {pct(largest.outstanding)} of the book
          </span>
        </p>
      ) : null}
    </section>
  );
}

/** A round step for about four gridlines, and the axis top it implies. */
function scale(top: number): { max: number; ticks: number[] } {
  if (top <= 0) return { max: 1, ticks: [0] };
  const rough = top / 4;
  const exp = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((s) => s >= rough)!;
  const max = Math.ceil(top / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
}

/** ₹2L, ₹50K: axis ticks in lakhs and thousands. */
function compact(paise: number): string {
  const rupees = paise / 100;
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  if (rupees >= 1e5) return `₹${trim(rupees / 1e5)}L`;
  if (rupees >= 1e3) return `₹${trim(rupees / 1e3)}K`;
  return `₹${rupees}`;
}

const monthName = (month: string, style: 'short' | 'long') =>
  new Date(`${month}T00:00:00`).toLocaleString('en-IN', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) });

export function RemittanceChart({ months }: { months: FederationTrends['months'] }) {
  const totals = months.map((m) => m.principal + m.interest);
  const { max, ticks } = scale(Math.max(...totals, 0));
  const px = (paise: number) => Math.max(0, (paise / max) * PLOT);
  const principal = months.reduce((a, m) => a + m.principal, 0);
  const interest = months.reduce((a, m) => a + m.interest, 0);
  const last = months.length - 1;
  return (
    <section className="g-card g-blur g-s6" aria-label="Remittances received by month">
      <div className="g-cardhead">
        <span className="g-lbl">Remittances received · by month</span>
        <span className="g-ref">
          <b className="g-strong num">
            <Money paise={principal + interest} />
          </b>{' '}
          since {monthName(months[0]!.month, 'short')}
        </span>
      </div>
      <div className="g-leg mt-3">
        <span>
          <i className="g-key" style={{ background: PRINCIPAL }} />
          Principal <b className="num"><Money paise={principal} /></b>
        </span>
        <span>
          <i className="g-key" style={{ background: INTEREST }} />
          Interest <b className="num"><Money paise={interest} /></b>
        </span>
      </div>
      <div className="g-plot" aria-hidden>
        {ticks.map((t) => (
          <div key={t} className="g-grid" style={{ bottom: `${(t / max) * 100}%` }}>
            <span>{compact(t)}</span>
          </div>
        ))}
        <div className="g-cols">
          {months.map((m, i) => (
            <div key={m.month} className="g-slot" tabIndex={0}>
              {i === last && totals[i]! > 0 ? <span className="g-cap num">{compact(totals[i]!)}</span> : null}
              <div className="g-stack">
                {m.principal > 0 ? <i style={{ height: px(m.principal), background: PRINCIPAL }} /> : null}
                {m.interest > 0 ? <i style={{ height: px(m.interest), background: INTEREST }} /> : null}
                <div className="g-tip">
                  <b>{monthName(m.month, 'long')}</b>
                  <div>
                    <span>Principal</span>
                    <b className="num">{formatPaise(m.principal)}</b>
                  </div>
                  <div>
                    <span>Interest</span>
                    <b className="num">{formatPaise(m.interest)}</b>
                  </div>
                  <div>
                    <span>{plural(m.remittances, 'remittance')}</span>
                    <b className="num">{formatPaise(totals[i]!)}</b>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="g-xaxis" aria-hidden>
        {months.map((m) => (
          <span key={m.month}>{monthName(m.month, 'short')}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Remittances received from societies by month this financial year</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Principal</th>
            <th scope="col">Interest</th>
            <th scope="col">Remittances</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{monthName(m.month, 'long')}</th>
              <td>{formatPaise(m.principal)}</td>
              <td>{formatPaise(m.interest)}</td>
              <td>{m.remittances}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function PurposeChart({ purposes }: { purposes: FederationTrends['purposes'] }) {
  const top = Math.max(1, ...purposes.map((p) => p.outstanding));
  const total = purposes.reduce((a, p) => a + p.outstanding, 0);
  return (
    <section className="g-card g-blur g-s3 g-col" aria-label="Member loans by purpose">
      <div className="g-cardhead">
        <span className="g-lbl">Loans by purpose</span>
      </div>
      <ul className="m-0 mt-3 list-none p-0">
        {purposes.map((p) => (
          <li key={p.purpose} className="g-hrow" tabIndex={0}>
            <span>
              <b className="g-strong">{PURPOSE_LABEL[p.purpose]}</b> <span className="g-ref">{plural(p.loans, 'loan')}</span>
            </span>
            <b className="g-strong num text-[13px]">
              <Money paise={p.outstanding} />
            </b>
            <span className="g-bar" aria-hidden>
              <span style={{ width: `${(p.outstanding / top) * 100}%`, background: INTEREST, borderRadius: 999 }} />
            </span>
            <span className="g-tip" aria-hidden>
              <b>{PURPOSE_LABEL[p.purpose]}</b>
              <span className="flex justify-between gap-3">
                <span>Share of the book</span>
                <b>{total > 0 ? Math.round((p.outstanding / total) * 100) : 0}%</b>
              </span>
              <span className="flex justify-between gap-3">
                <span>Average loan left</span>
                <b className="num">{formatPaise(Math.round(p.outstanding / p.loans))}</b>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="g-foot">
        <span>{plural(purposes.reduce((a, p) => a + p.loans, 0), 'loan')} running</span>
        <b className="g-strong num">
          <Money paise={total} />
        </b>
      </div>
    </section>
  );
}

/** How the interest members paid this year divided between the federation and the societies. */
export function InterestSplit({ split }: { split: FederationTrends['interestSplit'] }) {
  if (split.members <= 0) return null;
  const pct = (n: number) => Math.round((n / split.members) * 100);
  return (
    <>
      <div className="g-split" role="img" aria-label={`Of ${formatPaise(split.members)} members paid in interest, ${pct(split.federation)}% went to the federation and ${pct(split.societies)}% stayed with the societies`}>
        <span style={{ width: `${(split.federation / split.members) * 100}%`, background: PRINCIPAL }} />
        <span style={{ width: `${(split.societies / split.members) * 100}%`, background: INTEREST }} />
      </div>
      <div className="flex justify-between gap-3 text-[12px] text-[var(--g-muted)]">
        <span>
          <i className="g-key" style={{ background: PRINCIPAL }} />
          Federation {pct(split.federation)}%
        </span>
        <span>
          <i className="g-key" style={{ background: INTEREST }} />
          Societies kept <b className="g-strong num"><Money paise={split.societies} /></b>
        </span>
      </div>
    </>
  );
}
