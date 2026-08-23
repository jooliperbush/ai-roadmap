/**
 * Repository functions for the unattended loop: schedules, window ledger, alerts and
 * delivery. Same rule as the rest of the layer — tenantId first, tenant_id in the SQL.
 *
 * The one deliberate exception is `claimSchedule`, which is a conditional UPDATE by primary
 * key used as a distributed lock. It still carries tenant_id so a caller cannot lease another
 * tenant's schedule by guessing an id.
 */

import type { DB } from '../index.js';
import { id, nowIso } from '../index.js';
import type { Row } from './index.js';

// ------------------------------------------------------------------ schedules

export interface ScheduleInput {
  brand_id: string;
  cadence?: string;
  hour_utc?: number;
  timezone?: string;
  monthly_budget_usd?: number;
  budget_runs?: number;
  surfaces?: string;
  enabled?: number;
  next_run_at: string;
}

export function createSchedule(db: DB, tenantId: string, s: ScheduleInput): Row {
  const row = {
    id: id('sch'),
    tenant_id: tenantId,
    brand_id: s.brand_id,
    cadence: s.cadence ?? 'daily',
    hour_utc: s.hour_utc ?? 6,
    timezone: s.timezone ?? 'UTC',
    monthly_budget_usd: s.monthly_budget_usd ?? 500,
    budget_runs: s.budget_runs ?? 60,
    surfaces: s.surfaces ?? '[]',
    enabled: s.enabled ?? 1,
    next_run_at: s.next_run_at,
    lease_owner: null,
    lease_expires_at: null,
    last_run_at: null,
    last_window_label: null,
    last_error: null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO schedules (id, tenant_id, brand_id, cadence, hour_utc, timezone, monthly_budget_usd,
      budget_runs, surfaces, enabled, next_run_at, lease_owner, lease_expires_at, last_run_at,
      last_window_label, last_error, created_at)
     VALUES (@id, @tenant_id, @brand_id, @cadence, @hour_utc, @timezone, @monthly_budget_usd,
      @budget_runs, @surfaces, @enabled, @next_run_at, @lease_owner, @lease_expires_at, @last_run_at,
      @last_window_label, @last_error, @created_at)`,
  ).run(row);
  return row;
}

export function listSchedules(db: DB, tenantId: string, brandId?: string): Row[] {
  return brandId
    ? (db.prepare('SELECT * FROM schedules WHERE tenant_id = ? AND brand_id = ? ORDER BY created_at').all(tenantId, brandId) as Row[])
    : (db.prepare('SELECT * FROM schedules WHERE tenant_id = ? ORDER BY created_at').all(tenantId) as Row[]);
}

export function getSchedule(db: DB, tenantId: string, scheduleId: string): Row | undefined {
  return db.prepare('SELECT * FROM schedules WHERE tenant_id = ? AND id = ?').get(tenantId, scheduleId) as Row | undefined;
}

/** Every enabled schedule whose time has come and whose lease is dead. Cross-tenant by design. */
export function dueSchedules(db: DB, nowIso_: string): Row[] {
  return db
    .prepare(
      `SELECT * FROM schedules
        WHERE enabled = 1 AND next_run_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at < ?)
        ORDER BY next_run_at`,
    )
    .all(nowIso_, nowIso_) as Row[];
}

/**
 * The lock. A single conditional UPDATE: only one caller can observe changes = 1, because
 * SQLite serialises writers. Two schedulers racing the same row produce exactly one winner.
 */
export function claimSchedule(db: DB, tenantId: string, scheduleId: string, owner: string, nowIso_: string, until: string): boolean {
  const res = db
    .prepare(
      `UPDATE schedules SET lease_owner = ?, lease_expires_at = ?
        WHERE tenant_id = ? AND id = ? AND enabled = 1 AND next_run_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
    )
    .run(owner, until, tenantId, scheduleId, nowIso_, nowIso_);
  return res.changes === 1;
}

export function releaseSchedule(db: DB, tenantId: string, scheduleId: string, patch: Row): void {
  db.prepare(
    `UPDATE schedules SET lease_owner = NULL, lease_expires_at = NULL, next_run_at = @next_run_at,
        last_run_at = @last_run_at, last_window_label = @last_window_label, last_error = @last_error
      WHERE tenant_id = @tenant_id AND id = @id`,
  ).run({ ...patch, tenant_id: tenantId, id: scheduleId });
}

