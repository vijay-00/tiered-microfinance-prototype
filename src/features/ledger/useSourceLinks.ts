import { useMemo } from 'react';
import type { ID, JournalEntry } from '@/domain/types';
import { useAppStore } from '@/store/context';

export interface SourceLink {
  readonly to: string;
  readonly label: string;
}

/**
 * Where a journal entry came from, as a link: the loan a disbursement or
 * receipt belongs to, the tranche a drawdown or remittance was made on.
 */
export function useSourceLinks(): (entry: Pick<JournalEntry, 'sourceType' | 'sourceId'>) => SourceLink | undefined {
  const loans = useAppStore((s) => s.world.loans);
  const tranches = useAppStore((s) => s.world.tranches);
  return useMemo(() => {
    const loanOfReceipt = new Map<ID, ID>();
    for (const entry of Object.values(loans)) for (const r of entry.receipts) loanOfReceipt.set(r.id, entry.loan.id);
    const trancheOfRemittance = new Map<ID, ID>();
    for (const entry of Object.values(tranches)) {
      for (const r of entry.remittances) trancheOfRemittance.set(r.id, entry.tranche.id);
    }
    const tranche = (id: ID | undefined): SourceLink | undefined =>
      id && tranches[id] ? { to: `/tranches/${id}`, label: tranches[id]!.tranche.sanctionRef } : undefined;
    return (entry) => {
      switch (entry.sourceType) {
        case 'DISBURSEMENT':
          return { to: `/loans/${entry.sourceId}`, label: entry.sourceId };
        case 'PAYMENT': {
          const loanId = loanOfReceipt.get(entry.sourceId);
          return loanId ? { to: `/loans/${loanId}`, label: loanId } : undefined;
        }
        case 'DRAWDOWN':
          return tranche(entry.sourceId);
        case 'REMITTANCE':
          return tranche(trancheOfRemittance.get(entry.sourceId));
        default:
          return undefined;
      }
    };
  }, [loans, tranches]);
}

export const SOURCE_LABEL: Record<JournalEntry['sourceType'], string> = {
  OPENING: 'Opening',
  PAYMENT: 'Receipt',
  REMITTANCE: 'Remittance',
  DISBURSEMENT: 'Disbursement',
  DRAWDOWN: 'Drawdown',
  ACCRUAL: 'Accrual',
  WRITE_OFF: 'Write-off',
  CLOSE: 'Period close',
};
