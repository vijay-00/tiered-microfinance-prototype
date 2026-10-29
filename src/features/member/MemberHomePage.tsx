import { Check, ChevronRight, CircleAlert, Clock, FilePlus2, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { formatBps } from '@/domain/money';
import type { ApplicationStepKey, MemberApplicationView } from '@/domain/views';
import { BigMoney, Money, PageHead, Pill } from '@/features/apex/glass';
import { cn } from '@/lib/cn';
import { formatDate, plural } from '@/lib/format';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

/**
 * The member's own view. It shows the retail rate and nothing else about
 * pricing: the wholesale rate and the society's margin are not the member's
 * business, and this screen never receives them.
 */
export function MemberHomePage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const memberId = user.memberId!;
  const { data, error } = useQuery(`member-loans:${memberId}:${version}`, () => repositories.member.getLoans(memberId));
  const { data: applications } = useQuery(`member-applications:${memberId}:${version}`, () =>
    repositories.member.getApplications(memberId),
  );
  const justApplied = (useLocation().state as { applied?: string } | null)?.applied;
  // In progress, or turned down in the last while; once paid out, an application is a loan below.
  const tracked = (applications ?? []).filter((a) => a.outcome !== 'PAID_OUT').slice(0, 2);
  const open = tracked.some((a) => a.outcome === 'IN_PROGRESS');

  return (
    <>
      <PageHead
        title="My loans"
        sub={`Welcome, ${user.name}`}
        actions={
          open ? null : (
            <Link to="/me/apply" className="g-btn pri">
              <FilePlus2 aria-hidden /> Apply for a loan
            </Link>
          )
        }
      />
      {error ? <p className="g-error">Your loans could not be loaded: {error}</p> : null}
      {tracked.map((a) => (
        <Tracker key={a.applicationId} application={a} fresh={a.applicationId === justApplied} />
      ))}
      {!data ? (
        <LoadingTiles count={1} />
      ) : data.length === 0 ? (
        <p className="g-sub">You have no loans with the society yet.</p>
      ) : (
        <div className="g-dash">
          {data.map((loan) => (
            <section key={loan.loanId} className="g-card g-blur g-s6 g-col" aria-label={`Loan of ${loan.principal / 100}`}>
              <div className="g-cardhead">
                <span className="g-lbl">
                  Loan of <Money paise={loan.principal} />
                </span>
                {loan.status !== 'ACTIVE' ? (
                  <Pill tone="good" icon={<Check aria-hidden />}>Repaid</Pill>
                ) : loan.daysPastDue > 0 ? (
                  <Pill tone="bad" icon={<CircleAlert aria-hidden />}>{plural(loan.daysPastDue, 'day')} overdue</Pill>
                ) : loan.dueNow > 0 ? (
                  <Pill tone="warn" icon={<Clock aria-hidden />}>Due today</Pill>
                ) : (
                  <Pill tone="good" icon={<Check aria-hidden />}>Up to date</Pill>
                )}
              </div>
              <span className="g-lbl mt-4">Still to repay</span>
              <BigMoney paise={loan.outstanding} className="sm" />
              <div className="g-bar mt-4" aria-hidden>
                <span
                  style={{ width: `${(loan.instalmentsPaid / Math.max(1, loan.instalmentsTotal)) * 100}%`, background: 'var(--g-accent)', borderRadius: 999 }}
                />
              </div>
              <dl className="g-facts mt-2 text-[13px]">
                <div>
                  <dt>Instalments paid</dt>
                  <dd className="m-0">
                    <b className="num">
                      {loan.instalmentsPaid} of {loan.instalmentsTotal}
                    </b>
                  </dd>
                </div>
                <div>
                  <dt>Monthly instalment</dt>
                  <dd className="m-0">
                    <b className="num">
                      <Money paise={loan.emi} />
                    </b>
                  </dd>
                </div>
                <div>
                  <dt>Interest rate</dt>
                  <dd className="m-0">
                    <b>{formatBps(loan.rateBps)} a year</b>
                  </dd>
                </div>
                {loan.dueNow > 0 ? (
                  <div>
                    <dt>To pay now</dt>
                    <dd className="m-0">
                      <b className="g-neg num">
                        <Money paise={loan.dueNow} />
                      </b>
                    </dd>
                  </div>
                ) : null}
                {loan.nextInstalment ? (
                  <div>
                    <dt>Next instalment</dt>
                    <dd className="m-0">
                      <b className="num">
                        <Money paise={loan.nextInstalment.amount} />
                      </b>{' '}
                      on {formatDate(loan.nextInstalment.dueOn)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="g-foot mt-auto">
                <span>Paid out {formatDate(loan.disbursedOn)}</span>
                <Link to={`/me/loans/${loan.loanId}`} className="g-btn sm">
                  Your schedule and payments <ChevronRight aria-hidden />
                </Link>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const STEP_LABEL: Record<ApplicationStepKey, string> = {
  APPLIED: 'Applied',
  APPRAISED: 'Appraised by the field officer',
  DECIDED: 'Approved by the society',
  SENT: 'Sent for funding',
  FUNDED: 'Funding approved',
  PAID_OUT: 'Paid out to you',
};

const NEXT_LABEL: Record<ApplicationStepKey, string> = {
  APPLIED: 'You applied',
  APPRAISED: 'The field officer visits to appraise it',
  DECIDED: 'The society decides',
  SENT: 'The society sends it, with others, for funding',
  FUNDED: 'Funding is approved',
  PAID_OUT: 'The money is paid out to you',
};

function Tracker({ application: a, fresh }: { application: MemberApplicationView; fresh: boolean }) {
  const rejected = a.outcome === 'REJECTED';
  const current = a.steps.findIndex((s) => !s.on);
  return (
    <section className="g-card g-blur" aria-label="Your application">
      <div className="g-cardhead flex-wrap">
        <span className="g-lbl">
          Your application · <Money paise={a.requestedAmount} /> for {PURPOSE_LABEL[a.purpose].toLowerCase()} over {a.requestedTenureMonths} months
        </span>
        {rejected ? (
          <Pill tone="bad" icon={<X aria-hidden />}>Not approved</Pill>
        ) : fresh ? (
          <Pill tone="good" icon={<Check aria-hidden />}>Sent to the society</Pill>
        ) : (
          <Pill tone="warn" icon={<Clock aria-hidden />}>In progress</Pill>
        )}
      </div>
      {rejected ? (
        <p className="g-sub">
          The society did not approve it{a.reason ? `: ${a.reason}` : '.'} You can apply again.
        </p>
      ) : (
        <>
          <ol className="g-steps" aria-label="Where it stands">
            {a.steps.map((s, i) => (
              <li key={s.key} className={cn(s.on ? 'done' : i === current ? 'now' : undefined)} aria-current={i === current ? 'step' : undefined}>
                <i aria-hidden>{s.on ? <Check /> : i + 1}</i>
                <b>{STEP_LABEL[s.key]}</b>
                <span>{s.on ? formatDate(s.on) : i === current ? 'Next' : ''}</span>
              </li>
            ))}
          </ol>
          {current >= 0 ? (
            <p className="g-sub">
              Next: {NEXT_LABEL[a.steps[current]!.key].toLowerCase()}.
              {a.approvedAmount !== undefined ? (
                <>
                  {' '}
                  Approved for <Money paise={a.approvedAmount} />.
                </>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