export function setScheduleEnabled(db: DB, tenantId: string, scheduleId: string, enabled: number): void {
  db.prepare('UPDATE schedules SET enabled = ? WHERE tenant_id = ? AND id = ?').run(enabled, tenantId, scheduleId);
}

export function updateScheduleNextRun(db: DB, tenantId: string, scheduleId: string, at: string): void {
  db.prepare('UPDATE schedules SET next_run_at = ? WHERE tenant_id = ? AND id = ?').run(at, tenantId, scheduleId);
}

// -------------------------------------------------------------------- windows

export function upsertWindow(db: DB, tenantId: string, brandId: string, label: string, patch: Row): Row {
  const existing = getWindow(db, tenantId, brandId, label);
  if (existing) {
    const merged = { ...existing, ...patch, tenant_id: tenantId, brand_id: brandId, window_label: label };
    db.prepare(
      `UPDATE windows SET status = @status, finished_at = @finished_at, planned_runs = @planned_runs,
          actual_runs = @actual_runs, cost_usd = @cost_usd, cost_known = @cost_known, gaps = @gaps, dropped = @dropped
        WHERE tenant_id = @tenant_id AND brand_id = @brand_id AND window_label = @window_label`,
    ).run(merged);
    return merged;
  }
  const row = {
    id: id('win'),
    tenant_id: tenantId,
    brand_id: brandId,
    window_label: label,
    status: patch.status ?? 'complete',
    started_at: patch.started_at ?? nowIso(),
    finished_at: patch.finished_at ?? null,
    planned_runs: patch.planned_runs ?? 0,
    actual_runs: patch.actual_runs ?? 0,
    cost_usd: patch.cost_usd ?? 0,
    cost_known: patch.cost_known ?? 1,
    gaps: patch.gaps ?? '[]',
    dropped: patch.dropped ?? '[]',
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO windows (id, tenant_id, brand_id, window_label, status, started_at, finished_at,
      planned_runs, actual_runs, cost_usd, cost_known, gaps, dropped, created_at)
     VALUES (@id, @tenant_id, @brand_id, @window_label, @status, @started_at, @finished_at,
      @planned_runs, @actual_runs, @cost_usd, @cost_known, @gaps, @dropped, @created_at)`,
  ).run(row);
  return row;
}

export function getWindow(db: DB, tenantId: string, brandId: string, label: string): Row | undefined {
  return db
    .prepare('SELECT * FROM windows WHERE tenant_id = ? AND brand_id = ? AND window_label = ?')
    .get(tenantId, brandId, label) as Row | undefined;
}

export function listWindows(db: DB, tenantId: string, brandId: string): Row[] {
  return db
    .prepare('SELECT * FROM windows WHERE tenant_id = ? AND brand_id = ? ORDER BY window_label DESC')
    .all(tenantId, brandId) as Row[];
}

// ------------------------------------------------------------------- spending

/** Month-to-date spend, counting only runs whose cost the provider actually told us. */
export function monthToDateSpend(db: DB, tenantId: string, monthPrefix: string): { usd: number; pricedRuns: number; unpricedRuns: number } {
  const priced = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS n FROM model_runs
        WHERE tenant_id = ? AND cost_known = 1 AND requested_at LIKE ?`,
    )
    .get(tenantId, `${monthPrefix}%`) as Row;
  const unpriced = db
    .prepare('SELECT COUNT(*) AS n FROM model_runs WHERE tenant_id = ? AND cost_known = 0 AND requested_at LIKE ?')
    .get(tenantId, `${monthPrefix}%`) as Row;
  return { usd: Number(priced.usd ?? 0), pricedRuns: Number(priced.n ?? 0), unpricedRuns: Number(unpriced.n ?? 0) };
}

export function spendByProvider(db: DB, tenantId: string, monthPrefix: string): Row[] {
  return db
    .prepare(
      `SELECT provider, COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS runs,
              SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpriced
         FROM model_runs WHERE tenant_id = ? AND requested_at LIKE ?
        GROUP BY provider ORDER BY usd DESC`,
    )
    .all(tenantId, `${monthPrefix}%`) as Row[];
}

// --------------------------------------------------------------------- alerts

export interface AlertInput {
  brand_id: string;
  kind: string;
  headline: string;
  detail?: string;
  severity?: string;
  window_label: string;
  subject_key: string;
  link?: string;
  p_value?: number | null;
  effect?: number | null;
  q_value?: number | null;
}

