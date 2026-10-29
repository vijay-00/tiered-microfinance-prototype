import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadCsv } from '@/lib/csv';

/** Builds the file only when clicked, from what the screen is showing. */
export function CsvButton({ filename, build, label = 'CSV' }: { filename: string; build: () => string; label?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => downloadCsv(filename, build())} aria-label={`Download ${filename}`}>
      <Download aria-hidden />
      {label}
    </Button>
  );
}
