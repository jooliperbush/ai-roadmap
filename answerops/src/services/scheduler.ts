/**
 * The loop.
 *
 * Everything else in this system is a way of turning an answer into a number. This is the
 * part that makes it happen on Tuesday without anyone asking, which is the difference between
 * a report and a monitor.
 *
 * Two properties matter and both are tested. Exactly one worker runs a due schedule, enforced
 * by a conditional UPDATE rather than by hoping. And a round that dies leaves the schedule
 * claimable again, the window marked partial, and a row in the audit log naming the error.
 */

import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as sched from '../db/repo/unattended.js';
import { runSamplingRound, type SampleRoundResult } from './observatory.js';
import { buildDashboard } from './dashboard.js';
import { generateAlerts } from './alerts.js';
import { dispatchAlerts, sendDigest, type Transport } from './delivery.js';
import { computeNextRun, windowLabelFor, LEASE_MS, type Cadence } from '../domain/scheduler.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { Fetcher } from '../domain/fetcher.js';
import type { BeliefProfile, ProviderAdapter } from '../providers/types.js';

export interface SchedulerOptions {
  clock?: Clock;
  /** identifies this worker in the lease; two workers must not share one */
  owner?: string;
  providers?: ProviderAdapter[];
  fetcher?: Fetcher | null;
  transports?: Record<string, Transport>;
  beliefsFor?: (windowLabel: string) => BeliefProfile | null;
  leaseMs?: number;
}

export interface TickResult {
  claimed: number;
  ran: number;
  failed: number;
  alertsCreated: number;
  delivered: number;
  windows: string[];
  errors: string[];
}

/**
 * One pass over everything that is due. Returns what it did, so the caller can log it and a
 * test can assert it, rather than the loop being a thing that happens somewhere.
 */
export async function tick(db: DB, opts: SchedulerOptions = {}): Promise<TickResult> {
  const clock = opts.clock ?? systemClock;
  const owner = opts.owner ?? `worker-${randomBytes(4).toString('hex')}`;
  const leaseMs = opts.leaseMs ?? LEASE_MS;
  const out: TickResult = { claimed: 0, ran: 0, failed: 0, alertsCreated: 0, delivered: 0, windows: [], errors: [] };

  const now = clock.now();
  const due = sched.dueSchedules(db, now.toISOString());

  for (const s of due) {
    const until = new Date(now.getTime() + leaseMs).toISOString();
    if (!sched.claimSchedule(db, s.tenant_id, s.id, owner, now.toISOString(), until)) continue;
    out.claimed++;

    const cadence = s.cadence as Cadence;
    const windowLabel = windowLabelFor(cadence, now);
    let result: SampleRoundResult | null = null;
    let error: string | null = null;

    try {
      result = await runSamplingRound(db, {
        tenantId: s.tenant_id,
        brandId: s.brand_id,
        windowLabel,
        budget: s.budget_runs,
        samplingReason: 'scheduled',
        actor: 'scheduler',
        beliefs: opts.beliefsFor ? opts.beliefsFor(windowLabel) : null,
        providers: opts.providers,
        clock,
        fetcher: opts.fetcher,
        monthlyBudgetUsd: s.monthly_budget_usd,
        surfaceKeys: safeParseArray(s.surfaces),
        seedOffset: hashSeed(windowLabel),
      });
      out.ran++;
      out.windows.push(windowLabel);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
      out.failed++;
      out.errors.push(error);
      // A failed round still owns a window. Marking it partial is what stops it becoming a
      // baseline later, which would silently contaminate every experiment that used it.
      sched.upsertWindow(db, s.tenant_id, s.brand_id, windowLabel, {
        status: 'partial',
        started_at: now.toISOString(),
        finished_at: clock.now().toISOString(),
        gaps: JSON.stringify([{ provider: 'all', surface: 'all', clusterId: '', reason: error }]),
      });
      repo.audit(db, s.tenant_id, 'scheduler', 'sampling_round_failed', 'brand', s.brand_id, `window=${windowLabel} error=${error}`);
    }

    if (result && result.runsCreated > 0) {
      try {
        const data = buildDashboard(db, s.tenant_id, s.brand_id, windowLabel);
        const alerts = generateAlerts(db, s.tenant_id, s.brand_id, windowLabel, data, clock);
        out.alertsCreated += alerts.created;
      } catch (err) {
        out.errors.push(err instanceof Error ? err.message.slice(0, 200) : 'alerting failed');
      }
    }

    sched.releaseSchedule(db, s.tenant_id, s.id, {
      next_run_at: computeNextRun(cadence, clock.now(), s.hour_utc).toISOString(),
      last_run_at: clock.now().toISOString(),
      last_window_label: windowLabel,
      last_error: error,
    });
  }

  if (opts.transports) {
    const tenants = new Set(due.map((s) => s.tenant_id));
    for (const tenantId of tenants) {
      const res = await dispatchAlerts(db, tenantId, opts.transports, clock);
      out.delivered += res.delivered;
    }
  }

  return out;
}

/**
 * The long-running loop. Deliberately thin: everything interesting is in `tick`, which is
 * synchronous to reason about and takes an injectable clock.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private db: DB, private opts: SchedulerOptions = {}, private intervalMs = 60_000) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<TickResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await tick(this.db, this.opts);
    } catch {
      return null;
    } finally {
      this.running = false;
    }
  }
}

/** Weekly digests, run separately from sampling so a sampling failure does not eat the digest. */
export async function runDigests(
  db: DB,
  transports: Record<string, Transport>,
  clock: Clock = systemClock,
): Promise<{ tenants: number; sent: number }> {
  const now = clock.now();
  const week = windowLabelFor('weekly', now);
  let tenants = 0;
  let sent = 0;
  for (const t of repo.listTenants(db)) {
    const brand = repo.primaryBrand(db, t.id);
    if (!brand) continue;
    tenants++;
    const res = await sendDigest(db, t.id, brand.id, week, transports);
    sent += res.sent;
  }
  return { tenants, sent };
}

function safeParseArray(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 100000;
}
