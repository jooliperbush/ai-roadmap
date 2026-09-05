/**
 * Re-checking a citation.
 *
 * The value of a snapshot is that it still exists when the page has changed. This is the
 * other half: noticing that it changed. A page that supported a claim in March and does not
 * in August is a regression in the evidence a model is drawing on, and it is invisible unless
 * something looks again.
 */

import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as snaps from '../db/repo/snapshots.js';
import * as sched from '../db/repo/unattended.js';
import { checkCitation } from '../domain/verifier.js';
import { textOf, type Fetcher } from '../domain/fetcher.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';

export interface DiffLine {
  side: 'added' | 'removed';
  text: string;
}

export interface RecheckResult {
  citationId: string;
  before: string;
  after: string;
  changed: boolean;
  regressed: boolean;
  diff: DiffLine[];
  error: string | null;
  snapshotSha: string | null;
}

/**
 * Refetch one citation, re-run the support check against the fresh page, and report what
 * moved. A support that falls from `supports` to `absent` raises `citation_regressed`.
 */
export async function recheckCitation(
  db: DB,
  tenantId: string,
  citationId: string,
  fetcher: Fetcher,
  clock: Clock = systemClock,
): Promise<RecheckResult> {
  const citation = repo.getCitation(db, tenantId, citationId);
  if (!citation) throw new Error('citation not found');
  const run = repo.getRun(db, tenantId, citation.run_id);
  const brand = run ? repo.getBrand(db, tenantId, run.brand_id) : undefined;
  const before = String(citation.support);
  const fetched = await fetcher.fetch(citation.url);
  const baseCheck = {
    source_class: citation.source_class,
    checked_claim: citation.checked_claim,
    snapshot_sha256: citation.snapshot_sha256,
    snapshot_fetched_at: citation.snapshot_fetched_at,
  };
  if (!fetched.ok || fetched.body === null || !fetched.sha256) {
    repo.updateCitationCheck(db, tenantId, citationId, {
      ...baseCheck,
      support: 'unreachable',
      reason: `Re-check could not retrieve the page (${fetched.error}).`,
      http_status: fetched.status,
      fetch_error: fetched.error,
    });
    return {
      citationId,
      before,
      after: 'unreachable',
      changed: before !== 'unreachable',
      regressed: false,
      diff: [],
      error: fetched.error,
      snapshotSha: null,
    };
  }
  const text = textOf(fetched.body);
  const check = checkCitation({
    url: citation.url,
    snapshotText: text,
    claimObject: citation.checked_claim || brand?.name || '',
    claimSubject: brand?.name ?? '',
    ownedDomains: brand ? [brand.domain] : [],
  });
  const previous = citation.snapshot_sha256 ? snaps.getSnapshot(db, citation.snapshot_sha256) : undefined;
  const regressed = before === 'supports' && check.support === 'absent';
  const result: RecheckResult = {
    citationId,
    before,
    after: check.support,
    changed: before !== check.support,
    regressed,
    diff: previous
      ? diffAroundClaim(textOf(previous.body as string), text, citation.checked_claim || '')
      : [],
    error: null,
    snapshotSha: fetched.sha256,
  };
  db.transaction(() => {
    snaps.putSnapshot(db, {
      sha256: fetched.sha256!,
      url: citation.url,
      body: fetched.body!,
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      truncated: fetched.truncated,
      httpStatus: fetched.status,
      fetchedAt: fetched.fetchedAt,
    });
    repo.updateCitationCheck(db, tenantId, citationId, {
      ...baseCheck,
      support: check.support,
      source_class: check.sourceClass,
      reason: check.reason,
      snapshot_sha256: fetched.sha256,
      snapshot_fetched_at: fetched.fetchedAt,
      http_status: fetched.status,
      fetch_error: null,
    });
    if (regressed && run)
      sched.insertAlertOnce(db, tenantId, {
        brand_id: run.brand_id,
        kind: 'citation_regressed',
        severity: 'high',
        window_label: run.window_label,
        subject_key: citation.url,
        headline: `A page that used to support a cited claim no longer does: ${citation.url} (checked ${fetched.fetchedAt.slice(0, 10)}, n=1 page).`,
        detail:
          `The claim checked was "${citation.checked_claim}". On the earlier snapshot the page contained it; ` +
          'on the current fetch it does not. The earlier snapshot is retained, so the change is inspectable.',
        link: `/runs/${citation.run_id}`,
      });
    repo.audit(
      db,
      tenantId,
      'system',
      'citation_recheck',
      'citation',
      citationId,
      `${before} -> ${check.support}`,
    );
  })();
  return result;
}

/**
 * The lines around the claim that changed. Not a general diff: a customer looking at this
 * wants to know whether the sentence they were relying on is still there, not to review the
 * page's whole edit history.
 */
export function diffAroundClaim(before: string, after: string, claim: string, context = 2): DiffLine[] {
  const needle = claim.trim().toLowerCase();
  const excerpt = (text: string) => {
    const lines = text
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const position = needle ? lines.findIndex((line) => line.toLowerCase().includes(needle)) : 0;
    return new Set(
      position < 0
        ? []
        : lines.slice(
            needle ? Math.max(0, position - context) : 0,
            needle ? position + context + 1 : context * 2 + 1,
          ),
    );
  };
  const oldLines = excerpt(before),
    newLines = excerpt(after);
  return [
    ...[...oldLines]
      .filter((line) => !newLines.has(line))
      .map((text) => ({ side: 'removed' as const, text })),
    ...[...newLines].filter((line) => !oldLines.has(line)).map((text) => ({ side: 'added' as const, text })),
  ];
}

/** Retention sweep across every tenant, keeping whatever a live finding leans on. */
export function pruneOldSnapshots(db: DB, olderThanIso: string): number {
  return db.transaction(() => {
    const references = repo.listTenants(db).flatMap((tenant) => snaps.protectedHashesFor(db, tenant.id));
    return snaps.pruneSnapshots(db, olderThanIso, Array.from(new Set(references)));
  })();
}
