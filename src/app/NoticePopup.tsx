import { BadgeCheck, Banknote, CircleX, FileText, Landmark, MapPin, Smartphone } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatBps, formatPaise } from '@/domain/money';
import { noticesFor, type ApplicationNotice, type Notice, type PaymentNotice, type PoolNotice } from '@/domain/views';
import { formatTenure } from '@/domain/machines';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useAppStore } from '@/store/context';

/**
 * Pop-ups about applications members made themselves: whoever decides hears of
 * a new proposal, the secretary or the federation by where the member applied,
 * and the member of the decision and the payout. And about the federation's
 * decision on a pool, for those who act on it next. One at a time;
 * acting on it or closing it marks it seen. What was already so in the seed is
 * history, not news, so it never pops up.
 */

interface Copy {
  title: string;
  body: string;
  action: string;
  to: string;
  later: string;
  icon: typeof FileText;
  tone: 'accent' | 'good' | 'bad';
}

function copyFor(n: Notice): Copy {
  if (n.kind === 'PAYMENT') return paymentCopy(n);
  return 'poolId' in n ? poolCopy(n) : applicationCopy(n);
}

function paymentCopy(n: PaymentNotice): Copy {
  return {
    title: 'Payment received by UPI',
    body: `${n.memberName} paid ${formatPaise(n.amount)}. Receipt ${n.receiptNo} is posted to the ledger and the loan is updated.`,
    action: 'Open the loan',
    to: `/loans/${n.loanId}`,
    later: 'Close',
    icon: Smartphone,
    tone: 'good',
  };
}

function poolCopy(n: PoolNotice): Copy {
  const t = n.tranche;
  if (n.kind === 'POOL_DECLINED' || !t) {
    const why = n.remarks ? `: ${n.remarks}` : '.';
    if (n.audience === 'MEMBER') {
      return {
        title: 'Funding for your loan was declined',
        body: `The federation declined funding for the batch your loan was in${why} The society will tell you what happens next.`,
        action: 'See where it stands',
        to: '/me',
        later: 'Close',
        icon: CircleX,
        tone: 'bad',
      };
    }
    return {
      title: 'The federation declined a batch',
      body: `The federation declined ${n.poolReference}, which asked for ${formatPaise(n.requested)}${why}`,
      action: 'Open the batch',
      to: `/pools/${n.poolId}`,
      later: 'Close',
      icon: CircleX,
      tone: 'bad',
    };
  }

  const inFull = t.sanctioned === n.requested;
  const share = inFull ? 'in full' : `${Math.round((t.sanctioned / n.requested) * 100)}% of the ${formatPaise(n.requested)} asked for`;
  const terms = `${formatPaise(t.sanctioned)}, ${share}, at ${formatBps(t.rateBps)} a year for ${formatTenure(t.tenureMonths)}`;
  if (n.audience === 'MEMBER') {
    return {
      title: 'Funding for your loan is approved',
      body: inFull
        ? 'The federation approved funding for the batch your loan is in. The society pays your loan out to you next.'
        : 'The federation approved part of the funding the society asked for. The society confirms the amount it pays out to you next.',
      action: 'See where it stands',
      to: '/me',
      later: 'Close',
      icon: BadgeCheck,
      tone: 'good',
    };
  }
  return {
    title: 'Funding sanctioned',
    body: inFull
      ? `The federation sanctioned ${n.poolReference}: ${terms}, as ${t.sanctionRef}. Draw it down to pay out the members’ loans.`
      : `The federation sanctioned ${n.poolReference}: ${terms}, as ${t.sanctionRef}. Fit the members’ loans to the sanction so they add up to ${formatPaise(t.sanctioned)}, then draw it down.`,
    action: n.readOnly ? 'Open the facility' : inFull ? 'Draw down and disburse' : 'Fit the batch to the sanction',
    // The facility page offers the re-scope first when the sanction fell short.
    to: `/tranches/${t.id}`,
    later: 'Later',
    icon: Landmark,
    tone: 'good',
  };
}

