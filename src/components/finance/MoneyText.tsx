import { formatPaise } from '@/domain/money';
import type { Paise } from '@/domain/types';
import { cn } from '@/lib/cn';

/**
 * Every amount on screen goes through this. It takes paise and never a float,
 * aligns digits in columns, and shows a negative in the warning colour.
 */
export function MoneyText({ paise, className }: { paise: Paise; className?: string }) {
  return <span className={cn('tabular-nums', paise < 0 && 'text-bad', className)}>{formatPaise(paise)}</span>;
}
