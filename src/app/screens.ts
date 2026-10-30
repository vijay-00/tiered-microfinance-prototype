import type { Tier } from './roles';

/**
 * Every screen in the TDD's inventory, with the phase that builds it. Routes
 * exist for all of them from Phase 2, so the shape of the app is visible from
 * the first click and each later phase fills a page in rather than adding one.
 */

export interface Screen {
  path: string;
  tier: Tier;
  title: string;
  summary: string;
  phase: 2 | 3 | 4 | 5 | 6;
}

export const PHASE_NAMES: Record<Screen['phase'], string> = {
  2: 'Shell and state',
  3: 'Servicing',
  4: 'Origination',
  5: 'Ledger and reporting',
  6: 'Scenarios and polish',
};

export const SCREENS: readonly Screen[] = [
  // Society
  { path: '/dashboard', tier: 'society', phase: 2, title: 'Dashboard', summary: 'Portfolio outstanding, net interest income, what is due, what is overdue, and the next remittance.' },
  { path: '/members', tier: 'society', phase: 4, title: 'Member register', summary: 'Searchable list of members with current exposure per member.' },
  { path: '/members/:memberId', tier: 'society', phase: 4, title: 'Member profile', summary: 'Loans, repayment track record, total exposure and share capital.' },
  { path: '/applications', tier: 'society', phase: 4, title: 'Application queue', summary: 'Applications tabbed by state, appraised and decided by the secretary.' },
  { path: '/applications/new', tier: 'society', phase: 4, title: 'New application', summary: 'Member, amount, tenure and purpose, with the EMI the member would pay shown as you type.' },
  { path: '/applications/:applicationId', tier: 'society', phase: 4, title: 'Appraisal and decision', summary: 'Income and obligations, the recommended amount, and approval or rejection.' },
  { path: '/pools', tier: 'society', phase: 4, title: 'Batches', summary: 'Every batch with its status, member count, requested amount and apex decision.' },
  { path: '/pools/new', tier: 'society', phase: 4, title: 'Batch builder', summary: 'Approved applications on one side, the batch on the other, with its wholesale cost, retail income and margin updating live.' },
  { path: '/pools/:poolId', tier: 'society', phase: 4, title: 'Batch detail', summary: 'Constituent applications, the submission trail and the sanction terms.' },
  { path: '/tranches', tier: 'society', phase: 3, title: 'Funding facilities', summary: 'Sanctioned, drawn and outstanding on each tranche, and the next remittance.' },
  { path: '/tranches/:trancheId', tier: 'society', phase: 3, title: 'Tranche detail', summary: 'Drawdowns, the remittance schedule, the remit action and interest accrued.' },
  { path: '/collections', tier: 'society', phase: 3, title: 'Collections desk', summary: 'What is due today and overdue, with the record-payment drawer and its live split preview.' },
  { path: '/loans/:loanId', tier: 'society', phase: 3, title: 'Loan detail', summary: 'The amortisation schedule, every payment, and the split applied to each receipt.' },
  { path: '/ledger', tier: 'society', phase: 5, title: 'General ledger', summary: 'Journal list, T-account view and trial balance.' },
  { path: '/ledger/statements', tier: 'society', phase: 5, title: 'Statements', summary: 'Income statement and balance sheet, for a period you choose.' },
  { path: '/reports', tier: 'society', phase: 5, title: 'Reports', summary: 'Margin analysis, ageing, batch performance and collection efficiency.' },
  { path: '/settings', tier: 'society', phase: 6, title: 'Settings', summary: 'Policy values, the reconciliation policy, scenarios and resetting the demo.' },
  // Apex federation
  { path: '/apex', tier: 'apex', phase: 2, title: 'Exposure', summary: 'Exposure by society, against each credit limit, and what awaits review.' },
  { path: '/apex/requests', tier: 'apex', phase: 4, title: 'Funding requests', summary: 'Batches submitted by societies, awaiting a decision.' },
  { path: '/apex/requests/:poolId', tier: 'apex', phase: 4, title: 'Review and sanction', summary: 'Batch composition, the society track record, the terms editor, and sanction or decline.' },
  { path: '/apex/societies', tier: 'apex', phase: 4, title: 'Societies', summary: 'Credit limit, utilisation and repayment record for each society.' },
  { path: '/apex/societies/:societyId', tier: 'apex', phase: 4, title: 'Society detail', summary: 'Tranche history, remittance punctuality and current exposure.' },
  // Member
  { path: '/me', tier: 'member', phase: 2, title: 'My loans', summary: 'What you owe, what you have paid, and your next instalment.' },
  { path: '/me/apply', tier: 'member', phase: 6, title: 'Apply for a loan', summary: 'The member applies for themselves and sees the instalment as they type; the application joins the society queue.' },
  { path: '/me/loans/:loanId', tier: 'member', phase: 3, title: 'Loan detail', summary: 'Your schedule, what has been paid and what is due.' },
];
