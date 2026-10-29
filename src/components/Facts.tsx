import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A compact grid of labelled facts, as a description list. */
export function Facts(props: { items: ReadonlyArray<{ label: string; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6', props.className)}>
      {props.items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
