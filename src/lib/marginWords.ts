import { formatPaise } from '@/domain/money';
import type { MarginPeriod, MarginReason } from '@/domain/reporting';

/** Why realised margin differs from what the schedules promised, in words. */
export function marginReasonText(reason: MarginReason): string {
  const amount = formatPaise(reason.amount);
  switch (reason.kind) {
    case 'MEMBERS_BEHIND':
      return `Members paid ${amount} less interest than fell due. Their arrears are still owed, so this comes back as they catch up, with penal interest on top.`;
    case 'MEMBERS_AHEAD':
      return `Members paid ${amount} more interest than fell due, catching up on arrears from earlier periods.`;
    case 'PREPAYMENT_IN_TRANSIT':
      return `${amount} of wholesale interest on principal members prepaid between remittance dates: a member stops paying interest at once, the federation charges until the next remittance passes the money on. A cost of prepayment, not of arrears.`;
    case 'WHOLESALE_ABOVE_SCHEDULE':
      return `The federation was paid ${amount} more interest than members' balances imply: principal held back from it, or money drawn and not lent, kept attracting wholesale interest. That margin is lost for good.`;
    case 'WHOLESALE_NOT_YET_PAID':
      return `${amount} of the federation's interest for the period is not yet paid: a remittance is outstanding or was short. It is still owed.`;
    case 'ROUNDING':
      return `${amount} of rounding: the federation's interest is rounded once on each tranche's balance, each member's share on its own.`;
  }
}

export function marginSummary(period: MarginPeriod): string[] {
  return period.reasons.length === 0
    ? ['Realised and theoretical margin agree to the paisa.']
    : period.reasons.map(marginReasonText);
}

/** A few words for a table cell. */
export const MARGIN_REASON_SHORT: Record<MarginReason['kind'], string> = {
  MEMBERS_BEHIND: 'Members behind',
  MEMBERS_AHEAD: 'Members catching up',
  PREPAYMENT_IN_TRANSIT: 'Prepayment timing',
  WHOLESALE_ABOVE_SCHEDULE: 'Extra wholesale interest',
  WHOLESALE_NOT_YET_PAID: 'Remittance outstanding',
  ROUNDING: 'Rounding',
};
