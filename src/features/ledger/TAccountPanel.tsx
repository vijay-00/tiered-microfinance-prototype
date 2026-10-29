import { Link, useSearchParams } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { MoneyText } from '@/components/finance/MoneyText';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { ACCOUNTS, CHART_OF_ACCOUNTS } from '@/domain/ledger';
import type { TAccountLine, TAccountView } from '@/domain/reporting';
import type { ID } from '@/domain/types';
import { cn } from '@/lib/cn';
import { rupeesCell, toCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { readAccount, readRange, traceHref } from '@/lib/ledgerLinks';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { describeRange } from './JournalPanel';
import { useSourceLinks } from './useSourceLinks';

type Side = 'DR' | 'CR';

/**
 * One account as a T: debits on the left, credits on the right, the balance
 * brought down from before the range and carried down at its end, so both
 * sides total alike as they would in a bound ledger.
 */
export function TAccountPanel({ societyId, filePrefix }: { societyId: ID; filePrefix: string }) {
  const [params, setParams] = useSearchParams();
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const code = readAccount(params, ACCOUNTS.CASH);
  const range = readRange(params);
  const { data, error } = useQuery(['t-account', societyId, version, code, range.from, range.to].join(':'), () =>
    repositories.ledger.getTAccount(societyId, code, range),
  );
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Field label="Account">
            {({ id }) => (
              <NativeSelect id={id} value={code} onChange={(e) => set({ account: e.target.value })}>
                {CHART_OF_ACCOUNTS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="From">
            {({ id }) => <Input id={id} type="date" value={range.from ?? ''} onChange={(e) => set({ from: e.target.value })} />}
          </Field>
          <Field label="To">
            {({ id }) => <Input id={id} type="date" value={range.to ?? ''} onChange={(e) => set({ to: e.target.value })} />}
          </Field>
        </CardContent>
      </Card>
      {error ? <p className="text-sm text-bad">The account could not be loaded: {error}</p> : null}
      {!data ? <LoadingTiles count={2} className="md:grid-cols-2" /> : <TAccount view={data} filePrefix={filePrefix} />}
    </div>
  );
}

function TAccount({ view, filePrefix }: { view: TAccountView; filePrefix: string }) {
  const { account, opening, closing } = view;
  const normal: Side = account.normal;
  const other: Side = normal === 'DR' ? 'CR' : 'DR';
  // A negative balance sits on the side opposite the account's normal one.
  const openingSide = opening >= 0 ? normal : other;
  const drSide = view.totalDr + (openingSide === 'DR' ? Math.abs(opening) : 0);
  const crSide = view.totalCr + (openingSide === 'CR' ? Math.abs(opening) : 0);
  const carried = Math.abs(drSide - crSide);
  const carriedSide: Side = drSide > crSide ? 'CR' : 'DR';
  const closingSide = closing >= 0 ? normal : other;

  return (
    <Card role="region" aria-label={`T-account ${account.code}`}>
      <CardHeader className="flex-wrap">
        <CardTitle>
          {account.code} {account.name}
          <span className="ml-2 font-normal text-muted-foreground">{describeRange(view.range.from, view.range.to)}</span>
        </CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-sm">
            Balance <span className="font-semibold"><MoneyText paise={Math.abs(closing)} /></span>{' '}
            <span className="text-muted-foreground">{closingSide === 'DR' ? 'Dr' : 'Cr'}</span>
          </span>
          <Link to={traceHref({ plus: [account.code], ...view.range })} className="text-xs text-primary underline">
            As journal lines
          </Link>
          <CsvButton
            filename={`${filePrefix}-${account.code}.csv`}
            build={() =>
              toCsv(
                ['Date', 'Entry', 'Narration', 'Debit', 'Credit'],
                [
                  ...(opening !== 0
                    ? [[view.range.from ?? '', '', 'Balance brought down', openingSide === 'DR' ? rupeesCell(Math.abs(opening)) : '', openingSide === 'CR' ? rupeesCell(Math.abs(opening)) : '']]
                    : []),
                  ...[...view.debits.map((l) => ({ l, side: 'DR' as const })), ...view.credits.map((l) => ({ l, side: 'CR' as const }))]
                    .sort((a, b) => (a.l.on < b.l.on ? -1 : a.l.on > b.l.on ? 1 : 0))
                    .map(({ l, side }) => [l.on, l.entryId, l.narration, side === 'DR' ? rupeesCell(l.amount) : '', side === 'CR' ? rupeesCell(l.amount) : '']),
                ],
              )
            }
          />
        </div>
      </CardHeader>
      <div className="grid md:grid-cols-2 md:divide-x">
        <Side
          title="Debit"
          lines={view.debits}
          opening={openingSide === 'DR' && opening !== 0 ? Math.abs(opening) : undefined}
          carried={carriedSide === 'DR' && carried !== 0 ? carried : undefined}
          total={Math.max(drSide, crSide)}
        />
        <Side
          title="Credit"
          lines={view.credits}
          opening={openingSide === 'CR' && opening !== 0 ? Math.abs(opening) : undefined}
          carried={carriedSide === 'CR' && carried !== 0 ? carried : undefined}
          total={Math.max(drSide, crSide)}
        />
      </div>
    </Card>
  );
}

function Side(props: { title: string; lines: readonly TAccountLine[]; opening?: number; carried?: number; total: number }) {
  const links = useSourceLinks();
  return (
    <section aria-label={props.title} className="flex flex-col">
      <h3 className="border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">{props.title}</h3>
      <ol className="max-h-[28rem] flex-1 divide-y overflow-y-auto text-sm">
        {props.opening !== undefined ? (
          <li className="flex justify-between gap-3 px-4 py-1.5 italic text-muted-foreground">
            <span>Balance brought down</span>
            <MoneyText paise={props.opening} />
          </li>
        ) : null}
        {props.lines.map((line) => {
          const link = links(line);
          return (
            <li key={`${line.entryId}-${line.amount}`} className="flex justify-between gap-3 px-4 py-1.5">
              <span className="min-w-0">
                <span className="mr-2 whitespace-nowrap text-xs text-muted-foreground">{formatDate(line.on)}</span>
                {link ? (
                  <Link to={link.to} className="hover:underline">
                    {line.narration}
                  </Link>
                ) : (
                  line.narration
                )}
              </span>
              <MoneyText paise={line.amount} />
            </li>
          );
        })}
        {props.lines.length === 0 && props.opening === undefined ? (
          <li className="px-4 py-1.5 text-muted-foreground">Nothing</li>
        ) : null}
        {props.carried !== undefined ? (
          <li className="flex justify-between gap-3 px-4 py-1.5 italic text-muted-foreground">
            <span>Balance carried down</span>
            <MoneyText paise={props.carried} />
          </li>
        ) : null}
      </ol>
      <p className={cn('flex justify-between border-t px-4 py-2 text-sm font-semibold')}>
        <span>Total</span>
        <MoneyText paise={props.total} />
      </p>
    </section>
  );
}
