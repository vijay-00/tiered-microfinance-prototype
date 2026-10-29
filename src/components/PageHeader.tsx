import type { ReactNode } from 'react';

export function PageHeader(props: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{props.title}</h1>
        {props.description ? <p className="mt-1 text-sm text-muted-foreground">{props.description}</p> : null}
      </div>
      {props.actions ? <div className="flex items-center gap-2">{props.actions}</div> : null}
    </header>
  );
}
