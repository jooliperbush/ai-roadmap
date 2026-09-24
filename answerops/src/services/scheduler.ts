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

import { processWeekly, deliverWeekly } from './weekly.js';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as sched from '../db/repo/unattended.js';
import { runSamplingRound, type SampleRoundResult } from './observatory.js';
import { buildDashboard } from './dashboard.js';
import { generateAlerts } from './alerts.js';
import { dispatchAlerts, sendDigest, type Transport } from './delivery.js';
import { pruneOldSnapshots } from './recheck.js';
import { startQueuedAudits } from './auditQueue.js';
import { BackgroundTasks } from '../runtime/tasks.js';
import { computeNextRun, windowLabelFor, LEASE_MS, type Cadence } from '../domain/scheduler.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { SNAPSHOT_RETENTION_DAYS, type Fetcher } from '../domain/fetcher.js';
import type { BeliefProfile, ProviderAdapter } from '../providers/types.js';

export interface SchedulerOptions {
  /** Optional scope for an authorized manual run; omitted for the background worker. */
  tenantId?: string;
  scheduleId?: string;
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
function samplingOptions(schedule: repo.Row, opts: SchedulerOptions, clock: Clock, windowLabel: string) {
  return {
    tenantId: schedule.tenant_id,
    brandId: schedule.brand_id,
    windowLabel,
    budget: schedule.budget_runs,
    samplingReason: 'scheduled',
    actor: 'scheduler',
    beliefs: opts.beliefsFor?.(windowLabel) ?? null,
    providers: opts.providers,
    clock,
    fetcher: opts.fetcher,
    monthlyBudgetUsd: schedule.monthly_budget_usd,
    surfaceKeys: safeParseArray(schedule.surfaces),
    seedOffset: hashSeed(windowLabel),
  };
}

export async function tick(db: DB, opts: SchedulerOptions = {}): Promise<TickResult> {
  const clock = opts.clock ?? systemClock;
  const owner = opts.owner ?? `worker-${randomBytes(4).toString('hex')}`;
  const now = clock.now();
  const schedules = sched
    .dueSchedules(db, now.toISOString())
    .filter(
      (schedule) =>
        (!opts.tenantId || schedule.tenant_id === opts.tenantId) &&
        (!opts.scheduleId || schedule.id === opts.scheduleId),
    );
  const result: TickResult = {
    claimed: 0,
    ran: 0,
    failed: 0,
    alertsCreated: 0,
    delivered: 0,
    windows: [],
    errors: [],
  };
  for (const schedule of schedules) {
    const claimAt = clock.now();
    const expires = new Date(claimAt.getTime() + (opts.leaseMs ?? LEASE_MS)).toISOString();
    if (!sched.claimSchedule(db, schedule.tenant_id, schedule.id, owner, claimAt.toISOString(), expires))
      continue;
    result.claimed++;
    if (schedule.weekly_briefing === 1) {
      try {
        const state = await processWeekly(db, schedule, { ...opts, owner }, clock);
        if (state === 'complete') result.ran++;
        if (state === 'failed') result.failed++;
      } catch (e) {
        result.failed++;
        result.errors.push(e instanceof Error ? e.message : 'Weekly job failed');
        sched.releaseSchedule(db, schedule.tenant_id, schedule.id, {
          next_run_at: new Date(+clock.now() + 3600000).toISOString(),
          last_run_at: clock.now().toISOString(),
          last_window_label: null,
          last_error: 'Weekly job interrupted',
        });
      }
      continue;
    }
    const cadence = schedule.cadence as Cadence;
    const label = windowLabelFor(cadence, now);
    let error: string | null = null;
    try {
      let round: SampleRoundResult | undefined;
      try {
        round = await runSamplingRound(db, samplingOptions(schedule, opts, clock, label));
        result.ran++;
        result.windows.push(label);
      } catch (failure) {
        error = failure instanceof Error ? failure.message.slice(0, 200) : 'unknown error';
        result.failed++;
        result.errors.push(error);
        db.transaction(() => {
          sched.upsertWindow(db, schedule.tenant_id, schedule.brand_id, label, {
            status: 'partial',
            started_at: now.toISOString(),
            finished_at: clock.now().toISOString(),
            gaps: JSON.stringify([{ provider: 'all', surface: 'all', clusterId: '', reason: error }]),
          });
          repo.audit(
            db,
            schedule.tenant_id,
            'scheduler',
            'sampling_round_failed',
            'brand',
            schedule.brand_id,
            `window=${label} error=${error}`,
          );
        })();
      }
      if (round && round.runsCreated > 0) {
        try {
          const dashboard = buildDashboard(db, schedule.tenant_id, schedule.brand_id, label);
          result.alertsCreated += generateAlerts(
            db,
            schedule.tenant_id,
            schedule.brand_id,
            label,
            dashboard,
            clock,
          ).created;
        } catch (failure) {
          result.errors.push(failure instanceof Error ? failure.message.slice(0, 200) : 'alerting failed');
        }
      }
    } finally {
      sched.releaseSchedule(db, schedule.tenant_id, schedule.id, {
        next_run_at: computeNextRun(cadence, clock.now(), schedule.hour_utc).toISOString(),
        last_run_at: clock.now().toISOString(),
        last_window_label: label,
        last_error: error,
      });
    }
  }
  if (opts.transports) {
    for (const tenantId of new Set(schedules.map((schedule) => schedule.tenant_id))) {
      result.delivered += (await dispatchAlerts(db, tenantId, opts.transports, clock)).delivered;
    }
  }
  if (opts.transports) await deliverWeekly(db, opts.transports, clock, opts.tenantId);
  return result;
}

/**
 * The long-running loop. Deliberately thin: everything interesting is in `tick`, which is
 * synchronous to reason about and takes an injectable clock.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<TickResult | null> | null = null;
  private closing = false;
  /** The UTC day of the last snapshot retention sweep. */
  private prunedOn: string | null = null;
  /** Queued public audits this worker started; shutdown waits for them. */
  private audits = new BackgroundTasks();

