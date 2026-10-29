import { Link, useParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Facts } from '@/components/Facts';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { StatTile } from '@/components/finance/StatTile';
import { LoanStatusBadge, TrancheStatusBadge } from '@/components/finance/StatusBadges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { formatBps } from '@/domain/money';
import { can } from '@/domain/permissions';
import type { RemittancePreview } from '@/domain/servicing';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { DisbursePanel } from './DisbursePanel';
import { RecordRemittanceDialog } from './RecordRemittanceDialog';

export function TrancheDetailPage() {
  const { trancheId = '' } = useParams();
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const exists = useAppStore((s) => s.world.tranches[trancheId]?.tranche.societyId === user.societyId);
  const repositories = useRepositories();
  const { data, error } = useQuery(`tranche:${trancheId}:${version}`, () =>
    exists ? repositories.tranches.getDetail(trancheId) : Promise.reject(new Error('missing')),
  );

  if (!exists) {
    return (
      <PageHeader
        title="Facility not found"
        description={
          <>
            There is no tranche {trancheId} for this society. <Link to="/tranches" className="text-primary underline">Back to funding</Link>.
          </>
        }
      />
    );
  }
  if (error) return <p className="text-sm text-bad">The facility could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={4} className="sm:grid-cols-2 xl:grid-cols-4" />;

  const { tranche, totals } = data;
  return (
    <>
      <Breadcrumb items={[{ label: 'Funding', to: '/tranches' }, { label: tranche.sanctionRef }]} />
      <PageHeader
        title={tranche.sanctionRef}
        description={`${data.pool.reference} · ${data.societyName} · sanctioned ${formatDate(tranche.sanctionedOn)}`}
        actions={<TrancheStatusBadge status={tranche.status} />}
      />
      <Facts
        className="mb-5 rounded-lg border bg-card p-4"
        items={[
          { label: 'Sanctioned', value: <MoneyText paise={tranche.sanctionedAmount} /> },
          { label: 'Drawn', value: <MoneyText paise={data.drawn} /> },
          { label: 'Undrawn', value: <MoneyText paise={data.undrawn} /> },
          { label: 'Outstanding', value: <MoneyText paise={data.outstanding} /> },
          { label: 'Wholesale rate', value: `${formatBps(tranche.wholesaleRateBps)} a year` },
          { label: 'Tenure', value: `${tranche.tenureMonths} months` },
        ]}
      />

      <DisbursePanel trancheId={tranche.id} sanctionRef={tranche.sanctionRef} canDisburse={can(user.role, 'DISBURSE')} />

      <NextRemittance
        preview={data.next}
        sanctionRef={tranche.sanctionRef}
        canRemit={can(user.role, 'RECORD_REMITTANCE')}
        funded={data.funded.length}
      />

      <section aria-label="To date" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Wholesale interest paid" value={<MoneyText paise={totals.wholesaleInterestPaid} />} />
        <StatTile label="Principal repaid" value={<MoneyText paise={totals.principalRepaid} />} />
        <StatTile label="Interest received from members" value={<MoneyText paise={totals.memberInterest} />} />
        <StatTile
          label="Margin kept by the society"
          tone="good"
          value={<MoneyText paise={totals.marginRetained} />}
          detail="Member interest received less wholesale interest paid"
        />
      </section>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Remittances <span className="font-normal text-muted-foreground">· {data.history.length}</span>
          </CardTitle>
        </CardHeader>
        {data.history.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nothing remitted yet.</p>
        ) : (
          <Table>
            <caption className="sr-only">Remittances made, with the margin each period earned</caption>
            <THead>
              <tr>
                <TH>Due</TH>
                <TH>Paid</TH>
                <TH numeric>Interest</TH>
                <TH numeric>Principal</TH>
                <TH numeric>Carried forward</TH>
                <TH numeric>Member interest</TH>
                <TH numeric>Margin</TH>
                <TH>Recorded by</TH>
              </tr>
            </THead>
            <TBody>
              {data.history.map((p) => (
                <tr key={p.remittance.id}>
                  <TD className="whitespace-nowrap">{formatDate(p.remittance.dueOn)}</TD>
                  <TD className="whitespace-nowrap">{formatDate(p.remittance.paidOn)}</TD>
                  <TD numeric><MoneyText paise={p.remittance.interestPaid} /></TD>
                  <TD numeric><MoneyText paise={p.remittance.principalPaid} /></TD>
                  <TD numeric className={p.carriedForward > 0 ? 'text-bad' : 'text-muted-foreground'}>
                    <MoneyText paise={p.carriedForward} />
                  </TD>
                  <TD numeric><MoneyText paise={p.memberInterest} /></TD>
                  <TD numeric className="font-medium text-good"><MoneyText paise={p.margin} /></TD>
                  <TD className="text-xs text-muted-foreground">{p.recordedByName}</TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {data.projection.length > 0 ? (
        <Card className="mt-5">
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
              Remittances still to come · {data.projection.length}
              <span className="ml-2 font-normal text-muted-foreground">if every member and remittance is on time</span>
            </summary>
            <Table>
              <caption className="sr-only">Projected remittances</caption>
              <THead>
                <tr>
                  <TH>Due</TH>
                  <TH numeric>Tranche balance</TH>
                  <TH numeric>Interest</TH>
                  <TH numeric>Principal</TH>
                  <TH numeric>Total</TH>
                </tr>
              </THead>
              <TBody>
                {data.projection.map((p) => (
                  <tr key={p.dueOn}>
                    <TD className="whitespace-nowrap">{formatDate(p.dueOn)}</TD>
                    <TD numeric><MoneyText paise={p.opening} /></TD>
                    <TD numeric><MoneyText paise={p.interest} /></TD>
                    <TD numeric><MoneyText paise={p.principal} /></TD>
                    <TD numeric className="font-medium"><MoneyText paise={p.total} /></TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </details>
        </Card>
      ) : null}

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>
            Loans funded <span className="font-normal text-muted-foreground">· {data.funded.length}</span>
          </CardTitle>
        </CardHeader>
        {data.funded.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No loans paid out from it yet.</p>
        ) : (
          <Table>
            <caption className="sr-only">Member loans funded by this tranche</caption>
            <THead>
              <tr>
                <TH>Member</TH>
                <TH numeric>Principal</TH>
                <TH numeric>Outstanding</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {data.funded.map((f) => (
                <tr key={f.loan.id}>
                  <TD>
                    <Link to={`/loans/${f.loan.id}`} className="font-medium hover:underline">{f.memberName}</Link>
                    <span className="block text-xs text-muted-foreground">{f.loan.id}</span>
                  </TD>
                  <TD numeric><MoneyText paise={f.loan.principal} /></TD>
                  <TD numeric><MoneyText paise={f.outstanding} /></TD>
                  <TD><LoanStatusBadge status={f.loan.status} /></TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

function NextRemittance(props: {
  preview: RemittancePreview | undefined;
  sanctionRef: string;
  canRemit: boolean;
  funded: number;
}) {
  const { preview } = props;
  if (!preview) {
    return (
      <Card role="region" aria-label="Next remittance">
        <CardContent className="text-sm text-muted-foreground">
          {props.funded === 0
            ? 'Nothing falls due to the federation until loans are paid out from this facility.'
            : 'Nothing more is due on this facility.'}
        </CardContent>
      </Card>
    );
  }
  const { due, collectedSinceLast } = preview;
  return (
    <Card role="region" aria-label="Next remittance">
      <CardHeader>
        <CardTitle>Next remittance · {formatDate(preview.dueOn)}</CardTitle>
        {preview.overdue ? (
          <Badge tone="bad">Overdue</Badge>
        ) : preview.canRecord ? (
          <Badge tone="warn">Due today</Badge>
        ) : (
          <Badge>Not due yet</Badge>
        )}
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              Interest on <MoneyText paise={due.trancheOpening} /> for the month
            </dt>
            <dd><MoneyText paise={due.wholesaleInterest} /></dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Principal members were scheduled to repay</dt>
            <dd><MoneyText paise={due.memberPrincipalScheduled} /></dd>
          </div>
          {due.prepaidPassThrough > 0 ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Principal members prepaid</dt>
              <dd><MoneyText paise={due.prepaidPassThrough} /></dd>
            </div>
          ) : null}
          {due.interestArrears + due.principalArrears > 0 ? (
            <div className="flex justify-between gap-3 text-bad">
              <dt>Brought forward from last period</dt>
              <dd><MoneyText paise={due.interestArrears + due.principalArrears} /></dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold">
            <dt>Owed to the federation</dt>
            <dd><MoneyText paise={due.totalDue} /></dd>
          </div>
        </dl>

        <div className="space-y-2 text-sm">
          {collectedSinceLast.receipts === 0 ? (
            <p>No member payments have come in towards it yet.</p>
          ) : (
            <p>
              Since the last remittance, {plural(collectedSinceLast.receipts, 'member payment')} brought in{' '}
              <MoneyText paise={collectedSinceLast.toFederation} /> towards this, and{' '}
              <span className="font-medium text-good"><MoneyText paise={collectedSinceLast.margin} /></span> of margin
              for the society.
            </p>
          )}
          {!preview.canRecord ? (
            // A shortfall only means something once the date has arrived;
            // before then the members' instalments are simply not due yet.
            <p className="text-muted-foreground">
              Members' instalments for this period fall due by {formatDate(preview.dueOn)}.
            </p>
          ) : preview.fromReserves >= 100 ? (
            <p className="text-bad">
              <MoneyText paise={preview.fromReserves} /> will have to come from the society's reserves to pay in full.
            </p>
          ) : preview.fromReserves > 0 ? (
            // The tranche's interest is rounded once on its whole balance, each
            // member's share on their own: paise apart, by design.
            <p className="text-muted-foreground">
              Members have paid in enough to cover it, bar <MoneyText paise={preview.fromReserves} /> of rounding.
            </p>
          ) : (
            <p className="text-muted-foreground">Members have paid in enough to cover it.</p>
          )}
          <p className="text-muted-foreground">
            Cash available <MoneyText paise={preview.cashAvailable} />, leaving{' '}
            <span className={preview.liquidityBreach ? 'font-medium text-bad' : undefined}>
              <MoneyText paise={preview.cashAfter} />
            </span>{' '}
            after paying in full.
          </p>
          <div className="pt-1">
            {!preview.canRecord ? (
              <p className="text-xs text-muted-foreground">It can be recorded from {formatDate(preview.dueOn)}.</p>
            ) : props.canRemit ? (
              <RecordRemittanceDialog preview={preview} sanctionRef={props.sanctionRef} />
            ) : (
              <p className="text-xs text-muted-foreground">Only the society's secretary can record a remittance.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
