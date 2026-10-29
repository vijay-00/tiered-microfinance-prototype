import { Badge } from '@/components/ui/badge';
import type { ApprovalAuthority } from '@/domain/machines';
import type { ApplicationStage } from '@/domain/origination';
import type { CollectionStatus, ScheduleStatus } from '@/domain/servicing';
import type { LoanStatus, PoolStatus, TrancheStatus } from '@/domain/types';
import { plural } from '@/lib/format';
import { STAGE_LABEL } from '@/lib/labels';

export function ScheduleStatusBadge({ status, daysLate }: { status: ScheduleStatus; daysLate: number }) {
  switch (status) {
    case 'PAID':
      return <Badge tone="good">Paid</Badge>;
    case 'UPCOMING':
      return <Badge>Upcoming</Badge>;
    case 'DUE_TODAY':
      return <Badge tone="warn">Due today</Badge>;
    case 'PARTLY_PAID':
      return <Badge tone={daysLate > 0 ? 'bad' : 'warn'}>Part paid{daysLate > 0 ? `, ${daysLate}d late` : ''}</Badge>;
    case 'OVERDUE':
      return <Badge tone="bad">{plural(daysLate, 'day')} late</Badge>;
  }
}

export function CollectionStatusBadge({ status, daysPastDue }: { status: CollectionStatus; daysPastDue: number }) {
  switch (status) {
    case 'DUE_TODAY':
      return <Badge tone="warn">Due today</Badge>;
    case 'IN_GRACE':
      return <Badge tone="warn">{plural(daysPastDue, 'day')} late, in grace</Badge>;
    case 'OVERDUE':
      return <Badge tone="bad">{plural(daysPastDue, 'day')} late</Badge>;
    case 'UPCOMING':
      return <Badge>Upcoming</Badge>;
  }
}

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  const tone = status === 'ACTIVE' ? 'info' : status === 'WRITTEN_OFF' ? 'bad' : 'good';
  const label = { ACTIVE: 'Active', CLOSED: 'Repaid', FORECLOSED: 'Foreclosed', WRITTEN_OFF: 'Written off' }[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function TrancheStatusBadge({ status }: { status: TrancheStatus }) {
  const label = {
    SANCTIONED: 'Sanctioned',
    PARTIALLY_DRAWN: 'Part drawn',
    DRAWN: 'Drawn',
    SERVICING: 'Servicing',
    CLOSED: 'Closed',
    DEFAULTED: 'Defaulted',
  }[status];
  const tone = status === 'DEFAULTED' ? 'bad' : status === 'CLOSED' ? 'good' : 'info';
  return <Badge tone={tone}>{label}</Badge>;
}

export function ApplicationStageBadge({ stage }: { stage: ApplicationStage }) {
  const tone = {
    NEEDS_APPRAISAL: 'warn',
    AWAITING_DECISION: 'warn',
    READY_TO_POOL: 'info',
    IN_POOL: 'info',
    DISBURSED: 'good',
    REJECTED: 'bad',
  } as const;
  return <Badge tone={tone[stage]}>{STAGE_LABEL[stage]}</Badge>;
}

export function PoolStatusBadge({ status }: { status: PoolStatus }) {
  const label = {
    OPEN: 'Being built',
    READY: 'Ready to submit',
    SUBMITTED: 'Submitted',
    UNDER_APEX_REVIEW: 'Under review',
    SANCTIONED: 'Sanctioned',
    DECLINED: 'Declined',
    DISBURSED: 'Disbursed',
    SERVICING: 'Servicing',
    CLOSED: 'Closed',
  }[status];
  const tone =
    status === 'DECLINED'
      ? 'bad'
      : status === 'OPEN' || status === 'READY'
        ? 'neutral'
        : status === 'SUBMITTED' || status === 'UNDER_APEX_REVIEW'
          ? 'warn'
          : status === 'CLOSED'
            ? 'good'
            : 'info';
  return <Badge tone={tone}>{label}</Badge>;
}

/** Who may decide an application of this size: the officer, or above the limit the secretary. */
export function AuthorityBadge({ authority }: { authority: ApprovalAuthority }) {
  return authority === 'SECRETARY' ? (
    <Badge tone="info">Secretary decides</Badge>
  ) : (
    <Badge>Officer can decide</Badge>
  );
}
