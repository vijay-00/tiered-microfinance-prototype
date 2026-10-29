import { Link, useSearchParams } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { MoneyText } from '@/components/finance/MoneyText';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { ACCOUNTS } from '@/domain/ledger';
import type { AgeingBucket, AgeingKey } from '@/domain/reporting';
import type { ID } from '@/domain/types';
import { cn } from '@/lib/cn';
import { rupeesCell, toCsv } from '@/lib/csv';
import { formatDate, plural } from '@/lib/format';
import { percent } from '@/lib/labels';
import { tAccountHref, traceHref } from '@/lib/ledgerLinks';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';

export const BUCKET_TONE: Record<AgeingKey, string> = {
  CURRENT: 'bg-good',
  GRACE: 'bg-warn/60',
  UPTO_30: 'bg-warn',
  UPTO_60: 'bg-bad/60',
  UPTO_90: 'bg-bad/80',
  OVER_90: 'bg-bad',
};

/** Principal outstanding by how late the loan is, as a single stacked bar. */
export function AgeingBar({ buckets, total }: { buckets: readonly AgeingBucket[]; total: number }) {
  return (
    <div
      className="flex h-3 overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={buckets.map((b) => `${b.label} ${percent(total ? b.amount / total : 0)}`).join(', ')}
    >
      {buckets.map((b) =>
        b.amount > 0 ? <span key={b.key} className={cn('h-full', BUCKET_TONE[b.key])} style={{ width: `${(b.amount / total) * 100}%` }} /> : null,
      )}
    </div>
  );
}

export function AgeingPanel({ societyId, filePrefix }: { societyId: ID; filePrefix: string }) {
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const [params, setParams] = useSearchParams();
  const { data, error } = useQuery(`ageing:${societyId}:${version}`, () => repositories.reports.getAgeing(societyId));
  if (error) return <p className="text-sm text-bad">The ageing could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={2} />;

  const selected = data.buckets.find((b) => b.key === params.get('bucket'));
  const loans = selected ? selected.loans : data.buckets.flatMap((b) => b.loans);
  const ties = data.total === data.ledger.value;
  const choose = (key?: AgeingKey) => {
    const next = new URLSearchParams(params);
    if (key) next.set('bucket', key);
    else next.delete('bucket');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <Card role="region" aria-label="Ageing buckets">
        <CardHeader>
          <CardTitle>Principal outstanding by days past due · {formatDate(data.asOf)}</CardTitle>
          <span className="text-sm">
            Portfolio at risk <span className={cn('font-semibold', data.atRisk.amount > 0 && 'text-bad')}>{percent(data.atRisk.share, 1)}</span>
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <AgeingBar buckets={data.buckets} total={data.total} />
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {data.buckets.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-pressed={selected?.key === b.key}
                onClick={() => choose(selected?.key === b.key ? undefined : b.key)}
                className={cn(
                  'rounded-md border px-3 py-2 text-left transition-colors hover:border-ring',
                  selected?.key === b.key && 'border-primary bg-accent/50',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className={cn('size-2 rounded-sm', BUCKET_TONE[b.key])} />
                  {b.label}
                </span>
                <span className="mt-0.5 block font-semibold tabular-nums"><MoneyText paise={b.amount} /></span>
                <span className="text-xs text-muted-foreground">{plural(b.loans.length, 'loan')}</span>
              </button>
            ))}
          </div>
          <p className="text-sm">
            Total <MoneyText paise={data.total} className="font-semibold" />{' '}
            {ties ? (
              <Badge tone="good">Ties to the books</Badge>
            ) : (
              <Badge tone="bad">Does not tie to the books</Badge>
            )}{' '}
            <Link to={tAccountHref(ACCOUNTS.LOANS_RECEIVABLE)} className="text-muted-foreground hover:underline">
              Member Loans Receivable <MoneyText paise={data.ledger.value} />
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {selected ? selected.label : 'Every active loan'} <span className="font-normal text-muted-foreground">· {loans.length}</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {selected ? (
              <button type="button" className="text-xs text-primary underline" onClick={() => choose(undefined)}>
                Show every bucket
              </button>
            ) : null}
            <CsvButton
              filename={`${filePrefix}-ageing.csv`}
              build={() =>
                toCsv(
                  ['Bucket', 'Loan', 'Member', 'Days past due', 'Arrears', 'Principal outstanding'],
                  data.buckets.flatMap((b) =>
                    b.loans.map((l) => [b.label, l.loanId, l.memberName, l.daysPastDue, rupeesCell(l.arrears), rupeesCell(l.outstanding)]),
                  ),
                )
              }
            />
          </div>
        </CardHeader>
        {loans.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No loan is in this bucket.</p>
        ) : (
          <Table>
            <caption className="sr-only">Loans and their principal outstanding</caption>
            <THead>
              <tr>
                <TH>Member</TH>
                <TH numeric>Days past due</TH>
                <TH numeric>Arrears</TH>
                <TH numeric>Principal outstanding</TH>
              </tr>
            </THead>
            <TBody>
              {loans.map((l) => (
                <tr key={l.loanId}>
                  <TD>
                    <Link to={`/loans/${l.loanId}`} className="font-medium hover:underline">{l.memberName}</Link>
                    <span className="block text-xs text-muted-foreground">{l.loanId}</span>
                  </TD>
                  <TD numeric className={l.daysPastDue > 0 ? 'text-bad' : 'text-muted-foreground'}>{l.daysPastDue}</TD>
                  <TD numeric>{l.arrears > 0 ? <MoneyText paise={l.arrears} /> : '–'}</TD>
                  <TD numeric>
                    <Link
                      to={traceHref({ plus: [ACCOUNTS.LOANS_RECEIVABLE], loanId: l.loanId })}
                      className="hover:underline"
                      title="The journal lines behind this balance"
                    >
                      <MoneyText paise={l.outstanding} />
                    </Link>
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
