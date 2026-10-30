import { describe, expect, it } from 'vitest';
import { rowInterestAt } from '@/domain/interest';
import { positionOf, remittanceDueFor } from '@/domain/world';
import { createAppStore } from '../appStore';
import { selectInvariantHealth, selectNextDueDateForViewer } from '../selectors';
import { STORAGE_KEY, STATE_VERSION, type StorageLike } from '../persistence';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

describe('a fresh store', () => {
  const store = createAppStore();

  it('opens scenario A on the seed, as the society secretary', () => {
    const state = store.getState();
    expect(state.scenarioId).toBe('A');
    expect(state.world.clock).toBe('2026-10-29');
    expect(state.userEvents).toHaveLength(0);
    expect(state.session.userId).toBe('usr_secretary');
  });

  it('switches role to that role’s user in the demo society', () => {
    const s = createAppStore();
    s.getState().switchRole('APEX_OFFICER');
    expect(s.getState().session.userId).toBe('usr_apex');
    s.getState().switchRole('MEMBER');
    expect(s.getState().session.userId).toBe('usr_member');
  });

  it('changes the world only through the reducer, one event at a time', () => {
    const s = createAppStore();
    const before = s.getState().world;
    expect(s.getState().advanceClock('2026-11-15')).toEqual({ ok: true });
    expect(s.getState().world.clock).toBe('2026-11-15');
    expect(s.getState().world.eventCount).toBe(before.eventCount + 1);
    expect(s.getState().userEvents).toEqual([{ type: 'CLOCK_ADVANCED', to: '2026-11-15' }]);
  });

  it('refuses an invalid event, says why, and leaves the world untouched', () => {
    const s = createAppStore();
    const before = s.getState().world;
    const result = s.getState().advanceClock('2026-01-01');
    expect(result.ok).toBe(false);
    expect(s.getState().notice).toMatch(/only moves forward/);
    expect(s.getState().world).toBe(before);
    s.getState().dismissNotice();
    expect(s.getState().notice).toBeUndefined();
  });

  it('loads each prepared scenario, discarding what was done in the last', () => {
    const s = createAppStore();
    s.getState().advanceClock('2026-11-02');
    for (const id of ['B', 'C', 'A'] as const) {
      expect(s.getState().loadScenario(id).ok).toBe(true);
      expect(s.getState().scenarioId).toBe(id);
      expect(s.getState().userEvents).toHaveLength(0);
      expect(s.getState().world.clock).toBe('2026-10-29');
    }
  });

  it('resets to the seed', () => {
    const s = createAppStore();
    s.getState().advanceClock('2027-01-01');
    s.getState().reset();
    expect(s.getState().world).toBe(s.getState().seedWorld);
    expect(s.getState().userEvents).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('saves what was done and replays it on the next load', () => {
    const storage = new MemoryStorage();
    const first = createAppStore({ storage });
    first.getState().advanceClock('2026-12-01');
    first.getState().switchRole('AUDITOR');

    const second = createAppStore({ storage });
    expect(second.getState().world.clock).toBe('2026-12-01');
    expect(second.getState().session.userId).toBe('usr_auditor');
    expect(second.getState().notice).toBeUndefined();
  });

  it('saves events, never the derived world', () => {
    const storage = new MemoryStorage();
    createAppStore({ storage }).getState().advanceClock('2026-12-01');
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(Object.keys(saved).sort()).toEqual(['scenarioId', 'seedVersion', 'session', 'stateVersion', 'userEvents']);
  });

  it('starts fresh, and says so, when the seed has changed', () => {
    const storage = new MemoryStorage();
    const store = createAppStore({ storage });
    store.getState().advanceClock('2026-12-01');
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, seedVersion: 'deadbeef' }));

    const reloaded = createAppStore({ storage });
    expect(reloaded.getState().world.clock).toBe('2026-10-29');
    expect(reloaded.getState().notice).toMatch(/started fresh/);
  });

  it('starts fresh, and says so, when saved events no longer replay', () => {
    const storage = new MemoryStorage();
    const seedVersion = createAppStore().getState().seedVersion;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        stateVersion: STATE_VERSION,
        seedVersion,
        scenarioId: 'A',
        session: { userId: 'usr_secretary' },
        userEvents: [{ type: 'CLOCK_ADVANCED', to: '2025-01-01' }],
      }),
    );
    const store = createAppStore({ storage });
    expect(store.getState().world.clock).toBe('2026-10-29');
    expect(store.getState().notice).toMatch(/no longer replay/);
  });

  it('ignores storage that is corrupt or throws', () => {
    const corrupt = new MemoryStorage();
    corrupt.setItem(STORAGE_KEY, '{not json');
    expect(createAppStore({ storage: corrupt }).getState().world.clock).toBe('2026-10-29');

    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createAppStore({ storage: throwing });
    expect(store.getState().advanceClock('2026-11-01').ok).toBe(true);
  });

  it('clears what was saved on reset', () => {
    const storage = new MemoryStorage();
    const store = createAppStore({ storage });
    store.getState().advanceClock('2026-12-01');
    store.getState().reset();
    expect(createAppStore({ storage }).getState().world.clock).toBe('2026-10-29');
  });
});

