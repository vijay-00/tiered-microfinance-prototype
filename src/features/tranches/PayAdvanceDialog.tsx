import { useState } from 'react';
import { MoneyText } from '@/components/finance/MoneyText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { formatPaise, formatPaisePlain, parseRupees } from '@/domain/money';
import type { RemittancePreview } from '@/domain/servicing';
import { formatDate } from '@/lib/format';
import { useRepositories } from '@/store/context';

/**
 * Sends members' advances on to the federation ahead of the remittance date.
 * The society owes that much less on the date; the members' schedules do not
 * change, because the money still waits to meet their instalments.
 */
export function PayAdvanceDialog({ preview, sanctionRef }: { preview: RemittancePreview; sanctionRef: string }) {
  const repositories = useRepositories();
  const available = preview.advanceAvailable;
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState(formatPaisePlain(available));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const amount = parseRupees(amountText);
  const amountError =
    amount === undefined || amount <= 0
      ? 'Enter an amount in rupees.'
      : amount > available
        ? `Only ${formatPaise(available)} is held in advance.`
        : undefined;
  const nextRemittance = Math.max(0, preview.payNow - (amount ?? 0));

  function show(next: boolean) {
    if (next) setAmountText(formatPaisePlain(available));
    setError(undefined);
    setOpen(next);
  }

  async function confirm() {
    if (amountError) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.remittances.payAdvance({ trancheId: preview.trancheId, amount: amount! });
    setPending(false);
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={show}>
      <Button variant="outline" onClick={() => show(true)}>
        Pay advance to the federation
      </Button>
      <DialogContent className="max-w-lg">
        <DialogTitle>Pay advance to the federation</DialogTitle>
        <DialogDescription>
          {sanctionRef}. The federation gets this now, and the members’ schedules stay as they are.
        </DialogDescription>

        <div className="mt-4 space-y-4">
          <Field label="Amount (₹)" error={amountError} hint={<>Held in advance <MoneyText paise={available} /></>}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
          <dl className="space-y-1 rounded-md bg-muted/60 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Left to pay on {formatDate(preview.dueOn)}</dt>
              <dd className="font-semibold"><MoneyText paise={nextRemittance} /></dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Cash left afterwards</dt>
              <dd><MoneyText paise={preview.cashAvailable - (amount ?? 0)} /></dd>
            </div>
          </dl>
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
          <Button onClick={() => void confirm()} disabled={Boolean(amountError) || pending}>
            {pending ? 'Paying…' : <>Pay <MoneyText paise={amount ?? 0} /></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
