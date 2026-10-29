import { ChevronRight } from 'lucide-react';
import { createContext, Fragment, useContext } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

/** Where the glass shell wants a page's breadcrumb: its top bar. Null outside the shell. */
export const CrumbSlot = createContext<HTMLElement | null>(null);

/** Where a detail page sits: each step but the last is a link back. */
export function Breadcrumb({ items }: { items: ReadonlyArray<{ label: string; to?: string }> }) {
  const slot = useContext(CrumbSlot);
  if (slot) {
    return createPortal(
      <nav aria-label="Breadcrumb" className="g-crumb">
        {items.map((item, i) => (
          <Fragment key={item.label}>
            {i > 0 ? <ChevronRight size={12} aria-hidden /> : null}
            {item.to ? <Link to={item.to}>{item.label}</Link> : <b>{item.label}</b>}
          </Fragment>
        ))}
      </nav>,
      slot,
    );
  }
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
