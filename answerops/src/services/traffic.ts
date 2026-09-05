import type { DB } from '../db/index.js';
export const TRAFFIC_SOURCES = [
  'public_site',
  'linkedin',
  'x',
  'producthunt',
  'newsletter',
  'partner',
  'email',
  'paid_search',
  'github',
] as const;
export const LAUNCH_EVENTS = ['landing_view', 'example_view', 'primary_cta'] as const;
export function trafficSource(value: unknown): string {
  const key = typeof value === 'string' && value.length <= 30 ? value.trim().toLowerCase() : '';
  return TRAFFIC_SOURCES.includes(key as (typeof TRAFFIC_SOURCES)[number]) ? key : 'public_site';
}
export function countLaunchEvent(db: DB, source: string, event: string, at: Date): void {
  db.prepare(
    'INSERT INTO launch_counts(day,source,event,count) VALUES (?,?,?,1) ON CONFLICT(day,source,event) DO UPDATE SET count=count+1',
  ).run(at.toISOString().slice(0, 10), trafficSource(source), event);
}
/** Operator-only aggregates. This is deliberately not exposed as a cross-tenant HTTP endpoint. */
export function trafficScorecard(db: DB, since: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(since) ||
    !Number.isFinite(Date.parse(since)) ||
    new Date(since).toISOString().slice(0, 10) !== since
  )
    throw new Error('Use a valid YYYY-MM-DD start date');
  return {
    since,
    caveats: [
      'Browser events are counts, not unique visitors; reloads, blockers and bots affect them.',
      'No provider keys means simulation; simulated or mixed reports do not establish live activation.',
      'Monitoring activation is account setup, not a payment or a human evidence review.',
      'Sources are allowlisted self-reported attribution, not verified acquisition data.',
    ],
    events: db
      .prepare(
        'SELECT source,event,SUM(count) AS count FROM launch_counts WHERE day >= ? GROUP BY source,event ORDER BY source,event',
      )
      .all(since),
    outcomes: db
      .prepare(
        `SELECT q.source, COUNT(*) AS requests,
      SUM(CASE WHEN r.status='complete' AND r.sample_size>0 AND r.simulated_runs=0 AND r.facts_read>0 THEN 1 ELSE 0 END) AS live_with_facts,
      SUM(CASE WHEN r.status='complete' AND r.sample_size>0 AND r.simulated_runs>0 THEN 1 ELSE 0 END) AS simulated_or_mixed,
      SUM(CASE WHEN r.status='complete' AND r.sample_size>0 AND r.simulated_runs=0 AND r.facts_read=0 THEN 1 ELSE 0 END) AS live_without_facts,
      SUM(CASE WHEN r.status='complete' AND r.sample_size=0 THEN 1 ELSE 0 END) AS empty_reports,
      SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN r.status IN ('queued','running') OR r.id IS NULL THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN q.tenant_id IS NOT NULL THEN 1 ELSE 0 END) AS monitoring_activated,
      SUM(CASE WHEN q.tenant_id IS NOT NULL AND r.simulated_runs=0 AND r.sample_size>0 AND r.facts_read>0 THEN 1 ELSE 0 END) AS live_monitoring_activated
      FROM audit_requests q LEFT JOIN audit_reports r ON r.request_id=q.id
      WHERE q.created_at>=? GROUP BY q.source ORDER BY q.source`,
      )
      .all(since),
  };
}