describe('the role a first visit opens as', () => {
  it('opens as the apex officer when the demo asks, and as the secretary by default', () => {
    const apex = createAppStore({ startAs: 'APEX_OFFICER' });
    expect(apex.getState().world.users.find((u) => u.id === apex.getState().session.userId)?.role).toBe('APEX_OFFICER');
    const plain = createAppStore();
    expect(plain.getState().world.users.find((u) => u.id === plain.getState().session.userId)?.role).toBe('SECRETARY');
  });
});

describe.each(['A', 'B', 'C'] as const)('the demo, cut down to the member’s society, in scenario %s', (id) => {
  const store = createAppStore({ onlySociety: 'soc_1' });
  if (id !== 'A') store.getState().loadScenario(id);
  const world = () => store.getState().world;

  it('has one society, one member to log in as, and nobody in a hidden role', () => {
    expect(world().societies.map((s) => s.name)).toEqual(['Annapoorani Credit Society']);
    expect(world().users.map((u) => `${u.name}, ${u.role}`).sort()).toEqual([
      'Dr. Sudha Ramanathan, APEX_OFFICER',
      'Meenakshi Sundaram, SECRETARY',
      'R. N. Subramanian, AUDITOR',
      'Veerappan Pandian, MEMBER',
    ]);
  });

  it('credits the loan officer’s past work to the secretary, so his name is nowhere in it', () => {
    expect(JSON.stringify(world())).not.toContain('usr_officer');
    const appraised = world().applications.filter((a) => a.appraisal);
    expect(appraised.length).toBeGreaterThan(0);
    expect(appraised.every((a) => a.appraisal!.officerId === 'usr_secretary')).toBe(true);
    expect(store.getState().userEvents).toHaveLength(0);
  });

  it('has no pool half-built in advance: every approved application waits to be picked', () => {
    expect(world().pools.filter((p) => p.status === 'OPEN' || p.status === 'READY')).toEqual([]);
    const waiting = world().applications.filter((a) => a.status === 'APPROVED');
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((a) => a.poolId === undefined)).toBe(true);
  });

  it('starts Veerappan Pandian with no loan and no application on file', () => {
    const login = world().users.find((u) => u.role === 'MEMBER')!;
    const member = world().members.find((m) => m.id === login.memberId)!;
    expect(member.name).toBe('Veerappan Pandian');
    expect(member.status).toBe('ACTIVE');
    expect(world().applications.filter((a) => a.memberId === member.id)).toEqual([]);
    expect(Object.values(world().loans).filter((l) => l.loan.memberId === member.id)).toEqual([]);
    // Nothing of his is due, so the member's Next due date has nowhere to go.
    store.getState().switchUser(login.id);
    expect(selectNextDueDateForViewer(store.getState())).toBeUndefined();
  });
});

