/**
 * The loop running itself: leases, windows, budgets, alerts and delivery, against a real
 * database and a clock the test controls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import { seed, DEMO_EMAIL, type SeedInfo } from '../../src/seed.js';
import * as repo from '../../src/db/repo/index.js';
import * as sched from '../../src/db/repo/unattended.js';
import { tick, runDigests } from '../../src/services/scheduler.js';
import { runSamplingRound } from '../../src/services/observatory.js';
import { buildDashboard } from '../../src/services/dashboard.js';
import { generateAlerts } from '../../src/services/alerts.js';
import { dispatchAlerts, buildDigest, RecordingTransport, signBody } from '../../src/services/delivery.js';
import { TestClock } from '../../src/domain/clock.js';
import { computeNextRun } from '../../src/domain/scheduler.js';
import { SimulatedProvider } from '../../src/providers/simulated.js';
import { ResilientProvider, DEFAULT_POLICY } from '../../src/providers/resilience.js';
import { VANAR_AFTER, VANAR_BEFORE } from '../../seed/simulation.js';
import type { ProviderAdapter, RunRequest, RunResult } from '../../src/providers/types.js';

let db: DB;
let info: SeedInfo;
let clock: TestClock;

const providers = () => [new SimulatedProvider()];
const beliefsFor = (w: string) => (w === 'baseline' ? VANAR_BEFORE : VANAR_AFTER);

beforeEach(async () => {
  db = openDb(':memory:');
  info = await seed(db);
  clock = new TestClock('2026-06-01T05:00:00.000Z');
});

function scheduleFor(overrides: Record<string, unknown> = {}) {
  return sched.createSchedule(db, info.tenantId, {
    brand_id: info.brandId,
    cadence: 'daily',
    hour_utc: 6,
    monthly_budget_usd: 500,
    budget_runs: 30,
    next_run_at: clock.now().toISOString(),
    ...overrides,
  } as any);
}

describe('the scheduler claims work exactly once', () => {
  it('runs a due schedule and advances it past the current time', async () => {
    const s = scheduleFor();
    const result = await tick(db, { clock, owner: 'w1', providers: providers(), beliefsFor });
    expect(result.claimed).toBe(1);
    expect(result.ran).toBe(1);
    const after = sched.getSchedule(db, info.tenantId, s.id)!;
    expect(new Date(after.next_run_at).getTime()).toBeGreaterThan(clock.now().getTime());
    expect(after.lease_owner).toBeNull();
  });

  it('two workers racing one due schedule produce exactly one round', async () => {
    scheduleFor();
    const [a, b] = await Promise.all([
      tick(db, { clock, owner: 'w1', providers: providers(), beliefsFor }),
      tick(db, { clock, owner: 'w2', providers: providers(), beliefsFor }),
    ]);
    expect(a.claimed + b.claimed, 'a lease that two workers can hold is not a lease').toBe(1);
    expect(a.ran + b.ran).toBe(1);
  });

  it('does nothing when nothing is due', async () => {
    scheduleFor({ next_run_at: '2027-01-01T00:00:00.000Z' });
    const result = await tick(db, { clock, owner: 'w1', providers: providers(), beliefsFor });
    expect(result.claimed).toBe(0);
  });

  it('skips a paused schedule', async () => {
    const s = scheduleFor();
    sched.setScheduleEnabled(db, info.tenantId, s.id, 0);
    expect((await tick(db, { clock, owner: 'w1', providers: providers(), beliefsFor })).claimed).toBe(0);
  });

  it('produces exactly seven distinct windows across seven simulated days', async () => {
    scheduleFor();
    const windows: string[] = [];
    for (let day = 0; day < 7; day++) {
      const result = await tick(db, { clock, owner: 'w1', providers: providers(), beliefsFor });
      windows.push(...result.windows);
      clock.advanceDays(1);
    }
    expect(windows).toHaveLength(7);
    expect(new Set(windows).size, 'a day that reuses yesterday label overwrites yesterday measurement').toBe(7);
  });
});

describe('a round that dies', () => {
  class Broken implements ProviderAdapter {
    key = 'broken';
    displayName = 'Broken';
    surfaces = new SimulatedProvider().surfaces;
    available() { return true; }
    async run(_r: RunRequest): Promise<RunResult> { throw new Error('provider exploded'); }
  }

  it('records every lost surface as a gap and marks the window partial', async () => {
    scheduleFor();
    const result = await tick(db, { clock, owner: 'w1', providers: [new Broken()], beliefsFor });
    const window = sched.getWindow(db, info.tenantId, info.brandId, result.windows[0] ?? '2026-06-01')!;
    expect(window.status).toBe('partial');
    expect(JSON.parse(window.gaps).length).toBeGreaterThan(0);
    expect(result.ran).toBe(1);
  });

  it('keeps sampling the surfaces that still answer', async () => {
    const round = await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'mixed', budget: 30,
      actor: 'test', beliefs: VANAR_AFTER, providers: [new Broken(), new SimulatedProvider()], clock,
    });
    expect(round.runsCreated, 'one broken surface must not take the round with it').toBeGreaterThan(0);
    expect(round.gaps.length).toBeGreaterThan(0);
    expect(round.windowStatus).toBe('partial');
  });

  it('names an open circuit as the reason rather than as an unknown failure', async () => {
    const flaky = new ResilientProvider(new Broken(), { ...DEFAULT_POLICY, maxAttempts: 1, failureThreshold: 1, sleep: async () => undefined }, clock);
    const round = await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'circuit', budget: 30,
      actor: 'test', beliefs: VANAR_AFTER, providers: [flaky], clock,
    });
    expect(round.gaps.some((g) => g.reason === 'circuit_open')).toBe(true);
  });

  it('leaves the lease claimable and the schedule advanced after a failure', async () => {
    const s = scheduleFor();
    await tick(db, { clock, owner: 'w1', providers: [new Broken()], beliefsFor });
    const after = sched.getSchedule(db, info.tenantId, s.id)!;
    expect(after.lease_owner).toBeNull();
    expect(after.lease_expires_at).toBeNull();
  });
});

describe('the budget', () => {
  it('leaves a round alone when it fits', async () => {
    const round = await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'cheap', budget: 30,
      actor: 'test', beliefs: VANAR_AFTER, providers: providers(), clock, monthlyBudgetUsd: 10_000,
    });
    expect(round.droppedForBudget).toEqual([]);
    expect(round.runsCreated).toBeGreaterThan(0);
  });

  it('drops clusters and raises one alert when the ceiling is reached', async () => {
    // Priced runs come from the live path; here we force the trim by setting a ceiling of zero.
    const round = await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'broke', budget: 30,
      actor: 'test', beliefs: VANAR_AFTER,
      providers: [{ ...new SimulatedProvider(), key: 'priced' } as any], clock, monthlyBudgetUsd: 0,
    });
    expect(round.runsCreated).toBe(0);
    const alerts = sched.listAlertsFor(db, info.tenantId, info.brandId);
    expect(alerts.some((a) => a.kind === 'budget_exhausted')).toBe(true);
  });

  it('counts only priced runs toward month-to-date spend', async () => {
    await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'w1', budget: 30,
      actor: 'test', beliefs: VANAR_AFTER, providers: providers(), clock,
    });
    db.prepare('UPDATE model_runs SET cost_known = 0, cost_usd = 0 WHERE window_label = ?').run('w1');
    const spend = sched.monthToDateSpend(db, info.tenantId, '2026-06');
    expect(spend.unpricedRuns).toBeGreaterThan(0);
    expect(spend.pricedRuns).toBe(0);
    expect(spend.usd, 'an unpriced run is unknown, not free').toBe(0);
  });
});

describe('alerts', () => {
  async function twoWindows() {
    await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'w-base', budget: 200,
      actor: 'test', beliefs: VANAR_BEFORE, providers: providers(), clock, seedOffset: 11,
    });
    await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'w-post', budget: 200,
      actor: 'test', beliefs: VANAR_AFTER, providers: providers(), clock, seedOffset: 999,
    });
  }

  it('writes at most one alert per misconception per window, however often the round reruns', async () => {
    await twoWindows();
    const data = buildDashboard(db, info.tenantId, info.brandId, 'w-post');
    const first = generateAlerts(db, info.tenantId, info.brandId, 'w-post', data, clock);
    const second = generateAlerts(db, info.tenantId, info.brandId, 'w-post', data, clock);
    const third = generateAlerts(db, info.tenantId, info.brandId, 'w-post', data, clock);
    expect(second.created, 'a retried round must not re-page anyone').toBe(0);
    expect(third.created).toBe(0);
    expect(first.created + second.created + third.created).toBe(first.created);
  });

  it('never puts a bare percentage in an alert body', async () => {
    await twoWindows();
    const data = buildDashboard(db, info.tenantId, info.brandId, 'w-post');
    generateAlerts(db, info.tenantId, info.brandId, 'w-post', data, clock);
    const alerts = sched.listAlertsFor(db, info.tenantId, info.brandId);
    for (const a of alerts) {
      const text = `${a.headline} ${a.detail}`;
      if (!/\d+%/.test(text)) continue;
      expect(text, `alert without a sample size: ${a.headline}`).toMatch(/n=\d+/);
    }
  });

  it('only raises a critical alert once two evaluators agree', async () => {
    await twoWindows();
    // Force every high-risk verdict into disagreement and the critical alerts must vanish.
    db.prepare("UPDATE observed_claims SET adjudication = 'disputed' WHERE adjudication = 'agreed'").run();
    db.prepare('DELETE FROM alerts').run();
    const data = buildDashboard(db, info.tenantId, info.brandId, 'w-post');
    generateAlerts(db, info.tenantId, info.brandId, 'w-post', data, clock);
    const criticals = sched.listAlertsFor(db, info.tenantId, info.brandId).filter((a) => a.kind === 'critical_defect');
    expect(criticals).toHaveLength(0);
  });

  it('raises a registry gap when models assert facts the registry cannot adjudicate', async () => {
    await twoWindows();
    const data = buildDashboard(db, info.tenantId, info.brandId, 'w-post');
    generateAlerts(db, info.tenantId, info.brandId, 'w-post', data, clock);
    const gaps = sched.listAlertsFor(db, info.tenantId, info.brandId).filter((a) => a.kind === 'registry_gap');
    if (data.registryGaps.length > 0) {
      expect(gaps).toHaveLength(1);
      expect(gaps[0].headline).toMatch(/n=\d+/);
    }
  });
});

describe('delivery', () => {
  function channel(kind: string, severity = 'low') {
    return sched.createChannel(db, info.tenantId, { kind, target: `${kind}-target`, secret: 's3cret', min_severity: severity, digest: 1 });
  }

  function anAlert(severity = 'critical') {
    return sched.insertAlertOnce(db, info.tenantId, {
      brand_id: info.brandId, kind: 'critical_defect', severity,
      window_label: `w-${severity}-${Math.random().toString(36).slice(2, 8)}`,
      subject_key: `s-${Math.random()}`,
      headline: 'Something moved (n=52)', detail: '95% CI 30-46%, n=52', link: '/defect/x',
    });
  }

  it('delivers an alert and marks it delivered', async () => {
    db.prepare('DELETE FROM delivery_channels').run();
    channel('email');
    anAlert();
    const t = new RecordingTransport('email');
    const res = await dispatchAlerts(db, info.tenantId, { email: t }, clock);
    expect(res.delivered).toBeGreaterThan(0);
    expect(t.sent[0].subject).toMatch(/Miscited/);
    expect(sched.undeliveredAlerts(db, info.tenantId)).toHaveLength(0);
  });

  it('skips a channel whose minimum severity is above the alert', async () => {
    db.prepare('DELETE FROM delivery_channels').run();
    db.prepare('DELETE FROM alerts').run();
    channel('email', 'critical');
    sched.insertAlertOnce(db, info.tenantId, {
      brand_id: info.brandId, kind: 'registry_gap', severity: 'medium', window_label: 'w', subject_key: 'r',
      headline: 'A gap (n=10)', detail: 'n=10',
    });
    const t = new RecordingTransport('email');
    const res = await dispatchAlerts(db, info.tenantId, { email: t }, clock);
    expect(t.sent).toHaveLength(0);
    expect(res.skipped).toBeGreaterThan(0);
  });

  it('retries three times then marks the channel failing', async () => {
    db.prepare('DELETE FROM delivery_channels').run();
    const c = channel('email');
    anAlert();
    const t = new RecordingTransport('email', 99);
    await dispatchAlerts(db, info.tenantId, { email: t }, clock);
    const after = sched.getChannel(db, info.tenantId, c.id)!;
    expect(after.state).toBe('failing');
    const attempts = sched.listAttempts(db, info.tenantId).filter((a) => a.channel_id === c.id);
    expect(attempts).toHaveLength(3);
  });

  it('signs a webhook body with the channel secret', async () => {
    db.prepare('DELETE FROM delivery_channels').run();
    channel('webhook');
    anAlert();
    const t = new RecordingTransport('webhook');
    await dispatchAlerts(db, info.tenantId, { webhook: t }, clock);
    const payload = t.sent[0];
    expect(signBody(payload.secret, payload.body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('does not leave an alert queued forever when there is no channel at all', async () => {
    db.prepare('DELETE FROM delivery_channels').run();
    anAlert();
    await dispatchAlerts(db, info.tenantId, {}, clock);
    expect(sched.undeliveredAlerts(db, info.tenantId)).toHaveLength(0);
  });
});

describe('the weekly digest', () => {
  it('states the sample size and the detectable effect when there is nothing to report', async () => {
    // The second brand in the seeded agency workspace has never been sampled, which is the
    // only honest way to produce an empty dashboard.
    const quiet = repo.listBrands(db, info.tenantId).find((b) => b.id !== info.brandId)!;
    const data = buildDashboard(db, info.tenantId, quiet.id, null);
    const digest = buildDigest(data, '2026-W23');
    expect(digest.empty).toBe(true);
    expect(digest.text).toMatch(/Nothing new to report/);
    expect(digest.text).toMatch(/would have been detectable/);
    expect(digest.text, 'a digest that invents a narrative out of a quiet week trains people to ignore it')
      .not.toMatch(/momentum|trending|encouraging/i);
  });

  it('carries the three sections and nothing else when there is', async () => {
    const data = buildDashboard(db, info.tenantId, info.brandId, null);
    const digest = buildDigest(data, '2026-W23');
    expect(digest.text).toContain('1. Critical answer defects');
    expect(digest.text).toContain('2. Missed commercial demand');
    expect(digest.text).toContain('3. Confirmed wins');
    expect(digest.text).not.toContain('4.');
  });

  it('sends to every digest channel and records the attempt', async () => {
    db.prepare('DELETE FROM delivery_channels').run();
    sched.createChannel(db, info.tenantId, { kind: 'email', target: 'a@b.c', min_severity: 'low', digest: 1 });
    const t = new RecordingTransport('email');
    const res = await runDigests(db, { email: t }, clock);
    expect(res.sent).toBeGreaterThan(0);
    expect(sched.listAttempts(db, info.tenantId).some((a) => a.kind === 'digest')).toBe(true);
  });
});

describe('the window ledger', () => {
  it('marks a complete round complete and records what it planned versus did', async () => {
    const round = await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'full', budget: 30,
      actor: 'test', beliefs: VANAR_AFTER, providers: providers(), clock,
    });
    const w = sched.getWindow(db, info.tenantId, info.brandId, 'full')!;
    expect(w.status).toBe('complete');
    expect(w.actual_runs).toBe(round.runsCreated);
    expect(w.planned_runs).toBe(round.plannedRuns);
  });

  it('surfaces partial status on the dashboard so a thin window is visible', async () => {
    await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'thin', budget: 30,
      actor: 'test', beliefs: VANAR_AFTER, providers: providers(), clock,
    });
    sched.upsertWindow(db, info.tenantId, info.brandId, 'thin', { status: 'partial' });
    expect(buildDashboard(db, info.tenantId, info.brandId, 'thin').windowStatus).toBe('partial');
  });
});
