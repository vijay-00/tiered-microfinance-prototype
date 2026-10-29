import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Plain semantic tables with the app's density. Numbers right-align via `numeric`. */

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="ui-table-wrap relative overflow-x-auto">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('ui-thead border-b bg-muted/50 text-xs text-muted-foreground', className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y', className)} {...props} />;
}

export function TH({
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn('px-3 py-2 font-medium whitespace-nowrap', numeric ? 'text-right' : 'text-left', className)}
      {...props}
    />
  );
}

export function TD({
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn('px-3 py-2 align-top', numeric && 'text-right tabular-nums', className)} {...props} />;
}