/** Returns the row when it was new, or null when the unique index rejected a duplicate. */
export function insertAlertOnce(db: DB, tenantId: string, a: AlertInput): Row | null {
  const row = {
    id: id('alt'),
    tenant_id: tenantId,
    brand_id: a.brand_id,
    kind: a.kind,
    headline: a.headline,
    detail: a.detail ?? '',
    p_value: a.p_value ?? null,
    effect: a.effect ?? null,
    q_value: a.q_value ?? null,
    window_label: a.window_label,
    subject_key: a.subject_key,
    severity: a.severity ?? 'medium',
    link: a.link ?? '',
    delivered_at: null,
    created_at: nowIso(),
  };
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO alerts (id, tenant_id, brand_id, kind, headline, detail, p_value, effect,
        q_value, window_label, subject_key, severity, link, delivered_at, created_at)
       VALUES (@id, @tenant_id, @brand_id, @kind, @headline, @detail, @p_value, @effect,
        @q_value, @window_label, @subject_key, @severity, @link, @delivered_at, @created_at)`,
    )
    .run(row);
  return res.changes === 1 ? row : null;
}

export function listAlertsFor(db: DB, tenantId: string, brandId: string, limit = 100): Row[] {
  return db
    .prepare('SELECT * FROM alerts WHERE tenant_id = ? AND brand_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(tenantId, brandId, limit) as Row[];
}

export function undeliveredAlerts(db: DB, tenantId: string): Row[] {
  return db
    .prepare('SELECT * FROM alerts WHERE tenant_id = ? AND delivered_at IS NULL ORDER BY created_at')
    .all(tenantId) as Row[];
}

export function markAlertDelivered(db: DB, tenantId: string, alertId: string, at: string): void {
  db.prepare('UPDATE alerts SET delivered_at = ? WHERE tenant_id = ? AND id = ?').run(at, tenantId, alertId);
}

// ------------------------------------------------------------------- delivery

export function createChannel(db: DB, tenantId: string, c: Row): Row {
  const row = {
    id: id('chn'),
    tenant_id: tenantId,
    kind: c.kind,
    target: c.target,
    secret: c.secret ?? '',
    enabled: c.enabled ?? 1,
    min_severity: c.min_severity ?? 'high',
    digest: c.digest ?? 1,
    state: 'ok',
    consecutive_failures: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO delivery_channels (id, tenant_id, kind, target, secret, enabled, min_severity, digest,
      state, consecutive_failures, created_at)
     VALUES (@id, @tenant_id, @kind, @target, @secret, @enabled, @min_severity, @digest,
      @state, @consecutive_failures, @created_at)`,
  ).run(row);
  return row;
}

export function listChannels(db: DB, tenantId: string): Row[] {
  return db.prepare('SELECT * FROM delivery_channels WHERE tenant_id = ? ORDER BY created_at').all(tenantId) as Row[];
}

export function getChannel(db: DB, tenantId: string, channelId: string): Row | undefined {
  return db.prepare('SELECT * FROM delivery_channels WHERE tenant_id = ? AND id = ?').get(tenantId, channelId) as Row | undefined;
}

export function deleteChannel(db: DB, tenantId: string, channelId: string): void {
  db.prepare('DELETE FROM delivery_channels WHERE tenant_id = ? AND id = ?').run(tenantId, channelId);
}

export function setChannelHealth(db: DB, tenantId: string, channelId: string, failures: number, state: string): void {
  db.prepare('UPDATE delivery_channels SET consecutive_failures = ?, state = ? WHERE tenant_id = ? AND id = ?')
    .run(failures, state, tenantId, channelId);
}

export function recordAttempt(db: DB, tenantId: string, a: Row): Row {
  const row = {
    id: id('dla'),
    tenant_id: tenantId,
    alert_id: a.alert_id ?? null,
    channel_id: a.channel_id,
    kind: a.kind ?? 'alert',
    attempt: a.attempt ?? 1,
    status: a.status,
    error: a.error ?? '',
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO delivery_attempts (id, tenant_id, alert_id, channel_id, kind, attempt, status, error, created_at)
     VALUES (@id, @tenant_id, @alert_id, @channel_id, @kind, @attempt, @status, @error, @created_at)`,
  ).run(row);
  return row;
}

export function listAttempts(db: DB, tenantId: string, limit = 50): Row[] {
  return db
    .prepare('SELECT * FROM delivery_attempts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(tenantId, limit) as Row[];
}
