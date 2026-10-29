import { Link, useParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { PoolEconomicsList } from '@/components/finance/PoolEconomicsList';
import { ApplicationStageBadge, PoolStatusBadge } from '@/components/finance/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { formatBps } from '@/domain/money';
import type { PoolDetail, TrailStep } from '@/domain/origination';
import { can } from '@/domain/permissions';
import { formatDate, plural } from '@/lib/format';
import { PURPOSE_LABEL } from '@/lib/labels';
import { RescopeDialog } from './RescopeDialog';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

export function PoolDetailPage() {
  const { poolId = '' } = useParams();
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const policy = useAppStore((s) => s.world.policy);
  const exists = useAppStore((s) => s.world.pools.find((p) => p.id === poolId)?.societyId === user.societyId);
  const repositories = useRepositories();
  const { data, error } = useQuery(`pool:${poolId}:${version}`, () =>
    exists ? repositories.pools.getDetail(poolId) : Promise.reject(new Error('missing')),
  );

  if (!exists) {
    return (
      <PageHeader
        title="Pool not found"
        description={
          <>
            There is no pool {poolId} in this society.{' '}
            <Link to="/pools" className="text-primary underline">
              Back to pools
            </Link>
            .
          </>
        }
      />
    );
  }
  if (error) return <p className="text-sm text-bad">The pool could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={3} className="sm:grid-cols-3" />;

  const { pool } = data;
  const editable = pool.status === 'OPEN' || pool.status === 'READY';
  return (
    <>
      <Breadcrumb items={[{ label: 'Pools', to: '/pools' }, { label: pool.reference }]} />
      <PageHeader
        title={pool.reference}
        description={`${plural(pool.applicationIds.length, 'member')} · ${data.society.name} · opened ${formatDate(pool.createdOn)}`}
        actions={
          <>
            <PoolStatusBadge status={pool.status} />
            {editable && can(user.role, 'MANAGE_POOL') ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/pools/new?pool=${pool.id}`}>Edit pool</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <FederationDecision detail={data} />
          <Card>
            <CardHeader>
              <CardTitle>
                Members <span className="font-normal text-muted-foreground">· {data.applications.length}</span>
              </CardTitle>
            </CardHeader>
            {data.applications.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No one is in this pool yet.</p>
            ) : (
              <Table>
                <caption className="sr-only">Applications in this pool</caption>
                <THead>
                  <tr>
                    <TH>Member</TH>
                    <TH>Purpose</TH>
                    <TH numeric>Amount</TH>
                    <TH numeric>Tenure</TH>
                    <TH numeric>EMI</TH>
                    <TH>Stage</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.applications.map((row) => (
                    <tr key={row.application.id}>
                      <TD>
                        <Link to={`/applications/${row.application.id}`} className="font-medium hover:underline">
                          {row.memberName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{row.village}</span>
                      </TD>
                      <TD>{PURPOSE_LABEL[row.application.purpose]}</TD>
                      <TD numeric>
                        <MoneyText paise={row.amount} />
                      </TD>
                      <TD numeric>{row.tenureMonths} mo</TD>
                      <TD numeric>{row.emi !== undefined ? <MoneyText paise={row.emi} /> : '–'}</TD>
                      <TD>
                        {row.loanId ? (
                          <Link to={`/loans/${row.loanId}`} className="text-xs hover:underline">
                            {row.loanId}
                          </Link>
                        ) : (
                          <ApplicationStageBadge stage={row.stage} />
                        )}
                      </TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card role="region" aria-label="Economics">
            <CardHeader>
              <CardTitle>Economics</CardTitle>
            </CardHeader>
            <CardContent>
              <PoolEconomicsList economics={data.economics} policy={policy} />
            </CardContent>
          </Card>
          <Card role="region" aria-label="History">
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <Trail steps={data.trail} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function FederationDecision({ detail }: { detail: PoolDetail }) {
  const { pool, tranche } = detail;
  const user = useAppStore(selectCurrentUser);
  if (pool.status === 'OPEN' || pool.status === 'READY') return null;
  if (pool.status === 'SUBMITTED' || pool.status === 'UNDER_APEX_REVIEW') {
    return (
      <Card role="region" aria-label="Federation decision">
        <CardContent className="text-sm">
          {pool.status === 'SUBMITTED' ? 'Waiting for the federation to take it up' : 'The federation is reviewing it'},
          since {formatDate(pool.submittedOn ?? pool.createdOn)}.
        </CardContent>
      </Card>
    );
  }
  if (pool.status === 'DECLINED') {
    return (
      <Card role="region" aria-label="Federation decision">
        <CardHeader>
          <CardTitle>Declined by the federation</CardTitle>
          <span className="text-xs text-muted-foreground">{pool.apexReview ? formatDate(pool.apexReview.on) : null}</span>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{pool.apexReview?.remarks}</p>
          <p className="text-muted-foreground">Its applications are free to go into another pool.</p>
        </CardContent>
      </Card>
    );
  }
  if (!tranche) return null;
  return (
    <Card role="region" aria-label="Federation decision">
      <CardHeader>
        <CardTitle>
          Sanctioned as{' '}
          <Link to={`/tranches/${tranche.id}`} className="hover:underline">
            {tranche.sanctionRef}
          </Link>
        </CardTitle>
        <span className="text-xs text-muted-foreground">{formatDate(tranche.sanctionedOn)}</span>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          <MoneyText paise={tranche.sanctionedAmount} /> at {formatBps(tranche.wholesaleRateBps)} a year for{' '}
          {tranche.tenureMonths} months.
          {pool.apexReview?.remarks ? <span className="text-muted-foreground"> “{pool.apexReview.remarks}”</span> : null}
        </p>
        {detail.shortfall > 0 ? (
          <div role="region" aria-label="Re-scope needed" className="space-y-2 rounded-md border border-warn/40 bg-warn-soft p-3">
            <p className="font-medium text-warn">Re-scope needed</p>
            <p>
              The members ask for <MoneyText paise={tranche.sanctionedAmount + detail.shortfall} />,{' '}
              <MoneyText paise={detail.shortfall} /> more than was sanctioned. Nothing can be drawn until the pool fits:
              cut every loan pro rata, or remove members.
            </p>
            {can(user.role, 'MANAGE_POOL') ? (
              <RescopeDialog
                poolId={pool.id}
                reference={pool.reference}
                rows={detail.applications.filter((a) => a.application.status === 'POOLED')}
                sanctioned={tranche.sanctionedAmount}
              />
            ) : (
              <p className="text-muted-foreground">The secretary re-scopes it.</p>
            )}
          </div>
        ) : pool.rescope ? (
          <p className="text-muted-foreground">
            Re-scoped {formatDate(pool.rescope.on)} from <MoneyText paise={pool.rescope.askedBefore} />:{' '}
            {pool.rescope.method === 'PRO_RATA'
              ? 'every loan cut pro rata.'
              : `${plural(pool.rescope.removed.length, 'member')} removed, the rest at their full amounts.`}
          </p>
        ) : null}
        {detail.shortfall === 0 && detail.awaitingDisbursement > 0 ? (
          <p>
            {plural(detail.awaitingDisbursement, 'member')} still to be paid out.{' '}
            <Link to={`/tranches/${tranche.id}`} className="text-primary underline">
              Draw down and disburse
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Trail({ steps }: { steps: readonly TrailStep[] }) {
  return (
    <ol className="space-y-3 border-l pl-4 text-sm">
      {steps.map((step, i) => (
        <li key={`${step.on}-${i}`} className="relative">
          <span aria-hidden className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary" />
          <p className="font-medium">{step.label}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(step.on)}
            {step.by ? ` · ${step.by}` : null}
            {step.detail ? ` · ${step.detail}` : null}
          </p>
        </li>
      ))}
    </ol>
  );
}
