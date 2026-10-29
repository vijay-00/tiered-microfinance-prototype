import { Check, CircleAlert, Eye, Send, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { sanctionEconomics, type FederationSocietyDetail } from '@/domain/federation';
import { formatBps, formatPaise, formatPaisePlain, parseRupees } from '@/domain/money';
import type { PoolReview } from '@/domain/origination';
import { can } from '@/domain/permissions';
import { MAX_TENURE_MONTHS } from '@/domain/world';
import { cn } from '@/lib/cn';
import { formatDate, plural } from '@/lib/format';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { Loading, Money, PageHead, Pill } from './glass';

const short = (name: string) => name.replace(/ Credit Society$/, '');

/** E3: the evidence for a pool on the left, the federation's terms on the right. */
export function PoolReviewPage() {
  const { poolId = '' } = useParams();
  const version = useAppStore((s) => s.world.eventCount);
  const societyId = useAppStore((s) => s.world.pools.find((p) => p.id === poolId && p.submittedOn !== undefined)?.societyId);
  const repositories = useRepositories();
  const { data, error } = useQuery(`apex-review:${poolId}:${version}`, async () => {
    if (!societyId) throw new Error('missing');
    const [review, society] = await Promise.all([repositories.apex.getReview(poolId), repositories.apex.getSocietyDetail(societyId)]);
    return { review, society };
  });

  if (!societyId) {
    return (
      <PageHead
        title="Request not found"
        sub={
          <>
            No society has submitted a pool {poolId}.{' '}
            <Link to="/apex/requests" className="underline">
              Back to funding requests
            </Link>
            .
          </>
        }
      />
    );
  }
  if (error) return <p className="g-error">The request could not be loaded: {error}</p>;
  if (!data) return <Loading />;
  return <Review review={data.review} society={data.society} />;
}

function StatusPill({ status }: { status: string }) {
  if (status === 'SUBMITTED') return <Pill tone="neutral" icon={<Send aria-hidden />}>Submitted</Pill>;
  if (status === 'UNDER_APEX_REVIEW') return <Pill tone="warn" icon={<Eye aria-hidden />}>Under review</Pill>;
  if (status === 'DECLINED') return <Pill tone="bad" icon={<X aria-hidden />}>Declined</Pill>;
  return <Pill tone="good" icon={<Check aria-hidden />}>Sanctioned</Pill>;
}

function Review({ review, society }: { review: PoolReview; society: FederationSocietyDetail }) {
  const clock = useAppStore((s) => s.world.clock);
  const user = useAppStore(selectCurrentUser);
  const { detail, composition } = review;
  const { pool, tranche } = detail;
  const name = short(detail.society.name);
  const undecided = pool.status === 'SUBMITTED' || pool.status === 'UNDER_APEX_REVIEW';
  const waitingDays = Math.max(0, Math.round((Date.parse(clock) - Date.parse(pool.submittedOn!)) / 86_400_000));
  const mayReview = can(user.role, 'REVIEW_POOL');
  // What the officer is about to sanction, shared with the track record's bar.
  const [amount, setAmount] = useState<number | undefined>(review.maxSanction);
  const decided = pool.apexReview;
  const facts: [string, ReactNode][] = [
    ['Requested', <Money key="r" paise={pool.requestedAmount} />],
    ['Members', pool.applicationIds.length],
    ['Longest loan', `${pool.requestedTenureMonths} months`],
    ['Average tenure', `${detail.economics.weightedTenureMonths.toFixed(1)} months`],
    ['Smallest loan', <Money key="s" paise={composition.smallest} />],
    ['Largest loan', <Money key="l" paise={composition.largest} />],
  ];

  return (
    <>
      <PageHead
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {name}’s funding request <StatusPill status={pool.status} />
          </span>
        }
        sub={
          <>
            {pool.reference} ·{' '}
            <Link to={`/apex/societies/${detail.society.id}`} className="hover:underline">
              {detail.society.name}
            </Link>{' '}
            · submitted {formatDate(pool.submittedOn!)}
            {undecided ? ` · waiting ${plural(waitingDays, 'day')}` : ''}
          </>
        }
      />
      <div className="g-dash items-start">
        <div className="g-s7 flex flex-col gap-[var(--g-gap)]">
          <section className="g-card g-blur" aria-label="The request">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <span className="g-lbl">{label}</span>
                  <div className="g-fig num" style={{ fontSize: 20, marginTop: 4 }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <TrackRecord name={name} review={review} society={society} sanction={undecided ? (amount ?? 0) : 0} />
          <Composition review={review} />
        </div>

        <div className="g-s5">
          {pool.status === 'UNDER_APEX_REVIEW' && mayReview ? (
            <Terms review={review} name={name} onAmount={setAmount} />
          ) : (
            <section className="g-card g-blur flex flex-col gap-3" aria-label="Decision">
              {pool.status === 'SUBMITTED' ? (
                <>
                  <h2 className="g-strong m-0 text-lg">Not yet taken up</h2>
                  <p className="g-sub m-0">
                    Submitted {formatDate(pool.submittedOn!)}. Begin the review to set the terms; {name} sees that the federation has it in
                    hand.
                  </p>
                  {mayReview ? <BeginReview poolId={pool.id} /> : null}
                </>
              ) : pool.status === 'UNDER_APEX_REVIEW' ? (
                <p className="g-sub m-0">Under review by the federation.</p>
              ) : (
                <>
                  <div className="g-cardhead">
                    <h2 className="g-strong m-0 text-lg">
                      {decided?.decision === 'DECLINED' ? 'Declined' : `Sanctioned as ${tranche?.sanctionRef ?? ''}`}
                    </h2>
                    <span className="g-ref">{decided ? formatDate(decided.on) : null}</span>
                  </div>
                  {tranche ? (
                    <p className="g-sub m-0">
                      <b className="g-strong">
                        <Money paise={tranche.sanctionedAmount} />
                      </b>{' '}
                      at {formatBps(tranche.wholesaleRateBps)} a year for {tranche.tenureMonths} months.
                    </p>
                  ) : null}
                  {decided?.remarks ? <p className="g-sub m-0">“{decided.remarks}”</p> : null}
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function TrackRecord(props: { name: string; review: PoolReview; society: FederationSocietyDetail; sanction: number }) {
  const graceDays = useAppStore((s) => s.world.policy.graceDays);
  const { track } = props.review;
  const { row } = props.society;
  const after = track.headroom - props.sanction;
  const pct = (n: number) => `${track.creditLimit > 0 ? Math.max(0, Math.min(100, (n / track.creditLimit) * 100)) : 0}%`;
  return (
    <section className="g-card g-blur" aria-label="Society track record">
      <div className="g-cardhead">
        <span className="g-lbl">{props.name}’s track record</span>
        {track.remittancesOverdue > 0 ? (
          <Pill tone="bad" icon={<CircleAlert aria-hidden />}>
            {plural(track.remittancesOverdue, 'remittance')} overdue
          </Pill>
        ) : (
          <Pill tone="good" icon={<Check aria-hidden />}>
            Remittances current
          </Pill>
        )}
      </div>
      <div className="g-limh mt-5 flex-wrap">
        <span>
          Credit limit{' '}
          <b className="g-strong num">
            <Money paise={track.creditLimit} />
          </b>
        </span>
        <span>
          Headroom now{' '}
          <b className="g-strong num">
            <Money paise={track.headroom} />
          </b>
          {props.sanction > 0 ? (
            <>
              {' '}
              · <Money paise={after} /> if sanctioned
            </>
          ) : null}
        </span>
      </div>
      <div
        className="g-bar"
        style={{ height: 10, margin: '10px 0 12px' }}
        role="img"
        aria-label={`${formatPaise(row.drawn)} drawn, ${formatPaise(row.undrawn)} sanctioned and not drawn, and ${formatPaise(props.sanction)} in this sanction, of a ${formatPaise(track.creditLimit)} limit`}
      >
        {row.drawn > 0 ? <span className="g-fedfill" style={{ width: pct(row.drawn) }} /> : null}
        {row.undrawn > 0 ? <span className="g-undrawn" style={{ width: pct(row.undrawn) }} /> : null}
        {props.sanction > 0 ? <span className="g-hatch" style={{ width: pct(props.sanction) }} /> : null}
      </div>
      <div className="g-leg" style={{ gap: '8px 18px' }}>
        <span>
          <i className="g-key g-fedfill" />
          Drawn <b className="num"><Money paise={row.drawn} /></b>
        </span>
        {row.undrawn > 0 ? (
          <span>
            <i className="g-key g-undrawn" />
            Not yet drawn <b className="num"><Money paise={row.undrawn} /></b>
          </span>
        ) : null}
        {props.sanction > 0 ? (
          <span>
            <i className="g-key g-hatch" />
            This sanction <b className="num"><Money paise={props.sanction} /></b>
          </span>
        ) : null}
        <span>
          <i className="g-key head" />
          Headroom{props.sanction > 0 ? ' after' : ''} <b className="num"><Money paise={after} /></b>
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4" style={{ borderColor: 'var(--g-line)' }}>
        <Stat
          label="Outstanding"
          value={<Money paise={track.outstanding} />}
          note={
            <>
              of <Money paise={row.drawn} /> drawn
            </>
          }
        />
        <Stat
          label="On the day"
          value={track.remittancesMade ? `${track.remittancesOnTime} of ${track.remittancesMade}` : '–'}
          note={
            track.remittancesMade === 0
              ? 'No remittance due yet'
              : track.remittancesOnTime === track.remittancesMade
                ? 'Every remittance in full'
                : `${track.remittancesMade - track.remittancesOnTime} late or short`
          }
        />
        <Stat
          label="Overdue now"
          value={<Money paise={track.arrearsCarried} />}
          note={track.remittancesOverdue > 0 ? `${plural(track.remittancesOverdue, 'remittance')} overdue` : 'Nothing past its date'}
          bad={track.remittancesOverdue > 0}
        />
        <Stat
          label="Members late"
          value={track.atRisk.loans}
          note={
            track.atRisk.loans > 0 ? (
              <>
                <Money paise={track.atRisk.arrears} /> in arrears
              </>
            ) : (
              `None past ${graceDays} days`
            )
          }
          bad={track.atRisk.loans > 0}
        />
      </div>
    </section>
  );
}

function Stat(props: { label: string; value: ReactNode; note: ReactNode; bad?: boolean }) {
  return (
    <div>
      <span className="g-lbl">{props.label}</span>
      <div className={cn('g-strong num', props.bad && 'g-neg')} style={{ fontSize: 16, marginTop: 4 }}>
        {props.value}
      </div>
      <span className="g-ref">{props.note}</span>
    </div>
  );
}

function Composition({ review }: { review: PoolReview }) {
  const [tab, setTab] = useState<'purpose' | 'members'>('purpose');
  const { composition, detail } = review;
  const top = Math.max(1, ...composition.purposes.map((p) => p.amount));
  return (
    <section className="g-card g-blur" aria-label="What the money is for">
      <div className="g-tabs" role="tablist" aria-label="The loans in this pool">
        <button
          type="button"
          role="tab"
          id="tab-purpose"
          aria-controls="panel-purpose"
          aria-selected={tab === 'purpose'}
          onClick={() => setTab('purpose')}
        >
          What the money is for
        </button>
        <button
          type="button"
          role="tab"
          id="tab-members"
          aria-controls="panel-members"
          aria-selected={tab === 'members'}
          onClick={() => setTab('members')}
        >
          Members <em>{detail.applications.length}</em>
        </button>
      </div>
      {tab === 'purpose' ? (
        <div role="tabpanel" id="panel-purpose" aria-labelledby="tab-purpose" className="pt-3">
          {composition.purposes.map((p) => (
            <div key={p.purpose} className="grid items-center gap-x-4 gap-y-1.5 py-2 sm:grid-cols-[200px_1fr_120px]">
              <span className="flex items-baseline gap-2 whitespace-nowrap">
                <b className="g-strong">{PURPOSE_LABEL[p.purpose]}</b>
                <span className="g-ref">{plural(p.count, 'loan')}</span>
              </span>
              <span className="g-bar" aria-hidden>
                <span style={{ width: `${(p.amount / top) * 100}%`, background: 'var(--g-accent)', borderRadius: 999 }} />
              </span>
              <b className="g-strong num sm:text-right">
                <Money paise={p.amount} />
              </b>
            </div>
          ))}
          <div className="g-foot mt-3 border-t pt-3" style={{ borderColor: 'var(--g-line)' }}>
            <span>
              {plural(detail.applications.length, 'loan')} across {plural(composition.purposes.length, 'purpose')}
            </span>
            <b className="g-strong num">
              <Money paise={detail.pool.requestedAmount} />
            </b>
          </div>
        </div>
      ) : (
        <div role="tabpanel" id="panel-members" aria-labelledby="tab-members" className="g-scroll">
          <table className="g-table">
            <caption className="sr-only">The loans this pool would fund</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Purpose</th>
                <th scope="col" className="r">Amount</th>
                <th scope="col" className="r">Tenure</th>
                <th scope="col" className="r">EMI</th>
              </tr>
            </thead>
            <tbody>
              {detail.applications.map((row) => (
                <tr key={row.application.id}>
                  <td>
                    <div className="g-who">
                      <div>
                        <b>{row.memberName}</b>
                        <span>{row.village}</span>
                      </div>
                    </div>
                  </td>
                  <td>{PURPOSE_LABEL[row.application.purpose]}</td>
                  <td className="r">
                    <Money paise={row.amount} />
                  </td>
                  <td className="r">{row.tenureMonths} mo</td>
                  <td className="r">{row.emi !== undefined ? <Money paise={row.emi} /> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BeginReview({ poolId }: { poolId: string }) {
  const repositories = useRepositories();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="g-btn pri"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const result = await repositories.apex.beginReview(poolId);
          setPending(false);
          if (!result.ok) setError(result.error);
        }}
      >
        <Eye aria-hidden /> {pending ? 'Starting…' : 'Begin review'}
      </button>
      {error ? (
        <p role="alert" className="g-error m-0">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function parseRate(text: string): number | undefined {
  const value = Number(text.trim().replace(/%$/, ''));
  if (!text.trim() || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100);
}

function Terms(props: { review: PoolReview; name: string; onAmount: (paise: number | undefined) => void }) {
  const { review, name } = props;
  const repositories = useRepositories();
  const world = useAppStore((s) => s.world);
  const policy = world.policy;
  const { pool } = review.detail;
  const [amountText, setAmountText] = useState(formatPaisePlain(review.maxSanction));
  const [rateText, setRateText] = useState(String(policy.wholesaleRateBps / 100));
  const [tenure, setTenure] = useState(String(pool.requestedTenureMonths));
  const [remarks, setRemarks] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [declining, setDeclining] = useState(false);
  const [declineRemarks, setDeclineRemarks] = useState('');

  const amount = parseRupees(amountText);
  const rate = parseRate(rateText);
  const months = Number(tenure);
  const eighty = Math.floor((pool.requestedAmount * 0.8) / 100) * 100;
  const setAmount = (text: string) => {
    setAmountText(text);
    props.onAmount(parseRupees(text));
  };

  const amountError =
    amount === undefined || amount <= 0
      ? 'Enter an amount in rupees.'
      : amount > pool.requestedAmount
        ? 'More than the society asked for.'
        : amount > review.track.headroom
          ? `Only ${formatPaise(review.track.headroom)} is left within the credit limit.`
          : undefined;
  const rateError =
    rate === undefined || rate <= 0
      ? 'Enter a rate a year, such as 9.5.'
      : rate >= policy.retailRateBps
        ? `Must be below the ${formatBps(policy.retailRateBps)} members pay, or the society loses on every loan.`
        : undefined;
  const tenureError =
    !Number.isInteger(months) || months < pool.requestedTenureMonths || months > MAX_TENURE_MONTHS
      ? `Between ${pool.requestedTenureMonths} months, the longest loan, and ${MAX_TENURE_MONTHS}.`
      : undefined;
  const valid = !amountError && !rateError && !tenureError;
  const shortBy = amount !== undefined && !amountError ? pool.requestedAmount - amount : 0;

  // Worked out as the terms change, the way the society's own previews are.
  const economics = useMemo(
    () =>
      amount !== undefined && !amountError && rate !== undefined && !rateError
        ? sanctionEconomics(world, pool.id, amount, rate)
        : undefined,
    [world, pool.id, amount, amountError, rate, rateError],
  );

  async function sanction() {
    if (!valid) return;
    setPending(true);
    setError(undefined);
    const result = await repositories.apex.sanction({
      poolId: pool.id,
      sanctionedAmount: amount!,
      wholesaleRateBps: rate!,
      tenureMonths: months,
      remarks: remarks.trim(),
    });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  async function decline() {
    setPending(true);
    setError(undefined);
    const result = await repositories.apex.decline(pool.id, declineRemarks.trim());
    setPending(false);
    if (result.ok) setDeclining(false);
    else setError(result.error);
  }

  return (
    <section className="g-card g-blur" role="region" aria-label="Terms">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void sanction();
        }}
      >
        <div className="g-cardhead">
          <h2 className="g-strong m-0 text-lg">Terms</h2>
          <span className="g-ref">Up to {formatPaise(review.maxSanction)} within the limit</span>
        </div>

        <div className="g-field">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="sanction-amount">Amount to sanction</label>
            <div className="g-seg" role="group" aria-label="Quick amounts">
              <button
                type="button"
                aria-pressed={amount === pool.requestedAmount}
                onClick={() => setAmount(formatPaisePlain(pool.requestedAmount))}
              >
                In full
              </button>
              <button type="button" aria-pressed={amount === eighty} onClick={() => setAmount(formatPaisePlain(eighty))}>
                80%
              </button>
            </div>
          </div>
          <div className="g-money" data-invalid={Boolean(amountError)}>
            <span aria-hidden>₹</span>
            <input
              id="sanction-amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={Boolean(amountError)}
              aria-describedby="sanction-amount-note"
            />
            <small id="sanction-amount-note">of {formatPaise(pool.requestedAmount)} requested</small>
          </div>
          {amountError ? (
            <p role="alert" className="g-error m-0">
              {amountError}
            </p>
          ) : null}
        </div>

        {shortBy > 0 ? (
          <div className="g-callout warn">
            <TriangleAlert aria-hidden />
            <div>
              <b>
                <Money paise={shortBy} /> short · {name} will re-scope
              </b>
              <div>
                Before drawing, {name} trims its {plural(pool.applicationIds.length, 'loan')} to fit, pro rata or by removing members,
                and the members agree the new amounts.
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="g-field">
            <label htmlFor="sanction-rate">Wholesale rate (% a year)</label>
            <input
              id="sanction-rate"
              className="g-input"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              aria-invalid={Boolean(rateError)}
            />
          </div>
          <div className="g-field">
            <label htmlFor="sanction-tenure">Tenure (months)</label>
            <input
              id="sanction-tenure"
              className="g-input"
              inputMode="numeric"
              value={tenure}
              onChange={(e) => setTenure(e.target.value)}
              aria-invalid={Boolean(tenureError)}
            />
          </div>
        </div>
        {rateError ? (
          <p role="alert" className="g-error m-0">
            {rateError}
          </p>
        ) : null}
        {tenureError ? (
          <p role="alert" className="g-error m-0">
            {tenureError}
          </p>
        ) : (
          <p className="g-ok m-0">
            <Check aria-hidden /> Covers the longest loan, {pool.requestedTenureMonths} months
          </p>
        )}

        <div className="g-field">
          <label htmlFor="sanction-remarks">Remarks for the society</label>
          <textarea id="sanction-remarks" className="g-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {economics ? (
          <div className="rounded-[14px] p-4" style={{ background: 'var(--g-subtle)' }}>
            <span className="g-lbl">
              Interest over the life of the loans, at <Money paise={amount!} />
            </span>
            <div className="g-bar" style={{ height: 8, margin: '12px 0' }} aria-hidden>
              <span className="g-fedfill" style={{ width: `${(economics.wholesale / Math.max(1, economics.retail)) * 100}%` }} />
              <span style={{ width: `${(economics.margin / Math.max(1, economics.retail)) * 100}%`, background: 'var(--g-soc)' }} />
            </div>
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="g-muted">Members pay · {formatBps(policy.retailRateBps)}</span>
              <b className="g-strong num">
                <Money paise={economics.retail} />
              </b>
            </div>
            <div className="mt-1.5 flex justify-between gap-3 text-[13px]">
              <span className="g-muted">
                <i className="g-key g-fedfill" />
                To the federation · {formatBps(rate!)}
              </span>
              <b className="g-strong num">
                <Money paise={economics.wholesale} />
              </b>
            </div>
            <div className="mt-1.5 flex justify-between gap-3 text-[13px]">
              <span className="g-muted">
                <i className="g-key" style={{ background: 'var(--g-soc)' }} />
                Kept by {name} · {formatBps(policy.retailRateBps - rate!)}
              </span>
              <b className="g-strong num">
                <Money paise={economics.margin} />
              </b>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="g-error m-0">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4" style={{ borderColor: 'var(--g-line)' }}>
          <Dialog open={declining} onOpenChange={setDeclining}>
            <button type="button" className="g-btn" onClick={() => setDeclining(true)} disabled={pending}>
              <X aria-hidden /> Decline
            </button>
            <DialogContent>
              <DialogTitle>Decline {pool.reference}?</DialogTitle>
              <DialogDescription>The society is told why, and its applications are released to go into another pool.</DialogDescription>
              <Field label="Remarks for the society" className="mt-4">
                {({ id }) => <Textarea id={id} value={declineRemarks} onChange={(e) => setDeclineRemarks(e.target.value)} />}
              </Field>
              {error ? (
                <p role="alert" className="mt-2 text-sm text-bad">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button onClick={() => void decline()} disabled={pending || !declineRemarks.trim()}>
                  {pending ? 'Declining…' : 'Decline the pool'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <button type="submit" className="g-btn pri lg" disabled={!valid || pending}>
            <Check aria-hidden />
            {pending ? 'Sanctioning…' : `Sanction ${amount !== undefined && !amountError ? formatPaise(amount) : ''}`.trim()}
          </button>
        </div>
      </form>
    </section>
  );
}
