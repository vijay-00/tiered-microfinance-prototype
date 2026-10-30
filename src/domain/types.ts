import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
//
// Money is an integer count of paise everywhere in this codebase. A float rupee
// drifts over a 12-period schedule, the closing balance misses zero, and the
// trial balance stops balancing. Rupees exist only at the formatting boundary.
// ---------------------------------------------------------------------------

/** An integer count of paise. */
export type Paise = number;

/** Basis points per annum: 950 means 9.5% p.a. */
export type Bps = number;

/** A calendar date as 'YYYY-MM-DD'. */
export type ISODate = string;

export const paiseSchema = z.number().int().finite();
export const bpsSchema = z.number().int().min(0).max(100_000);
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date as YYYY-MM-DD');

export const idSchema = z.string().min(1);
export type ID = z.infer<typeof idSchema>;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const loanPurposes = [
  'CROP',
  'DAIRY',
  'TRADE',
  'EDUCATION',
  'HOUSING',
  'CONSUMPTION',
] as const;
export const loanPurposeSchema = z.enum(loanPurposes);
export type LoanPurpose = z.infer<typeof loanPurposeSchema>;

export const applicationStatuses = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_APPRAISAL',
  'APPROVED',
  'REJECTED',
  'POOLED',
  'DISBURSED',
] as const;
export const applicationStatusSchema = z.enum(applicationStatuses);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const poolStatuses = [
  'OPEN',
  'READY',
  'SUBMITTED',
  'UNDER_APEX_REVIEW',
  'SANCTIONED',
  'DECLINED',
  'DISBURSED',
  'SERVICING',
  'CLOSED',
] as const;
export const poolStatusSchema = z.enum(poolStatuses);
export type PoolStatus = z.infer<typeof poolStatusSchema>;

export const trancheStatuses = [
  'SANCTIONED',
  'PARTIALLY_DRAWN',
  'DRAWN',
  'SERVICING',
  'CLOSED',
  'DEFAULTED',
] as const;
export const trancheStatusSchema = z.enum(trancheStatuses);
export type TrancheStatus = z.infer<typeof trancheStatusSchema>;

/**
 * Delinquency is deliberately absent from this list. An overdue loan is still
 * ACTIVE; overdue-ness is derived from the schedule, the payments and the
 * clock. Making it a state would mean two sources of truth for one fact.
 */
export const loanStatuses = ['ACTIVE', 'CLOSED', 'FORECLOSED', 'WRITTEN_OFF'] as const;
export const loanStatusSchema = z.enum(loanStatuses);
export type LoanStatus = z.infer<typeof loanStatusSchema>;

export const remittanceStatuses = ['DUE', 'PAID', 'PARTIAL', 'OVERDUE'] as const;
export const remittanceStatusSchema = z.enum(remittanceStatuses);
export type RemittanceStatus = z.infer<typeof remittanceStatusSchema>;

export const paymentModes = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'] as const;
export const paymentModeSchema = z.enum(paymentModes);
export type PaymentMode = z.infer<typeof paymentModeSchema>;

export const allocationBuckets = [
  'PENAL_INTEREST',
  'FEES',
  'OVERDUE_INTEREST',
  'OVERDUE_PRINCIPAL',
  'CURRENT_INTEREST',
  'CURRENT_PRINCIPAL',
  'ADVANCE',
] as const;
export const allocationBucketSchema = z.enum(allocationBuckets);
export type AllocationBucket = z.infer<typeof allocationBucketSchema>;

export const reconciliationPolicies = ['PASS_THROUGH', 'INDEPENDENT_AMORTISATION'] as const;
export const reconciliationPolicySchema = z.enum(reconciliationPolicies);
export type ReconciliationPolicy = z.infer<typeof reconciliationPolicySchema>;

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const policySchema = z.object({
  retailRateBps: bpsSchema,
  wholesaleRateBps: bpsSchema,
  /** Charged over and above the retail rate, on overdue amounts only. */
  penalRateBps: bpsSchema,
  poolMinMembers: z.number().int().min(1),
  poolMaxMembers: z.number().int().min(1),
  minTicket: paiseSchema.nonnegative(),
  maxTicket: paiseSchema.nonnegative(),
  officerApprovalLimit: paiseSchema.nonnegative(),
  graceDays: z.number().int().min(0),
  reconciliationPolicy: reconciliationPolicySchema,
  accrualEnabled: z.boolean(),
  allocationOrder: z.array(allocationBucketSchema),
});
export type Policy = z.infer<typeof policySchema>;

