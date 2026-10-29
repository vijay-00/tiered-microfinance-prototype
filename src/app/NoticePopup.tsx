import { BadgeCheck, Banknote, CircleX, FileText, Scale } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatPaise } from '@/domain/money';
import { noticesFor, type Notice } from '@/domain/views';
import { PURPOSE_LABEL } from '@/lib/labels';
import { useAppStore } from '@/store/context';

/**
 * Pop-ups about applications members made themselves: the officer hears of a
 * new proposal, the secretary of one above the officer's limit, the member of
 * the decision and the payout. One at a time; acting on it or closing it marks
 * it seen.
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

function copyFor(n: Notice, officerLimit: number): Copy {
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
    case 'DECIDE':
      return {
        title: 'A loan proposal needs your decision',
        body: `${n.memberName}’s application, ${loan}, is above the officer’s ${formatPaise(officerLimit)} limit, so the decision is yours.`,
        action: 'Open the proposal',
        to: `/applications/${n.applicationId}`,
        later: 'Later',
        icon: Scale,
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
  const session = useAppStore((s) => s.session);
  const markSeen = useAppStore((s) => s.markSeen);
  const navigate = useNavigate();
  const pending = useMemo(() => {
    const seen = new Set(session.seen ?? []);
    return noticesFor(world, session.userId).filter((n) => !seen.has(n.key));
  }, [world, session]);
  const notice = pending[0];
  if (!notice) return null;
  const copy = copyFor(notice, world.policy.officerApprovalLimit);
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
