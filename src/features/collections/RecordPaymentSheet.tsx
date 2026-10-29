import { CheckCircle2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { JournalEntryTable } from '@/components/finance/JournalEntryTable';
import { MoneyText } from '@/components/finance/MoneyText';
import { SplitBar } from '@/components/finance/SplitBar';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, NativeSelect } from '@/components/ui/form';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatPaisePlain, parseRupees } from '@/domain/money';
import { previewPayment } from '@/domain/servicing';
import type { Allocation, Paise, PaymentMode } from '@/domain/types';
import { journalOf, loanOf, memberOf, positionOf } from '@/domain/world';
import { formatDate, plural } from '@/lib/format';
import { useAppStore, useRepositories } from '@/store/context';

const MODES: ReadonlyArray<{ value: PaymentMode; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
];

/** The waterfall's buckets, in the words a collections officer would use. */
const BUCKETS: ReadonlyArray<{ key: keyof Allocation; label: string }> = [
  { key: 'penalInterest', label: 'Penal interest' },
  { key: 'fees', label: 'Fees' },
  { key: 'overdueInterest', label: 'Overdue interest' },
  { key: 'overduePrincipal', label: 'Overdue principal' },
  { key: 'currentInterest', label: 'This instalment’s interest' },
  { key: 'currentPrincipal', label: 'This instalment’s principal' },
  { key: 'prepaidPrincipal', label: 'Principal prepaid' },
  { key: 'advance', label: 'Held as advance' },
];

type Done = { receiptNo: string; paymentId: string };

/**
 * The record-payment drawer. Everything it shows before confirmation comes
 * from running the real engine on the receipt as typed; nothing is
 * approximated, so what is previewed is exactly what gets posted.
 */
