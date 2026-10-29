import { Link, useSearchParams } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { MoneyText } from '@/components/finance/MoneyText';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { endOfMonth } from '@/domain/dates';
import { ACCOUNTS } from '@/domain/ledger';
import { monthLabel, type CollectionMonth } from '@/domain/reporting';
import type { ID } from '@/domain/types';
import { cn } from '@/lib/cn';
import { rupeesCell, toCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { percent } from '@/lib/labels';
import { traceHref } from '@/lib/ledgerLinks';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';

export function rateTone(rate: number | undefined): string | undefined {
  if (rate === undefined) return undefined;
  return rate >= 0.98 ? 'text-good' : rate >= 0.9 ? 'text-warn' : 'text-bad';
}

/**
 * Of the instalments that fell due each month, how much was paid by the
 * month's end. Arrears paid later improve the month they are paid in, not the
 * month they fell due, so a bad month stays visible.
 */
export function CollectionsPanel({ societyId, filePrefix }: { societyId: ID; filePrefix: string }) {
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const [params, setParams] = useSearchParams();
  const { data: months, error } = useQuery(`collection-months:${societyId}:${version}`, () =>
    repositories.reports.getCollections(societyId),
  );
  const chosen = months?.find((m) => m.month === params.get('month')) ?? [...(months ?? [])].reverse().find((m) => m.instalments > 0);
  const { data: dues } = useQuery(`collection-dues:${societyId}:${version}:${chosen?.from}:${chosen?.to}`, () =>
    chosen ? repositories.reports.getCollectionDues(societyId, { from: chosen.from, to: chosen.to }) : Promise.resolve([]),
  );
  if (error) return <p className="text-sm text-bad">Collections could not be loaded: {error}</p>;
  if (!months) return <LoadingTiles count={2} />;
  if (months.length === 0) return <p className="text-sm text-muted-foreground">No instalment has fallen due yet.</p>;

  const choose = (m: CollectionMonth) => {
    const next = new URLSearchParams(params);
    next.set('month', m.month);
    setParams(next, { replace: true });
  };
  const rows = [...months].reverse();

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Collection efficiency by month</CardTitle>
          <CsvButton
            filename={`${filePrefix}-collections.csv`}
            build={() =>
              toCsv(
                ['Month', 'Instalments', 'Paid in full', 'Due', 'Collected by month end', 'Efficiency', 'Cash received from members'],
                rows.map((m) => [m.month, m.instalments, m.paidInFull, rupeesCell(m.due), rupeesCell(m.collected), m.rate === undefined ? '' : (m.rate * 100).toFixed(1), rupeesCell(m.received.value)]),
              )
            }
          />
        </CardHeader>
        <Table>
          <caption className="sr-only">Collection efficiency by month, newest first</caption>
          <THead>
            <tr>
              <TH>Month</TH>
              <TH numeric>Instalments</TH>
              <TH numeric>Due</TH>
              <TH numeric>Collected</TH>
              <TH numeric>Efficiency</TH>
              <TH numeric>Cash received</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((m) => (
              <tr key={m.month} className={cn(chosen?.month === m.month && 'bg-accent/40')}>
                <TD>
                  <button type="button" className="font-medium hover:underline" onClick={() => choose(m)} aria-pressed={chosen?.month === m.month}>
                    {monthLabel(m.from)}
                  </button>
                  {m.to !== endOfMonth(m.from) ? (
                    <span className="block text-xs text-muted-foreground">to {formatDate(m.to)}</span>
                  ) : null}
                </TD>
                <TD numeric>
                  {m.paidInFull} of {m.instalments}
                </TD>
                <TD numeric><MoneyText paise={m.due} /></TD>
                <TD numeric><MoneyText paise={m.collected} /></TD>
                <TD numeric className={cn('font-medium', rateTone(m.rate))}>{m.rate === undefined ? '–' : percent(m.rate, 1)}</TD>
                <TD numeric>
                  <Link to={traceHref(m.received.trace)} className="hover:underline" title="The receipts in the journal">
                    <MoneyText paise={m.received.value} />
                  </Link>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Cash received includes arrears from earlier months, prepayments and penal interest, so it need not match what was collected against the month&rsquo;s own instalments.
        </p>
      </Card>

      {chosen ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Instalments due in {monthLabel(chosen.from)} <span className="font-normal text-muted-foreground">· {dues?.length ?? ''}</span>
            </CardTitle>
          </CardHeader>
          {!dues ? (
            <LoadingTiles count={1} />
          ) : (
            <Table>
              <caption className="sr-only">Each instalment due in the month, and what was paid against it</caption>
              <THead>
                <tr>
                  <TH>Due</TH>
                  <TH>Member</TH>
                  <TH numeric>Instalment</TH>
                  <TH numeric>Paid</TH>
                  <TH numeric>Unpaid</TH>
                </tr>
              </THead>
              <TBody>
                {dues.map((d) => (
                  <tr key={`${d.loanId}-${d.dueOn}`}>
                    <TD className="whitespace-nowrap">{formatDate(d.dueOn)}</TD>
                    <TD>
                      <Link to={`/loans/${d.loanId}`} className="font-medium hover:underline">{d.memberName}</Link>
                      <span className="block text-xs text-muted-foreground">{d.loanId}</span>
                    </TD>
                    <TD numeric><MoneyText paise={d.instalment} /></TD>
                    <TD numeric>
                      <Link
                        to={traceHref({ plus: [ACCOUNTS.CASH], source: 'PAYMENT', loanId: d.loanId })}
                        className="hover:underline"
                        title="This member's receipts in the journal"
                      >
                        <MoneyText paise={d.paid} />
                      </Link>
                    </TD>
                    <TD numeric className={d.instalment - d.paid > 0 ? 'text-bad' : 'text-muted-foreground'}>
                      <MoneyText paise={d.instalment - d.paid} />
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}
