import { Link, useSearchParams } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { AppliedByBadge } from '@/components/finance/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { STAGE_ORDER, type ApplicationRow, type ApplicationStage } from '@/domain/origination';
import { can } from '@/domain/permissions';
import { formatDate } from '@/lib/format';
import { PURPOSE_LABEL, STAGE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

const isStage = (value: string | null): value is ApplicationStage =>
  value !== null && (STAGE_ORDER as readonly string[]).includes(value);

export function ApplicationsPage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const [params, setParams] = useSearchParams();
  const { data, error, loading } = useQuery(`applications:${societyId}:${version}`, () =>
    repositories.applications.getQueue(societyId),
  );
  const tab = params.get('tab');
  const stage: ApplicationStage = isStage(tab) ? tab : 'NEEDS_APPRAISAL';

  return (
    <>
      <PageHeader
        title="Applications"
        description="A member applies for themselves, or the society applies for them. Each moves from appraisal to a decision by the secretary, into a pool, and out as a loan."
        actions={
          can(user.role, 'SUBMIT_APPLICATION') ? (
            <Button asChild>
              <Link to="/applications/new">New application</Link>
            </Button>
          ) : null
        }
      />
      {error ? <p className="mb-4 text-sm text-bad">The applications could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={1} />
      ) : (
        <Tabs value={stage} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
          <TabsList aria-label="Applications by stage">
            {STAGE_ORDER.map((s) => (
              <TabsTrigger key={s} value={s}>
                {STAGE_LABEL[s]}
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{data[s].length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {STAGE_ORDER.map((s) => (
            <TabsContent key={s} value={s}>
              <Card aria-busy={loading}>
                <StageTable stage={s} rows={data[s]} />
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </>
  );
}

function StageTable({ stage, rows }: { stage: ApplicationStage; rows: readonly ApplicationRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing is {STAGE_LABEL[stage].toLowerCase()}.</p>;
  }
  return (
    <Table>
      <caption className="sr-only">Applications: {STAGE_LABEL[stage]}</caption>
      <THead>
        <tr>
          <TH>Applicant</TH>
          <TH>Applied</TH>
          <TH>Purpose</TH>
          <TH numeric>Amount</TH>
          <TH numeric>Tenure</TH>
          <TH numeric>EMI</TH>
          <TH>{stage === 'IN_POOL' || stage === 'READY_TO_POOL' ? 'Pool' : stage === 'DISBURSED' ? 'Loan' : stage === 'REJECTED' ? 'Reason' : 'Applied by'}</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <tr key={row.application.id}>
            <TD>
              <Link to={`/applications/${row.application.id}`} className="font-medium hover:underline">
                {row.memberName}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {row.application.id} · {row.village}
              </span>
            </TD>
            <TD className="whitespace-nowrap">{formatDate(row.application.appliedOn)}</TD>
            <TD>{PURPOSE_LABEL[row.application.purpose]}</TD>
            <TD numeric><MoneyText paise={row.amount} /></TD>
            <TD numeric>{row.tenureMonths} mo</TD>
            <TD numeric>{row.emi !== undefined ? <MoneyText paise={row.emi} /> : '–'}</TD>
            <TD>
              {stage === 'IN_POOL' || stage === 'READY_TO_POOL' ? (
                row.poolReference ? (
                  <Link to={`/pools/${row.application.poolId}`} className="text-xs hover:underline">{row.poolReference}</Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Not yet pooled</span>
                )
              ) : stage === 'DISBURSED' ? (
                row.loanId ? <Link to={`/loans/${row.loanId}`} className="text-xs hover:underline">{row.loanId}</Link> : null
              ) : stage === 'REJECTED' ? (
                <span className="text-xs text-muted-foreground">{row.application.decision?.reason}</span>
              ) : (
                <AppliedByBadge selfApplied={row.application.selfApplied} />
              )}
            </TD>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
