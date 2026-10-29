import type { Paise } from '@/domain/types';
import { cn } from '@/lib/cn';
import { MoneyText } from './MoneyText';

/**
 * Where an amount goes: the federation's share against what the society keeps,
 * and anything held as an advance. The same picture wherever money is split,
 * so the reconciliation reads identically on every screen.
 */
export function SplitBar(props: {
  toFederation: Paise;
  retained: Paise;
  advance?: Paise;
  className?: string;
  showLegend?: boolean;
}) {
  const advance = props.advance ?? 0;
  const total = props.toFederation + props.retained + advance;
  const pct = (n: Paise) => (total > 0 ? (n / total) * 100 : 0);
  const parts = [
    { key: 'federation', label: 'To the federation', value: props.toFederation, swatch: 'bg-primary' },
    { key: 'retained', label: 'Kept by the society', value: props.retained, swatch: 'bg-good' },
    ...(advance > 0 ? [{ key: 'advance', label: 'Held as advance', value: advance, swatch: 'bg-warn' }] : []),
  ];
  return (
    <div className={props.className}>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${Math.round(pct(p.value))}%`).join(', ')}
      >
        {parts.map((p) =>
          p.value > 0 ? (
            <span key={p.key} className={cn('h-full', p.swatch)} style={{ width: `${pct(p.value)}%` }} />
          ) : null,
        )}
      </div>
      {props.showLegend !== false ? (
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {parts.map((p) => (
            <div key={p.key} className="flex items-center gap-2">
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-sm', p.swatch)} />
              <dt className="text-muted-foreground">{p.label}</dt>
              <dd className="ml-auto font-medium">
                <MoneyText paise={p.value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
