import { Link } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { MoneyText } from '@/components/finance/MoneyText';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import type { ID } from '@/domain/types';
import { cn } from '@/lib/cn';
import { rupeesCell, toCsv } from '@/lib/csv';
import { percent } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';

/** Each funded pool: how much is repaid, how much is late, and what it has earned. */
export function PoolsPanel({ societyId, filePrefix }: { societyId: ID; filePrefix: string }) {
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const { data, error } = useQuery(`pool-performance:${societyId}:${version}`, () => repositories.reports.getPools(societyId));
  if (error) return <p className="text-sm text-bad">Pool performance could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={1} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Pools funded <span className="font-normal text-muted-foreground">· {data.length}</span>
        </CardTitle>
        <CsvButton
          filename={`${filePrefix}-pools.csv`}
          build={() =>
            toCsv(
              ['Pool', 'Sanction', 'Loans', 'Active', 'Disbursed', 'Outstanding', 'Repaid %', 'Late loans', 'At risk %', 'Member interest', 'Wholesale interest', 'Margin', 'Remittances', 'On time'],
              data.map((p) => [
                p.pool.reference,
                p.tranche.sanctionRef,
                p.loans,
                p.activeLoans,
                rupeesCell(p.disbursed),
                rupeesCell(p.outstanding),
                (p.repaidShare * 100).toFixed(1),
                p.lateLoans,
                (p.atRiskShare * 100).toFixed(1),
                rupeesCell(p.interestReceived),
                rupeesCell(p.wholesalePaid),
                rupeesCell(p.margin),
                p.remittancesMade,
                p.remittancesOnTime,
              ]),
            )
          }
        />
      </CardHeader>
      {data.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No pool has been disbursed yet.</p>
      ) : (
        <Table>
          <caption className="sr-only">Performance of each funded pool</caption>
          <THead>
            <tr>
              <TH>Pool</TH>
              <TH numeric>Loans</TH>
              <TH numeric>Disbursed</TH>
              <TH numeric>Outstanding</TH>
              <TH>Repaid</TH>
              <TH numeric>At risk</TH>
              <TH numeric>Member interest</TH>
              <TH numeric>Wholesale interest</TH>
              <TH numeric>Margin</TH>
              <TH numeric>Remitted on time</TH>
            </tr>
          </THead>
          <TBody>
            {data.map((p) => (
              <tr key={p.tranche.id}>
                <TD>
                  <Link to={`/pools/${p.pool.id}`} className="font-medium hover:underline">{p.pool.reference}</Link>
                  <Link to={`/tranches/${p.tranche.id}`} className="block text-xs text-muted-foreground hover:underline">
                    {p.tranche.sanctionRef}
                  </Link>
                </TD>
                <TD numeric>
                  {p.activeLoans} of {p.loans}
                  <span className="block text-xs text-muted-foreground">active</span>
                </TD>
                <TD numeric><MoneyText paise={p.disbursed} /></TD>
                <TD numeric><MoneyText paise={p.outstanding} /></TD>
                <TD className="min-w-28">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-good" style={{ width: `${p.repaidShare * 100}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{percent(p.repaidShare)}</span>
                </TD>
                <TD numeric className={cn(p.lateLoans > 0 && 'text-bad')}>
                  {percent(p.atRiskShare, 1)}
                  <span className="block text-xs text-muted-foreground">{p.lateLoans} late</span>
                </TD>
                <TD numeric><MoneyText paise={p.interestReceived} /></TD>
                <TD numeric><MoneyText paise={p.wholesalePaid} /></TD>
                <TD numeric className="font-medium text-good"><MoneyText paise={p.margin} /></TD>
                <TD numeric>
                  {p.remittancesMade ? `${p.remittancesOnTime} of ${p.remittancesMade}` : '–'}
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
