import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'good' | 'warn' | 'bad';

const toneBar: Record<Tone, string> = {
  neutral: 'bg-border',
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
};

/** A labelled figure. With `href`, the whole tile is a link to where the figure comes from. */
export function StatTile(props: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const tone = props.tone ?? 'neutral';
  const body = (
    <>
      <span aria-hidden className={cn('ui-stat-tone absolute inset-y-0 left-0 w-1', toneBar[tone])} />
      <p className="ui-stat-label text-xs font-medium text-muted-foreground">{props.label}</p>
      <p className="ui-stat-value mt-1 text-xl font-semibold tabular-nums">{props.value}</p>
      {props.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{props.detail}</p> : null}
    </>
  );
  const frame = cn('ui-card ui-stat relative block overflow-hidden rounded-lg border bg-card px-4 py-3', props.className);
  return props.href ? (
    <Link to={props.href} className={cn(frame, 'transition-colors hover:border-ring')}>
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}
