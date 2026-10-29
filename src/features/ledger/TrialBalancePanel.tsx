import { Link, useSearchParams } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { MoneyText } from '@/components/finance/MoneyText';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import type { AccountBalance } from '@/domain/statements';
import type { ID } from '@/domain/types';
import { rupeesCell, toCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { readRange, tAccountHref } from '@/lib/ledgerLinks';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';

const TYPE_LABEL = { ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expense' };

/** Each account's net balance in the column it sits on: the debit column for a debit balance. */
function columns(row: AccountBalance): { dr: number; cr: number } {
  const net = row.dr - row.cr;
  return net >= 0 ? { dr: net, cr: 0 } : { dr: 0, cr: -net };
}

export function TrialBalancePanel({ societyId, filePrefix }: { societyId: ID; filePrefix: string }) {
  const [params, setParams] = useSearchParams();
  const version = useAppStore((s) => s.world.eventCount);
  const clock = useAppStore((s) => s.world.clock);
  const repositories = useRepositories();
  const asOf = readRange(params).to ?? clock;
  const { data, error } = useQuery(['trial', societyId, version, asOf].join(':'), () =>
    repositories.ledger.getTrialBalance(societyId, asOf),
  );
  const rows = data?.rows.filter((row) => row.dr !== 0 || row.cr !== 0) ?? [];
  const totals = rows.reduce((t, row) => ({ dr: t.dr + columns(row).dr, cr: t.cr + columns(row).cr }), { dr: 0, cr: 0 });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Field label="As of">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={asOf}
                max={clock}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  next.set('to', e.target.value || clock);
                  setParams(next, { replace: true });
                }}
              />
            )}
          </Field>
        </CardContent>
      </Card>
      {error ? <p className="text-sm text-bad">The trial balance could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={1} />
      ) : (
        <Card role="region" aria-label="Trial balance">
          <CardHeader>
            <CardTitle>Trial balance at {formatDate(asOf)}</CardTitle>
            <div className="flex items-center gap-2">
              {data.balanced ? <Badge tone="good">Balanced</Badge> : <Badge tone="bad">Out of balance</Badge>}
              <CsvButton
                filename={`${filePrefix}-trial-balance-${asOf}.csv`}
                build={() =>
                  toCsv(
                    ['Code', 'Account', 'Type', 'Debit', 'Credit'],
                    [
                      ...rows.map((row) => {
                        const c = columns(row);
                        return [row.account.code, row.account.name, TYPE_LABEL[row.account.type], c.dr ? rupeesCell(c.dr) : '', c.cr ? rupeesCell(c.cr) : ''];
                      }),
                      ['', 'Total', '', rupeesCell(totals.dr), rupeesCell(totals.cr)],
                    ],
                  )
                }
              />
            </div>
          </CardHeader>
          <Table>
            <caption className="sr-only">Trial balance: each account's balance, debits against credits</caption>
            <THead>
              <tr>
                <TH>Account</TH>
                <TH>Type</TH>
                <TH numeric>Debit</TH>
                <TH numeric>Credit</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const c = columns(row);
                return (
                  <tr key={row.account.code}>
                    <TD>
                      <Link to={tAccountHref(row.account.code, { to: asOf })} className="hover:underline">
                        <span className="text-muted-foreground tabular-nums">{row.account.code}</span> {row.account.name}
                      </Link>
                    </TD>
                    <TD className="text-muted-foreground">{TYPE_LABEL[row.account.type]}</TD>
                    <TD numeric>{c.dr ? <MoneyText paise={c.dr} /> : null}</TD>
                    <TD numeric>{c.cr ? <MoneyText paise={c.cr} /> : null}</TD>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <TD>Total</TD>
                <TD />
                <TD numeric>
                  <MoneyText paise={totals.dr} />
                </TD>
                <TD numeric>
                  <MoneyText paise={totals.cr} />
                </TD>
              </tr>
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
