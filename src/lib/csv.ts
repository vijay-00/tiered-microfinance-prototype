import type { Paise } from '@/domain/types';

/**
 * CSV for spreadsheets: RFC 4180 quoting, CRLF line ends, and amounts as plain
 * rupees with two decimals so a spreadsheet reads them as numbers.
 */

export type Cell = string | number | undefined;

function quote(cell: Cell): string {
  if (cell === undefined) return '';
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly Cell[]>): string {
  return [header, ...rows].map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** 123456 paise as "1234.56". */
export function rupeesCell(amount: Paise): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function downloadCsv(filename: string, csv: string): void {
  // A byte-order mark so Excel reads the rupee sign and Indian names as UTF-8.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