describe('the demo member’s first loan', () => {
  it('can be for the full Rs 5,00,000, and falls due on the same day each month', () => {
    const store = createAppStore({ onlySociety: 'soc_1' });
    const { world, dispatch } = store.getState();
    const login = world.users.find((u) => u.role === 'MEMBER')!;
    const on = world.clock;
    expect(
      dispatch({
        type: 'APPLICATION_SUBMITTED', on, applicationId: 'app_900', memberId: login.memberId!,
        requestedAmount: 50_000_000, requestedTenureMonths: 24, purpose: 'TRADE', recordedBy: login.id,
      }),
    ).toEqual({ ok: true });
    expect(
      store.getState().dispatchMany([
        { type: 'APPLICATION_APPRAISED', on, applicationId: 'app_900', monthlyIncome: 30_000_000, existingObligations: 0, recommendedAmount: 50_000_000, notes: '', recordedBy: 'usr_secretary' },
        { type: 'APPLICATION_DECIDED', on, applicationId: 'app_900', outcome: 'APPROVED', sanctionedAmount: 50_000_000, tenureMonths: 24, recordedBy: 'usr_secretary' },
        { type: 'POOL_CREATED', on, poolId: 'pool_90', reference: 'ANN/POOL/TEST/01', applicationIds: ['app_900'], recordedBy: 'usr_secretary' },
        { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'SUBMITTED', recordedBy: 'usr_secretary' },
        { type: 'POOL_STATUS_CHANGED', on, poolId: 'pool_90', to: 'UNDER_APEX_REVIEW', recordedBy: 'usr_apex' },
        { type: 'TRANCHE_SANCTIONED', on, trancheId: 'trn_90', poolId: 'pool_90', sanctionRef: 'PACF/SAN/TEST/01', sanctionedAmount: 50_000_000, wholesaleRateBps: 950, tenureMonths: 24, remarks: '', recordedBy: 'usr_apex' },
        { type: 'TRANCHE_DRAWN', on, trancheId: 'trn_90', amount: 50_000_000, recordedBy: 'usr_secretary' },
        { type: 'LOAN_DISBURSED', on, loanId: 'loan_900', applicationId: 'app_900', trancheId: 'trn_90', firstDueOn: '2026-12-01', recordedBy: 'usr_secretary' },
      ]),
    ).toEqual({ ok: true });

    // Paid out on 29 October, EMI on the 1st: three days of broken period ride on the first instalment.
    const loan = store.getState().world.loans.loan_900!;
    expect(loan.schedule[0]).toMatchObject({ dueOn: '2026-12-01', brokenPeriodDays: 3 });
    expect(loan.schedule[0]!.instalment).toBe(loan.loan.emi + loan.schedule[0]!.brokenPeriodInterest!);
    expect(loan.schedule[1]).toMatchObject({ dueOn: '2027-01-01', instalment: loan.loan.emi });

    // Viewed as the member, Next due date steps through his own date, the 1st, month by month.
    store.getState().switchUser(login.id);
    expect(selectNextDueDateForViewer(store.getState())).toBe('2026-12-01');
    store.getState().advanceClock('2026-12-01');
    expect(selectNextDueDateForViewer(store.getState())).toBe('2027-01-01');

    // He pays the first instalment, broken period and all; the society remits; the books stay whole.
    const position = positionOf(store.getState().world, 'loan_900');
    expect(position.totalDueNow).toBe(loan.schedule[0]!.instalment);
    store.getState().switchUser('usr_secretary');
    expect(
      store.getState().dispatch({
        type: 'PAYMENT_RECEIVED', on: '2026-12-01', paymentId: 'pay_900', loanId: 'loan_900', amount: position.totalDueNow,
        mode: 'CASH', receiptNo: 'ANN/R/90001', source: 'CASH', electPrepayment: false, recordedBy: 'usr_secretary',
      }),
    ).toEqual({ ok: true });
    const due = remittanceDueFor(store.getState().world, 'trn_90', '2026-12-01');
    // The federation is paid its broken period too, for the same three days.
    expect(due.wholesaleInterest).toBe(rowInterestAt(loan.schedule[0]!, 950));
    expect(due.wholesaleVariance).toBe(0);
    expect(
      store.getState().dispatch({
        type: 'REMITTANCE_RECORDED', on: '2026-12-01', remittanceId: 'rem_900', trancheId: 'trn_90', dueOn: '2026-12-01',
        interestPaid: due.interestDue, principalPaid: due.principalDue, recordedBy: 'usr_secretary',
      }),
    ).toEqual({ ok: true });
    expect(selectInvariantHealth(store.getState().world).ok).toBe(true);
  });
});
