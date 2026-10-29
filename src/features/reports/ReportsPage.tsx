import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';
import { AgeingPanel } from './AgeingPanel';
import { CollectionsPanel } from './CollectionsPanel';
import { MarginPanel } from './MarginPanel';
import { PoolsPanel } from './PoolsPanel';

type Tab = 'margin' | 'ageing' | 'collections' | 'pools';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'margin', label: 'Margin' },
  { id: 'ageing', label: 'Ageing' },
  { id: 'collections', label: 'Collection efficiency' },
  { id: 'pools', label: 'Pool performance' },
];

export function ReportsPage() {
  const user = useAppStore(selectCurrentUser);
  const society = useAppStore((s) => s.world.societies.find((x) => x.id === user.societyId));
  const clock = useAppStore((s) => s.world.clock);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : 'margin';
  const societyId = user.societyId!;
  const filePrefix = `${society?.code ?? societyId}-${clock}`;

  return (
    <>
      <PageHeader title="Reports" description={`${society?.name} · as of the demo date. Each figure opens the loans or journal lines behind it.`} />
      <Tabs value={tab} onValueChange={(next) => setParams(next === 'margin' ? {} : { tab: next }, { replace: true })}>
        <TabsList aria-label="Reports">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="margin">{tab === 'margin' ? <MarginPanel societyId={societyId} filePrefix={filePrefix} /> : null}</TabsContent>
        <TabsContent value="ageing">{tab === 'ageing' ? <AgeingPanel societyId={societyId} filePrefix={filePrefix} /> : null}</TabsContent>
        <TabsContent value="collections">
          {tab === 'collections' ? <CollectionsPanel societyId={societyId} filePrefix={filePrefix} /> : null}
        </TabsContent>
        <TabsContent value="pools">{tab === 'pools' ? <PoolsPanel societyId={societyId} filePrefix={filePrefix} /> : null}</TabsContent>
      </Tabs>
    </>
  );
}
