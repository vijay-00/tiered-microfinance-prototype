import type { ApplicationStage } from '@/domain/origination';
import type { LoanPurpose } from '@/domain/types';

/** Words for the domain's codes, in one place so every screen says the same thing. */

export const PURPOSE_LABEL: Record<LoanPurpose, string> = {
  CROP: 'Crop',
  DAIRY: 'Dairy',
  TRADE: 'Trade',
  EDUCATION: 'Education',
  HOUSING: 'Housing',
  CONSUMPTION: 'Consumption',
};

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  NEEDS_APPRAISAL: 'Needs appraisal',
  AWAITING_DECISION: 'Awaiting decision',
  READY_TO_POOL: 'Ready to pool',
  IN_POOL: 'In a pool',
  DISBURSED: 'Disbursed',
  REJECTED: 'Rejected',
};

export function percent(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}
