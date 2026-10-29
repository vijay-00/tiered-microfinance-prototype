import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { JournalEntryTable } from '@/components/finance/JournalEntryTable';
import { MoneyText } from '@/components/finance/MoneyText';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { CHART_OF_ACCOUNTS } from '@/domain/ledger';
import type { TraceLine } from '@/domain/reporting';
import { journalSourceTypes, type ID } from '@/domain/types';
import { rupeesCell, toCsv } from '@/lib/csv';
import { formatDate, plural } from '@/lib/format';
import { describeAccounts, readTrace } from '@/lib/ledgerLinks';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { SOURCE_LABEL, useSourceLinks } from './useSourceLinks';

const PAGE = 50;

export function describeRange(from?: string, to?: string): string {
  if (from && to) return from === to ? `on ${formatDate(from)}` : `${formatDate(from)} to ${formatDate(to)}`;
  if (from) return `from ${formatDate(from)}`;
  if (to) return `up to ${formatDate(to)}`;
  return 'all dates';
}

/**
 * Every entry in the society's journal, newest first, filtered by account,
 * dates, source or loan. With accounts named it becomes a trace: the lines
 * behind one figure, totalled the way the figure was.
 */
export function JournalPanel({ societyId, filePrefix }: { societyId: ID; filePrefix: string }) {
  const [params, setParams] = useSearchParams();
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const links = useSourceLinks();
  const query = readTrace(params);
  const search = params.get('q') ?? '';
  const key = ['journal', societyId, version, params.get('accounts'), query.from, query.to, query.source, query.loanId].join(':');
  const { data, error, loading } = useQuery(key, () => repositories.ledger.getTrace(societyId, query));
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<ID>>(new Set());

  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setShown(PAGE);
    setParams(next, { replace: true });
  };

  const named = query.plus.length + (query.minus?.length ?? 0) > 0;
  const single = query.plus.length === 1 && !query.minus?.length ? String(query.plus[0]) : undefined;
  const linesByEntry = useMemo(() => {
    const map = new Map<ID, TraceLine[]>();
    for (const l of data?.lines ?? []) map.set(l.entry.id, [...(map.get(l.entry.id) ?? []), l]);
    return map;
  }, [data]);
  const term = search.trim().toLowerCase();
  const entries = (data?.entries ?? []).filter(
    (e) => !term || e.narration.toLowerCase().includes(term) || e.id.toLowerCase().includes(term),
  );
  const filtered = Boolean(params.get('accounts') || query.from || query.to || query.source || query.loanId || term);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Account">
            {({ id }) => (
              <NativeSelect id={id} value={single ?? (named ? 'trace' : '')} onChange={(e) => set({ accounts: e.target.value === 'trace' ? params.get('accounts') ?? undefined : e.target.value })}>
                <option value="">All accounts</option>
                {named && !single ? <option value="trace">{describeAccounts(query)}</option> : null}
                {CHART_OF_ACCOUNTS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="From">
            {({ id }) => <Input id={id} type="date" value={query.from ?? ''} onChange={(e) => set({ from: e.target.value })} />}
          </Field>
          <Field label="To">
            {({ id }) => <Input id={id} type="date" value={query.to ?? ''} onChange={(e) => set({ to: e.target.value })} />}
          </Field>
          <Field label="Source">
            {({ id }) => (
              <NativeSelect id={id} value={query.source ?? ''} onChange={(e) => set({ source: e.target.value })}>
                <option value="">Any</option>
                {journalSourceTypes.map((t) => (
                  <option key={t} value={t}>
                    {SOURCE_LABEL[t]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Search">
            {({ id }) => (
              <Input id={id} type="search" placeholder="Narration or entry" value={search} onChange={(e) => set({ q: e.target.value })} />
            )}
          </Field>
        </CardContent>
      </Card>

      {query.loanId || filtered ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {query.loanId ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-accent-foreground">
              Loan <Link to={`/loans/${query.loanId}`} className="font-medium hover:underline">{query.loanId}</Link>
              <button type="button" aria-label="Stop filtering by loan" onClick={() => set({ loan: undefined })}>
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-bad">The journal could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={2} />
      ) : (
        <>
          {named ? (
            <Card role="region" aria-label="Trace">
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">{describeAccounts(query)}</span>, {describeRange(query.from, query.to)}
                  {query.source ? `, ${SOURCE_LABEL[query.source].toLowerCase()} entries only` : ''}
                  {query.loanId ? `, for ${query.loanId}` : ''}.
                </p>
                <dl className="space-y-1">
                  {data.accounts.map((a) => (
                    <div key={a.account.code} className="flex flex-wrap justify-between gap-x-4 text-muted-foreground">
                      <dt>
                        {a.sign < 0 ? 'less ' : ''}
                        {a.account.code} {a.account.name}
                      </dt>
                      <dd className="tabular-nums">
                        Dr <MoneyText paise={a.dr} /> · Cr <MoneyText paise={a.cr} /> ·{' '}
                        <span className="font-medium text-foreground">
                          <MoneyText paise={a.balance} />
                        </span>
                      </dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 border-t pt-1 font-semibold">
                    <dt>Total</dt>
                    <dd>
                      <MoneyText paise={data.total} />
                    </dd>
                  </div>
                </dl>
                {data.excludesClosing ? (
                  <p className="text-xs text-muted-foreground">Period-close entries are left out, as on the income statement.</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card aria-busy={loading}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <p className="text-sm text-muted-foreground">{plural(entries.length, 'entry', 'entries')}</p>
              <CsvButton
                filename={`${filePrefix}-journal.csv`}
                build={() =>
                  toCsv(
                    ['Date', 'Entry', 'Narration', 'Source', 'Source id', 'Account', 'Account name', 'Debit', 'Credit'],
                    entries.flatMap((entry) =>
                      (linesByEntry.get(entry.id) ?? []).map((l) => [
                        entry.on,
                        entry.id,
                        entry.narration,
                        SOURCE_LABEL[entry.sourceType],
                        entry.sourceId,
                        l.account.code,
                        l.account.name,
                        rupeesCell(l.line.dr),
                        rupeesCell(l.line.cr),
                      ]),
                    ),
                  )
                }
              />
            </div>
            {entries.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No entry matches.</p>
            ) : (
              <Table>
                <caption className="sr-only">Journal entries, newest first</caption>
                <THead>
                  <tr>
                    <TH className="w-8">
                      <span className="sr-only">Lines</span>
                    </TH>
                    <TH>Date</TH>
                    <TH>Narration</TH>
                    <TH>Source</TH>
                    <TH numeric>Debit</TH>
                    <TH numeric>Credit</TH>
                  </tr>
                </THead>
                <TBody>
                  {entries.slice(0, shown).map((entry) => {
                    const lines = linesByEntry.get(entry.id) ?? [];
                    const dr = named ? lines.reduce((t, l) => t + l.line.dr, 0) : entry.lines.reduce((t, l) => t + l.dr, 0);
                    const cr = named ? lines.reduce((t, l) => t + l.line.cr, 0) : dr;
                    const expanded = open.has(entry.id);
                    const link = links(entry);
                    return (
                      <Fragment key={entry.id}>
                        <tr>
                          <TD>
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? 'Hide' : 'Show'} the lines of ${entry.id}`}
                              onClick={() =>
                                setOpen((current) => {
                                  const next = new Set(current);
                                  if (next.has(entry.id)) next.delete(entry.id);
                                  else next.add(entry.id);
                                  return next;
                                })
                              }
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                          </TD>
                          <TD className="whitespace-nowrap">{formatDate(entry.on)}</TD>
                          <TD>
                            {entry.narration}
                            <span className="block text-xs text-muted-foreground">{entry.id}</span>
                          </TD>
                          <TD className="text-xs">
                            {SOURCE_LABEL[entry.sourceType]}
                            {link ? (
                              <Link to={link.to} className="block hover:underline">
                                {link.label}
                              </Link>
                            ) : null}
                          </TD>
                          <TD numeric>{dr > 0 ? <MoneyText paise={dr} /> : null}</TD>
                          <TD numeric>{cr > 0 ? <MoneyText paise={cr} /> : null}</TD>
                        </tr>
                        {expanded ? (
                          <tr className="bg-muted/30">
                            <td colSpan={6} className="px-10 py-2">
                              <JournalEntryTable entry={entry} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TBody>
              </Table>
            )}
            {entries.length > shown ? (
              <div className="border-t px-4 py-2.5 text-center">
                <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, entries.length - shown)} more of {entries.length - shown}
                </Button>
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
