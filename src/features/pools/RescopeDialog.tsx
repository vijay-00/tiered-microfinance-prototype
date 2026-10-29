import { useState } from 'react';
import { MoneyText } from '@/components/finance/MoneyText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { formatPaise, sum } from '@/domain/money';
import { proRataRescope, quoteLoan, type ApplicationRow } from '@/domain/origination';
import type { ID, Paise } from '@/domain/types';
import { cn } from '@/lib/cn';
import { useAppStore, useRepositories } from '@/store/context';

type Method = 'PRO_RATA' | 'REMOVE';

/**
 * A sanction below the request goes back to the secretary, who chooses how the
 * pool fits: every loan cut by the same proportion, or members removed until
 * the rest fit. Nothing is decided for them, and either way they confirm the
 * members were told.
 */
export function RescopeDialog(props: { poolId: ID; reference: string; rows: readonly ApplicationRow[]; sanctioned: Paise }) {
  const { rows, sanctioned } = props;
  const repositories = useRepositories();
  const policy = useAppStore((s) => s.world.policy);
  const clock = useAppStore((s) => s.world.clock);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>('PRO_RATA');
  const [kept, setKept] = useState<ID[]>(() => rows.map((r) => r.application.id));
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const asked = sum(rows.map((r) => r.amount));
  const cuts = new Map(
    proRataRescope(
      rows.map((r) => ({ applicationId: r.application.id, amount: r.amount })),
      sanctioned,
    ).map((c) => [c.applicationId, c.amount]),
  );
  const tooSmall = rows.filter((r) => cuts.get(r.application.id)! < policy.minTicket);
  const keptRows = rows.filter((r) => kept.includes(r.application.id));
  const keptTotal = sum(keptRows.map((r) => r.amount));
  const over = keptTotal - sanctioned;
  const fits = method === 'PRO_RATA' ? tooSmall.length === 0 : keptRows.length > 0 && over <= 0;
  const newTotal = method === 'PRO_RATA' ? sum([...cuts.values()]) : keptTotal;

  function start() {
    setMethod('PRO_RATA');
    setKept(rows.map((r) => r.application.id));
    setConfirmed(false);
    setError(undefined);
    setOpen(true);
  }

  async function save() {
    if (!fits || !confirmed) return;
    setPending(true);
    setError(undefined);
    const keep =
      method === 'PRO_RATA'
        ? rows.map((r) => ({ applicationId: r.application.id, amount: cuts.get(r.application.id)! }))
        : keptRows.map((r) => ({ applicationId: r.application.id, amount: r.amount }));
    const result = await repositories.pools.rescope({ poolId: props.poolId, method, keep });
    setPending(false);
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={start}>Re-scope the pool</Button>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Re-scope {props.reference}</DialogTitle>
        <DialogDescription>
          The federation sanctioned <MoneyText paise={sanctioned} /> against <MoneyText paise={asked} /> asked for,{' '}
          <MoneyText paise={asked - sanctioned} /> short. Choose how the pool fits.
        </DialogDescription>

        <div role="radiogroup" aria-label="How to fit the sanction" className="mt-4 grid gap-2 sm:grid-cols-2">
          {(
            [
              ['PRO_RATA', 'Cut every loan pro rata', `Each member gets ${Math.floor((sanctioned / asked) * 1000) / 10}% of what was approved.`],
              ['REMOVE', 'Remove members', 'The rest keep their full amounts; those removed can join another pool.'],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={method === value}
              onClick={() => {
                setMethod(value);
                setConfirmed(false);
              }}
              className={cn(
                'rounded-md border px-3 py-2 text-left text-sm transition-colors hover:border-ring',
                method === value && 'border-primary bg-accent/50',
              )}
            >
              <span className="block font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 max-h-72 overflow-y-auto rounded-md border">
          <Table>
            <caption className="sr-only">The pool after re-scoping</caption>
            <THead>
              <tr>
                {method === 'REMOVE' ? (
                  <TH className="w-8">
                    <span className="sr-only">Keep</span>
                  </TH>
                ) : null}
                <TH>Member</TH>
                <TH numeric>Approved</TH>
                <TH numeric>{method === 'PRO_RATA' ? 'Re-scoped' : 'Amount'}</TH>
                <TH numeric>EMI</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const id = row.application.id;
                const amount = method === 'PRO_RATA' ? cuts.get(id)! : row.amount;
                const removed = method === 'REMOVE' && !kept.includes(id);
                const small = method === 'PRO_RATA' && amount < policy.minTicket;
                const emi = quoteLoan(amount, row.tenureMonths, policy.retailRateBps, clock)?.emi;
                return (
                  <tr key={id} className={cn(removed && 'text-muted-foreground line-through')}>
                    {method === 'REMOVE' ? (
                      <TD>
                        <input
                          type="checkbox"
                          checked={!removed}
                          onChange={() =>
                            setKept((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
                          }
                          aria-label={`Keep ${row.memberName}`}
                          className="size-4 accent-[var(--primary)]"
                        />
                      </TD>
                    ) : null}
                    <TD>
                      <span className="font-medium">{row.memberName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {id} · {row.tenureMonths} months
                      </span>
                    </TD>
                    <TD numeric><MoneyText paise={row.amount} /></TD>
                    <TD numeric className={cn(small && 'font-medium text-bad')}>
                      <MoneyText paise={amount} />
                    </TD>
                    <TD numeric>{emi !== undefined && !removed ? <MoneyText paise={emi} /> : '–'}</TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        </div>

        <div className="mt-3 space-y-3 text-sm">
          <p>
            The pool would ask for <span className="font-semibold"><MoneyText paise={newTotal} /></span> of the{' '}
            <MoneyText paise={sanctioned} /> sanctioned
            {method === 'REMOVE' ? `, from ${keptRows.length} of ${rows.length} members` : ''}.
          </p>
          {method === 'PRO_RATA' && tooSmall.length > 0 ? (
            <p role="alert" className="text-bad">
              {tooSmall.map((r) => r.memberName).join(', ')} would fall below the {formatPaise(policy.minTicket)} minimum
              loan. Remove members instead.
            </p>
          ) : null}
          {method === 'REMOVE' && over > 0 ? (
            <p role="alert" className="text-bad">
              <MoneyText paise={over} /> over the sanction: remove more members.
            </p>
          ) : null}
          <Checkbox
            checked={confirmed}
            onChange={setConfirmed}
            disabled={!fits}
            label={
              method === 'PRO_RATA'
                ? 'Each member has agreed to the reduced amount and instalment'
                : 'The members removed have been told they will wait for another pool'
            }
            hint="Re-scoping changes what members were promised, so it needs their word, not just the arithmetic."
          />
          {error ? (
            <p role="alert" className="text-bad">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={() => void save()} disabled={!fits || !confirmed || pending}>
            {pending ? 'Re-scoping…' : 'Re-scope the pool'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