  constructor(
    private db: DB,
    private opts: SchedulerOptions = {},
    private intervalMs = 60_000,
  ) {}

  start(): void {
    if (this.timer || this.closing) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.stop();
    await this.inFlight;
    await this.audits.drain();
  }

  runOnce(): Promise<TickResult | null> {
    if (this.inFlight || this.closing) return Promise.resolve(null);
    this.pruneDaily();
    this.startQueuedAudits();
    this.inFlight = tick(this.db, this.opts)
      .catch(() => null)
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /**
   * Snapshot retention, on the first pass of each UTC day. It runs here rather than in `tick`
   * because the sweep covers every tenant, and `tick` also serves scoped manual runs.
   */
  private pruneDaily(): void {
    const now = (this.opts.clock ?? systemClock).now();
    const day = windowLabelFor('daily', now);
    if (day === this.prunedOn) return;
    try {
      pruneOldSnapshots(this.db, new Date(+now - SNAPSHOT_RETENTION_DAYS * 86_400_000).toISOString());
      this.prunedOn = day;
    } catch {
      // Left unmarked so the next pass tries again; a failed sweep must never cost a sampling round.
    }
  }

  /**
   * Public audits the daily cap held, oldest first, as slots open. Like the sweep this covers every tenant,
   * so it runs here rather than in `tick`. Each audit records its own failure on its report.
   */
  private startQueuedAudits(): void {
    if (!this.opts.fetcher) return;
    try {
      const started = startQueuedAudits(this.db, {
        fetcher: this.opts.fetcher,
        providers: this.opts.providers,
        beliefs: this.opts.beliefsFor?.('audit') ?? null,
        clock: this.opts.clock,
      });
      for (const audit of started) void this.audits.track(audit).catch(() => undefined);
    } catch {
      // The requests stay queued for the next pass; a failed start must never cost a sampling round.
    }
  }
}

/** Weekly digests, run separately from sampling so a sampling failure does not eat the digest. */
export async function runDigests(
  db: DB,
  transports: Record<string, Transport>,
  clock: Clock = systemClock,
): Promise<{ tenants: number; sent: number }> {
  const week = windowLabelFor('weekly', clock.now());
  const workspaces = db
    .prepare(
      `SELECT t.id AS tenantId,
    (SELECT b.id FROM brands b WHERE b.tenant_id = t.id ORDER BY b.created_at LIMIT 1) AS brandId
    FROM tenants t WHERE brandId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.tenant_id=t.id AND s.weekly_briefing=1) ORDER BY t.created_at`,
    )
    .all() as Array<{ tenantId: string; brandId: string }>;
  let sent = 0;
  for (const workspace of workspaces) {
    const delivery = await sendDigest(db, workspace.tenantId, workspace.brandId, week, transports);
    sent += delivery.sent;
  }
  return { tenants: workspaces.length, sent };
}

function safeParseArray(raw: unknown): string[] {
  const parsed = repo.jsonParse<unknown>(typeof raw === 'string' ? raw : null, []);
  return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
}

function hashSeed(value: string): number {
  const hash = value
    .split('')
    .reduce((sum, character) => (Math.imul(sum, 31) + character.charCodeAt(0)) | 0, 0);
  return Math.abs(hash) % 100000;
}
