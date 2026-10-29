import { addMonthsISO } from './dates';
import { assertPaise, mulRate, roundHalfUp, sum, toWholeRupees } from './money';
import type { Bps, ID, ISODate, Paise, ScheduleRow } from './types';

/**
 * Reducing-balance interest, compounded monthly, on a 30/360 basis: the
 * monthly rate is the annual rate divided by twelve. Flat-rate interest is not
 * supported, because it would make the society's spread a constant and hide
 * the reconciliation this whole prototype exists to demonstrate.
 *
 * Every function here is pure and fully determined by its arguments. Nothing
 * reads a clock or a store.
 */

export class InterestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterestError';
  }
}

export const MONTHS_PER_YEAR = 12;

/** The monthly rate as a float. Used only inside the annuity formula. */
export function monthlyRate(annualBps: Bps): number {
  return annualBps / (10_000 * MONTHS_PER_YEAR);
}

/** The exact annuity payment in fractional paise, before any rounding. */
function annuityPayment(principal: Paise, annualBps: Bps, tenureMonths: number): number {
  assertPaise(principal, 'principal');
  if (principal <= 0) throw new InterestError(`principal must be positive, got ${principal}`);
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new InterestError(`tenureMonths must be a positive whole number, got ${tenureMonths}`);
  }
  if (annualBps < 0) throw new InterestError(`rate must not be negative, got ${annualBps}`);

  const r = monthlyRate(annualBps);
  if (r === 0) return principal / tenureMonths;

  const factor = Math.pow(1 + r, tenureMonths);
  const raw = (principal * r * factor) / (factor - 1);
  if (!Number.isFinite(raw)) throw new InterestError('instalment calculation did not converge');
  return raw;
}

/**
 * The standard annuity payment, rounded to the nearest whole rupee so the
 * instalment is a presentable figure.
 *
 *   EMI = P . r (1 + r)^n / ((1 + r)^n - 1)
 *
 * Rounding to a rupee means the schedule does not amortise exactly, which is
 * what the final-instalment plug in generateSchedule is for.
 */
export function emi(principal: Paise, annualBps: Bps, tenureMonths: number): Paise {
  return toWholeRupees(annuityPayment(principal, annualBps, tenureMonths));
}

/** The annuity payment rounded only to the paise. */
export function exactEmi(principal: Paise, annualBps: Bps, tenureMonths: number): Paise {
  return roundHalfUp(annuityPayment(principal, annualBps, tenureMonths));
}

export interface ScheduleInput {
  loanId: ID;
  principal: Paise;
  annualBps: Bps;
  tenureMonths: number;
  firstDueOn: ISODate;
}

/**
 * Builds the full amortisation schedule.
 *
 * For every period except the last, the instalment is the EMI and the
 * principal component is whatever the EMI leaves after interest. The last
 * period is a plug: its principal is the entire remaining balance and its
 * instalment is recomputed, so the schedule closes at exactly zero rather than
 * a few rupees either side of it.
 *
 * On a very small loan over a long tenure, rounding the EMI up to a whole
 * rupee overpays enough to retire the loan early, leaving trailing instalments
 * of zero. A Rs 1,000 loan over 53 months at 10.17% has an exact EMI of
 * Rs 23.50; at Rs 24 it is paid off before month 53. Those loans fall back to
 * the EMI rounded only to the paise. Nothing above the Rs 5,000 minimum ticket
 * comes close, and the reference fixture is unaffected.
 */
export function generateSchedule(input: ScheduleInput): readonly ScheduleRow[] {
  const rounded = buildRows(input, emi(input.principal, input.annualBps, input.tenureMonths));
  const retiresEarly = rounded.slice(0, -1).some((row) => row.closing === 0);
  const rows = retiresEarly
    ? buildRows(input, exactEmi(input.principal, input.annualBps, input.tenureMonths))
    : rounded;

  const last = rows[rows.length - 1];
  if (!last || last.closing !== 0) {
    throw new InterestError(`schedule did not close at zero, left ${last?.closing ?? 'nothing'}`);
  }
  return Object.freeze(rows);
}

function buildRows(input: ScheduleInput, instalmentBase: Paise): ScheduleRow[] {
  const { loanId, principal, annualBps, tenureMonths, firstDueOn } = input;
  const rows: ScheduleRow[] = [];
  let opening: Paise = principal;

  for (let period = 1; period <= tenureMonths; period += 1) {
    const isLast = period === tenureMonths;
    const interest = mulRate(opening, annualBps, MONTHS_PER_YEAR);

    let principalPart: Paise;
    let instalment: Paise;

    if (isLast) {
      principalPart = opening;
      instalment = opening + interest;
    } else {
      principalPart = instalmentBase - interest;
      if (principalPart < 0) {
        // Only reachable if the rounded EMI does not cover one period's
        // interest, which would mean the balance grows instead of amortising.
        throw new InterestError(
          `instalment ${instalmentBase} does not cover interest ${interest} in period ${period}`,
        );
      }
      // Near the end of a schedule the EMI can exceed what is left owing.
      if (principalPart > opening) principalPart = opening;
      instalment = principalPart + interest;
    }

    const closing = opening - principalPart;

    rows.push(
      Object.freeze({
        loanId,
        period,
        dueOn: addMonthsISO(firstDueOn, period - 1),
        opening,
        instalment,
        interest,
        principal: principalPart,
        closing,
      }),
    );

    opening = closing;
  }
  return rows;
}

