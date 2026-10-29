import { describe, expect, it } from 'vitest';
import type { LedgerQuery } from '@/domain/reporting';
import { rupeesCell, toCsv } from '../csv';
import { readTrace, traceHref } from '../ledgerLinks';

describe('CSV', () => {
  it('quotes only what needs quoting, and ends every line with CRLF', () => {
    expect(toCsv(['a', 'b'], [['plain', 'with, comma'], ['say "hi"', undefined], [1, 'line\nbreak']])).toBe(
      'a,b\r\nplain,"with, comma"\r\n"say ""hi""",\r\n1,"line\nbreak"\r\n',
    );
  });

  it('writes amounts as plain rupees a spreadsheet reads as numbers', () => {
    expect(rupeesCell(123_456)).toBe('1234.56');
    expect(rupeesCell(5)).toBe('0.05');
    expect(rupeesCell(-100)).toBe('-1.00');
    expect(rupeesCell(0)).toBe('0.00');
  });
});

describe('ledger links', () => {
  it('round-trips a query through its address', () => {
    const query: LedgerQuery = { plus: [4000, 4100], minus: [5000], from: '2026-10-01', to: '2026-10-29', source: 'PAYMENT', loanId: 'loan_001' };
    const href = traceHref(query);
    expect(href).toBe('/ledger?accounts=4000,4100,-5000&from=2026-10-01&to=2026-10-29&source=PAYMENT&loan=loan_001');
    expect(readTrace(new URLSearchParams(href.split('?')[1]))).toEqual(query);
  });

  it('ignores accounts, dates and sources it does not recognise', () => {
    expect(readTrace(new URLSearchParams('accounts=9999,abc,1100&from=yesterday&source=BRIBE'))).toEqual({
      plus: [1100],
      minus: [],
      from: undefined,
      to: undefined,
      source: undefined,
      loanId: undefined,
    });
  });
});
