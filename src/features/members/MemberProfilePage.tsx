import { Link, useParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Facts } from '@/components/Facts';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { ApplicationStageBadge, LoanStatusBadge } from '@/components/finance/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { stageOf, workingAmount } from '@/domain/origination';
import { can } from '@/domain/permissions';
import { formatDate, plural } from '@/lib/format';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

export function MemberProfilePage() {
  const { memberId = '' } = useParams();
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const graceDays = useAppStore((s) => s.world.policy.graceDays);
  const exists = useAppStore((s) => s.world.members.find((m) => m.id === memberId)?.societyId === user.societyId);
  const repositories = useRepositories();
  const { data, error } = useQuery(`member:${memberId}:${version}`, () =>
    exists ? repositories.members.getProfile(memberId) : Promise.reject(new Error('missing')),
  );

  if (!exists) {
    return (
      <PageHeader
        title="Member not found"
        description={
          <>
            There is no member {memberId} in this society. <Link to="/members" className="text-primary underline">Back to the register</Link>.
          </>
        }
      />
    );
  }
  if (error) return <p className="text-sm text-bad">The member could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={3} className="sm:grid-cols-3" />;

  const { member, canApply } = data;
  const mayApply = can(user.role, 'SUBMIT_APPLICATION');
  return (
    <>
      <Breadcrumb items={[{ label: 'Members', to: '/members' }, { label: member.name }]} />
      <PageHeader
        title={member.name}
        description={`${member.membershipNo} · ${member.village} · member since ${formatDate(member.joinedOn)}`}
        actions={
          mayApply ? (
            canApply.ok ? (
              <Button asChild>
                <Link to={`/applications/new?member=${member.id}`}>New application</Link>
              </Button>
            ) : (
              <p className="max-w-xs text-right text-xs text-muted-foreground">{canApply.reason}</p>
            )
          ) : null
        }
      />
      <Facts
        className="mb-5 rounded-lg border bg-card p-4"
        items={[
          { label: 'Occupation', value: member.occupation },
          { label: 'Phone', value: member.phone },
          { label: 'Share capital', value: <MoneyText paise={member.shareCapital} /> },
          { label: 'Internal score', value: member.internalScore },
          { label: 'Borrowing now', value: <MoneyText paise={data.exposure} /> },
          { label: 'Can still borrow', value: <MoneyText paise={data.headroom} /> },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            Loans <span className="font-normal text-muted-foreground">· {data.loans.length}</span>
          </CardTitle>
        </CardHeader>
        {data.loans.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No loans yet.</p>
        ) : (
          <Table>
            <caption className="sr-only">Loans of this member</caption>
            <THead>
              <tr>
                <TH>Loan</TH>
                <TH>Disbursed</TH>
                <TH numeric>Principal</TH>
                <TH numeric>EMI</TH>
                <TH numeric>Outstanding</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {data.loans.map(({ loan, outstanding, daysPastDue, poolReference }) => (
                <tr key={loan.id}>
                  <TD>
                    <Link to={`/loans/${loan.id}`} className="font-medium hover:underline">{loan.id}</Link>
                    <span className="block text-xs text-muted-foreground">{poolReference}</span>
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(loan.disbursedOn)}</TD>
                  <TD numeric><MoneyText paise={loan.principal} /></TD>
                  <TD numeric><MoneyText paise={loan.emi} /></TD>
                  <TD numeric><MoneyText paise={outstanding} /></TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <LoanStatusBadge status={loan.status} />
                      {daysPastDue > graceDays ? <Badge tone="bad">{plural(daysPastDue, 'day')} late</Badge> : null}
                    </div>
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Applications <span className="font-normal text-muted-foreground">· {data.applications.length}</span>
          </CardTitle>
        </CardHeader>
        {data.applications.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No applications yet.</p>
        ) : (
          <Table>
            <caption className="sr-only">Applications by this member</caption>
            <THead>
              <tr>
                <TH>Application</TH>
                <TH>Applied</TH>
                <TH>Purpose</TH>
                <TH numeric>Amount</TH>
                <TH numeric>Tenure</TH>
                <TH>Stage</TH>
              </tr>
            </THead>
            <TBody>
              {data.applications.map((application) => {
                const { amount, tenureMonths } = workingAmount(application);
                return (
                  <tr key={application.id}>
                    <TD>
                      <Link to={`/applications/${application.id}`} className="font-medium hover:underline">{application.id}</Link>
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(application.appliedOn)}</TD>
                    <TD>{PURPOSE_LABEL[application.purpose]}</TD>
                    <TD numeric><MoneyText paise={amount} /></TD>
                    <TD numeric>{tenureMonths} mo</TD>
                    <TD><ApplicationStageBadge stage={stageOf(application)} /></TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
