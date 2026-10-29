import type { ISODate } from './types';

/**
 * Date arithmetic on 'YYYY-MM-DD' strings, done on the string's own components.
 *
 * The domain layer deliberately uses no date library and never constructs a
 * local-time Date. A local-time getter such as getDate() returns the previous
 * day west of Greenwich, which would make due dates, overdue counts and
 * therefore penal interest depend on where the demo is being run. date-fns is
 * a UI dependency; it has no business in here.
 */

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function parseISODate(date: ISODate): DateParts {
  const match = ISO_PATTERN.exec(date);
  if (!match) throw new DateError(`expected a date as YYYY-MM-DD, got ${JSON.stringify(date)}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) throw new DateError(`month out of range in ${date}`);
  if (day < 1 || day > daysInMonth(year, month)) throw new DateError(`day out of range in ${date}`);
  return { year, month, day };
}

export function isValidISODate(date: string): boolean {
  try {
    parseISODate(date);
    return true;
  } catch {
    return false;
  }
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new DateError(`month out of range: ${month}`);
  }
}

function toISO(parts: DateParts): ISODate {
  const yyyy = String(parts.year).padStart(4, '0');
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Adds whole months, clamping the day to the end of the target month so that
 * 31 January plus one month is 28 (or 29) February, and the instalment after
 * that falls on 31 March rather than drifting to the 28th for good. Clamping
 * from the original day, not from the clamped one, is what prevents the drift.
 */
export function addMonthsISO(date: ISODate, months: number): ISODate {
  if (!Number.isInteger(months)) throw new DateError(`months must be a whole number, got ${months}`);
  const { year, month, day } = parseISODate(date);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = zeroBased - targetYear * 12 + 1; // proper modulo, safe for negatives
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return toISO({ year: targetYear, month: targetMonth, day: clampedDay });
}

// Day numbers counted from 1970-01-01, by Howard Hinnant's civil-calendar
// algorithms. Pure integer arithmetic: no Date object is ever constructed in
// the domain layer, which a test enforces.

function daysFromCivil({ year, month, day }: DateParts): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(dayNumber: number): DateParts {
  const z = dayNumber + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function addDaysISO(date: ISODate, days: number): ISODate {
  if (!Number.isInteger(days)) throw new DateError(`days must be a whole number, got ${days}`);
  return toISO(civilFromDays(daysFromCivil(parseISODate(date)) + days));
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: ISODate, to: ISODate): number {
  return daysFromCivil(parseISODate(to)) - daysFromCivil(parseISODate(from));
}

export function compareISO(a: ISODate, b: ISODate): number {
  // Zero-padded ISO dates sort correctly as strings, but both sides are parsed
  // first so that a malformed date fails loudly instead of sorting oddly.
  parseISODate(a);
  parseISODate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The Indian financial year a date falls in, April to March: '2026-27'. */
export function financialYear(date: ISODate): string {
  const { year, month } = parseISODate(date);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The first day of the financial year a date falls in: 1 April. */
export function financialYearStart(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  return toISO({ year: month >= 4 ? year : year - 1, month: 4, day: 1 });
}

export function startOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  return toISO({ year, month, day: 1 });
}

export function endOfMonth(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  return toISO({ year, month, day: daysInMonth(year, month) });
}

/** The quarter of the financial year: April to June is the first. */
export function startOfFinancialQuarter(date: ISODate): ISODate {
  const { year, month } = parseISODate(date);
  const first = month - ((month - 4 + 12) % 3);
  return toISO({ year, month: first, day: 1 });
}

export function minISO(a: ISODate, b: ISODate): ISODate {
  return compareISO(a, b) <= 0 ? a : b;
}

export const isOnOrBefore = (a: ISODate, b: ISODate): boolean => compareISO(a, b) <= 0;
export const isAfter = (a: ISODate, b: ISODate): boolean => compareISO(a, b) > 0;

export function maxISO(a: ISODate, b: ISODate): ISODate {
  return compareISO(a, b) >= 0 ? a : b;
}
