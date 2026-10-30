import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { formatBps, formatPaise, parseRupees } from '@/domain/money';
import { quoteLoan } from '@/domain/origination';
import { can } from '@/domain/permissions';
import { loanPurposes, type LoanPurpose } from '@/domain/types';
import { MAX_TENURE_MONTHS, MIN_TENURE_MONTHS } from '@/domain/world';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

const TENURES = [6, 9, 12, 15, 18, 24, 30, 36, 48, 60].filter((m) => m >= MIN_TENURE_MONTHS && m <= MAX_TENURE_MONTHS);

/**
 * A member applies for themselves, or the society applies for them here. The EMI the
 * member would pay is worked out as the amount is typed, by the same schedule
 * generator that will build the real one.
 */
export function NewApplicationPage() {
  const user = useAppStore(selectCurrentUser);
  const policy = useAppStore((s) => s.world.policy);
  const clock = useAppStore((s) => s.world.clock);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const societyId = user.societyId!;
  const { data: members } = useQuery(`members:${societyId}:${version}`, () => repositories.members.list(societyId));

  const [memberId, setMemberId] = useState(params.get('member') ?? '');
  const [amountText, setAmountText] = useState('');
  const [tenure, setTenure] = useState(12);
  const [purpose, setPurpose] = useState<LoanPurpose>('TRADE');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  if (!can(user.role, 'SUBMIT_APPLICATION')) {
    return <PageHeader title="New application" description="Only the secretary can apply for a member." />;
  }
  if (!members) return <LoadingTiles count={2} className="md:grid-cols-2" />;

  const eligible = members.filter((m) => m.member.status === 'ACTIVE' && !m.inProgress);
  const chosen = eligible.find((m) => m.member.id === memberId);
  const amount = parseRupees(amountText);
  const amountError =
    amount === undefined
      ? 'Enter an amount in rupees.'
      : amount < policy.minTicket || amount > policy.maxTicket
        ? `Between ${formatPaise(policy.minTicket)} and ${formatPaise(policy.maxTicket)}.`
        : undefined;
  const memberError = chosen ? undefined : 'Choose the member applying.';
  const quote = amount !== undefined && !amountError ? quoteLoan(amount, tenure, policy.retailRateBps, clock) : undefined;
  const exposureAfter = (chosen?.outstanding ?? 0) + (amount ?? 0);
  const overMemberLimit = chosen !== undefined && quote !== undefined && exposureAfter > policy.maxTicket;

  async function submit() {
    setTouched(true);
    if (memberError || amountError || amount === undefined) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.applications.submit({
      memberId,
      requestedAmount: amount,
      requestedTenureMonths: tenure,
      purpose,
    });
    setPending(false);
    if (result.ok) navigate(`/applications/${result.applicationId}`);
    else setError(result.error);
  }

  return (
    <>
      <Breadcrumb items={[{ label: 'Applications', to: '/applications' }, { label: 'New' }]} />
      <PageHeader title="New application" description="Taken from the member in person. It goes to appraisal next." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Field
                label="Member"
                error={touched ? memberError : undefined}
                hint={
                  chosen ? (
                    <>
                      {chosen.member.membershipNo} · {chosen.member.occupation} · borrowing{' '}
                      <MoneyText paise={chosen.outstanding} /> now
                    </>
                  ) : (
                    `${eligible.length} members can apply; anyone with an application in progress cannot.`
                  )
                }
              >
                {({ id, describedBy, invalid }) => (
                  <NativeSelect
                    id={id}
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  >
                    <option value="">Choose a member…</option>
                    {eligible.map((m) => (
                      <option key={m.member.id} value={m.member.id}>
                        {m.member.name} · {m.member.village}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Amount (₹)" error={touched || amountText ? amountError : undefined}>
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
                <Field label="Tenure">
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
                <Field label="Purpose">
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
                <p role="alert" className="text-sm text-bad">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" asChild>
                  <Link to="/applications">Cancel</Link>
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Submitting…' : 'Submit application'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card role="region" aria-label="What the member would pay">
          <CardHeader>
            <CardTitle>What the member would pay</CardTitle>
          </CardHeader>
          <CardContent>
            {quote ? (
              <div className="space-y-1.5 text-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Monthly instalment</dt>
                    <dd className="text-lg font-semibold">
                      <MoneyText paise={quote.emi} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Interest over {tenure} months</dt>
                    <dd>
                      <MoneyText paise={quote.totalInterest} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t pt-1.5">
                    <dt className="text-muted-foreground">Repaid in all</dt>
                    <dd className="font-medium">
                      <MoneyText paise={quote.amount + quote.totalInterest} />
                    </dd>
                  </div>
                </dl>
                <p className="pt-2 text-xs text-muted-foreground">
                  At {formatBps(policy.retailRateBps)} a year on the reducing balance. Instalments fall due on the 1st
                  of every month; interest for the days between payout and the next 1st is added to the first.
                </p>
                {overMemberLimit ? (
                  <p role="alert" className="pt-2 text-xs text-bad">
                    With what {chosen.member.name} already owes, this would take borrowing to{' '}
                    {formatPaise(exposureAfter)}, above the {formatPaise(policy.maxTicket)} limit per member. It can be
                    taken, but not approved at this amount.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Enter an amount to see the instalment.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
