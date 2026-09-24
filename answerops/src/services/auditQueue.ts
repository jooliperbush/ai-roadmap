/**
 * The public audit queue.
 *
 * Every public audit is a paid sample, so the form cannot start one per request. A domain gets one audit a
 * week, and the site a daily number of starts, counted over the last 24 hours. A request past the cap is
 * stored as queued. The request route and the scheduler both start queued audits oldest first as slots
 * open, so a new request never overtakes a held one, and a queued request whose domain has been audited
 * since is marked a duplicate and never runs.
 */

import type { DB } from '../db/index.js';
import type { Row } from '../db/repo/index.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { AUDIT_BUDGET_RUNS, runAudit, type AuditOptions } from './audit.js';

/** Audits started a day unless MISCITED_PUBLIC_AUDITS_PER_DAY says otherwise, and the most samples one may take. */
export const PUBLIC_AUDITS_PER_DAY = 10;
export const MAX_AUDIT_RUNS = 60;

/** A whole-number env setting: the fallback when unset or malformed, otherwise clamped into [min, max]. */
function envInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return raw?.trim() && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

const daysBefore = (clock: Clock, days: number) => new Date(+clock.now() - days * 86_400_000).toISOString();

/** Whether a running or complete audit of this domain, with or without www, started in the last 7 days. */
export function auditedThisWeek(db: DB, domain: string, clock: Clock = systemClock): boolean {
  const bare = domain.replace(/^www\./, '');
  return !!db
    .prepare(
      "SELECT 1 FROM audit_reports WHERE domain IN (?, ?) AND status IN ('running', 'complete') AND started_at >= ?",
    )
    .get(bare, `www.${bare}`, daysBefore(clock, 7));
}

/** Whether another audit may start: fewer than the daily cap have started in the last 24 hours. */
export function slotOpen(db: DB, clock: Clock = systemClock): boolean {
  const cap = envInt(process.env.MISCITED_PUBLIC_AUDITS_PER_DAY, PUBLIC_AUDITS_PER_DAY, 0, 1000);
  const started = db
    .prepare('SELECT COUNT(*) AS n FROM audit_reports WHERE started_at >= ?')
    .get(daysBefore(clock, 1)) as { n: number };
  return started.n < cap;
}

/** Records a request that will never run, because its domain was audited in the last 7 days. */
export function markDuplicate(db: DB, reportId: string): void {
  db.prepare("UPDATE audit_reports SET status = 'duplicate' WHERE id = ? AND status = 'queued'").run(reportId);
}

/**
 * Starts queued audits, oldest first, while slots are open, and returns them. runAudit records a report as
 * running, with its start time, before it first awaits, so each start counts against the cap before the next.
 */
export function startQueuedAudits(db: DB, opts: Omit<AuditOptions, 'budgetRuns'>): Array<Promise<Row>> {
  const clock = opts.clock ?? systemClock;
  const started: Array<Promise<Row>> = [];
  if (!slotOpen(db, clock)) return started;
  const queued = db
    .prepare("SELECT id, domain FROM audit_reports WHERE status = 'queued' ORDER BY created_at, rowid")
    .all() as Array<{ id: string; domain: string }>;
  const budgetRuns = envInt(process.env.MISCITED_AUDIT_RUNS, AUDIT_BUDGET_RUNS, 1, MAX_AUDIT_RUNS);
  for (const report of queued) {
    if (auditedThisWeek(db, report.domain, clock)) markDuplicate(db, report.id);
    else if (slotOpen(db, clock)) started.push(runAudit(db, report.id, { ...opts, budgetRuns }));
    else break;
  }
  return started;
}
