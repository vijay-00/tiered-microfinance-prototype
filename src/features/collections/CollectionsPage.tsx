import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { StatTile } from '@/components/finance/StatTile';
import { CollectionStatusBadge } from '@/components/finance/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { can } from '@/domain/permissions';
import type { CollectionRow } from '@/domain/servicing';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { RecordPaymentSheet } from './RecordPaymentSheet';

export function CollectionsPage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const societies = useAppStore((s) => s.world.societies);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const society = societies.find((s) => s.id === societyId);
  const canRecord = can(user.role, 'RECORD_PAYMENT');
  const [paying, setPaying] = useState<string>();
  const { data, error } = useQuery(`collections:${societyId}:${version}`, () =>
    repositories.collections.getDesk(societyId),
  );

  return (
    <>
      <PageHeader
        title="Collections desk"
        description={data ? `${society?.name} · ${formatDate(data.queue.asOf)}` : society?.name}
        actions={
          canRecord && data && data.queue.dueToday.length > 0 ? (
            <CollectAllDialog count={data.queue.dueToday.length} amount={sumDue(data.queue.dueToday)} societyId={societyId} />
          ) : null
        }
      />
      {error ? <p className="mb-4 text-sm text-bad">The desk could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={3} className="sm:grid-cols-3" />
      ) : (
        <>
          <section aria-label="Collected today" className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Collected today"
              value={<MoneyText paise={data.today.cashReceived} />}
              detail={plural(data.today.receipts, 'receipt')}
            />
            <StatTile
              label="Owed on to the federation"
              value={<MoneyText paise={data.today.toFederation} />}
              detail={
                <>
                  <MoneyText paise={data.today.wholesaleInterest} /> interest, <MoneyText paise={data.today.principal} /> principal
                </>
              }
            />
            <StatTile
              label="Kept by the society"
              tone="good"
              value={<MoneyText paise={data.today.retained} />}
              detail={
                <>
                  <MoneyText paise={data.today.margin} /> margin
                  {data.today.penalAndFees > 0 ? (
                    <>
                      , <MoneyText paise={data.today.penalAndFees} /> penal and fees
                    </>
                  ) : null}
                </>
              }
            />
          </section>

          {!canRecord ? (
            <p className="mt-4 text-sm text-muted-foreground">You can see the desk but not record payments in this role.</p>
          ) : null}

          <QueueSection
            title="Due today"
            rows={data.queue.dueToday}
            empty="Nothing falls due today. Use Next due date in the demo bar to move to the next instalment date."
            canRecord={canRecord}
            onPay={setPaying}
          />
          <QueueSection
            title="Overdue"
            rows={data.queue.overdue}
            empty="Every member is up to date."
            canRecord={canRecord}
            onPay={setPaying}
          />
          <QueueSection
            title={`Coming up in the next ${data.queue.horizonDays} days`}
            rows={data.queue.upcoming}
            empty="Nothing falls due this week."
            canRecord={canRecord}
            onPay={setPaying}
            upcoming
          />
        </>
      )}
      <RecordPaymentSheet loanId={paying} onClose={() => setPaying(undefined)} />
    </>
  );
}

function sumDue(rows: readonly CollectionRow[]) {
  return rows.reduce((t, r) => t + r.amountDue, 0);
}

function QueueSection(props: {
  title: string;
  rows: readonly CollectionRow[];
  empty: string;
  canRecord: boolean;
  onPay: (loanId: string) => void;
  upcoming?: boolean;
}) {
  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>
          {props.title} <span className="font-normal text-muted-foreground">· {props.rows.length}</span>
        </CardTitle>
        {props.rows.length > 0 ? (
          <span className="text-sm font-medium"><MoneyText paise={sumDue(props.rows)} /></span>
        ) : null}
      </CardHeader>
      {props.rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{props.empty}</p>
      ) : (
        <Table>
          <caption className="sr-only">{props.title}</caption>
          <THead>
            <tr>
              <TH>Member</TH>
              <TH>Pool</TH>
              <TH>{props.upcoming ? 'Falls due' : 'Due since'}</TH>
              <TH>Status</TH>
              <TH numeric>{props.upcoming ? 'Instalment' : 'Amount due'}</TH>
              {props.canRecord ? <TH><span className="sr-only">Action</span></TH> : null}
            </tr>
          </THead>
          <TBody>
            {props.rows.map((row) => (
              <tr key={row.loanId}>
                <TD>
                  <Link to={`/loans/${row.loanId}`} className="font-medium hover:underline">
                    {row.memberName}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {row.village} · {row.loanId}
                  </span>
                </TD>
                <TD className="text-xs text-muted-foreground">{row.poolReference}</TD>
                <TD className="whitespace-nowrap">{formatDate(row.dueOn)}</TD>
                <TD>
                  <CollectionStatusBadge status={row.status} daysPastDue={row.daysPastDue} />
                </TD>
                <TD numeric>
                  <MoneyText paise={row.amountDue} />
                  {row.penalDue > 0 ? (
                    <span className="block text-xs text-bad">
                      incl. <MoneyText paise={row.penalDue} /> penal
                    </span>
                  ) : null}
                </TD>
                {props.canRecord ? (
                  <TD className="text-right">
                    <Button
                      size="sm"
                      variant={props.upcoming ? 'outline' : 'default'}
                      onClick={() => props.onPay(row.loanId)}
                      aria-label={`Record payment from ${row.memberName}`}
                    >
                      {props.upcoming ? 'Take early' : 'Record payment'}
                    </Button>
                  </TD>
                ) : null}
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

/**
 * Records every instalment due today, in full and in cash, in one step: the
 * collection sheet from a members' meeting. All or nothing.
 */
function CollectAllDialog(props: { count: number; amount: number; societyId: string }) {
  const repositories = useRepositories();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setPending(true);
    setError(undefined);
    const result = await repositories.collections.recordAllDueToday(props.societyId);
    setPending(false);
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Record all due today</Button>
      <DialogContent>
        <DialogTitle>Record {plural(props.count, 'payment')}?</DialogTitle>
        <DialogDescription>
          One cash receipt for each instalment due today, in full: <MoneyText paise={props.amount} /> in all. Each is
          split and posted exactly as it would be from the drawer.
        </DialogDescription>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-bad">
            {error} Nothing was recorded.
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={pending}>
            {pending ? 'Recording…' : `Record ${plural(props.count, 'payment')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