export function RecordPaymentSheet(props: { loanId: string | undefined; onClose: () => void }) {
  return (
    <Sheet open={props.loanId !== undefined} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <SheetContent className="max-w-xl">
        {props.loanId ? <PaymentForm key={props.loanId} loanId={props.loanId} onClose={props.onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function PaymentForm({ loanId, onClose }: { loanId: string; onClose: () => void }) {
  const world = useAppStore((s) => s.world);
  const repositories = useRepositories();
  const entry = loanOf(world, loanId);
  const member = memberOf(world, entry.loan.memberId);
  const position = useMemo(() => positionOf(world, loanId), [world, loanId]);

  const [amountText, setAmountText] = useState(() =>
    formatPaisePlain(position.totalDueNow > 0 ? position.totalDueNow : entry.loan.emi),
  );
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [prepay, setPrepay] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [done, setDone] = useState<Done>();

  const amount = parseRupees(amountText);
  const amountError =
    amount === undefined ? 'Enter an amount in rupees, with at most two decimals.' : amount <= 0 ? 'Enter more than zero.' : undefined;
  const preview = useMemo(
    () =>
      amount !== undefined && amount > 0 && !done
        ? previewPayment(world, loanId, { amount, source: 'CASH', electPrepayment: prepay })
        : undefined,
    [world, loanId, amount, prepay, done],
  );

  async function submit(source: 'CASH' | 'ADVANCE', value: Paise) {
    setPending(true);
    setSubmitError(undefined);
    const result = await repositories.payments.record({
      loanId,
      amount: value,
      mode,
      source,
      electPrepayment: source === 'CASH' && prepay,
    });
    setPending(false);
    if (result.ok) setDone({ receiptNo: result.receiptNo, paymentId: result.paymentId });
    else setSubmitError(result.error);
  }

  if (done) return <Receipt done={done} loanId={loanId} onClose={onClose} />;

  const payoff = position.payoffAmount - position.unappliedReceipts;
  const advanceUsable = Math.min(position.unappliedReceipts, position.totalDueNow);

  return (
    <>
      <SheetHeader>
        <SheetTitle>Record a payment</SheetTitle>
        <SheetDescription>
          {member.name}, {member.village} · loan {loanId} · instalment <MoneyText paise={entry.loan.emi} />
        </SheetDescription>
      </SheetHeader>

      <form
        className="flex-1 space-y-5 overflow-y-auto px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (amount !== undefined && preview?.ok) void submit('CASH', amount);
        }}
      >
        <section aria-label="What is owed" className="grid grid-cols-2 gap-3 rounded-md bg-muted/60 p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Due now</p>
            <p className="font-semibold"><MoneyText paise={position.totalDueNow} /></p>
            {position.penalUnpaid > 0 ? (
              <p className="text-xs text-bad">
                Includes <MoneyText paise={position.penalUnpaid} /> penal interest
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Principal outstanding</p>
            <p className="font-semibold"><MoneyText paise={position.principalOutstanding} /></p>
            {position.unappliedReceipts > 0 ? (
              <p className="text-xs text-muted-foreground">
                <MoneyText paise={position.unappliedReceipts} /> held in advance
              </p>
            ) : null}
          </div>
        </section>

        {advanceUsable > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm">
            <p>
              <MoneyText paise={position.unappliedReceipts} /> is already held for this member.
            </p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => void submit('ADVANCE', advanceUsable)}>
              Apply <MoneyText paise={advanceUsable} />
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field
            label="Amount received (₹)"
            error={amountError}
            hint={
              <span className="flex flex-wrap gap-x-3">
                {position.totalDueNow > 0 ? (
                  <button type="button" className="text-primary underline" onClick={() => setAmountText(formatPaisePlain(position.totalDueNow))}>
                    Amount due
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => {
                    setAmountText(formatPaisePlain(payoff));
                    setPrepay(true);
                  }}
                >
                  Pay off the loan
                </button>
              </span>
            }
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                inputMode="decimal"
                autoComplete="off"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="text-base tabular-nums"
              />
            )}
          </Field>
          <Field label="Received by">
            {({ id }) => (
              <NativeSelect id={id} value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>

        <Checkbox
          checked={prepay}
          onChange={setPrepay}
          label="Apply anything extra to principal"
          hint="Prepaid principal is passed to the federation at the next remittance. The instalment stays the same and the loan ends sooner."
        />

        <PreviewPanel
          preview={preview}
          onPayOff={(max) => {
            // The most a loan accepts is its payoff, which only makes sense as
            // a prepayment; held as an advance it would park the whole balance.
            setAmountText(formatPaisePlain(max));
            setPrepay(true);
          }}
        />

        {submitError ? (
          <p role="alert" className="rounded-md bg-bad-soft p-3 text-sm text-bad">
            {submitError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !preview?.ok}>
            {pending ? 'Recording…' : amount ? <>Record <MoneyText paise={amount} /></> : 'Record payment'}
          </Button>
        </div>
      </form>
    </>
  );
}

function PreviewPanel(props: { preview: ReturnType<typeof previewPayment> | undefined; onPayOff: (max: Paise) => void }) {
  const { preview } = props;
  if (!preview) return null;
  if (!preview.ok) {
    return (
      <div role="alert" className="rounded-md border border-bad/30 bg-bad-soft p-3 text-sm text-bad">
        <p>{preview.message}.</p>
        {preview.maxAcceptable !== undefined && preview.maxAcceptable > 0 ? (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => props.onPayOff(preview.maxAcceptable!)}>
            Use <MoneyText paise={preview.maxAcceptable} /> to pay off the loan
          </Button>
        ) : null}
      </div>
    );
  }

  const { allocation, federation, society } = preview.output.reconciliation;
  const retained = society.netInterestIncome + society.penalIncome + society.feeIncome;
  return (
    <section aria-label="Preview" className="space-y-4 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-semibold">How it is applied</h3>
        <dl className="mt-2 space-y-1 text-sm">
          {BUCKETS.filter((b) => allocation[b.key] > 0).map((b) => (
            <div key={b.key} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{b.label}</dt>
              <dd><MoneyText paise={allocation[b.key]} /></dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Where it goes</h3>
        <SplitBar
          className="mt-2"
          toFederation={federation.remittanceShare}
          retained={retained}
          advance={allocation.advance}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          The federation's share is <MoneyText paise={federation.wholesaleInterestShare} /> of wholesale interest and{' '}
          <MoneyText paise={federation.principalPassThrough} /> of principal. The society keeps a margin of{' '}
          <MoneyText paise={society.netInterestIncome} />
          {society.penalIncome + society.feeIncome > 0 ? (
            <>
              {' '}and <MoneyText paise={society.penalIncome + society.feeIncome} /> of penal interest and fees
            </>
          ) : null}
          .
        </p>
      </div>

      {preview.reschedule ? (
        <p className="rounded-md bg-accent p-3 text-sm text-accent-foreground">
          The loan is rescheduled: the instalment stays the same, with{' '}
          {plural(preview.reschedule.instalmentsLeft, 'instalment')} left
          {preview.reschedule.lastDueOn ? `, the last on ${formatDate(preview.reschedule.lastDueOn)}` : ''}
          {preview.reschedule.previousLastDueOn ? ` instead of ${formatDate(preview.reschedule.previousLastDueOn)}` : ''}.
          The member saves <MoneyText paise={preview.reschedule.interestSaved} /> of interest.
        </p>
      ) : null}
      {preview.output.closesLoan ? (
        <p className="rounded-md bg-good-soft p-3 text-sm text-good">This payment repays the loan in full.</p>
      ) : null}
    </section>
  );
}

function Receipt({ done, loanId, onClose }: { done: Done; loanId: string; onClose: () => void }) {
  const world = useAppStore((s) => s.world);
  const entry = loanOf(world, loanId);
  const receipt = entry.receipts.find((r) => r.id === done.paymentId);
  const journal = journalOf(world, entry.loan.societyId).find((j) => j.sourceId === done.paymentId);
  // Focus lands on the confirmation so a screen reader announces it.
  useEffect(() => document.getElementById('receipt-heading')?.focus(), []);
  if (!receipt) return null;
  const { federation, society } = receipt.reconciliation;
  return (
    <>
      <SheetHeader>
        <SheetTitle id="receipt-heading" tabIndex={-1} className="flex items-center gap-2 outline-none">
          <CheckCircle2 className="size-5 text-good" aria-hidden /> Receipt {done.receiptNo} recorded
        </SheetTitle>
        <SheetDescription>
          <MoneyText paise={receipt.amount} /> on {formatDate(receipt.receivedOn)}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <SplitBar
          toFederation={federation.remittanceShare}
          retained={society.netInterestIncome + society.penalIncome + society.feeIncome}
          advance={receipt.allocation.advance}
        />
        {journal ? (
          <section aria-label="Journal entry">
            <h3 className="mb-1 text-sm font-semibold">Posted to the ledger as {journal.id}</h3>
            <JournalEntryTable entry={journal} />
          </section>
        ) : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" asChild>
            <Link to={`/loans/${loanId}`} onClick={onClose}>
              View the loan
            </Link>
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </>
  );
}
