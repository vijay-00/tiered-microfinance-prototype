import { ChevronLeft, ChevronRight, Compass, X } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { ScenarioId } from '@/data/scenarios';
import type { ID } from '@/domain/types';
import { useAppStore } from '@/store/context';

/**
 * Scripted tours of the demo. Each step says what to look at and takes you
 * there: the scenario, the person and the screen. Nothing is clicked for you;
 * where a step asks you to record something, you record it.
 */

export interface WalkStep {
  readonly title: string;
  readonly body: string;
  readonly go: { readonly scenario?: ScenarioId; readonly userId?: ID; readonly path: string };
}

export interface Walkthrough {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly WalkStep[];
}

export const WALKTHROUGHS: readonly Walkthrough[] = [
  {
    id: 'journey',
    title: 'A member’s loan, start to finish',
    summary: 'Scenario A: a member applies, the society appraises, pools and submits, the federation sanctions, the society pays out, the member repays and the society remits.',
    steps: [
      {
        title: 'The member applies',
        body: 'Veerappan Pandian, a member, applies directly. Type an amount, say 40000, and the monthly instalment appears as you type, in whole rupees. Choose Send application.',
        go: { scenario: 'A', userId: 'usr_member', path: '/me/apply' },
      },
      {
        title: 'The member can follow it',
        body: 'The member’s home screen now tracks the application, step by step, from applying to being paid out. It shows the retail rate and nothing of the federation’s pricing.',
        go: { userId: 'usr_member', path: '/me' },
      },
      {
        title: 'The secretary appraises and approves',
        body: 'Open Veerappan Pandian’s application in the queue. Enter the monthly income, 40000, to see the repayment burden against the 50% cap, and Record appraisal. Then Approve it.',
        go: { userId: 'usr_secretary', path: '/applications' },
      },
      {
        title: 'The secretary pools and submits',
        body: 'Approved applications go to the federation in a pool of one to twenty. Choose Add to ANN/POOL/2026-27/02, Select all, and Submit to the federation. The pool shows its wholesale cost and the society’s 2% spread as it fills.',
        go: { userId: 'usr_secretary', path: '/pools' },
      },
      {
        title: 'The federation sanctions',
        body: 'The apex officer opens ANN/POOL/2026-27/02, checks the society’s track record and the purpose mix, chooses Begin review, and sanctions it at 9.5%.',
        go: { userId: 'usr_apex', path: '/apex/requests' },
      },
      {
        title: 'The society draws down and pays out',
        body: 'Open the new sanction, PACF/SAN/2026-27/015, and choose Draw down and disburse. One drawdown and twelve disbursements post to the ledger, and each loan gets its schedule.',
        go: { userId: 'usr_secretary', path: '/tranches' },
      },
      {
        title: 'The loan is paid out',
        body: 'The application has become a loan: what is still to repay, the instalment and the date of the first one.',
        go: { userId: 'usr_member', path: '/me' },
      },
      {
        title: 'A month on, members repay',
        body: 'Use Next due date in the demo bar until twelve instalments are due today, then Record all due today. Each payment is split into what goes on to the federation and what the society keeps.',
        go: { userId: 'usr_secretary', path: '/collections' },
      },
      {
        title: 'The society remits',
        body: 'Open PACF/SAN/2026-27/015 and Record remittance. The federation’s interest at 9.5% and the principal members repaid go up; the society keeps the 2% spread.',
        go: { userId: 'usr_secretary', path: '/tranches' },
      },
      {
        title: 'The federation sees it land',
        body: 'Annapoorani’s remittance appears in its record, on the day and in full, and its outstanding comes down.',
        go: { userId: 'usr_apex', path: '/apex/societies/soc_1' },
      },
    ],
  },
  {
    id: 'delinquency',
    title: 'When members fall behind',
    summary: 'Scenario B: late members cost the society cash, not margin, and the margin comes back as they catch up.',
    steps: [
      {
        title: 'The margin the schedules promised, and the one in the books',
        body: 'Annapoorani Credit Society lends at 11.5% and borrows from the federation at 9.5%. Four of its twelve borrowers fell behind this year. On the dashboard, the realised margin sits well below the theoretical one. Each figure opens the journal lines behind it.',
        go: { scenario: 'B', userId: 'usr_secretary', path: '/dashboard' },
      },
      {
        title: 'Why they differ, in words',
        body: 'The margin report puts theoretical and realised side by side and says why they differ: members paid less interest than fell due. That interest is still owed, so this is a delay, not a loss. Month by month you can watch it build from July.',
        go: { path: '/reports' },
      },
      {
        title: 'Who is behind',
        body: 'Iyyappan Selvaraj and Mahesh Velusamy have missed two instalments each; Rekha Krishnan has missed four. Penal interest of 2% a year runs on what they owe once the seven days of grace pass. Palanisamy Velusamy missed two earlier and has already caught up, penal interest and all.',
        go: { path: '/reports?tab=ageing' },
      },
      {
        title: 'The federation was paid in full regardless',
        body: 'Every remittance on this tranche went in full and on the day: the society covered what members had not paid from its own reserves. Late members cost the society cash, not margin. Compare the cash on the dashboard with scenario A.',
        go: { path: '/tranches/trn_01' },
      },
      {
        title: 'Let them catch up',
        body: 'Record each late member’s payment: choose Record payment on their row, use the amount due, and record it. Each payment goes to penal interest first, then overdue interest, then principal, as the split preview shows.',
        go: { path: '/collections' },
      },
      {
        title: 'The margin comes back',
        body: 'Back on the margin report, the gap has closed to a few paise of rounding, and the penal interest sits on top as extra income. The late payments delayed the margin; they did not take it away.',
        go: { path: '/reports' },
      },
      {
        title: 'What the federation sees',
        body: 'The apex officer sees the society’s share of late members and whether its remittances are current. Annapoorani’s members are late, but its remittances are not: the society, not the federation, carried the arrears.',
        go: { userId: 'usr_apex', path: '/apex' },
      },
    ],
  },
  {
    id: 'prepayment',
    title: 'Prepayment and recovery',
    summary: 'Scenario C: a part-prepayment shortens a loan, a foreclosure passes straight to the federation, and partial recoveries pay interest before principal.',
    steps: [
      {
        title: 'A part-prepayment shortens the loan',
        body: 'Revathi Selvaraj paid ₹25,000 extra in July. Her instalment stays the same and the loan ends sooner: compare the schedule with the original.',
        go: { scenario: 'C', userId: 'usr_secretary', path: '/loans/loan_006' },
      },
      {
        title: 'A foreclosure, without a fee',
        body: 'Karuppasamy Kannan repaid in full in month four. No fee was charged: RBI’s 2022 microfinance directions bar prepayment penalties. The principal went to the federation with the next remittance.',
        go: { path: '/loans/loan_012' },
      },
      {
        title: 'A partial recovery pays interest before principal',
        body: 'Rekha Krishnan paid part of her arrears on 22 October. It went to penal interest, then overdue interest, and none reached principal: the waterfall in action. Open the receipt to see the split and its journal entry.',
        go: { path: '/loans/loan_005' },
      },
      {
        title: 'What prepayment costs the society',
        body: 'In August the margin report shows wholesale interest on the prepaid principal: members stop paying interest the moment they prepay, but the federation charges until the next remittance passes the money on.',
        go: { path: '/reports' },
      },
    ],
  },
  {
    id: 'clean',
    title: 'A month in the life of a pool',
    summary: 'Scenario A: collect from twelve members, pay the federation, and trace the margin to the journal.',
    steps: [
      {
        title: 'Everything on time',
        body: 'In scenario A every member and every remittance has been on time, so theoretical and realised margin agree to a few paise. Click any figure on the dashboard to see the journal lines behind it.',
        go: { scenario: 'A', userId: 'usr_secretary', path: '/dashboard' },
      },
      {
        title: 'Collect',
        body: 'Use Next due date in the demo bar until 15 November, then Record all due today: twelve instalments, each split between the federation and the society.',
        go: { path: '/collections' },
      },
      {
        title: 'Remit',
        body: 'On the tranche, the next remittance is covered by what members paid. Record it, and the margin the society kept appears in the remittance history.',
        go: { path: '/tranches/trn_01' },
      },
      {
        title: 'Trace it',
        body: 'The statements balance, and every line opens the journal entries behind it.',
        go: { path: '/ledger/statements' },
      },
      {
        title: 'Where loans come from',
        body: 'Applications are taken, appraised and decided, pooled, one to twenty at a time, and sent to the federation for a wholesale tranche. Pool ANN/POOL/2026-27/02 is being built: add the approved applications and submit it.',
        go: { path: '/pools' },
      },
    ],
  },
];

