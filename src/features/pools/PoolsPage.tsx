import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { PoolStatusBadge } from '@/components/finance/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { can } from '@/domain/permissions';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

export function PoolsPage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const policy = useAppStore((s) => s.world.policy);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const { data, error, loading } = useQuery(`batches:${societyId}:${version}`, async () => {
    const [pools, queue] = await Promise.all([
      repositories.pools.list(societyId),
      repositories.applications.getQueue(societyId),
    ]);
    return { pools, unpooled: queue.READY_TO_POOL.length };
  });
  const manage = can(user.role, 'MANAGE_POOL');
  const building = data?.pools.find((row) => row.pool.status === 'OPEN' || row.pool.status === 'READY');

  return (
    <>
      <PageHeader
        title="Batches"
        description={`Approved applications go to the federation up to ${policy.poolMaxMembers} at a time, as one request for a wholesale tranche. A single application is enough to send.`}
        actions={
          manage ? (
            <Button asChild>
              <Link to="/pools/new">New batch</Link>
            </Button>
          ) : null
        }
      />
      {error ? <p className="mb-4 text-sm text-bad">The batches could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={1} />
      ) : (
        <>
          {data.unpooled > 0 ? (
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p>
                  {plural(data.unpooled, 'approved application')} {data.unpooled === 1 ? 'is' : 'are'} waiting to be batched.
                </p>
                {manage ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={building ? `/pools/new?pool=${building.pool.id}` : '/pools/new'}>
                      {building ? `Add to ${building.pool.reference}` : 'Start a batch'}
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <Card aria-busy={loading}>
            <Table>
              <caption className="sr-only">Batches of this society</caption>
              <THead>
                <tr>
                  <TH>Batch</TH>
                  <TH>Status</TH>
                  <TH numeric>Members</TH>
                  <TH numeric>Requested</TH>
                  <TH numeric>Longest loan</TH>
                  <TH>Federation</TH>
                  <TH>
                    <span className="sr-only">Action</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {data.pools.map(({ pool, members, tranche }) => (
                  <tr key={pool.id}>
                    <TD>
                      <Link to={`/pools/${pool.id}`} className="font-medium hover:underline">
                        {pool.reference}
                      </Link>
                      <span className="block text-xs text-muted-foreground">opened {formatDate(pool.createdOn)}</span>
                    </TD>
                    <TD>
                      <PoolStatusBadge status={pool.status} />
                    </TD>
                    <TD numeric>{members}</TD>
                    <TD numeric>
                      <MoneyText paise={pool.requestedAmount} />
                    </TD>
                    <TD numeric>{pool.requestedTenureMonths ? `${pool.requestedTenureMonths} mo` : '–'}</TD>
                    <TD className="text-xs">
                      {tranche ? (
                        <>
                          <Link to={`/tranches/${tranche.id}`} className="hover:underline">
                            {tranche.sanctionRef}
                          </Link>
                          <span className="block text-muted-foreground">
                            <MoneyText paise={tranche.sanctionedAmount} /> sanctioned
                          </span>
                        </>
                      ) : pool.apexReview?.decision === 'DECLINED' ? (
                        <span className="text-bad">{pool.apexReview.remarks}</span>
                      ) : pool.submittedOn ? (
                        <span className="text-muted-foreground">submitted {formatDate(pool.submittedOn)}</span>
                      ) : (
                        <span className="text-muted-foreground">not submitted</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      {manage && (pool.status === 'OPEN' || pool.status === 'READY') ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/pools/new?pool=${pool.id}`}>Continue</Link>
                        </Button>
                      ) : null}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
