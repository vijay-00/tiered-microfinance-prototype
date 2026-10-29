import { parseISODate } from '@/domain/dates';
import type { ISODate } from '@/domain/types';

/**
 * Display formatting for dates. A 'YYYY-MM-DD' is formatted as a UTC calendar
 * date so it reads the same day wherever the demo is run.
 */

const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
const short = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function toUtc(date: ISODate): Date {
  const { year, month, day } = parseISODate(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Thu, 29 Oct 2026. Composed from parts because the en-IN long form puts a
 * comma before the year ("Thu, 29 Oct, 2026") that the short form does not.
 */
export function formatDateLong(date: ISODate): string {
  const utc = toUtc(date);
  return `${weekday.format(utc)}, ${short.format(utc)}`;
}

/** 29 Oct 2026 */
export function formatDate(date: ISODate): string {
  return short.format(toUtc(date));
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
