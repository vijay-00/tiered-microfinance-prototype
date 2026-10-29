import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { TrancheStatusBadge } from '@/components/finance/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { formatBps } from '@/domain/money';
import { formatDate } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

export function TranchesPage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const { data, error } = useQuery(`tranches:${societyId}:${version}`, () => repositories.tranches.list(societyId));

  return (
    <>
      <PageHeader
        title="Funding facilities"
        description="Tranches sanctioned by the federation, what is owed on each, and when the next remittance falls due."
      />
      {error ? <p className="mb-4 text-sm text-bad">The facilities could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={1} />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">The federation has not sanctioned any funding to this society yet.</p>
      ) : (
        <Card>
          <Table>
            <caption className="sr-only">Funding facilities</caption>
            <THead>
              <tr>
                <TH>Sanction</TH>
                <TH>Status</TH>
                <TH numeric>Sanctioned</TH>
                <TH numeric>Drawn</TH>
                <TH numeric>Outstanding</TH>
                <TH numeric>Rate</TH>
                <TH numeric>Loans</TH>
                <TH>Next remittance</TH>
              </tr>
            </THead>
            <TBody>
              {data.map((row) => (
                <tr key={row.tranche.id}>
                  <TD>
                    <Link to={`/tranches/${row.tranche.id}`} className="font-medium hover:underline">
                      {row.tranche.sanctionRef}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{row.poolReference}</span>
                  </TD>
                  <TD>
                    <TrancheStatusBadge status={row.tranche.status} />
                  </TD>
                  <TD numeric><MoneyText paise={row.tranche.sanctionedAmount} /></TD>
                  <TD numeric><MoneyText paise={row.drawn} /></TD>
                  <TD numeric><MoneyText paise={row.outstanding} /></TD>
                  <TD numeric>{formatBps(row.tranche.wholesaleRateBps)}</TD>
                  <TD numeric>
                    {row.activeLoans} of {row.fundedLoans}
                  </TD>
                  <TD>
                    {row.next ? (
                      <>
                        <MoneyText paise={row.next.totalDue} />
                        <span className="block text-xs text-muted-foreground">
                          {formatDate(row.next.dueOn)}{' '}
                          {row.next.overdue ? <Badge tone="bad">Overdue</Badge> : null}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Nothing due</span>
                    )}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
