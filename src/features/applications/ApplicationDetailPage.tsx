import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Facts } from '@/components/Facts';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { ApplicationStageBadge, PoolStatusBadge } from '@/components/finance/StatusBadges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { approvalAuthority } from '@/domain/machines';
import { formatBps, formatPaise, formatPaisePlain, parseRupees } from '@/domain/money';
import {
  quoteLoan,
  REPAYMENT_CAP_SHARE,
  repaymentCapacity,
  type ApplicationDetail,
  type RepaymentCapacity,
} from '@/domain/origination';
import { can } from '@/domain/permissions';
import type { User } from '@/domain/types';
import { MAX_TENURE_MONTHS, MIN_TENURE_MONTHS } from '@/domain/world';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { percent, PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

export function ApplicationDetailPage() {
  const { applicationId = '' } = useParams();
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const exists = useAppStore(
    (s) => s.world.applications.find((a) => a.id === applicationId)?.societyId === user.societyId,
  );
  const repositories = useRepositories();
  const { data, error } = useQuery(`application:${applicationId}:${version}`, () =>
    exists ? repositories.applications.getDetail(applicationId) : Promise.reject(new Error('missing')),
  );

  if (!exists) {
    return (
      <PageHeader
        title="Application not found"
        description={
          <>
            There is no application {applicationId} in this society.{' '}
            <Link to="/applications" className="text-primary underline">
              Back to applications
            </Link>
            .
          </>
        }
      />
    );
  }
  if (error) return <p className="text-sm text-bad">The application could not be loaded: {error}</p>;
  if (!data) return <LoadingTiles count={3} className="sm:grid-cols-3" />;

  const { row, member } = data;
  const application = row.application;
  return (
    <>
      <Breadcrumb items={[{ label: 'Applications', to: '/applications' }, { label: application.id }]} />
      <PageHeader
        title={row.memberName}
        description={`${application.id} · applied ${formatDate(application.appliedOn)} · ${PURPOSE_LABEL[application.purpose]}`}
        actions={<ApplicationStageBadge stage={row.stage} />}
      />
      <Facts
        className="mb-5 rounded-lg border bg-card p-4"
        items={[
          { label: 'Asked for', value: <MoneyText paise={application.requestedAmount} /> },
          { label: 'Over', value: `${application.requestedTenureMonths} months` },
          { label: 'Instalment at that', value: data.requested ? <MoneyText paise={data.requested.emi} /> : '–' },
          { label: 'Borrowing now', value: <MoneyText paise={data.exposure} /> },
          { label: 'Internal score', value: member.internalScore },
          {
            label: 'Member',
            value: (
              <Link to={`/members/${member.id}`} className="hover:underline">
                {member.membershipNo}
              </Link>
            ),
          },
        ]}
      />

      {row.stage === 'NEEDS_APPRAISAL' ? (
        can(user.role, 'APPRAISE_APPLICATION') ? (
          <AppraisalForm detail={data} />
        ) : (
          <Notice>The secretary appraises the application next.</Notice>
        )
      ) : (
        <div className="space-y-5">
          <AppraisalSummary detail={data} />
          {row.stage === 'AWAITING_DECISION' ? (
            can(user.role, 'DECIDE_APPLICATION') ? (
              <DecisionForm detail={data} user={user} />
            ) : (
              <Notice>The secretary decides it next.</Notice>
            )
          ) : (
            <DecisionSummary detail={data} />
          )}
        </div>
      )}
    </>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

/** The repayment burden against the cap, worded and coloured for a decision. */
function CapacityLine({ capacity }: { capacity: RepaymentCapacity }) {
  if (capacity.share === undefined) {
    return <p className="text-sm text-muted-foreground">Enter the monthly income to see the repayment burden.</p>;
  }
  return (
    <p className={cn('text-sm', capacity.withinCap ? 'text-good' : 'text-bad')}>
      Repayments on all loans would take <strong>{percent(capacity.share)}</strong> of monthly income
      {capacity.withinCap ? ', within' : ', above'} the {percent(REPAYMENT_CAP_SHARE)} cap for microfinance loans.
    </p>
  );
}

function AppraisalForm({ detail }: { detail: ApplicationDetail }) {
  const repositories = useRepositories();
  const policy = useAppStore((s) => s.world.policy);
  const clock = useAppStore((s) => s.world.clock);
  const application = detail.row.application;
  const [incomeText, setIncomeText] = useState('');
  const [obligationsText, setObligationsText] = useState('0');
  const [recommendedText, setRecommendedText] = useState(formatPaisePlain(application.requestedAmount));
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const income = parseRupees(incomeText);
  const obligations = parseRupees(obligationsText);
  const recommended = parseRupees(recommendedText);
  const incomeError = income === undefined || income <= 0 ? 'Enter the monthly income in rupees.' : undefined;
  const obligationsError = obligations === undefined || obligations < 0 ? 'Enter 0 if there are none.' : undefined;
  const recommendedError =
    recommended === undefined || recommended < 0
      ? 'Enter an amount, or 0 to recommend rejection.'
      : recommended > application.requestedAmount
        ? 'Cannot recommend more than was asked for.'
        : recommended > 0 && recommended < policy.minTicket
          ? `At least ${formatPaise(policy.minTicket)}, or 0 to recommend rejection.`
          : undefined;
  const quote =
    recommended && !recommendedError
      ? quoteLoan(recommended, application.requestedTenureMonths, policy.retailRateBps, clock)
      : undefined;
  const capacity =
    income !== undefined && obligations !== undefined
      ? repaymentCapacity(income, obligations, quote?.emi ?? 0)
      : undefined;
  const valid = !incomeError && !obligationsError && !recommendedError;

  async function save() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.applications.appraise({
      applicationId: application.id,
      monthlyIncome: income!,
      existingObligations: obligations!,
      recommendedAmount: recommended!,
      notes: notes.trim(),
    });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <Card role="region" aria-label="Appraisal">
      <CardHeader>
        <CardTitle>Appraisal</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Monthly income (₹)" error={incomeText ? incomeError : undefined}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  placeholder="18,000"
                  value={incomeText}
                  onChange={(e) => setIncomeText(e.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </Field>
            <Field
              label="Existing repayments a month (₹)"
              error={obligationsError}
              hint="Instalments on loans from anyone, this society included."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={obligationsText}
                  onChange={(e) => setObligationsText(e.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </Field>
            <Field
              label="Recommended amount (₹)"
              error={recommendedError}
              hint={quote ? <>Instalment <MoneyText paise={quote.emi} /> over {application.requestedTenureMonths} months</> : undefined}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={recommendedText}
                  onChange={(e) => setRecommendedText(e.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </Field>
          </div>
          {capacity ? <CapacityLine capacity={capacity} /> : null}
          <Field label="Notes">
            {({ id }) => (
              <Textarea
                id={id}
                placeholder="What was seen and checked: the business, the household, references."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || pending}>
              {pending ? 'Saving…' : recommended === 0 ? 'Record appraisal, recommending rejection' : 'Record appraisal'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AppraisalSummary({ detail }: { detail: ApplicationDetail }) {
  const appraisal = detail.row.application.appraisal;
  if (!appraisal) return null;
  return (
    <Card role="region" aria-label="Appraisal">
      <CardHeader>
        <CardTitle>Appraisal</CardTitle>
        <span className="text-xs text-muted-foreground">
          {detail.appraisedBy} · {formatDate(appraisal.on)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <Facts
          className="lg:grid-cols-4"
          items={[
            { label: 'Monthly income', value: <MoneyText paise={appraisal.monthlyIncome} /> },
            { label: 'Existing repayments', value: <MoneyText paise={appraisal.existingObligations} /> },
            {
              label: 'Recommended',
              value: appraisal.recommendedAmount > 0 ? <MoneyText paise={appraisal.recommendedAmount} /> : 'Reject',
            },
            {
              label: 'Instalment at that',
              value: detail.recommended ? <MoneyText paise={detail.recommended.emi} /> : '–',
            },
          ]}
        />
        {detail.capacity && appraisal.recommendedAmount > 0 ? <CapacityLine capacity={detail.capacity} /> : null}
        {appraisal.notes ? <p className="text-sm">{appraisal.notes}</p> : null}
      </CardContent>
    </Card>
  );
}

const TENURE_CHOICES = Array.from(
  { length: MAX_TENURE_MONTHS - MIN_TENURE_MONTHS + 1 },
  (_, i) => MIN_TENURE_MONTHS + i,
);

function DecisionForm({ detail, user }: { detail: ApplicationDetail; user: User }) {
  const repositories = useRepositories();
  const policy = useAppStore((s) => s.world.policy);
  const clock = useAppStore((s) => s.world.clock);
  const application = detail.row.application;
  const appraisal = application.appraisal;
  const recommendsRejection = appraisal?.recommendedAmount === 0;
  const [outcome, setOutcome] = useState<'APPROVED' | 'REJECTED'>(recommendsRejection ? 'REJECTED' : 'APPROVED');
  const [amountText, setAmountText] = useState(
    formatPaisePlain(appraisal?.recommendedAmount || application.requestedAmount),
  );
  const [tenure, setTenure] = useState(application.requestedTenureMonths);
  const [reason, setReason] = useState(recommendsRejection ? appraisal?.notes ?? '' : '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const approving = outcome === 'APPROVED';
  const amount = parseRupees(amountText);
  const amountError = !approving
    ? undefined
    : amount === undefined
      ? 'Enter an amount in rupees.'
      : amount > application.requestedAmount
        ? 'Cannot sanction more than was asked for.'
        : amount < policy.minTicket || amount > policy.maxTicket
          ? `Between ${formatPaise(policy.minTicket)} and ${formatPaise(policy.maxTicket)}.`
          : detail.exposure + amount > policy.maxTicket
            ? `With ${formatPaise(detail.exposure)} already owed, this passes the ${formatPaise(policy.maxTicket)} limit per member.`
            : undefined;
  const reasonError = !approving && !reason.trim() ? 'Say why, for the member and the file.' : undefined;
  const atStake = approving ? (amount ?? 0) : application.requestedAmount;
  const authority = approvalAuthority(atStake, policy);
  const blocked = authority === 'SECRETARY' && user.role !== 'SECRETARY';
  const quote =
    approving && amount !== undefined && !amountError ? quoteLoan(amount, tenure, policy.retailRateBps, clock) : undefined;
  const capacity =
    quote && appraisal ? repaymentCapacity(appraisal.monthlyIncome, appraisal.existingObligations, quote.emi) : undefined;
  const valid = !amountError && !reasonError && !blocked;

  async function decide() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.applications.decide({
      applicationId: application.id,
      outcome,
      sanctionedAmount: approving ? amount! : 0,
      tenureMonths: tenure,
      reason: approving ? undefined : reason.trim(),
    });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <Card role="region" aria-label="Decision">
      <CardHeader>
        <CardTitle>Decision</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void decide();
          }}
        >
          <div role="radiogroup" aria-label="Outcome" className="inline-flex rounded-md border p-0.5">
            {(['APPROVED', 'REJECTED'] as const).map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={outcome === o}
                onClick={() => setOutcome(o)}
                className={cn(
                  'rounded px-3 py-1 text-sm font-medium',
                  outcome === o ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o === 'APPROVED' ? 'Approve' : 'Reject'}
              </button>
            ))}
          </div>

          {approving ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Sanctioned amount (₹)"
                  error={amountError}
                  hint={`Asked for ${formatPaise(application.requestedAmount)}${
                    appraisal?.recommendedAmount ? `, recommended ${formatPaise(appraisal.recommendedAmount)}` : ''
                  }.`}
                >
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
                <Field label="Tenure">
                  {({ id }) => (
                    <NativeSelect id={id} value={tenure} onChange={(e) => setTenure(Number(e.target.value))}>
                      {TENURE_CHOICES.map((m) => (
                        <option key={m} value={m}>
                          {m} months
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>
              {quote ? (
                <p className="text-sm">
                  The member would pay <strong><MoneyText paise={quote.emi} /></strong> a month for {tenure} months,{' '}
                  <MoneyText paise={quote.totalInterest} /> in interest at {formatBps(policy.retailRateBps)}.
                </p>
              ) : null}
              {capacity ? <CapacityLine capacity={capacity} /> : null}
            </>
          ) : (
            <Field label="Reason" error={reason ? undefined : reasonError}>
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </Field>
          )}

          {blocked ? (
            <p role="alert" className="text-sm text-warn">
              {formatPaise(atStake)} is above the {formatPaise(policy.officerApprovalLimit)} officer limit, so the
              secretary decides. Switch to the secretary from the demo toolbar to continue.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || pending}>
              {pending ? 'Recording…' : approving ? <>Approve {amount !== undefined && !amountError ? <MoneyText paise={amount} /> : null}</> : 'Reject application'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DecisionSummary({ detail }: { detail: ApplicationDetail }) {
  const application = detail.row.application;
  const decision = application.decision;
  if (!decision) return null;
  const approved = decision.outcome === 'APPROVED';
  return (
    <Card role="region" aria-label="Decision">
      <CardHeader>
        <CardTitle>{approved ? 'Approved' : 'Rejected'}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {detail.decidedBy} · {formatDate(decision.on)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {approved ? (
          <Facts
            className="lg:grid-cols-4"
            items={[
              { label: 'Sanctioned', value: <MoneyText paise={decision.sanctionedAmount} /> },
              { label: 'Tenure', value: `${decision.tenureMonths} months` },
              { label: 'Rate', value: `${formatBps(decision.rateBps)} a year` },
              { label: 'Instalment', value: detail.row.emi !== undefined ? <MoneyText paise={detail.row.emi} /> : '–' },
            ]}
          />
        ) : (
          <p className="text-sm">{decision.reason}</p>
        )}
        {detail.pool ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            In batch{' '}
            <Link to={`/pools/${detail.pool.id}`} className="font-medium hover:underline">
              {detail.pool.reference}
            </Link>
            <PoolStatusBadge status={detail.pool.status} />
          </p>
        ) : approved && detail.row.stage === 'READY_TO_POOL' ? (
          <p className="text-sm text-muted-foreground">
            Waiting to be batched.{' '}
            <Link to="/pools" className="text-primary underline">
              Go to batches
            </Link>
          </p>
        ) : null}
        {detail.row.loanId ? (
          <p className="text-sm">
            Disbursed as{' '}
            <Link to={`/loans/${detail.row.loanId}`} className="font-medium hover:underline">
              {detail.row.loanId}
            </Link>
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
