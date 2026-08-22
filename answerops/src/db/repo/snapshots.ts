/**
 * Snapshot store.
 *
 * Content-addressed and deliberately not tenant-scoped: a snapshot is a copy of a public page
 * keyed by the hash of its bytes, so two customers citing the same page share one row. The
 * tenant-specific fact — that this workspace's answer cited that page — lives on `citations`.
 */

import type { DB } from '../index.js';
import type { Row } from './index.js';

export function putSnapshot(db: DB, s: {
  sha256: string; url: string; body: string; bytes: number; contentType: string;
  truncated: boolean; httpStatus: number | null; fetchedAt: string;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO snapshots (sha256, url, body, bytes, content_type, truncated, http_status, fetched_at)
     VALUES (@sha256, @url, @body, @bytes, @content_type, @truncated, @http_status, @fetched_at)`,
  ).run({
    sha256: s.sha256,
    url: s.url,
    body: s.body,
    bytes: s.bytes,
    content_type: s.contentType,
    truncated: s.truncated ? 1 : 0,
    http_status: s.httpStatus,
    fetched_at: s.fetchedAt,
  });
}

export function getSnapshot(db: DB, sha256: string): Row | undefined {
  return db.prepare('SELECT * FROM snapshots WHERE sha256 = ?').get(sha256) as Row | undefined;
}

export function countSnapshots(db: DB): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as Row).n);
}

/**
 * Snapshots one tenant's live findings depend on. A citation that shows a page contradicting
 * or missing the claim is the evidence for a defect, and the evidence has to outlive the page.
 * Tenant-scoped so the retention job composes from per-tenant answers rather than a
 * cross-tenant query the isolation lint would rightly reject.
 */
export function protectedHashesFor(db: DB, tenantId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT c.snapshot_sha256 AS sha FROM citations c
        WHERE c.tenant_id = ? AND c.snapshot_sha256 IS NOT NULL
          AND (c.support IN ('contradicts', 'absent', 'supports')
               OR c.run_id IN (
                 SELECT r.id FROM model_runs r
                  WHERE r.tenant_id = ? AND r.window_label IN (
                    SELECT e.post_window FROM experiments e WHERE e.tenant_id = ? AND e.verdict = 'confirmed'
                  )
               ))`,
    )
    .all(tenantId, tenantId, tenantId) as Row[];
  return rows.map((r) => r.sha as string);
}

/**
 * Retention. Anything referenced by an open defect or a confirmed experiment is kept
 * indefinitely, because the value of a snapshot is precisely that it still exists when the
 * page has changed.
 */
export function pruneSnapshots(db: DB, olderThanIso: string, protectedHashes: string[]): number {
  const keep = new Set(protectedHashes);
  const stale = db.prepare('SELECT sha256 FROM snapshots WHERE fetched_at < ?').all(olderThanIso) as Row[];
  const drop = stale.map((r) => r.sha256 as string).filter((h) => !keep.has(h));
  const stmt = db.prepare('DELETE FROM snapshots WHERE sha256 = ?');
  let n = 0;
  for (const h of drop) n += stmt.run(h).changes;
  return n;
}