interface WalkthroughState {
  readonly active: Walkthrough | undefined;
  readonly index: number;
  start(id: string): void;
  go(index: number): void;
  stop(): void;
}

const WalkthroughContext = createContext<WalkthroughState | undefined>(undefined);

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const loadScenario = useAppStore((s) => s.loadScenario);
  const switchUser = useAppStore((s) => s.switchUser);
  const [active, setActive] = useState<Walkthrough>();
  const [index, setIndex] = useState(0);

  const value = useMemo<WalkthroughState>(() => {
    const visit = (step: WalkStep) => {
      if (step.go.scenario) loadScenario(step.go.scenario);
      if (step.go.userId) switchUser(step.go.userId);
      navigate(step.go.path);
    };
    return {
      active,
      index,
      start(id) {
        const tour = WALKTHROUGHS.find((w) => w.id === id);
        if (!tour) return;
        setActive(tour);
        setIndex(0);
        visit(tour.steps[0]!);
      },
      go(next) {
        const step = active?.steps[next];
        if (!step) return;
        setIndex(next);
        visit(step);
      },
      stop() {
        setActive(undefined);
      },
    };
  }, [active, index, loadScenario, switchUser, navigate]);

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      <WalkthroughPanel />
    </WalkthroughContext.Provider>
  );
}