function applicationCopy(n: ApplicationNotice): Copy {
  const loan = `a ${formatPaise(n.amount)} ${PURPOSE_LABEL[n.purpose]} over ${formatTenure(n.tenureMonths)}`;
  const toFederation = n.route === 'FEDERATION';
  const decider = toFederation ? 'federation' : 'society';
  switch (n.kind) {
    case 'VISIT_DUE':
      return {
        title: 'New loan proposal',
        body: `${n.memberName} has applied for ${loan}. Visit the member, capture the location and upload any documents.`,
        action: 'Start the visit',
        to: `/visits/${n.applicationId}`,
        later: 'Later',
        icon: MapPin,
        tone: 'accent',
      };
    case 'VISITED':
      return {
        title: 'Field visit done',
        body: `The field officer has visited ${n.memberName} about ${loan}. It is ready for your appraisal.`,
        action: 'Open the proposal',
        to: toFederation ? `/apex/direct/${n.applicationId}` : `/applications/${n.applicationId}`,
        later: 'Later',
        icon: MapPin,
        tone: 'accent',
      };
    case 'DIRECT':
      return {
        title: 'A member applied to the federation',
        body: n.awaitingVisit
          ? `${n.memberName} asked the federation for ${loan}. The field officer visits first, then it is yours to appraise and decide.`
          : `${n.memberName} asked the federation for ${loan}. It is waiting for your appraisal.`,
        action: 'Open the proposal',
        to: `/apex/direct/${n.applicationId}`,
        later: 'Later',
        icon: Landmark,
        tone: 'accent',
      };
    case 'PROPOSAL':
      return {
        title: 'New loan proposal',
        body: `${n.memberName} has applied for ${loan}. It is waiting for your appraisal.`,
        action: 'Open the proposal',
        to: `/applications/${n.applicationId}`,
        later: 'Later',
        icon: FileText,
        tone: 'accent',
      };
    case 'APPROVED':
      return {
        title: 'Your loan is approved',
        body: toFederation
          ? `The federation approved ${loan}. Your society pays it out to you once the funding is sanctioned.`
          : `The society approved ${loan}. It now goes for funding along with other members’ loans, and is paid out to you once funding is approved.`,
        action: 'See where it stands',
        to: '/me',
        later: 'Close',
        icon: BadgeCheck,
        tone: 'good',
      };
    case 'REJECTED':
      return {
        title: 'Your application was not approved',
        body: `The ${decider} did not approve your application for ${formatPaise(n.amount)}${n.reason ? `: ${n.reason}` : '.'} You can apply again.`,
        action: 'Apply again',
        to: '/me/apply',
        later: 'Close',
        icon: CircleX,
        tone: 'bad',
      };
    case 'PAID_OUT':
      return {
        title: 'Your loan is paid out',
        body: `${formatPaise(n.amount)} has been paid out to you. Your schedule shows each instalment and when it falls due.`,
        action: 'See your schedule',
        to: `/me/loans/${n.loanId}`,
        later: 'Close',
        icon: Banknote,
        tone: 'good',
      };
  }
}

export function NoticePopup() {
  const world = useAppStore((s) => s.world);
  const seedWorld = useAppStore((s) => s.seedWorld);
  const session = useAppStore((s) => s.session);
  const markSeen = useAppStore((s) => s.markSeen);
  const navigate = useNavigate();
  const pending = useMemo(() => {
    const seen = new Set(session.seen ?? []);
    noticesFor(seedWorld, session.userId).forEach((n) => seen.add(n.key));
    return noticesFor(world, session.userId).filter((n) => !seen.has(n.key));
  }, [world, seedWorld, session]);
  const notice = pending[0];
  if (!notice) return null;
  const copy = copyFor(notice);
  const Icon = copy.icon;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : markSeen([notice.key]))}>
      <DialogContent className="glass g-notice">
        <span className={`g-notice-icon ${copy.tone}`} aria-hidden>
          <Icon />
        </span>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.body}</DialogDescription>
        {pending.length > 1 ? <p className="g-notice-more">{pending.length - 1} more after this</p> : null}
        <div className="g-notice-actions">
          <button type="button" className="g-btn" onClick={() => markSeen([notice.key])}>
            {copy.later}
          </button>
          <button
            type="button"
            className="g-btn pri"
            onClick={() => {
              markSeen([notice.key]);
              navigate(copy.to);
            }}
          >
            {copy.action}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
