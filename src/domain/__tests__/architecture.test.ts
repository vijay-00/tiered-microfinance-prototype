import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addMonthsISO, daysBetween, isValidISODate } from '../dates';
import { formatBps, formatPaise, parseRupees, roundHalfUp, rupees } from '../money';

/**
 * The two rules the TDD marks as not open for change, enforced mechanically
 * instead of by good intentions: the domain layer is pure, and it never reads
 * the wall clock or a random source.
 */

const domainDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = readdirSync(domainDir)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file, text: readFileSync(join(domainDir, file), 'utf8') }));

describe('the domain layer', () => {
  it('has source files to check', () => {
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining(['money.ts', 'interest.ts', 'reconciliation.ts', 'ledger.ts']),
    );
  });

  it('never reads the wall clock, a random source, or the browser', () => {
    const forbidden = [
      /new Date\s*\(/,
      /Date\.now\s*\(/,
      /Math\.random\s*\(/,
      /\bwindow\.[A-Za-z]/,
      /\bdocument\.[A-Za-z]/,
      /\blocalStorage\b/,
    ];
    for (const { file, text } of sources) {
      for (const pattern of forbidden) {
        expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('imports nothing but its own modules and zod: no React, store or mock data', () => {
    for (const { file, text } of sources) {
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(
          specifier.startsWith('./') || specifier === 'zod',
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });
});

describe('dates', () => {
  it('clamps month-end from the original day, so it does not drift to the 28th', () => {
    expect(addMonthsISO('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsISO('2027-01-31', 2)).toBe('2027-03-31');
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsISO('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('knows the Gregorian leap-year rules', () => {
    expect(daysBetween('2000-02-28', '2000-03-01')).toBe(2);
    expect(daysBetween('1900-02-28', '1900-03-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('26-01-01')).toBe(false);
    expect(isValidISODate('2026-02-28')).toBe(true);
  });
});

describe('money', () => {
  it('rounds half away from zero, so a credit and its reversal agree', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4999)).toBe(2);
  });

  it('converts two-decimal rupee literals to paise without float drift', () => {
    expect(rupees(0.1 + 0.2)).toBe(30);
    expect(rupees(8861.51)).toBe(886_151);
    expect(rupees(100_000)).toBe(10_000_000);
  });

  it('parses typed amounts exactly, never through a float', () => {
    expect(parseRupees('1,00,000')).toBe(10_000_000);
    expect(parseRupees('8861.5')).toBe(886_150);
    expect(parseRupees('8861.50')).toBe(886_150);
    expect(parseRupees('0.1')).toBe(10);
    expect(parseRupees('Rs 500')).toBe(50_000);
    expect(parseRupees('₹ 1,234.56')).toBe(123_456);
  });

  it('refuses what is not money, including a third decimal place', () => {
    expect(parseRupees('8861.505')).toBeUndefined();
    expect(parseRupees('')).toBeUndefined();
    expect(parseRupees('abc')).toBeUndefined();
    expect(parseRupees('1.2.3')).toBeUndefined();
  });

  it('formats with Indian digit grouping', () => {
    expect(formatPaise(10_633_775)).toBe('₹1,06,337.75');
    expect(formatBps(950)).toBe('9.5%');
    expect(formatBps(1150)).toBe('11.5%');
    expect(formatBps(200)).toBe('2%');
  });
});
