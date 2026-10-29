import { cn } from '@/lib/cn';

export function LoadingTiles({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn('grid gap-3', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ui-card h-[84px] animate-pulse rounded-lg border bg-muted" />
      ))}
    </div>
  );
}
