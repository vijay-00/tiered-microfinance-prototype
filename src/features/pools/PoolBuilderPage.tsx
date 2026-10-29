import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { PoolEconomicsList } from '@/components/finance/PoolEconomicsList';
import { PoolStatusBadge } from '@/components/finance/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { poolEconomics, type PoolBuilder } from '@/domain/origination';
import { can } from '@/domain/permissions';
import type { ID } from '@/domain/types';
import { cn } from '@/lib/cn';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { nextPoolReference } from '@/store/commands';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

export function PoolBuilderPage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const [params] = useSearchParams();
  const poolId = params.get('pool') ?? undefined;
  const societyId = user.societyId!;
  const { data, error } = useQuery(`pool-builder:${societyId}:${poolId ?? 'new'}:${version}`, () =>
    repositories.pools.getBuilder(societyId, poolId),
  );

  if (!can(user.role, 'MANAGE_POOL')) {
    return <PageHeader title="Pool builder" description="Only the secretary builds pools and submits them to the federation." />;
  }
  if (error) return <p className="text-sm text-bad">The pool could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={2} className="lg:grid-cols-2" />;
  if (poolId && !data.pool) {
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
  if (data.pool && data.pool.status !== 'OPEN' && data.pool.status !== 'READY') {
    return (
      <PageHeader
        title={data.pool.reference}
        description={
          <>
            This pool has been submitted and can no longer change.{' '}
            <Link to={`/pools/${data.pool.id}`} className="text-primary underline">
              See the pool
            </Link>
            .
          </>
        }
      />
    );
  }
  // Remount when switching pools so the selection starts from what was saved.
  return <Builder key={data.pool?.id ?? 'new'} builder={data} societyId={societyId} />;
}

function Builder({ builder, societyId }: { builder: PoolBuilder; societyId: ID }) {
  const world = useAppStore((s) => s.world);
  const policy = world.policy;
  const repositories = useRepositories();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ID[]>([...builder.selectedIds]);
  const [pending, setPending] = useState<'save' | 'submit'>();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  // Worked out in the browser on every tick, like the payment preview.
  const economics = useMemo(() => poolEconomics(world, selected), [world, selected]);
  const reference = builder.pool?.reference ?? nextPoolReference(world, societyId);
  const saved = builder.selectedIds;
  const changed = selected.length !== saved.length || selected.some((id) => !saved.includes(id));
  const count = selected.length;
  const toggle = (id: ID) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function save(submit: boolean) {
    setPending(submit ? 'submit' : 'save');
    setError(undefined);
    const result = await repositories.pools.save(
      { societyId, poolId: builder.pool?.id, applicationIds: selected },
      submit,
    );
    setPending(undefined);
    setConfirming(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(submit ? `/pools/${result.poolId}` : `/pools/new?pool=${result.poolId}`, { replace: !submit });
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Pools', to: '/pools' }, { label: builder.pool ? reference : 'New pool' }]} />
      <PageHeader
        title={builder.pool ? reference : 'New pool'}
        description={
          builder.pool
            ? 'Choose who goes to the federation in this pool. Saving keeps it as a draft.'
            : `It will be ${reference}. Choose who goes to the federation in it.`
        }
        actions={builder.pool ? <PoolStatusBadge status={builder.pool.status} /> : null}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>
              Approved applications <span className="font-normal text-muted-foreground">· {builder.candidates.length}</span>
            </CardTitle>
            {builder.candidates.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(
                    count === builder.candidates.length ? [] : builder.candidates.map((c) => c.application.id),
                  )
                }
              >
                {count === builder.candidates.length ? 'Clear all' : 'Select all'}
              </Button>
            ) : null}
          </CardHeader>
          {builder.candidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No approved application is waiting.{' '}
              <Link to="/applications?tab=AWAITING_DECISION" className="text-primary underline">
                See what awaits a decision
              </Link>
              .
            </p>
          ) : (
            <Table>
              <caption className="sr-only">Approved applications that can go into the pool</caption>
              <THead>
                <tr>
                  <TH className="w-8">
                    <span className="sr-only">In the pool</span>
                  </TH>
                  <TH>Member</TH>
                  <TH>Purpose</TH>
                  <TH numeric>Amount</TH>
                  <TH numeric>Tenure</TH>
                  <TH numeric>EMI</TH>
                </tr>
              </THead>
              <TBody>
                {builder.candidates.map((row) => {
                  const id = row.application.id;
                  const on = selected.includes(id);
                  return (
                    <tr key={id} className={cn('cursor-pointer', on && 'bg-accent/40')} onClick={() => toggle(id)}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Include ${row.memberName}`}
                          className="size-4 accent-[var(--primary)]"
                        />
                      </TD>
                      <TD>
                        <span className="font-medium">{row.memberName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {id} · {row.village}
                        </span>
                      </TD>
                      <TD>{PURPOSE_LABEL[row.application.purpose]}</TD>
                      <TD numeric>
                        <MoneyText paise={row.amount} />
                      </TD>
                      <TD numeric>{row.tenureMonths} mo</TD>
                      <TD numeric>{row.emi !== undefined ? <MoneyText paise={row.emi} /> : '–'}</TD>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        <Card role="region" aria-label="The pool" className="lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle>The pool</CardTitle>
            <span className={cn('text-sm font-semibold tabular-nums', economics.readiness.ready ? 'text-good' : 'text-warn')}>
              {count} of {policy.poolMinMembers}–{policy.poolMaxMembers} members
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <MemberBand count={count} min={policy.poolMinMembers} max={policy.poolMaxMembers} />
            <PoolEconomicsList economics={economics} policy={policy} />
            {!economics.readiness.ready ? (
              <p className="text-sm text-warn">{economics.readiness.reason}</p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-bad">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => void save(false)}
                disabled={pending !== undefined || !changed || (!builder.pool && count === 0)}
              >
                {pending === 'save' ? 'Saving…' : 'Save draft'}
              </Button>
              <Dialog open={confirming} onOpenChange={setConfirming}>
                <Button onClick={() => setConfirming(true)} disabled={pending !== undefined || !economics.readiness.ready}>
                  Submit to the federation
                </Button>
                <DialogContent>
                  <DialogTitle>Submit {reference}?</DialogTitle>
                  <DialogDescription>
                    {count} members asking for <MoneyText paise={economics.total} /> go to the federation for review. Their
                    applications are locked to this pool until it decides.
                  </DialogDescription>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="ghost">Cancel</Button>
                    </DialogClose>
                    <Button onClick={() => void save(true)} disabled={pending !== undefined}>
                      {pending === 'submit' ? 'Submitting…' : 'Submit'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** How full the pool is against the band it must fall in. */
function MemberBand({ count, min, max }: { count: number; min: number; max: number }) {
  const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div
      className="relative h-2 overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label="Members in the pool"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={count}
      aria-valuetext={`${count} members; between ${min} and ${max} needed`}
    >
      <span className="absolute inset-y-0 left-0 bg-good/15" style={{ left: pct(min), right: 0 }} aria-hidden />
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', count >= min && count <= max ? 'bg-good' : 'bg-warn')}
        style={{ width: pct(count) }}
        aria-hidden
      />
    </div>
  );
}
