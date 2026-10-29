import { useState } from 'react';
import { MoneyText } from '@/components/finance/MoneyText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { formatPaisePlain, parseRupees } from '@/domain/money';
import type { RemittancePreview } from '@/domain/servicing';
import { formatDate } from '@/lib/format';
import { useRepositories } from '@/store/context';

/**
 * Records a remittance to the federation. Paying in full is the default; a
 * short payment is allowed, because a society under pressure does it, and the
 * dialog says exactly what will carry into the next period.
 */
export function RecordRemittanceDialog({ preview, sanctionRef }: { preview: RemittancePreview; sanctionRef: string }) {
  const repositories = useRepositories();
  const { due } = preview;
  const [open, setOpen] = useState(false);
  const [short, setShort] = useState(false);
  const [interestText, setInterestText] = useState(formatPaisePlain(due.interestDue));
  const [principalText, setPrincipalText] = useState(formatPaisePlain(due.principalDue));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const interest = short ? parseRupees(interestText) : due.interestDue;
  const principal = short ? parseRupees(principalText) : due.principalDue;
  const check = (value: number | undefined, max: number) =>
    value === undefined
      ? 'Enter an amount in rupees.'
      : value < 0
        ? 'Cannot be negative.'
        : value > max
          ? 'More than is due.'
          : undefined;
  const interestError = check(interest, due.interestDue);
  const principalError = check(principal, due.principalDue);
  const valid = !interestError && !principalError;
  const total = (interest ?? 0) + (principal ?? 0);
  const carried = due.totalDue - total;

  async function confirm() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.remittances.record({
      trancheId: preview.trancheId,
      dueOn: preview.dueOn,
      interestPaid: interest!,
      principalPaid: principal!,
    });
    setPending(false);
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Record remittance</Button>
      <DialogContent className="max-w-lg">
        <DialogTitle>Remit to the federation</DialogTitle>
        <DialogDescription>
          {sanctionRef}, for the remittance due {formatDate(preview.dueOn)}.
        </DialogDescription>

        <div className="mt-4 space-y-4">
          <Checkbox
            checked={short}
            onChange={setShort}
            label="Record a short payment"
            hint="Anything unpaid carries into the next period, and unpaid principal keeps attracting wholesale interest."
          />
          {short ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Interest paid (₹)" error={interestError} hint={<>Due <MoneyText paise={due.interestDue} /></>}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} inputMode="decimal" value={interestText} onChange={(e) => setInterestText(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
                )}
              </Field>
              <Field label="Principal paid (₹)" error={principalError} hint={<>Due <MoneyText paise={due.principalDue} /></>}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} inputMode="decimal" value={principalText} onChange={(e) => setPrincipalText(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
                )}
              </Field>
            </div>
          ) : null}

          <dl className="space-y-1 rounded-md bg-muted/60 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Paying now</dt>
              <dd className="font-semibold"><MoneyText paise={total} /></dd>
            </div>
            {carried > 0 ? (
              <div className="flex justify-between text-bad">
                <dt>Carried into the next period</dt>
                <dd><MoneyText paise={carried} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Cash left afterwards</dt>
              <dd className={preview.cashAvailable - total < 0 ? 'text-bad' : undefined}>
                <MoneyText paise={preview.cashAvailable - total} />
              </dd>
            </div>
          </dl>
          {preview.cashAvailable - total < 0 ? (
            <p role="alert" className="text-sm text-bad">
              This takes the society's cash below zero, a liquidity breach. It is not prevented, but the dashboard will flag it.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={!valid || pending || total === 0}>
            {pending ? 'Recording…' : <>Remit <MoneyText paise={total} /></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
