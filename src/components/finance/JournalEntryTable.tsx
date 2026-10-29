import { accountFor } from '@/domain/ledger';
import type { JournalEntry } from '@/domain/types';
import { MoneyText } from './MoneyText';

/** One journal entry as debits and credits, account names included. */
export function JournalEntryTable({ entry }: { entry: JournalEntry }) {
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Journal entry {entry.id}</caption>
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="py-1 text-left font-medium">Account</th>
          <th scope="col" className="py-1 text-right font-medium">Debit</th>
          <th scope="col" className="py-1 text-right font-medium">Credit</th>
        </tr>
      </thead>
      <tbody>
        {entry.lines.map((line, i) => {
          const account = accountFor(line.accountCode);
          return (
            <tr key={i} className="border-t">
              <td className={line.cr > 0 ? 'py-1 pl-4' : 'py-1'}>
                <span className="text-muted-foreground tabular-nums">{account.code}</span> {account.name}
              </td>
              <td className="py-1 text-right">{line.dr > 0 ? <MoneyText paise={line.dr} /> : null}</td>
              <td className="py-1 text-right">{line.cr > 0 ? <MoneyText paise={line.cr} /> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
