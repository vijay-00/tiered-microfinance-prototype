import { MoneyText } from '@/components/finance/MoneyText';
import { ScheduleStatusBadge } from '@/components/finance/StatusBadges';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import type { ScheduleLine } from '@/domain/servicing';
import type { ScheduleRow } from '@/domain/types';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

/** The amortisation schedule with each row's standing. Shared by the society and member views. */
export function ScheduleTable({ lines, caption }: { lines: readonly ScheduleLine[]; caption: string }) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <THead>
        <tr>
          <TH numeric>#</TH>
          <TH>Due</TH>
          <TH numeric>Opening</TH>
          <TH numeric>Instalment</TH>
          <TH numeric>Interest</TH>
          <TH numeric>Principal</TH>
          <TH numeric>Closing</TH>
          <TH>Status</TH>
        </tr>
      </THead>
      <TBody>
        {lines.map(({ row, status, daysLate, unpaid }) => (
          <tr key={row.period} className={cn(status === 'PAID' && 'text-muted-foreground')}>
            <TD numeric>{row.period}</TD>
            <TD className="whitespace-nowrap">{formatDate(row.dueOn)}</TD>
            <TD numeric><MoneyText paise={row.opening} /></TD>
            <TD numeric><MoneyText paise={row.instalment} /></TD>
            <TD numeric>
              <MoneyText paise={row.interest} />
              {row.brokenPeriodInterest ? (
                <span className="block text-xs text-muted-foreground">
                  incl. <MoneyText paise={row.brokenPeriodInterest} /> for {row.brokenPeriodDays} days before the month
                </span>
              ) : null}
            </TD>
            <TD numeric><MoneyText paise={row.principal} /></TD>
            <TD numeric><MoneyText paise={row.closing} /></TD>
            <TD>
              <ScheduleStatusBadge status={status} daysLate={daysLate} />
              {status === 'PARTLY_PAID' ? (
                <span className="block text-xs text-muted-foreground">
                  <MoneyText paise={unpaid} /> left
                </span>
              ) : null}
            </TD>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

/** The schedule as first disbursed, before any prepayment reshaped it. */
export function OriginalScheduleTable({ rows }: { rows: readonly ScheduleRow[] }) {
  return (
    <Table>
      <caption className="sr-only">Original schedule</caption>
      <THead>
        <tr>
          <TH numeric>#</TH>
          <TH>Due</TH>
          <TH numeric>Instalment</TH>
          <TH numeric>Interest</TH>
          <TH numeric>Principal</TH>
          <TH numeric>Closing</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <tr key={row.period}>
            <TD numeric>{row.period}</TD>
            <TD className="whitespace-nowrap">{formatDate(row.dueOn)}</TD>
            <TD numeric><MoneyText paise={row.instalment} /></TD>
            <TD numeric><MoneyText paise={row.interest} /></TD>
            <TD numeric><MoneyText paise={row.principal} /></TD>
            <TD numeric><MoneyText paise={row.closing} /></TD>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