export const DEFAULT_POLICY: Policy = {
  retailRateBps: 1150,
  wholesaleRateBps: 950,
  penalRateBps: 200,
  poolMinMembers: 1, // one approved application is enough to go to the federation
  poolMaxMembers: 20,
  minTicket: 500_000, // Rs 5,000
  maxTicket: 50_000_000, // Rs 5,00,000
  officerApprovalLimit: 5_000_000, // Rs 50,000
  graceDays: 7,
  reconciliationPolicy: 'PASS_THROUGH',
  accrualEnabled: false,
  allocationOrder: [
    'PENAL_INTEREST',
    'FEES',
    'OVERDUE_INTEREST',
    'OVERDUE_PRINCIPAL',
    'CURRENT_INTEREST',
    'CURRENT_PRINCIPAL',
    'ADVANCE',
  ],
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const scheduleRowSchema = z.object({
  loanId: idSchema,
  period: z.number().int().positive(),
  dueOn: isoDateSchema,
  opening: paiseSchema.nonnegative(),
  instalment: paiseSchema.nonnegative(),
  interest: paiseSchema.nonnegative(),
  principal: paiseSchema.nonnegative(),
  closing: paiseSchema.nonnegative(),
});
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;

export const loanSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  memberId: idSchema,
  societyId: idSchema,
  poolId: idSchema,
  trancheId: idSchema,
  principal: paiseSchema.positive(),
  rateBps: bpsSchema,
  tenureMonths: z.number().int().positive(),
  disbursedOn: isoDateSchema,
  firstDueOn: isoDateSchema,
  emi: paiseSchema.positive(),
  status: loanStatusSchema,
});
export type Loan = z.infer<typeof loanSchema>;

export const trancheSchema = z.object({
  id: idSchema,
  poolId: idSchema,
  societyId: idSchema,
  federationId: idSchema,
  sanctionRef: z.string().min(1),
  sanctionedAmount: paiseSchema.positive(),
  wholesaleRateBps: bpsSchema,
  tenureMonths: z.number().int().positive(),
  sanctionedOn: isoDateSchema,
  /** The society's own stake. 0 means the tranche funds the pool in full. */
  marginRequirementBps: bpsSchema,
  drawdowns: z.array(z.object({ on: isoDateSchema, amount: paiseSchema.positive() })),
  status: trancheStatusSchema,
});
export type Tranche = z.infer<typeof trancheSchema>;

export const allocationSchema = z.object({
  penalInterest: paiseSchema.nonnegative(),
  fees: paiseSchema.nonnegative(),
  overdueInterest: paiseSchema.nonnegative(),
  overduePrincipal: paiseSchema.nonnegative(),
  currentInterest: paiseSchema.nonnegative(),
  currentPrincipal: paiseSchema.nonnegative(),
  /**
   * Principal not yet due, paid early because the member elected prepayment.
   * Kept apart from `advance` because the two post differently: a prepayment
   * reduces the loan receivable, an advance is a liability held for the member.
   */
  prepaidPrincipal: paiseSchema.nonnegative(),
  advance: paiseSchema.nonnegative(),
});
export type Allocation = z.infer<typeof allocationSchema>;

export const reconciliationResultSchema = z.object({
  allocation: allocationSchema,
  federation: z.object({
    /**
     * This loan's share of the wholesale interest, charged on the same balance
     * the retail interest was charged on. The tranche-level obligation from
     * computeRemittance is the authoritative figure; the two agree only while
     * every member pays on time.
     */
    wholesaleInterestShare: paiseSchema.nonnegative(),
    principalPassThrough: paiseSchema.nonnegative(),
    remittanceShare: paiseSchema.nonnegative(),
  }),
  society: z.object({
    netInterestIncome: paiseSchema,
    penalIncome: paiseSchema.nonnegative(),
    feeIncome: paiseSchema.nonnegative(),
  }),
  balancesAfter: z.object({
    loanOutstanding: paiseSchema.nonnegative(),
    unappliedReceipts: paiseSchema.nonnegative(),
  }),
});
export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;

export const paymentSchema = z.object({
  id: idSchema,
  loanId: idSchema,
  memberId: idSchema,
  receivedOn: isoDateSchema,
  amount: paiseSchema.positive(),
  mode: paymentModeSchema,
  receiptNo: z.string().min(1),
  /** Frozen at the time of posting. A payment is a historical fact. */
  reconciliation: reconciliationResultSchema,
  journalEntryIds: z.array(idSchema),
});
export type Payment = z.infer<typeof paymentSchema>;

/**
 * Due and paid are held separately so a short remittance carries its arrears
 * into the next period instead of vanishing. Each period's due amount already
 * includes the arrears brought forward, so arrears are never summed twice.
 */
export const remittanceSchema = z.object({
  id: idSchema,
  trancheId: idSchema,
  period: z.number().int().positive(),
  dueOn: isoDateSchema,
  interestDue: paiseSchema.nonnegative(),
  principalDue: paiseSchema.nonnegative(),
  interestPaid: paiseSchema.nonnegative(),
  principalPaid: paiseSchema.nonnegative(),
  paidOn: isoDateSchema.optional(),
  status: remittanceStatusSchema,
  journalEntryIds: z.array(idSchema),
});
export type Remittance = z.infer<typeof remittanceSchema>;

export const journalSourceTypes = [
  'OPENING',
  'PAYMENT',
  'REMITTANCE',
  'DISBURSEMENT',
  'DRAWDOWN',
  'ACCRUAL',
  'WRITE_OFF',
  'CLOSE',
] as const;
export const journalSourceTypeSchema = z.enum(journalSourceTypes);
export type JournalSourceType = z.infer<typeof journalSourceTypeSchema>;

