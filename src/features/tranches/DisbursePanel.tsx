import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MoneyText } from '@/components/finance/MoneyText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { compareISO, daysBetween, isValidISODate } from '@/domain/dates';
import { sum } from '@/domain/money';
import { MIN_DAYS_TO_FIRST_DUE, type DisbursementPlan } from '@/domain/origination';
import type { ID } from '@/domain/types';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { RescopeDialog } from '@/features/pools/RescopeDialog';
import { useAppStore, useRepositories } from '@/store/context';

/**
 * Members whose loans this tranche will fund but who have not been paid out,
 * and the one action that pays them: draw what is needed from the federation
 * and disburse each loan, together.
 */
export function DisbursePanel({ trancheId, sanctionRef, canDisburse }: { trancheId: ID; sanctionRef: string; canDisburse: boolean }) {
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const { data: plan } = useQuery(`disbursement:${trancheId}:${version}`, () =>
    repositories.tranches.getDisbursementPlan(trancheId),
  );
  const [done, setDone] = useState<{ loanIds: ID[]; drawn: number }>();

  if (!plan || (plan.candidates.length === 0 && !done)) return null;
  if (plan.rescope) {
    return (
      <Card role="region" aria-label="Re-scope needed" className="mb-5 border-warn/40">
        <CardHeader>
          <CardTitle>Re-scope needed before any drawdown</CardTitle>
          {canDisburse ? (
            <RescopeDialog
              poolId={plan.rescope.poolId}
              reference={plan.rescope.reference}
              rows={plan.candidates}
              sanctioned={plan.rescope.sanctioned}
            />
          ) : null}
        </CardHeader>
        <CardContent className="text-sm">
          The members of {plan.rescope.reference} ask for <MoneyText paise={plan.rescope.asked} /> against the{' '}
          <MoneyText paise={plan.rescope.sanctioned} /> the federation sanctioned. Cut every loan pro rata, or remove
          members until the batch fits; then draw down and disburse.
        </CardContent>
      </Card>
    );
  }
  // Under an under-sanction, what is left may be too little for anyone still waiting.
  const fits = plan.candidates.some((c) => c.amount <= plan.capacity);
  return (
    <Card role="region" aria-label="Awaiting disbursement" className="mb-5">
      <CardHeader>
        <CardTitle>
          {plan.candidates.length > 0
            ? `${plural(plan.candidates.length, 'member')} awaiting disbursement`
            : 'Disbursed'}
        </CardTitle>
        {plan.candidates.length > 0 ? (
          !fits ? null : canDisburse ? (
            <DisburseDialog plan={plan} sanctionRef={sanctionRef} onDone={setDone} />
          ) : (
            <span className="text-xs text-muted-foreground">Only the secretary draws down and disburses.</span>
          )
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {done ? (
          <p className="text-good" role="status">
            Drew <MoneyText paise={done.drawn} /> and paid out {plural(done.loanIds.length, 'loan')}:{' '}
            {done.loanIds.map((id, i) => (
              <span key={id}>
                {i > 0 ? ', ' : null}
                <Link to={`/loans/${id}`} className="underline">
                  {id}
                </Link>
              </span>
            ))}
            .
          </p>
        ) : null}
        {plan.candidates.length > 0 && !fits ? (
          <p className="text-muted-foreground">
            The sanction has <MoneyText paise={plan.capacity} /> left to lend, less than any loan still waiting. These
            members stay batched until further funding.
          </p>
        ) : plan.candidates.length > 0 ? (
          <p className="text-muted-foreground">
            <MoneyText paise={sum(plan.candidates.map((c) => c.amount))} /> approved;{' '}
            <MoneyText paise={plan.capacity} /> of the sanction is still to lend, <MoneyText paise={plan.undrawn} /> of it
            not yet drawn.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Ticks members in order while the sanction still covers them. */
function fitWithin(plan: DisbursementPlan): ID[] {
  let left = plan.capacity;
  const chosen: ID[] = [];
  for (const row of plan.candidates) {
    if (row.amount <= left) {
      chosen.push(row.application.id);
      left -= row.amount;
    }
  }
  return chosen;
}

function DisburseDialog(props: {
  plan: DisbursementPlan;
  sanctionRef: string;
  onDone: (result: { loanIds: ID[]; drawn: number }) => void;
}) {
  const { plan } = props;
  const repositories = useRepositories();
  const clock = useAppStore((s) => s.world.clock);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ID[]>(() => fitWithin(plan));
  const [firstDueOn, setFirstDueOn] = useState(plan.suggestedFirstDueOn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const chosen = plan.candidates.filter((c) => selected.includes(c.application.id));
  const lending = sum(chosen.map((c) => c.amount));
  const drawNow = Math.max(0, lending - plan.idle);
  const over = lending - plan.capacity;
  const dateError = !isValidISODate(firstDueOn)
    ? 'Choose a date.'
    : compareISO(firstDueOn, clock) <= 0
      ? 'It must fall after today.'
      : undefined;
  const shortFirstMonth = !dateError && daysBetween(clock, firstDueOn) < MIN_DAYS_TO_FIRST_DUE;
  const offCycle = !dateError && plan.existingDueDates.length > 0 && !plan.existingDueDates.includes(firstDueOn);
  const valid = chosen.length > 0 && over <= 0 && !dateError;
  const toggle = (id: ID) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function confirm() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.tranches.drawAndDisburse({
      trancheId: plan.trancheId,
      applicationIds: chosen.map((c) => c.application.id),
      firstDueOn,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    props.onDone({ loanIds: result.loanIds, drawn: result.drawn });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          // Start from the plan as it stands now, not as it was when first shown.
          setSelected(fitWithin(plan));
          setFirstDueOn(plan.suggestedFirstDueOn);
          setError(undefined);
          setOpen(true);
        }}
      >
        Draw down and disburse
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Draw down and disburse</DialogTitle>
        <DialogDescription>
          {props.sanctionRef}. The society draws from the federation exactly what these loans need, and pays each member
          out the same day.
        </DialogDescription>

        <div className="mt-4 max-h-72 overflow-y-auto rounded-md border">
          <Table>
            <caption className="sr-only">Members to pay out</caption>
            <THead>
              <tr>
                <TH className="w-8">
                  <span className="sr-only">Pay out</span>
                </TH>
                <TH>Member</TH>
                <TH numeric>Amount</TH>
                <TH numeric>Tenure</TH>
                <TH numeric>EMI</TH>
              </tr>
            </THead>
            <TBody>
              {plan.candidates.map((row) => {
                const id = row.application.id;
                return (
                  <tr key={id}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.includes(id)}
                        onChange={() => toggle(id)}
                        aria-label={`Pay out ${row.memberName}`}
                        className="size-4 accent-[var(--primary)]"
                      />
                    </TD>
                    <TD>
                      <span className="font-medium">{row.memberName}</span>
                      <span className="block text-xs text-muted-foreground">{id}</span>
                    </TD>
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
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="First instalment due"
            error={dateError}
            hint={
              offCycle
                ? `Members on this tranche already pay on ${formatDate(plan.existingDueDates[0]!)}; a different day adds remittance dates.`
                : shortFirstMonth
                  ? `Less than ${MIN_DAYS_TO_FIRST_DUE} days away, yet the first instalment carries a full month of interest.`
                  : 'Monthly from then on, on the same day of the month.'
            }
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                value={firstDueOn}
                min={clock}
                onChange={(e) => setFirstDueOn(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
          <dl className="space-y-1 rounded-md bg-muted/60 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">To lend, {plural(chosen.length, 'loan')}</dt>
              <dd className="font-semibold">
                <MoneyText paise={lending} />
              </dd>
            </div>
            {plan.idle > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Already drawn, not lent</dt>
                <dd>
                  <MoneyText paise={plan.idle} />
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Drawn from the federation now</dt>
              <dd>
                <MoneyText paise={drawNow} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Left undrawn</dt>
              <dd>
                <MoneyText paise={plan.undrawn - drawNow} />
              </dd>
            </div>
          </dl>
        </div>

        {over > 0 ? (
          <p role="alert" className="mt-3 text-sm text-bad">
            <MoneyText paise={over} /> more than the sanction still covers. Untick a member.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-bad">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={!valid || pending}>
            {pending ? 'Disbursing…' : `Disburse ${plural(chosen.length, 'loan')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
