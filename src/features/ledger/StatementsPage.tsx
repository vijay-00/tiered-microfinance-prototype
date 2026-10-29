import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CsvButton } from '@/components/CsvButton';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { ACCOUNTS } from '@/domain/ledger';
import type { Period, Statements } from '@/domain/reporting';
import type { AccountBalance } from '@/domain/statements';
import { cn } from '@/lib/cn';
import { rupeesCell, toCsv, type Cell } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { readRange, tAccountHref, traceHref } from '@/lib/ledgerLinks';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

const INCOME = [ACCOUNTS.INTEREST_INCOME, ACCOUNTS.PENAL_FEE_INCOME];
const EXPENSE = [ACCOUNTS.INTEREST_EXPENSE, ACCOUNTS.PROVISION_WRITEOFF];

export function StatementsPage() {
  const user = useAppStore(selectCurrentUser);
  const society = useAppStore((s) => s.world.societies.find((x) => x.id === user.societyId));
  const clock = useAppStore((s) => s.world.clock);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const [params, setParams] = useSearchParams();
  const { data: periods } = useQuery(`periods:${societyId}:${version}`, () => repositories.ledger.getPeriods(societyId));

  const custom = readRange(params);
  const preset = periods?.find((p) => p.id === (params.get('period') ?? 'YEAR'));
  const isCustom = Boolean(custom.from || custom.to);
  const range = isCustom
    ? { from: custom.from ?? periods?.find((p) => p.id === 'INCEPTION')?.from ?? clock, to: custom.to ?? clock }
    : preset
      ? { from: preset.from, to: preset.to }
      : undefined;
  const { data, error } = useQuery(`statements:${societyId}:${version}:${range?.from}:${range?.to}`, () =>
    range ? repositories.ledger.getStatements(societyId, range) : new Promise<never>(() => {}),
  );

  return (
    <>
      <PageHeader
        title="Statements"
        description={
          <>
            {society?.name}. Every line opens the journal lines behind it.{' '}
            <Link to="/ledger" className="text-primary underline">
              General ledger
            </Link>
          </>
        }
        actions={
          data ? (
            <CsvButton filename={`${society?.code ?? societyId}-statements-${data.from}-${data.to}.csv`} build={() => statementsCsv(data)} />
          ) : null
        }
      />
      <Card className="mb-5">
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Field label="Period">
            {({ id }) => (
              <NativeSelect
                id={id}
                value={isCustom ? 'CUSTOM' : (preset?.id ?? 'YEAR')}
                onChange={(e) =>
                  setParams(e.target.value === 'CUSTOM' ? { from: range?.from ?? clock, to: range?.to ?? clock } : { period: e.target.value }, {
                    replace: true,
                  })
                }
              >
                {(periods ?? []).map((p: Period) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value="CUSTOM">Dates I choose</option>
              </NativeSelect>
            )}
          </Field>
          <Field label="From">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={range?.from ?? ''}
                max={clock}
                onChange={(e) => setParams({ from: e.target.value, to: range?.to ?? clock }, { replace: true })}
              />
            )}
          </Field>
          <Field label="To">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={range?.to ?? ''}
                max={clock}
                onChange={(e) => setParams({ from: range?.from ?? clock, to: e.target.value }, { replace: true })}
              />
            )}
          </Field>
        </CardContent>
      </Card>
      {error ? <p className="mb-4 text-sm text-bad">The statements could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={2} className="lg:grid-cols-2" />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <IncomeStatementCard data={data} />
          <BalanceSheetCard data={data} />
        </div>
      )}
    </>
  );
}

function Line(props: { label: ReactNode; amount: number; to?: string; strong?: boolean; indent?: boolean; less?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3 py-1', props.strong && 'border-t pt-1.5 font-semibold', props.indent && 'pl-4')}>
      <dt className={props.strong ? undefined : 'text-muted-foreground'}>
        {props.to ? (
          <Link to={props.to} className="hover:underline">
            {props.label}
          </Link>
        ) : (
          props.label
        )}
      </dt>
      <dd className="tabular-nums">
        {props.less && props.amount !== 0 ? '(' : null}
        <MoneyText paise={props.amount} />
        {props.less && props.amount !== 0 ? ')' : null}
      </dd>
    </div>
  );
}