/**
 * Re-amortises a balance at a fixed instalment until it is repaid. This is how
 * the rest of a loan is rescheduled after a part-prepayment: the member keeps
 * the EMI they are used to and the tenure shortens, or at worst stays put.
 *
 * The last row is a plug. It is normally no larger than the EMI, but when the
 * EMI was rounded down the original schedule ended on a plug above it, and a
 * tiny prepayment can leave a balance that would need one more period at the
 * EMI. `maxPeriods` forbids that: a prepayment must never lengthen a loan, so
 * the final permitted row takes whatever is left, as the original plug did.
 * Found by the property tests: one paisa prepaid on a Rs 1,000.03 loan.
 *
 * Due dates come from the loan's original first due date and the period
 * number, never from the previous row, so a month-end loan stays on month-ends.
 */
export function amortiseAtInstalment(input: {
  loanId: ID;
  principal: Paise;
  annualBps: Bps;
  instalment: Paise;
  /** The loan's original first due date. */
  anchorDueOn: ISODate;
  firstPeriod: number;
  /** The periods the loan had left; the reschedule may not exceed them. */
  maxPeriods?: number;
}): ScheduleRow[] {
  const { loanId, principal, annualBps, instalment, anchorDueOn, firstPeriod, maxPeriods } = input;
  assertPaise(principal, 'principal');
  assertPaise(instalment, 'instalment');
  if (principal <= 0) throw new InterestError(`principal must be positive, got ${principal}`);
  if (maxPeriods !== undefined && (!Number.isInteger(maxPeriods) || maxPeriods <= 0)) {
    throw new InterestError(`maxPeriods must be a positive whole number, got ${maxPeriods}`);
  }

  const rows: ScheduleRow[] = [];
  let opening = principal;
  let period = firstPeriod;
  while (opening > 0) {
    const interest = mulRate(opening, annualBps, MONTHS_PER_YEAR);
    const lastPermitted = maxPeriods !== undefined && rows.length === maxPeriods - 1;
    const isLast = lastPermitted || opening + interest <= instalment;
    const principalPart = isLast ? opening : instalment - interest;
    if (principalPart <= 0) {
      throw new InterestError(
        `instalment ${instalment} does not cover interest ${interest} in period ${period}`,
      );
    }
    rows.push(
      Object.freeze({
        loanId,
        period,
        dueOn: addMonthsISO(anchorDueOn, period - 1),
        opening,
        instalment: principalPart + interest,
        interest,
        principal: principalPart,
        closing: opening - principalPart,
      }),
    );
    opening -= principalPart;
    period += 1;
    if (rows.length > 1_200) throw new InterestError('rescheduling did not converge');
  }
  return rows;
}

export interface ScheduleTotals {
  interest: Paise;
  principal: Paise;
  collected: Paise;
}

export function scheduleTotals(schedule: readonly ScheduleRow[]): ScheduleTotals {
  return {
    interest: sum(schedule.map((row) => row.interest)),
    principal: sum(schedule.map((row) => row.principal)),
    collected: sum(schedule.map((row) => row.instalment)),
  };
}

/** The balance still owing after a given period. Period 0 is the full principal. */
export function outstandingAfter(schedule: readonly ScheduleRow[], period: number): Paise {
  if (period <= 0) return schedule[0]?.opening ?? 0;
  const row = schedule[period - 1];
  if (!row) throw new InterestError(`period ${period} is not in this schedule`);
  return row.closing;
}

/** The rows that have fallen due on or before a date. */
export function rowsDueBy(
  schedule: readonly ScheduleRow[],
  asOf: ISODate,
): readonly ScheduleRow[] {
  return schedule.filter((row) => row.dueOn <= asOf);
}

/**
 * The wholesale schedule the federation would charge if the tranche carried
 * its own annuity rather than a principal pass-through. Kept so the
 * INDEPENDENT_AMORTISATION policy and the principal timing gap it creates can
 * be demonstrated side by side with the default.
 */
export function independentWholesaleSchedule(input: {
  trancheId: ID;
  principal: Paise;
  wholesaleBps: Bps;
  tenureMonths: number;
  firstDueOn: ISODate;
}): readonly ScheduleRow[] {
  return generateSchedule({
    loanId: input.trancheId,
    principal: input.principal,
    annualBps: input.wholesaleBps,
    tenureMonths: input.tenureMonths,
    firstDueOn: input.firstDueOn,
  });
}
