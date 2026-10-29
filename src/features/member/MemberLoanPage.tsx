import { useParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Facts } from '@/components/Facts';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { LoanStatusBadge } from '@/components/finance/StatusBadges';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { formatBps } from '@/domain/money';
import { ScheduleTable } from '@/features/loans/ScheduleTable';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

/**
 * A member's own loan. It shows the retail rate and how each payment was
 * applied to the loan, and never anything about the federation or margin.
 */
export function MemberLoanPage() {
  const { loanId = '' } = useParams();
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const { data, error } = useQuery(`member-loan:${loanId}:${version}`, () =>
    repositories.member.getLoan(loanId, user.memberId!),
  );

  const crumb = (
    <Breadcrumb items={[{ label: 'My loans', to: '/me' }, { label: loanId }]} />
  );
  if (error) {
    return (
      <>
        {crumb}
        <PageHeader title="Loan not found" description={error} />
      </>
    );
  }
  if (!data) return <LoadingTiles count={3} className="sm:grid-cols-3" />;

  return (
    <>
      {crumb}
      <PageHeader
        title={<>Your loan of <MoneyText paise={data.principal} /></>}
        description={`Loan ${data.loanId}, disbursed ${formatDate(data.disbursedOn)}`}
        actions={<LoanStatusBadge status={data.status} />}
      />
      <Facts
        className="mb-5 rounded-lg border bg-card p-4"
        items={[
          { label: 'Still to repay', value: <MoneyText paise={data.outstanding} /> },
          { label: 'Monthly instalment', value: <MoneyText paise={data.emi} /> },
          { label: 'Interest rate', value: `${formatBps(data.rateBps)} a year` },
          {
            label: 'To pay now',
            value: data.dueNow > 0 ? <span className="text-bad"><MoneyText paise={data.dueNow} /></span> : 'Nothing',
          },
          {
            label: 'Standing',
            value: data.daysPastDue > 0 ? `${plural(data.daysPastDue, 'day')} late` : 'Up to date',
          },
          {
            label: 'Of which penal interest',
            value: <MoneyText paise={data.penalDue} />,
          },
        ]}
      />
      {data.rescheduled ? (
        <p className="mb-5 rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground">
          You prepaid part of this loan, so it was rescheduled: your instalment is unchanged and the loan ends sooner.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your schedule</CardTitle>
        </CardHeader>
        <ScheduleTable lines={data.schedule} caption="Your repayment schedule" />
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Your payments <span className="font-normal text-muted-foreground">· {data.payments.length}</span>
          </CardTitle>
        </CardHeader>
        {data.payments.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <Table>
            <caption className="sr-only">Your payments and how each was applied</caption>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Receipt</TH>
                <TH numeric>Paid</TH>
                <TH numeric>To interest</TH>
                <TH numeric>To principal</TH>
                <TH numeric>To penal and fees</TH>
                <TH numeric>Held for you</TH>
              </tr>
            </THead>
            <TBody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <TD className="whitespace-nowrap">{formatDate(p.receivedOn)}</TD>
                  <TD className="text-xs text-muted-foreground tabular-nums">{p.receiptNo}</TD>
                  <TD numeric className="font-medium"><MoneyText paise={p.amount} /></TD>
                  <TD numeric><MoneyText paise={p.towardsInterest} /></TD>
                  <TD numeric><MoneyText paise={p.towardsPrincipal} /></TD>
                  <TD numeric><MoneyText paise={p.towardsPenalAndFees} /></TD>
                  <TD numeric><MoneyText paise={p.heldAsAdvance} /></TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
