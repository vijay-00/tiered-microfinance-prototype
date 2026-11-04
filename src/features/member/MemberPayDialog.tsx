import { ArrowRight, Check, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { formatPaise, formatPaisePlain, parseRupees } from '@/domain/money';
import { previewPayment } from '@/domain/servicing';
import type { ID, Paise } from '@/domain/types';
import { Money } from '@/features/apex/glass';
import { formatDate } from '@/lib/format';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

/**
 * A member pays by UPI. A stand-in for a real UPI collect: no bank is reached,
 * no money moves and no PIN is asked for. What it does post is real to the
 * app: the same payment event a secretary records, so the loan, the ledger,
 * the dashboards and the society's collections all follow at once.
 */

/** How long the pretend approval takes. */
const APPROVAL_MS = import.meta.env.MODE === 'test' ? 0 : 1600;

type Step = 'amount' | 'upi' | 'waiting' | 'done';

export function MemberPayDialog(props: {
  loanId: ID;
  dueNow: Paise;
  nextInstalment: Paise | undefined;
  emi: Paise;
  onClose: () => void;
}) {
  const { loanId, dueNow, onClose } = props;
  const world = useAppStore((s) => s.world);
  const user = useAppStore(selectCurrentUser);
  const repositories = useRepositories();
  const society = world.societies.find((s) => s.id === user.societyId);
  const member = world.members.find((m) => m.id === user.memberId);
  const usual = dueNow > 0 ? dueNow : (props.nextInstalment ?? props.emi);

  const [step, setStep] = useState<Step>('amount');
  const [amountText, setAmountText] = useState(formatPaisePlain(usual));
  const [toPrincipal, setToPrincipal] = useState(false);
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<{ receiptNo: string; upiRef: string }>();

  const amount = parseRupees(amountText);
  const preview = useMemo(
    () =>
      amount !== undefined && amount > 0 && step === 'amount'
        ? previewPayment(world, loanId, { amount, source: 'CASH', electPrepayment: toPrincipal })
        : undefined,
    [world, loanId, amount, toPrincipal, step],
  );
  const amountError =
    amount === undefined || amount <= 0 ? 'Enter an amount in rupees.' : preview && !preview.ok ? preview.message : undefined;
  const extra = amount !== undefined ? amount - dueNow : 0;
  const payee = `${society?.code.toLowerCase() ?? 'society'}@upi`;
  const from = `${member?.phone.replace(/\D/g, '').slice(-10) ?? 'member'}@upi`;

  async function pay() {
    if (amount === undefined) return;
    setStep('waiting');
    setError(undefined);
    await new Promise((r) => setTimeout(r, APPROVAL_MS));
    const upiRef = String(Math.floor(1e11 + Math.random() * 9e11));
    const result = await repositories.payments.record({ loanId, amount, mode: 'UPI', source: 'CASH', electPrepayment: toPrincipal, upiRef });
    if (result.ok) {
      setReceipt({ receiptNo: result.receiptNo, upiRef });
      setStep('done');
    } else {
      setError(result.error);
      setStep('upi');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open || step === 'waiting' ? undefined : onClose())}>
      <DialogContent className="glass g-notice g-pay">
        {step === 'done' && receipt && amount !== undefined ? (
          <>
            <span className="g-pay-tick" aria-hidden>
              <Check />
            </span>
            <DialogTitle className="text-center">Payment successful</DialogTitle>
            <DialogDescription className="text-center">
              {formatPaise(amount)} paid to {society?.name}
            </DialogDescription>
            <dl className="g-facts mt-3 text-[13px]">
              <div>
                <dt>Date</dt>
                <dd className="m-0">
                  <b>{formatDate(world.clock)}</b>
                </dd>
              </div>
              <div>
                <dt>UPI reference</dt>
                <dd className="m-0">
                  <b className="num">{receipt.upiRef}</b>
                </dd>
              </div>
              <div>
                <dt>Receipt</dt>
                <dd className="m-0">
                  <b className="num">{receipt.receiptNo}</b>
                </dd>
              </div>
            </dl>
            <div className="g-notice-actions">
              <button type="button" className="g-btn pri" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : step === 'waiting' ? (
          <>
            <span className="g-pay-spin" aria-hidden />
            <DialogTitle className="text-center">Waiting for approval</DialogTitle>
            <DialogDescription className="text-center">Approve the request in your UPI app…</DialogDescription>
          </>
        ) : step === 'upi' && amount !== undefined ? (
          <>
            <span className="g-notice-icon accent" aria-hidden>
              <Smartphone />
            </span>
            <DialogTitle>Pay by UPI</DialogTitle>
            <DialogDescription>Check the details, then approve.</DialogDescription>
            <div className="g-pay-amount num">
              <Money paise={amount} />
            </div>
            <dl className="g-facts text-[13px]">
              <div>
                <dt>To</dt>
                <dd className="m-0 text-right">
                  <b>{society?.name}</b>
                  <small className="g-muted block">{payee}</small>
                </dd>
              </div>
              <div>
                <dt>From</dt>
                <dd className="m-0 text-right">
                  <b>{member?.name}</b>
                  <small className="g-muted block">{from}</small>
                </dd>
              </div>
            </dl>
            {error ? (
              <p role="alert" className="g-error m-0">
                {error}
              </p>
            ) : null}
            <div className="g-notice-actions">
              <button type="button" className="g-btn" onClick={() => setStep('amount')}>
                Back
              </button>
              <button type="button" className="g-btn pri" onClick={() => void pay()}>
                Pay {formatPaise(amount)}
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="g-notice-icon accent" aria-hidden>
              <Smartphone />
            </span>
            <DialogTitle>Make a payment</DialogTitle>
            <DialogDescription>Pay your instalment, or any amount you choose.</DialogDescription>
            <div className="g-seg mt-3 flex-wrap" role="group" aria-label="Quick amounts">
              {dueNow > 0 ? (
                <button type="button" aria-pressed={amount === dueNow} onClick={() => setAmountText(formatPaisePlain(dueNow))}>
                  Due now {formatPaise(dueNow)}
                </button>
              ) : null}
              <button type="button" aria-pressed={amount === (props.nextInstalment ?? props.emi)} onClick={() => setAmountText(formatPaisePlain(props.nextInstalment ?? props.emi))}>
                Next instalment {formatPaise(props.nextInstalment ?? props.emi)}
              </button>
            </div>
            <Field label="Amount (₹)" className="mt-3" error={amountError}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
              )}
            </Field>
            {extra > 0 ? (
              <label className="mt-3 flex items-start gap-2 text-[13px]">
                <input type="checkbox" className="mt-0.5" checked={toPrincipal} onChange={(e) => setToPrincipal(e.target.checked)} />
                <span>Put what is extra towards the loan itself, so it ends sooner. Otherwise it is held for your next instalment.</span>
              </label>
            ) : null}
            <div className="g-notice-actions">
              <button type="button" className="g-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="g-btn pri" disabled={Boolean(amountError) || !preview?.ok} onClick={() => setStep('upi')}>
                Continue <ArrowRight aria-hidden />
              </button>
            </div>
          </>
        )}
        <p className="g-pay-note">Demo payment. No real money moves.</p>
      </DialogContent>
    </Dialog>
  );
}
