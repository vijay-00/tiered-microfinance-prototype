import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

/** Where a detail page sits: each step but the last is a link back. */
export function Breadcrumb({ items }: { items: ReadonlyArray<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
          {item.to ? (
            <Link to={item.to} className="hover:underline">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
