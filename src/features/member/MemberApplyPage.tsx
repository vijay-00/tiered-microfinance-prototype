import { Check, Info, Landmark, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DocumentSlots } from '@/components/Documents';
import { LoadingTiles } from '@/components/LoadingTiles';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { formatBps, formatPaise, parseRupees } from '@/domain/money';
import { needsFieldVisit } from '@/domain/machines';
import { quoteLoan } from '@/domain/origination';
import { loanTypes, type ApplicationRoute, type AttachedDocument, type LoanPurpose } from '@/domain/types';
import { MAX_TENURE_MONTHS, MIN_TENURE_MONTHS } from '@/domain/world';
import { Money, PageHead } from '@/features/apex/glass';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

/** What a member attaches when applying. Mock files: only the name and size are kept. */
const REQUIRED_DOCUMENTS = ['Aadhaar card', 'PAN card', 'Bank passbook', 'Income proof', 'Passport photo'];

const TENURES = [6, 9, 12, 15, 18, 24, 30, 36].filter((m) => m >= MIN_TENURE_MONTHS && m <= MAX_TENURE_MONTHS);

/**
 * A member applies for themselves. The instalment is worked out as they type,
 * by the same schedule generator that will build the real loan; the
 * application then joins the society's queue for the secretary.
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
  const [purpose, setPurpose] = useState<LoanPurpose>('CONSTRUCTION');
  const [route, setRoute] = useState<ApplicationRoute>('SOCIETY');
  const [documents, setDocuments] = useState<AttachedDocument[]>([]);
  const federation = useAppStore((s) => s.world.federation);
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
  const documentsMissing = documents.length < REQUIRED_DOCUMENTS.length;
  const visitNeeded = needsFieldVisit(purpose, policy);

  async function submit() {
    setTouched(true);
    if (amountError || amount === undefined || documentsMissing) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.applications.submit({ memberId, requestedAmount: amount, requestedTenureMonths: tenure, purpose, route, documents });
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
              <div className="g-field">
                <span className="g-lbl">Apply to</span>
                <div className="g-routes" role="radiogroup" aria-label="Apply to">
                  <button type="button" role="radio" aria-checked={route === 'SOCIETY'} className="g-route" onClick={() => setRoute('SOCIETY')}>
                    <Users aria-hidden />
                    <b>My society</b>
                    <small>{society?.name}. Goes for funding in a batch with other members.</small>
                  </button>
                  <button type="button" role="radio" aria-checked={route === 'FEDERATION'} className="g-route" onClick={() => setRoute('FEDERATION')}>
                    <Landmark aria-hidden />
                    <b>The federation</b>
                    <small>{federation.name}. Your society still checks it, then it goes up on its own.</small>
                  </button>
                </div>
              </div>
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
                <Field label="Loan type" hint={visitNeeded ? 'A field officer visits you for this loan.' : 'No field visit needed for this loan.'}>
                  {({ id }) => (
                    <NativeSelect id={id} value={purpose} onChange={(e) => setPurpose(e.target.value as LoanPurpose)}>
                      {loanTypes.map((p) => (
                        <option key={p} value={p}>
                          {PURPOSE_LABEL[p]} · {formatBps(policy.retailRateBps)} a year
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>
              <div className="g-field">
                <span className="g-lbl">Documents</span>
                <DocumentSlots slots={REQUIRED_DOCUMENTS} value={documents} onChange={setDocuments} invalid={touched && documentsMissing} />
                {touched && documentsMissing ? (
                  <p role="alert" className="g-error m-0">
                    Attach every document to send the application.
                  </p>
                ) : null}
              </div>
              {error ? (
                <p role="alert" className="g-error m-0">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--g-line2)' }}>
                <span className="g-sub m-0">{visitNeeded ? 'The field officer will visit you next.' : 'The society will appraise it next.'}</span>
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
                <p className="g-sub">
                  Instalments fall due on the 1st of every month. Interest for the days between payout and the next 1st is added to the first one.
                </p>
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
