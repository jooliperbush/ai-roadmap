import { statements, atomic } from './statements.js';
/**
 * Snapshot store.
 *
 * Content-addressed and deliberately not tenant-scoped: a snapshot is a copy of a public page
 * keyed by the hash of its bytes, so two customers citing the same page share one row. The
 * tenant-specific fact — that this workspace's answer cited that page — lives on `citations`.
 */

import type { DB } from '../index.js';
export interface SnapshotRow {
  sha256: string;
  url: string;
  body: string;
  bytes: number;
  content_type: string;
  truncated: number;
  http_status: number | null;
  fetched_at: string;
}

export function putSnapshot(
  db: DB,
  s: {
    sha256: string;
    url: string;
    body: string;
    bytes: number;
    contentType: string;
    truncated: boolean;
    httpStatus: number | null;
    fetchedAt: string;
  },
): void {
  const record = {
    sha256: s.sha256,
    url: s.url,
    body: s.body,
    bytes: s.bytes,
    content_type: s.contentType,
    truncated: Number(s.truncated),
    http_status: s.httpStatus,
    fetched_at: s.fetchedAt,
  };
  statements(db)
    .prepare(
      'INSERT INTO snapshots (sha256, url, body, bytes, content_type, truncated, http_status, fetched_at) VALUES (@sha256, @url, @body, @bytes, @content_type, @truncated, @http_status, @fetched_at) ON CONFLICT(sha256) DO UPDATE SET url=excluded.url, body=excluded.body, bytes=excluded.bytes, content_type=excluded.content_type, truncated=excluded.truncated, http_status=excluded.http_status, fetched_at=excluded.fetched_at',
    )
    .run(record);
}

export function getSnapshot(db: DB, sha256: string): SnapshotRow | undefined {
  return statements(db).prepare('SELECT * FROM snapshots WHERE sha256 = ?').get(sha256) as
    | SnapshotRow
    | undefined;
}

export function countSnapshots(db: DB): number {
  return Number((statements(db).prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n);
}

/**
 * Snapshots one tenant's live findings depend on. A citation that shows a page contradicting
 * or missing the claim is the evidence for a defect, and the evidence has to outlive the page.
 * Tenant-scoped so the retention job composes from per-tenant answers rather than a
 * cross-tenant query the isolation lint would rightly reject.
 */
export function protectedHashesFor(db: DB, tenantId: string): string[] {
  const rows = statements(db)
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
    .all(tenantId, tenantId, tenantId) as Array<{ sha: string }>;
  return rows.map((r) => r.sha as string);
}

/**
 * Retention. Anything referenced by an open defect or a confirmed experiment is kept
 * indefinitely, because the value of a snapshot is precisely that it still exists when the
 * page has changed.
 */
export function pruneSnapshots(db: DB, olderThanIso: string, protectedHashes: string[]): number {
  return atomic(db, () => {
    const protectedSet = new Set(protectedHashes);
    const records = statements(db)
      .prepare('SELECT sha256 FROM snapshots WHERE fetched_at < ?')
      .all(olderThanIso) as Array<{ sha256: string }>;
    const remove = statements(db).prepare('DELETE FROM snapshots WHERE sha256 = ?');
    return records.reduce(
      (deleted, record) =>
        protectedSet.has(record.sha256) ? deleted : deleted + remove.run(record.sha256).changes,
      0,
    );
  });
}
