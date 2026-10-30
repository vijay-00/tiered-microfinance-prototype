import { BadgeCheck, Banknote, CircleX, FileText, Landmark } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatBps, formatPaise } from '@/domain/money';
import { noticesFor, type ApplicationNotice, type Notice, type PoolNotice } from '@/domain/views';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useAppStore } from '@/store/context';

/**
 * Pop-ups about applications members made themselves: the secretary hears of a
 * new proposal, the member of the decision and the payout. And about the
 * federation's decision on a pool, for every role it concerns. One at a time;
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
  return 'poolId' in n ? poolCopy(n) : applicationCopy(n);
}

function poolCopy(n: PoolNotice): Copy {
  const t = n.tranche;
  if (n.kind === 'POOL_DECLINED' || !t) {
    const why = n.remarks ? `: ${n.remarks}` : '.';
    if (n.audience === 'MEMBER') {
      return {
        title: 'Funding for your loan was declined',
        body: `The federation declined funding for the pool your loan was in${why} The society will tell you what happens next.`,
        action: 'See where it stands',
        to: '/me',
        later: 'Close',
        icon: CircleX,
        tone: 'bad',
      };
    }
    return {
      title: n.audience === 'APEX' ? 'Decline recorded' : 'The federation declined a pool',
      body:
        n.audience === 'APEX'
          ? `You declined ${n.societyName}’s ${n.poolReference}, asking ${formatPaise(n.requested)}${why}`
          : `The federation declined ${n.poolReference}, which asked for ${formatPaise(n.requested)}${why}`,
      action: n.audience === 'APEX' ? 'Back to funding requests' : 'Open the pool',
      to: n.audience === 'APEX' ? '/apex/requests' : `/pools/${n.poolId}`,
      later: 'Close',
      icon: CircleX,
      tone: 'bad',
    };
  }

  const inFull = t.sanctioned === n.requested;
  const share = inFull ? 'in full' : `${Math.round((t.sanctioned / n.requested) * 100)}% of the ${formatPaise(n.requested)} asked for`;
  const terms = `${formatPaise(t.sanctioned)}, ${share}, at ${formatBps(t.rateBps)} a year for ${t.tenureMonths} months`;
  if (n.audience === 'MEMBER') {
    return {
      title: 'Funding for your loan is approved',
      body: inFull
        ? 'The federation approved funding for the pool your loan is in. The society pays your loan out to you next.'
        : 'The federation approved part of the funding the society asked for. The society confirms the amount it pays out to you next.',
      action: 'See where it stands',
      to: '/me',
      later: 'Close',
      icon: BadgeCheck,
      tone: 'good',
    };
  }
  if (n.audience === 'APEX') {
    return {
      title: 'Sanction recorded',
      body: `You sanctioned ${n.societyName}’s ${n.poolReference}: ${terms}, as ${t.sanctionRef}. The society can now draw it down and pay out its members.`,
      action: 'Back to funding requests',
      to: '/apex/requests',
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
    action: n.readOnly ? 'Open the facility' : inFull ? 'Draw down and disburse' : 'Fit the pool to the sanction',
    // The facility page offers the re-scope first when the sanction fell short.
    to: `/tranches/${t.id}`,
    later: 'Later',
    icon: Landmark,
    tone: 'good',
  };
}

function applicationCopy(n: ApplicationNotice): Copy {
  const loan = `${formatPaise(n.amount)} for ${PURPOSE_LABEL[n.purpose].toLowerCase()} over ${n.tenureMonths} months`;
  switch (n.kind) {
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
        body: `The society approved ${loan}. It now goes for funding along with other members’ loans, and is paid out to you once funding is approved.`,
        action: 'See where it stands',
        to: '/me',
        later: 'Close',
        icon: BadgeCheck,
        tone: 'good',
      };
    case 'REJECTED':
      return {
        title: 'Your application was not approved',
        body: `The society did not approve your application for ${formatPaise(n.amount)}${n.reason ? `: ${n.reason}` : '.'} You can apply again.`,
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
