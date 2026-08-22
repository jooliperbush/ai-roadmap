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
  const before = citation.support as string;

  const outcome = await fetcher.fetch(citation.url);
  if (!outcome.ok || outcome.body === null || !outcome.sha256) {
    repo.updateCitationCheck(db, tenantId, citationId, {
      support: 'unreachable',
      source_class: citation.source_class,
      reason: `Re-check could not retrieve the page (${outcome.error}).`,
      snapshot_sha256: citation.snapshot_sha256,
      snapshot_fetched_at: citation.snapshot_fetched_at,
      http_status: outcome.status,
      fetch_error: outcome.error,
      checked_claim: citation.checked_claim,
    });
    return {
      citationId, before, after: 'unreachable', changed: before !== 'unreachable',
      regressed: false, diff: [], error: outcome.error, snapshotSha: null,
    };
  }

  const previous = citation.snapshot_sha256 ? snaps.getSnapshot(db, citation.snapshot_sha256) : undefined;
  snaps.putSnapshot(db, {
    sha256: outcome.sha256,
    url: citation.url,
    body: outcome.body,
    bytes: outcome.bytes,
    contentType: outcome.contentType,
    truncated: outcome.truncated,
    httpStatus: outcome.status,
    fetchedAt: outcome.fetchedAt,
  });

  const snapshotText = textOf(outcome.body);
  const check = checkCitation({
    url: citation.url,
    snapshotText,
    claimObject: citation.checked_claim || brand?.name || '',
    claimSubject: brand?.name ?? '',
    ownedDomains: brand ? [brand.domain] : [],
  });

  repo.updateCitationCheck(db, tenantId, citationId, {
    support: check.support,
    source_class: check.sourceClass,
    reason: check.reason,
    snapshot_sha256: outcome.sha256,
    snapshot_fetched_at: outcome.fetchedAt,
    http_status: outcome.status,
    fetch_error: null,
    checked_claim: citation.checked_claim,
  });

  const diff = previous
    ? diffAroundClaim(textOf(previous.body as string), snapshotText, citation.checked_claim || '')
    : [];
  const regressed = before === 'supports' && check.support === 'absent';

  if (regressed && run) {
    sched.insertAlertOnce(db, tenantId, {
      brand_id: run.brand_id,
      kind: 'citation_regressed',
      severity: 'high',
      window_label: run.window_label,
      subject_key: citation.url,
      headline: `A page that used to support a cited claim no longer does: ${citation.url} (checked ${outcome.fetchedAt.slice(0, 10)}, n=1 page).`,
      detail:
        `The claim checked was "${citation.checked_claim}". On the earlier snapshot the page contained it; ` +
        'on the current fetch it does not. The earlier snapshot is retained, so the change is inspectable.',
      link: `/runs/${citation.run_id}`,
    });
  }

  repo.audit(db, tenantId, 'system', 'citation_recheck', 'citation', citationId, `${before} -> ${check.support}`);

  return {
    citationId,
    before,
    after: check.support,
    changed: before !== check.support,
    regressed,
    diff,
    error: null,
    snapshotSha: outcome.sha256,
  };
}

/**
 * The lines around the claim that changed. Not a general diff: a customer looking at this
 * wants to know whether the sentence they were relying on is still there, not to review the
 * page's whole edit history.
 */
export function diffAroundClaim(before: string, after: string, claim: string, context = 2): DiffLine[] {
  const beforeLines = sentences(before);
  const afterLines = sentences(after);
  const needle = claim.trim().toLowerCase();
  const relevant = (list: string[]) => {
    if (!needle) return list.slice(0, context * 2 + 1);
    const idx = list.findIndex((l) => l.toLowerCase().includes(needle));
    if (idx < 0) return [];
    return list.slice(Math.max(0, idx - context), idx + context + 1);
  };
  const b = new Set(relevant(beforeLines));
  const a = new Set(relevant(afterLines));
  const out: DiffLine[] = [];
  for (const line of b) if (!a.has(line)) out.push({ side: 'removed', text: line });
  for (const line of a) if (!b.has(line)) out.push({ side: 'added', text: line });
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Retention sweep across every tenant, keeping whatever a live finding leans on. */
export function pruneOldSnapshots(db: DB, olderThanIso: string): number {
  const keep = new Set<string>();
  for (const t of repo.listTenants(db)) {
    for (const h of snaps.protectedHashesFor(db, t.id)) keep.add(h);
  }
  return snaps.pruneSnapshots(db, olderThanIso, [...keep]);
}