function IncomeStatementCard({ data }: { data: Statements }) {
  const { income, from, to } = data;
  const range = { from, to };
  return (
    <Card role="region" aria-label="Income statement">
      <CardHeader>
        <CardTitle>Income statement</CardTitle>
        <span className="text-xs text-muted-foreground">
          {formatDate(from)} to {formatDate(to)}
        </span>
      </CardHeader>
      <CardContent>
        <dl className="text-sm">
          <Line label="Interest from members" amount={income.interestIncome} to={traceHref({ plus: [ACCOUNTS.INTEREST_INCOME], ...range })} />
          <Line label="Interest to the federation" less amount={income.interestExpense} to={traceHref({ plus: [ACCOUNTS.INTEREST_EXPENSE], ...range })} />
          <Line
            strong
            label="Net interest income"
            amount={income.netInterestIncome}
            to={traceHref({ plus: [ACCOUNTS.INTEREST_INCOME], minus: [ACCOUNTS.INTEREST_EXPENSE], ...range })}
          />
          <Line label="Penal interest and fees" amount={income.penalFeeIncome} to={traceHref({ plus: [ACCOUNTS.PENAL_FEE_INCOME], ...range })} />
          <Line label="Provisions and write-offs" less amount={income.provisions} to={traceHref({ plus: [ACCOUNTS.PROVISION_WRITEOFF], ...range })} />
          <Line strong label="Surplus for the period" amount={income.surplus} to={traceHref({ plus: INCOME, minus: EXPENSE, ...range })} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Period-close entries are left out: they move a period&rsquo;s result into reserves and would net every period to nothing.
        </p>
      </CardContent>
    </Card>
  );
}

function BalanceSheetCard({ data }: { data: Statements }) {
  const { balance, to } = data;
  const accountLine = (row: AccountBalance) => (
    <Line key={row.account.code} indent label={row.account.name} amount={row.balance} to={tAccountHref(row.account.code, { to })} />
  );
  const nonZero = (rows: readonly AccountBalance[]) => rows.filter((r) => r.dr !== 0 || r.cr !== 0);
  return (
    <Card role="region" aria-label="Balance sheet">
      <CardHeader>
        <CardTitle>Balance sheet</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">at {formatDate(to)}</span>
          {balance.balanced && data.trialBalanced ? <Badge tone="good">Balances</Badge> : <Badge tone="bad">Does not balance</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <dl className="text-sm">
          <dt className="py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Assets</dt>
          {nonZero(balance.assets).map(accountLine)}
          <Line strong label="Total assets" amount={balance.totalAssets} />

          <dt className="mt-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Liabilities</dt>
          {nonZero(balance.liabilities).map(accountLine)}
          <Line strong label="Total liabilities" amount={balance.totalLiabilities} />

          <dt className="mt-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Equity</dt>
          <Line indent label="Society reserves" amount={balance.reserves} to={tAccountHref(ACCOUNTS.SOCIETY_RESERVES, { to })} />
          <Line
            indent
            label="Surplus not yet closed into reserves"
            amount={balance.currentSurplus}
            to={traceHref({ plus: INCOME, minus: EXPENSE, from: data.openSurplusFrom, to })}
          />
          <Line strong label="Total equity" amount={balance.totalEquity} />
          <Line strong label="Liabilities and equity" amount={balance.totalLiabilities + balance.totalEquity} />
        </dl>
      </CardContent>
    </Card>
  );
}

function statementsCsv(data: Statements): string {
  const { income, balance } = data;
  const rows: Cell[][] = [
    ['Income statement', `${data.from} to ${data.to}`, ''],
    ['', 'Interest from members', rupeesCell(income.interestIncome)],
    ['', 'Interest to the federation', rupeesCell(-income.interestExpense)],
    ['', 'Net interest income', rupeesCell(income.netInterestIncome)],
    ['', 'Penal interest and fees', rupeesCell(income.penalFeeIncome)],
    ['', 'Provisions and write-offs', rupeesCell(-income.provisions)],
    ['', 'Surplus for the period', rupeesCell(income.surplus)],
    ['Balance sheet', `at ${data.to}`, ''],
    ...balance.assets.map((r) => ['Assets', r.account.name, rupeesCell(r.balance)]),
    ['', 'Total assets', rupeesCell(balance.totalAssets)],
    ...balance.liabilities.map((r) => ['Liabilities', r.account.name, rupeesCell(r.balance)]),
    ['', 'Total liabilities', rupeesCell(balance.totalLiabilities)],
    ['Equity', 'Society reserves', rupeesCell(balance.reserves)],
    ['Equity', 'Surplus not yet closed into reserves', rupeesCell(balance.currentSurplus)],
    ['', 'Total equity', rupeesCell(balance.totalEquity)],
  ];
  return toCsv(['Statement', 'Line', 'Amount'], rows);
}
