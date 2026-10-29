import type { Bps, Paise } from './types';

/**
 * Paise arithmetic. Nothing outside this module does money arithmetic inline.
 *
 * Every amount is an integer count of paise. Rates are basis points, so rate
 * arithmetic also stays integer until the final division, and each rounding
 * happens once, at the point an amount is recorded.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Paise in one rupee. */
export const RUPEE: Paise = 100;

/** Basis points in 100%. */
export const BPS_SCALE = 10_000;

export function assertPaise(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      `${label} must be an integer count of paise within the safe range, got ${value}`,
    );
  }
}

export function assertNonNegative(value: Paise, label = 'amount'): void {
  assertPaise(value, label);
  if (value < 0) throw new MoneyError(`${label} must not be negative, got ${value}`);
}

/**
 * Half away from zero. Math.round on its own rounds -2.5 up to -2, which would
 * make a credit and the debit reversing it differ by a paise.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new MoneyError(`cannot round ${value}`);
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  if (!Number.isSafeInteger(rounded)) {
    throw new MoneyError(`rounding ${value} leaves the safe integer range`);
  }
  return rounded;
}

/**
 * Rupees to paise, for literals in code and seed data such as rupees(50_000).
 * Safe for amounts with at most two decimals. A third decimal is not money,
 * and a value like 8861.505 has no exact float form anyway; user input goes
 * through parseRupees, which never touches a float.
 */
export function rupees(amount: number): Paise {
  return roundHalfUp(amount * RUPEE);
}

const RUPEE_TEXT = /^\s*(-)?(?:₹|Rs\.?)?\s*([0-9][0-9,]*)(?:\.([0-9]{1,2}))?\s*$/;

/**
 * Parses what a person types into a money field: '1,00,000', '8861.5',
 * 'Rs 500', '₹ 1,234.56'. Exact decimal parsing, no float in between.
 * Returns undefined for anything that is not a valid amount of money,
 * including a third decimal place, so the form can say so.
 */
export function parseRupees(text: string): Paise | undefined {
  const match = RUPEE_TEXT.exec(text);
  if (!match) return undefined;
  const [, minus, whole = '', fraction = ''] = match;
  const digits = whole.replace(/,/g, '');
  if (digits.length === 0) return undefined;
  const paise = Number(digits) * RUPEE + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) return undefined;
  return minus ? -paise : paise;
}

/** Paise to rupees, for formatting and for test assertions only. */
export function toRupees(amount: Paise): number {
  assertPaise(amount);
  return amount / RUPEE;
}

/** Rounds to the nearest whole rupee. Instalments are quoted in whole rupees. */
export function toWholeRupees(amount: number): Paise {
  return roundHalfUp(amount / RUPEE) * RUPEE;
}

export function sum(amounts: readonly Paise[]): Paise {
  let total = 0;
  for (const amount of amounts) {
    assertPaise(amount);
    total += amount;
  }
  assertPaise(total, 'total');
  return total;
}

export function maxPaise(a: Paise, b: Paise): Paise {
  assertPaise(a);
  assertPaise(b);
  return a > b ? a : b;
}

export function minPaise(a: Paise, b: Paise): Paise {
  assertPaise(a);
  assertPaise(b);
  return a < b ? a : b;
}

/** Subtraction that never goes below zero. The waterfall leans on this. */
export function subToZero(from: Paise, amount: Paise): Paise {
  assertPaise(from);
  assertPaise(amount);
  return maxPaise(0, from - amount);
}

/**
 * Interest for one period: amount x annual rate / periods per year.
 * With monthly periods this is the 30/360 convention the TDD settles on.
 */
export function mulRate(amount: Paise, annualBps: Bps, periodsPerYear: number): Paise {
  assertPaise(amount);
  if (!Number.isInteger(periodsPerYear) || periodsPerYear <= 0) {
    throw new MoneyError(`periodsPerYear must be a positive whole number, got ${periodsPerYear}`);
  }
  if (annualBps < 0) throw new MoneyError(`rate must not be negative, got ${annualBps}`);
  const product = amount * annualBps;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError('rate calculation leaves the safe integer range');
  }
  return roundHalfUp(product / (BPS_SCALE * periodsPerYear));
}

/**
 * Interest accrued over a number of days, used for penal interest on overdue
 * amounts. Actual/365 rather than the 30/360 used for scheduled interest,
 * because a penalty is counted in days late.
 */
export function mulRateDays(
  amount: Paise,
  annualBps: Bps,
  days: number,
  dayCount = 365,
): Paise {
  assertPaise(amount);
  if (!Number.isInteger(days) || days < 0) {
    throw new MoneyError(`days must be a non-negative whole number, got ${days}`);
  }
  if (annualBps < 0) throw new MoneyError(`rate must not be negative, got ${annualBps}`);
  const product = amount * annualBps * days;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError('penal calculation leaves the safe integer range');
  }
  return roundHalfUp(product / (BPS_SCALE * dayCount));
}

/**
 * Splits an amount across weights so the parts sum to the amount exactly,
 * using largest remainder. Without this, apportioning a tranche across twelve
 * member loans loses a few paise and the trial balance stops balancing.
 */
export function allocate(amount: Paise, weights: readonly number[]): Paise[] {
  assertNonNegative(amount);
  if (weights.length === 0) throw new MoneyError('allocate needs at least one weight');
  let totalWeight = 0;
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new MoneyError(`weights must be non-negative and finite, got ${weight}`);
    }
    totalWeight += weight;
  }
  if (totalWeight <= 0) throw new MoneyError('allocate needs at least one positive weight');

  const exact = weights.map((weight) => (amount * weight) / totalWeight);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = amount - parts.reduce((a, b) => a + b, 0);

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of byFraction) {
    if (remainder <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    remainder -= 1;
  }
  return parts;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plainFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Rs 1,00,000.00 — Indian digit grouping, with the currency symbol. */
export function formatPaise(amount: Paise): string {
  assertPaise(amount);
  return inrFormatter.format(amount / RUPEE);
}

/** 1,00,000.00 — for table columns that carry the symbol in the header. */
export function formatPaisePlain(amount: Paise): string {
  assertPaise(amount);
  return plainFormatter.format(amount / RUPEE);
}

/** 9.5% from 950 basis points. */
export function formatBps(bps: Bps): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}