export function useWalkthrough(): WalkthroughState {
  const value = useContext(WalkthroughContext);
  if (!value) throw new Error('useWalkthrough outside WalkthroughProvider');
  return value;
}

/** The tours, each started with one click. Starting reloads its scenario. */
export function WalkthroughList() {
  const { start } = useWalkthrough();
  return (
    <ul className="space-y-3">
      {WALKTHROUGHS.map((w) => (
        <li key={w.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{w.title}</p>
            <Button size="sm" variant="outline" onClick={() => start(w.id)}>
              <Compass aria-hidden /> Start
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{w.summary}</p>
        </li>
      ))}
      <li className="text-xs text-muted-foreground">Starting a walkthrough reloads its scenario, discarding changes made since.</li>
    </ul>
  );
}

function WalkthroughPanel() {
  const tour = useContext(WalkthroughContext)!;
  const { active, index } = tour;
  if (!active) return null;
  const step = active.steps[index]!;
  const last = index === active.steps.length - 1;
  return (
    <aside
      role="complementary"
      aria-label="Walkthrough"
      className="fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-lg border bg-card shadow-xl"
    >
      <div className="flex items-start justify-between gap-3 border-b px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{active.title}</span> · step {index + 1} of {active.steps.length}
        </p>
        <button type="button" onClick={tour.stop} aria-label="End the walkthrough" className="rounded p-0.5 hover:bg-muted">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-2 px-4 py-3" aria-live="polite">
        <h2 className="text-sm font-semibold">{step.title}</h2>
        <p className="text-sm text-muted-foreground">{step.body}</p>
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
        <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => tour.go(index - 1)}>
          <ChevronLeft aria-hidden /> Back
        </Button>
        {last ? (
          <Button size="sm" onClick={tour.stop}>
            Finish
          </Button>
        ) : (
          <Button size="sm" onClick={() => tour.go(index + 1)}>
            Next <ChevronRight aria-hidden />
          </Button>
        )}
      </div>
    </aside>
  );
}