export const journalLineSchema = z.object({
  accountCode: z.number().int(),
  dr: paiseSchema.nonnegative(),
  cr: paiseSchema.nonnegative(),
});
export type JournalLine = z.infer<typeof journalLineSchema>;

export const journalEntrySchema = z.object({
  id: idSchema,
  on: isoDateSchema,
  narration: z.string().min(1),
  sourceType: journalSourceTypeSchema,
  sourceId: idSchema,
  lines: z.array(journalLineSchema).min(2),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

// ---------------------------------------------------------------------------
// Organisation, people and origination
// ---------------------------------------------------------------------------

export const roles = ['MEMBER', 'LOAN_OFFICER', 'SECRETARY', 'APEX_OFFICER', 'AUDITOR'] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;

export const federationSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  shortName: z.string().min(1),
  registeredOffice: z.string().min(1),
});
export type Federation = z.infer<typeof federationSchema>;

export const societySchema = z.object({
  id: idSchema,
  federationId: idSchema,
  name: z.string().min(1),
  /** Short code used to prefix receipt numbers, e.g. ANN. */
  code: z.string().regex(/^[A-Z]{3}$/),
  district: z.string().min(1),
  registrationNo: z.string().min(1),
  /** The most the federation will have sanctioned to this society at once. */
  creditLimit: paiseSchema.positive(),
  openedOn: isoDateSchema,
});
export type Society = z.infer<typeof societySchema>;

export const userSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  role: roleSchema,
  title: z.string().min(1),
  /** Absent for apex officers, who sit above every society. */
  societyId: idSchema.optional(),
  /** Present only for the member role: the member this login belongs to. */
  memberId: idSchema.optional(),
});
export type User = z.infer<typeof userSchema>;

export const memberSchema = z.object({
  id: idSchema,
  societyId: idSchema,
  membershipNo: z.string().min(1),
  name: z.string().min(1),
  village: z.string().min(1),
  phone: z.string().regex(/^\+91 \d{5} \d{5}$/),
  joinedOn: isoDateSchema,
  shareCapital: paiseSchema.nonnegative(),
  occupation: z.string().min(1),
  /** Mock appraisal score, 300 to 900. */
  internalScore: z.number().int().min(300).max(900),
  status: z.enum(['ACTIVE', 'DORMANT', 'EXITED']),
});
export type Member = z.infer<typeof memberSchema>;

export const loanApplicationSchema = z.object({
  id: idSchema,
  memberId: idSchema,
  societyId: idSchema,
  requestedAmount: paiseSchema.positive(),
  requestedTenureMonths: z.number().int().positive(),
  purpose: loanPurposeSchema,
  appliedOn: isoDateSchema,
  status: applicationStatusSchema,
  appraisal: z
    .object({
      officerId: idSchema,
      on: isoDateSchema,
      monthlyIncome: paiseSchema.nonnegative(),
      existingObligations: paiseSchema.nonnegative(),
      recommendedAmount: paiseSchema.nonnegative(),
      notes: z.string(),
    })
    .optional(),
  decision: z
    .object({
      by: idSchema,
      on: isoDateSchema,
      outcome: z.enum(['APPROVED', 'REJECTED']),
      sanctionedAmount: paiseSchema.nonnegative(),
      tenureMonths: z.number().int().positive(),
      rateBps: bpsSchema,
      reason: z.string().optional(),
      /** The amount first sanctioned, when a re-scope cut it. */
      rescopedFrom: paiseSchema.positive().optional(),
    })
    .optional(),
  poolId: idSchema.optional(),
  /** Made by the member themselves, rather than taken by the officer or the secretary. */
  selfApplied: z.boolean().optional(),
});
export type LoanApplication = z.infer<typeof loanApplicationSchema>;

export const poolSchema = z.object({
  id: idSchema,
  societyId: idSchema,
  /** e.g. POOL/2026-27/004 */
  reference: z.string().min(1),
  applicationIds: z.array(idSchema),
  requestedAmount: paiseSchema.nonnegative(),
  /** The longest tenure among its applications; zero while it has none. */
  requestedTenureMonths: z.number().int().nonnegative(),
  createdOn: isoDateSchema,
  submittedOn: isoDateSchema.optional(),
  status: poolStatusSchema,
  apexReview: z
    .object({
      officerId: idSchema,
      on: isoDateSchema,
      decision: z.enum(['SANCTIONED', 'DECLINED']),
      remarks: z.string(),
    })
    .optional(),
  /** How the secretary fitted the pool to a sanction below its request. */
  rescope: z
    .object({
      on: isoDateSchema,
      by: idSchema,
      method: z.enum(['PRO_RATA', 'REMOVE']),
      removed: z.array(idSchema),
      /** What the members it kept asked for, before any cut. */
      askedBefore: paiseSchema.nonnegative(),
    })
    .optional(),
});
export type Pool = z.infer<typeof poolSchema>;
