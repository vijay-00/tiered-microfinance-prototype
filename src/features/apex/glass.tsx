import { Eye, Landmark, RefreshCw, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatPaise } from '@/domain/money';
import type { Punctuality } from '@/domain/federation';
import type { Paise, PoolStatus, TrancheStatus } from '@/domain/types';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';

/** Small parts of the federation's glass design, shared by its five screens. */

export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'accent';

export function Pill({ tone, icon, children, className }: { tone: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('g-pill', tone, className)}>
      {icon}
      {children}
    </span>
  );
}

/** A headline amount, in whole rupees like every amount on screen: ₹4,98,240. */
export function BigMoney({ paise, className }: { paise: Paise; className?: string }) {
  return <div className={cn('g-big num', paise < 0 && 'g-neg', className)}>{formatPaise(paise)}</div>;
}

export function Money({ paise, className }: { paise: Paise; className?: string }) {
  return <span className={cn('num', paise < 0 && 'g-neg', className)}>{formatPaise(paise)}</span>;
}

/** AN for Annapoorani Credit Society, SM for Sakthi Mahalir, DS for Dr. Sudha Ramanathan. */
export function initials(name: string): string {
  const words = name
    .replace(/ Credit (Society|Federation)$/, '')
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="g-av" aria-hidden>
      {initials(name)}
    </span>
  );
}

/**
 * A credit limit as drawn, sanctioned and not drawn, and headroom. The
 * undrawn part is hatched on the exposure table and solid but paler elsewhere.
 */
export function LimitBar(props: { limit: Paise; drawn: Paise; undrawn: Paise; hatched?: boolean; height?: number; className?: string }) {
  const pct = (n: Paise) => `${props.limit > 0 ? Math.max(0, Math.min(100, (n / props.limit) * 100)) : 0}%`;
  return (
    <div
      className={cn('g-bar', props.className)}
      style={props.height ? { height: props.height } : undefined}
      role="img"
      aria-label={`${formatPaise(props.drawn)} drawn and ${formatPaise(props.undrawn)} sanctioned but not drawn, of a ${formatPaise(props.limit)} limit`}
    >
      {props.drawn > 0 ? <span className="g-fedfill" style={{ width: pct(props.drawn) }} /> : null}
      {props.undrawn > 0 ? <span className={props.hatched ? 'g-hatch' : 'g-undrawn'} style={{ width: pct(props.undrawn) }} /> : null}
    </div>
  );
}

/** One dot per remittance: green on the day, amber late, red short. */
export function PunctualityDots({ items }: { items: readonly Punctuality[] }) {
  const onTime = items.filter((p) => p === 'ON_TIME').length;
  return (
    <span className="g-dots" role="img" aria-label={`${onTime} of ${items.length} remittances on the day`}>
      {items.map((p, i) => (
        <i key={i} className={p === 'LATE' ? 'late' : p === 'SHORT' ? 'short' : undefined} />
      ))}
    </span>
  );
}

/** Days waiting as fourteen ticks: amber up to two weeks, red past them. */
export function WaitTicks({ days }: { days: number }) {
  return (
    <span className={cn('g-ticks', days > 14 && 'over')} role="img" aria-label={`waiting ${plural(days, 'day')}`}>
      {Array.from({ length: 14 }, (_, i) => (
        <i key={i} className={i < Math.min(days, 14) ? 'on' : undefined} />
      ))}
    </span>
  );
}

const POOL_PILL: Record<PoolStatus, [Tone, string]> = {
  OPEN: ['neutral', 'Being built'],
  READY: ['neutral', 'Ready to submit'],
  SUBMITTED: ['neutral', 'Submitted'],
  UNDER_APEX_REVIEW: ['warn', 'Under review'],
  SANCTIONED: ['accent', 'Sanctioned'],
  DECLINED: ['bad', 'Declined'],
  DISBURSED: ['accent', 'Disbursed'],
  SERVICING: ['neutral', 'Servicing'],
  CLOSED: ['good', 'Closed'],
};

export function PoolPill({ status, rescope }: { status: PoolStatus; rescope?: boolean }) {
  if (rescope) return <Pill tone="warn" icon={<RotateCcw aria-hidden />}>Re-scope needed</Pill>;
  const [tone, label] = POOL_PILL[status];
  return (
    <Pill tone={tone} icon={status === 'SERVICING' ? <RefreshCw aria-hidden /> : status === 'UNDER_APEX_REVIEW' ? <Eye aria-hidden /> : undefined}>
      {label}
    </Pill>
  );
}

const TRANCHE_PILL: Record<TrancheStatus, [Tone, string]> = {
  SANCTIONED: ['neutral', 'Sanctioned'],
  PARTIALLY_DRAWN: ['accent', 'Part drawn'],
  DRAWN: ['accent', 'Drawn'],
  SERVICING: ['neutral', 'Servicing'],
  CLOSED: ['good', 'Closed'],
  DEFAULTED: ['bad', 'Defaulted'],
};

export function TranchePill({ status }: { status: TrancheStatus }) {
  const [tone, label] = TRANCHE_PILL[status];
  return (
    <Pill tone={tone} icon={status === 'SERVICING' ? <RefreshCw aria-hidden /> : status === 'SANCTIONED' ? <Landmark aria-hidden /> : undefined}>
      {label}
    </Pill>
  );
}

export function PageHead(props: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="g-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub ? <p>{props.sub}</p> : null}
      </div>
      {props.actions ? <div className="acts">{props.actions}</div> : null}
    </header>
  );
}

export function Loading() {
  return (
    <div className="g-dash" aria-busy="true" aria-label="Loading">
      {[8, 4, 4, 4, 4].map((span, i) => (
        <div key={i} className={cn('g-card', `g-s${span}`)} style={{ height: i === 0 ? 220 : 120, opacity: 0.6 }} />
      ))}
    </div>
  );
}
