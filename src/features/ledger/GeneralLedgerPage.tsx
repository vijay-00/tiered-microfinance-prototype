import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { JournalPanel } from './JournalPanel';
import { TAccountPanel } from './TAccountPanel';
import { TrialBalancePanel } from './TrialBalancePanel';

type View = 'journal' | 'accounts' | 'trial';
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'journal', label: 'Journal' },
  { id: 'accounts', label: 'T-accounts' },
  { id: 'trial', label: 'Trial balance' },
];

export function GeneralLedgerPage() {
  const user = useAppStore(selectCurrentUser);
  const society = useAppStore((s) => s.world.societies.find((x) => x.id === user.societyId));
  const clock = useAppStore((s) => s.world.clock);
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view: View = raw === 'accounts' || raw === 'trial' ? raw : 'journal';
  const societyId = user.societyId!;
  const filePrefix = `${society?.code ?? societyId}-${clock}`;

  return (
    <>
      <PageHeader
        title="General ledger"
        description={
          <>
            Every posting the society has made, double entry, folded into balances on demand.{' '}
            <Link to="/ledger/statements" className="text-primary underline">
              Statements
            </Link>
          </>
        }
      />
      <Tabs
        value={view}
        onValueChange={(next) => {
          // Dates carry across views; account filters belong to the view that set them.
          const kept = new URLSearchParams();
          for (const k of ['from', 'to']) {
            const v = params.get(k);
            if (v) kept.set(k, v);
          }
          if (next !== 'journal') kept.set('view', next);
          if (next === 'accounts') {
            const first = params.get('account') ?? params.get('accounts')?.split(',')[0]?.replace('-', '');
            if (first) kept.set('account', first);
          }
          setParams(kept, { replace: true });
        }}
      >
        <TabsList aria-label="Ledger views">
          {VIEWS.map((v) => (
            <TabsTrigger key={v.id} value={v.id}>
              {v.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="journal">
          {view === 'journal' ? <JournalPanel societyId={societyId} filePrefix={filePrefix} /> : null}
        </TabsContent>
        <TabsContent value="accounts">
          {view === 'accounts' ? <TAccountPanel societyId={societyId} filePrefix={filePrefix} /> : null}
        </TabsContent>
        <TabsContent value="trial">
          {view === 'trial' ? <TrialBalancePanel societyId={societyId} filePrefix={filePrefix} /> : null}
        </TabsContent>
      </Tabs>
    </>
  );
}
