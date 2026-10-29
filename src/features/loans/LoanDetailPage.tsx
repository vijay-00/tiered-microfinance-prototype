import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Facts } from '@/components/Facts';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { JournalEntryTable } from '@/components/finance/JournalEntryTable';
import { MoneyText } from '@/components/finance/MoneyText';
import { SplitBar } from '@/components/finance/SplitBar';
import { StatTile } from '@/components/finance/StatTile';
import { LoanStatusBadge } from '@/components/finance/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBps } from '@/domain/money';
import { can } from '@/domain/permissions';
import type { ReceiptLine } from '@/domain/servicing';
import { RecordPaymentSheet } from '@/features/collections/RecordPaymentSheet';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { OriginalScheduleTable, ScheduleTable } from './ScheduleTable';

const MODE_LABEL = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque' } as const;

export function LoanDetailPage() {
  const { loanId = '' } = useParams();
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const exists = useAppStore((s) => s.world.loans[loanId]?.loan.societyId === user.societyId);
  const repositories = useRepositories();
  const [paying, setPaying] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const { data, error } = useQuery(`loan:${loanId}:${version}`, () =>
    exists ? repositories.loans.getDetail(loanId) : Promise.reject(new Error('missing')),
  );

  if (!exists) {
    return (
      <PageHeader
        title="Loan not found"
        description={
          <>
            There is no loan {loanId} in this society. <Link to="/collections" className="text-primary underline">Back to collections</Link>.
          </>
        }
      />
    );
  }
  if (error) return <p className="text-sm text-bad">The loan could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={4} className="sm:grid-cols-2 xl:grid-cols-4" />;

  const { loan, member, position, totals } = data;
  const canRecord = can(user.role, 'RECORD_PAYMENT') && loan.status === 'ACTIVE';

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Link to="/collections" className="hover:underline">Collections</Link>
        <ChevronRight className="size-3" aria-hidden />
        <span>{loanId}</span>
      </nav>
      <PageHeader
        title={member.name}
        description={
          <>
            {member.village} · {member.membershipNo} · loan {loan.id} from{' '}
            <Link to={`/tranches/${data.tranche.id}`} className="text-primary hover:underline">
              {data.pool.reference}
            </Link>
          </>
        }
        actions={
          <>
            <LoanStatusBadge status={loan.status} />
            {canRecord ? <Button onClick={() => setPaying(true)}>Record payment</Button> : null}
          </>
        }
      />

      <Facts
        className="mb-5 rounded-lg border bg-card p-4"
        items={[
          { label: 'Principal', value: <MoneyText paise={loan.principal} /> },
          { label: 'Interest rate', value: `${formatBps(loan.rateBps)} a year` },
          { label: 'Instalment', value: <MoneyText paise={loan.emi} /> },
          {
            label: 'Tenure',
            value: data.rescheduled
              ? `${data.schedule.length} months, from ${loan.tenureMonths}`
              : `${loan.tenureMonths} months`,
          },
          { label: 'Disbursed', value: formatDate(loan.disbursedOn) },
          { label: 'Occupation', value: member.occupation },
        ]}
      />

      <section aria-label="Position" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Principal outstanding" value={<MoneyText paise={position.principalOutstanding} />} />
        <StatTile
          label="Due now"
          value={<MoneyText paise={position.totalDueNow} />}
          tone={position.daysPastDue > 0 ? 'bad' : position.totalDueNow > 0 ? 'warn' : 'good'}
          detail={
            position.daysPastDue > 0
              ? `${plural(position.daysPastDue, 'day')} late${position.penalUnpaid > 0 ? ', penal accruing' : ''}`
              : position.totalDueNow > 0
                ? 'Falls due today'
                : 'Up to date'
          }
        />
        <StatTile
          label="Interest received"
          value={<MoneyText paise={totals.interestPaid} />}
          detail={
            <>
              <MoneyText paise={totals.wholesaleShare} /> of it owed to the federation
            </>
          }
        />
        <StatTile
          label="Margin kept by the society"
          tone="good"
          value={<MoneyText paise={totals.marginRetained} />}
          detail={
            totals.penalPaid + totals.feesPaid > 0 ? (
              <>
                Plus <MoneyText paise={totals.penalPaid + totals.feesPaid} /> penal and fees
              </>
            ) : (
              'Retail interest less wholesale interest'
            )
          }
        />
      </section>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          {data.rescheduled ? (
            <Button size="sm" variant="ghost" onClick={() => setShowOriginal((v) => !v)} aria-expanded={showOriginal}>
              {showOriginal ? 'Hide' : 'Show'} the original schedule
            </Button>
          ) : null}
        </CardHeader>
        {data.rescheduled ? (
          <p className="border-b bg-accent px-4 py-2 text-sm text-accent-foreground">
            Rescheduled after a prepayment. The instalment is unchanged; the loan now ends on{' '}
            {formatDate(data.schedule.at(-1)?.row.dueOn ?? loan.firstDueOn)} instead of{' '}
            {formatDate(data.originalSchedule.at(-1)!.dueOn)}.
          </p>
        ) : null}
        {showOriginal ? (
          <div className="border-b">
            <p className="px-4 pt-3 text-xs font-medium text-muted-foreground">As disbursed</p>
            <OriginalScheduleTable rows={data.originalSchedule} />
          </div>
        ) : null}
        <ScheduleTable lines={data.schedule} caption={`Schedule for loan ${loan.id}`} />
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Payments <span className="font-normal text-muted-foreground">· {data.receipts.length}</span>
          </CardTitle>
        </CardHeader>
        {data.receipts.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="divide-y">
            {data.receipts.map((line) => (
              <PaymentRow key={line.receipt.id} line={line} />
            ))}
          </ul>
        )}
      </Card>

      {paying ? <RecordPaymentSheet loanId={loanId} onClose={() => setPaying(false)} /> : null}
    </>
  );
}

/** One receipt, expandable to show how it was split and what it posted. */
function PaymentRow({ line }: { line: ReceiptLine }) {
  const { receipt, journal } = line;
  const { federation, society } = receipt.reconciliation;
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/50">
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
          <span className="w-24 whitespace-nowrap">{formatDate(receipt.receivedOn)}</span>
          <span className="w-28 text-xs text-muted-foreground tabular-nums">{receipt.receiptNo}</span>
          <span className="text-xs text-muted-foreground">
            {receipt.source === 'ADVANCE' ? 'From advance' : MODE_LABEL[receipt.mode]}
            {receipt.allocation.prepaidPrincipal > 0 ? ' · prepayment' : ''}
          </span>
          <span className="ml-auto font-medium"><MoneyText paise={receipt.amount} /></span>
        </summary>
        <div className="grid gap-5 bg-muted/30 px-4 py-3 md:grid-cols-2">
          <div>
            <SplitBar
              toFederation={federation.remittanceShare}
              retained={society.netInterestIncome + society.penalIncome + society.feeIncome}
              advance={receipt.allocation.advance}
            />
            <p className="mt-2 text-xs text-muted-foreground">Recorded by {line.recordedByName}</p>
          </div>
          {journal ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Journal entry {journal.id}</p>
              <JournalEntryTable entry={journal} />
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}
