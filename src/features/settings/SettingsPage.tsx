import { RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { SCENARIOS, type ScenarioId } from '@/data/scenarios';
import { formatBps, formatPaise } from '@/domain/money';
import { REPAYMENT_CAP_SHARE } from '@/domain/origination';
import { MAX_TENURE_MONTHS, MIN_TENURE_MONTHS } from '@/domain/world';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/format';
import { percent } from '@/lib/labels';
import { useAppStore } from '@/store/context';
import { WalkthroughList } from '@/features/demo/Walkthrough';

/**
 * The rules the prototype runs on, and the demo's own controls. Policy is
 * shown, not edited: changing a rate mid-year would re-price every open loan
 * and tranche, which needs versioned policy the prototype does not attempt.
 */
export function SettingsPage() {
  const policy = useAppStore((s) => s.world.policy);
  const scenarioId = useAppStore((s) => s.scenarioId);
  const changes = useAppStore((s) => s.userEvents.length);
  const loadScenario = useAppStore((s) => s.loadScenario);
  const reset = useAppStore((s) => s.reset);

  return (
    <>
      <PageHeader title="Settings" description="The policy every screen and posting follows, and the demo's scenarios." />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card role="region" aria-label="Lending policy">
          <CardHeader>
            <CardTitle>Lending policy</CardTitle>
            <Badge>Fixed for the demo</Badge>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <Row label="Rate members pay" value={`${formatBps(policy.retailRateBps)} a year, reducing balance`} />
              <Row label="Rate on new tranches" value={`${formatBps(policy.wholesaleRateBps)} a year; each tranche keeps the rate it was sanctioned at`} />
              <Row label="Society's spread" value={formatBps(policy.retailRateBps - policy.wholesaleRateBps)} />
              <Row label="Penal interest" value={`${formatBps(policy.penalRateBps)} a year on overdue amounts, after ${plural(policy.graceDays, 'day')} of grace`} />
              <Row label="Loan size" value={`${formatPaise(policy.minTicket)} to ${formatPaise(policy.maxTicket)}, and no more than ${formatPaise(policy.maxTicket)} owed by any one member`} />
              <Row label="Tenure" value={`${MIN_TENURE_MONTHS} to ${MAX_TENURE_MONTHS} months`} />
              <Row label="Pool size" value={`${policy.poolMinMembers} to ${policy.poolMaxMembers} members`} />
              <Row label="Repayment burden" value={`Shown against ${percent(REPAYMENT_CAP_SHARE)} of monthly income at appraisal; it informs, not blocks`} />
              <Row label="Prepayment" value="Allowed at any time, without a fee" />
            </dl>
          </CardContent>
        </Card>

        <Card role="region" aria-label="Reconciliation">
          <CardHeader>
            <CardTitle>Reconciliation policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Policy
              active={policy.reconciliationPolicy === 'PASS_THROUGH'}
              name="Pass-through"
              body="Principal members repay goes on to the federation at the next remittance; interest is split, the wholesale share to the federation, the spread kept. The tranche shrinks as the members' loans do."
            />
            <Policy
              active={policy.reconciliationPolicy === 'INDEPENDENT_AMORTISATION'}
              name="Independent amortisation"
              body="The tranche repays on its own schedule whatever members pay. The engine supports it and its tests cover it; the demo keeps pass-through, since switching mid-year would re-price every open tranche."
            />
            <p className="text-muted-foreground">
              Interest is recognised when received (cash basis){policy.accrualEnabled ? ', with month-end accruals' : ''}. Receipts are applied
              to penal interest, fees, overdue interest, overdue principal, then current interest and principal.
            </p>
          </CardContent>
        </Card>

        <Card role="region" aria-label="Scenarios">
          <CardHeader>
            <CardTitle>Scenarios</CardTitle>
            <span className="text-xs text-muted-foreground">
              {changes === 0 ? 'No changes since the seed' : `${plural(changes, 'change')} since the seed`}
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            {SCENARIOS.map((s) => (
              <div key={s.id} className={cn('rounded-md border p-3', s.id === scenarioId && 'border-primary bg-accent/40')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {s.id}. {s.name}
                  </p>
                  {s.id === scenarioId ? (
                    <Badge tone="info">Loaded</Badge>
                  ) : (
                    <Confirm
                      label="Load"
                      size="sm"
                      title={`Load scenario ${s.id}?`}
                      body={changes > 0 ? `The ${plural(changes, 'change')} made since the seed will be discarded.` : 'The demo restarts on 29 Oct 2026.'}
                      confirm="Load"
                      onConfirm={() => loadScenario(s.id as ScenarioId)}
                    />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.summary}</p>
              </div>
            ))}
            <Confirm
              label={
                <>
                  <RotateCcw aria-hidden /> Reset demo data
                </>
              }
              disabled={changes === 0}
              title="Reset the demo?"
              body={`Discards ${plural(changes, 'change')} and reloads scenario ${scenarioId} as seeded.`}
              confirm="Reset"
              onConfirm={reset}
            />
          </CardContent>
        </Card>

        <Card role="region" aria-label="Walkthroughs">
          <CardHeader>
            <CardTitle>Guided walkthroughs</CardTitle>
          </CardHeader>
          <CardContent>
            <WalkthroughList />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Policy({ active, name, body }: { active: boolean; name: string; body: string }) {
  return (
    <div className={cn('rounded-md border p-3', active && 'border-primary bg-accent/40')}>
      <p className="flex items-center gap-2 font-medium">
        {name} {active ? <Badge tone="info">In force</Badge> : null}
      </p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

function Confirm(props: {
  label: ReactNode;
  size?: 'sm';
  disabled?: boolean;
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size={props.size} disabled={props.disabled} onClick={() => setOpen(true)}>
        {props.label}
      </Button>
      <DialogContent>
        <DialogTitle>{props.title}</DialogTitle>
        <DialogDescription>{props.body}</DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              props.onConfirm();
              setOpen(false);
            }}
          >
            {props.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
