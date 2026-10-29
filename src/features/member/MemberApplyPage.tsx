import { Check, Info } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { formatBps, formatPaise, parseRupees } from '@/domain/money';
import { quoteLoan } from '@/domain/origination';
import { loanPurposes, type LoanPurpose } from '@/domain/types';
import { MAX_TENURE_MONTHS, MIN_TENURE_MONTHS } from '@/domain/world';
import { Money, PageHead } from '@/features/apex/glass';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

const TENURES = [6, 9, 12, 15, 18, 24, 30, 36].filter((m) => m >= MIN_TENURE_MONTHS && m <= MAX_TENURE_MONTHS);

/**
 * A member applies for themselves. The instalment is worked out as they type,
 * by the same schedule generator that will build the real loan; the
 * application then joins the society's queue for the field officer.
 */
export function MemberApplyPage() {
  const user = useAppStore(selectCurrentUser);
  const policy = useAppStore((s) => s.world.policy);
  const clock = useAppStore((s) => s.world.clock);
  const society = useAppStore((s) => s.world.societies.find((x) => x.id === user.societyId));
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const navigate = useNavigate();
  const memberId = user.memberId!;
  const { data: applications } = useQuery(`member-applications:${memberId}:${version}`, () =>
    repositories.member.getApplications(memberId),
  );

  const [amountText, setAmountText] = useState('');
  const [tenure, setTenure] = useState(12);
  const [purpose, setPurpose] = useState<LoanPurpose>('TRADE');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  if (!applications) return <LoadingTiles count={2} className="md:grid-cols-2" />;
  const open = applications.find((a) => a.outcome === 'IN_PROGRESS');

  const amount = parseRupees(amountText);
  const amountError =
    amount === undefined
      ? 'Enter an amount in rupees.'
      : amount < policy.minTicket || amount > policy.maxTicket
        ? `Between ${formatPaise(policy.minTicket)} and ${formatPaise(policy.maxTicket)}.`
        : undefined;
  const quote = amount !== undefined && !amountError ? quoteLoan(amount, tenure, policy.retailRateBps, clock) : undefined;

  async function submit() {
    setTouched(true);
    if (amountError || amount === undefined) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.applications.submit({ memberId, requestedAmount: amount, requestedTenureMonths: tenure, purpose });
    setPending(false);
    if (result.ok) navigate('/me', { state: { applied: result.applicationId } });
    else setError(result.error);
  }

  return (
    <>
      <PageHead
        title="Apply for a loan"
        sub={`${society?.name ?? 'Your society'} lends at ${formatBps(policy.retailRateBps)} a year on the reducing balance.`}
      />
      {open ? (
        <section className="g-card g-blur" aria-label="Application in progress">
          <p className="g-callout info m-0">
            <Info aria-hidden />
            <span>
              Your application for <Money paise={open.requestedAmount} /> is already with the society. You can apply again once it is decided.{' '}
              <Link to="/me" className="font-semibold underline">
                See where it stands
              </Link>
            </span>
          </p>
        </section>
      ) : (
        <div className="g-dash items-start">
          <section className="g-card g-blur g-s7" aria-label="Application form">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Field
                label="How much do you need? (₹)"
                error={touched || amountText ? amountError : undefined}
                hint={`Between ${formatPaise(policy.minTicket)} and ${formatPaise(policy.maxTicket)}.`}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    placeholder="40,000"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Repay over">
                  {({ id }) => (
                    <NativeSelect id={id} value={tenure} onChange={(e) => setTenure(Number(e.target.value))}>
                      {TENURES.map((m) => (
                        <option key={m} value={m}>
                          {m} months
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="What is it for?">
                  {({ id }) => (
                    <NativeSelect id={id} value={purpose} onChange={(e) => setPurpose(e.target.value as LoanPurpose)}>
                      {loanPurposes.map((p) => (
                        <option key={p} value={p}>
                          {PURPOSE_LABEL[p]}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>
              {error ? (
                <p role="alert" className="g-error m-0">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--g-line2)' }}>
                <span className="g-sub m-0">The field officer will visit to appraise it.</span>
                <button type="submit" className="g-btn pri" disabled={pending}>
                  <Check aria-hidden /> {pending ? 'Sending…' : 'Send application'}
                </button>
              </div>
            </form>
          </section>

          <section className="g-card g-blur g-s5" aria-label="What you would pay">
            <span className="g-lbl">What you would pay</span>
            {quote ? (
              <>
                <div className="g-mid num">
                  <Money paise={quote.emi} />
                  <small className="g-muted" style={{ fontSize: 14, fontWeight: 500 }}>
                    {' '}
                    a month
                  </small>
                </div>
                <dl className="g-facts mt-3 text-[13px]">
                  <div>
                    <dt>Interest over {tenure} months</dt>
                    <dd className="m-0">
                      <b className="num">
                        <Money paise={quote.totalInterest} />
                      </b>
                    </dd>
                  </div>
                  <div>
                    <dt>Repaid in all</dt>
                    <dd className="m-0">
                      <b className="num">
                        <Money paise={quote.amount + quote.totalInterest} />
                      </b>
                    </dd>
                  </div>
                </dl>
                <p className="g-sub">The first instalment falls due about a month after the loan is paid out.</p>
              </>
            ) : (
              <p className="g-sub">Enter an amount to see your monthly instalment.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
