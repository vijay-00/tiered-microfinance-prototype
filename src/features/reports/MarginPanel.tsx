import { Link } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { MoneyText } from '@/components/finance/MoneyText';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import type { MarginPeriod } from '@/domain/reporting';
import type { ID } from '@/domain/types';
import { rupeesCell, toCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { traceHref } from '@/lib/ledgerLinks';
import { MARGIN_REASON_SHORT, marginSummary } from '@/lib/marginWords';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';

/**
 * Theoretical margin, what the schedules promised if every member paid on
 * time and every remittance was in full, against realised margin, what the
 * books show, and why the two differ.
 */
export function MarginPanel({ societyId, filePrefix }: { societyId: ID; filePrefix: string }) {
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const { data, error } = useQuery(`margin:${societyId}:${version}`, () => repositories.reports.getMargin(societyId));
  if (error) return <p className="text-sm text-bad">The margin analysis could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={2} className="lg:grid-cols-2" />;
  const months = data.months.filter((m) => m.scheduledRetail !== 0 || m.realised.value !== 0).reverse();

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <MarginCard period={data.yearToDate} />
        <MarginCard period={data.sinceInception} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Month by month</CardTitle>
          <CsvButton
            filename={`${filePrefix}-margin.csv`}
            build={() =>
              toCsv(
                ['Month', 'Member interest due', 'Member interest received', 'Wholesale on schedule', 'Wholesale paid', 'Theoretical margin', 'Realised margin', 'Difference', 'Penal and fees'],
                months.map((m) => [
                  m.from.slice(0, 7),
                  rupeesCell(m.scheduledRetail),
                  rupeesCell(m.receivedRetail.value),
                  rupeesCell(m.scheduledWholesale),
                  rupeesCell(m.paidWholesale.value),
                  rupeesCell(m.theoretical),
                  rupeesCell(m.realised.value),
                  rupeesCell(m.difference),
                  rupeesCell(m.penalAndFees.value),
                ]),
              )
            }
          />
        </CardHeader>
        <Table>
          <caption className="sr-only">Theoretical against realised margin, month by month, newest first</caption>
          <THead>
            <tr>
              <TH>Month</TH>
              <TH numeric>Member interest due</TH>
              <TH numeric>Received</TH>
              <TH numeric>Wholesale on schedule</TH>
              <TH numeric>Paid</TH>
              <TH numeric>Theoretical</TH>
              <TH numeric>Realised</TH>
              <TH numeric>Difference</TH>
              <TH>Why</TH>
            </tr>
          </THead>
          <TBody>
            {months.map((m) => (
              <tr key={m.from}>
                <TD className="whitespace-nowrap">{m.label}</TD>
                <TD numeric><MoneyText paise={m.scheduledRetail} /></TD>
                <TD numeric><Traced to={traceHref(m.receivedRetail.trace)} paise={m.receivedRetail.value} /></TD>
                <TD numeric><MoneyText paise={m.scheduledWholesale} /></TD>
                <TD numeric><Traced to={traceHref(m.paidWholesale.trace)} paise={m.paidWholesale.value} /></TD>
                <TD numeric><MoneyText paise={m.theoretical} /></TD>
                <TD numeric className="font-medium"><Traced to={traceHref(m.realised.trace)} paise={m.realised.value} /></TD>
                <TD numeric>
                  <MoneyText paise={m.difference} className={differenceTone(m.difference)} />
                </TD>
                <TD className="text-xs text-muted-foreground">
                  {m.reasons.length ? m.reasons.map((r) => MARGIN_REASON_SHORT[r.kind]).join(', ') : 'On schedule'}
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

/** A rupee or less either way is rounding, not news. */
function differenceTone(difference: number): string {
  return Math.abs(difference) <= 100 ? 'text-muted-foreground' : difference < 0 ? 'text-bad' : 'text-good';
}

function Traced({ to, paise }: { to: string; paise: number }) {
  return (
    <Link to={to} className="hover:underline" title="The journal lines behind this figure">
      <MoneyText paise={paise} />
    </Link>
  );
}

export function MarginCard({ period }: { period: MarginPeriod }) {
  return (
    <Card role="region" aria-label={`Margin: ${period.label}`}>
      <CardHeader>
        <CardTitle>{period.label}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {formatDate(period.from)} to {formatDate(period.to)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">Theoretical margin</dt>
            <dd className="text-lg font-semibold"><MoneyText paise={period.theoretical} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Realised margin</dt>
            <dd className="text-lg font-semibold text-good">
              <Traced to={traceHref(period.realised.trace)} paise={period.realised.value} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Difference</dt>
            <dd className="text-lg font-semibold">
              <MoneyText paise={period.difference} className={differenceTone(period.difference)} />
            </dd>
          </div>
        </dl>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {marginSummary(period).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        {period.penalAndFees.value > 0 ? (
          <p className="text-muted-foreground">
            Penal interest and fees, not part of the margin, brought in a further{' '}
            <Traced to={traceHref(period.penalAndFees.trace)} paise={period.penalAndFees.value} />.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
