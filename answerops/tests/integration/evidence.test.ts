/**
 * The evidence locker.
 *
 * The assertion that matters most in this file is the first one: a live-shaped provider run
 * whose citations get fetched produces `supports`, not `unreachable`. Before Phase 2 that path
 * returned `unreachable` on every row, which meant the product's headline capability returned
 * nothing the moment a customer supplied real API keys.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import { seed, type SeedInfo } from '../../src/seed.js';
import * as repo from '../../src/db/repo/index.js';
import * as snaps from '../../src/db/repo/snapshots.js';
import * as sched from '../../src/db/repo/unattended.js';
import { runSamplingRound } from '../../src/services/observatory.js';
import { recheckCitation, diffAroundClaim, pruneOldSnapshots } from '../../src/services/recheck.js';
import { StubFetcher, sha256Of, SNAPSHOT_RETENTION_DAYS } from '../../src/domain/fetcher.js';
import { TestClock } from '../../src/domain/clock.js';
import type { ProviderAdapter, RunRequest, RunResult, SurfaceDescriptor } from '../../src/providers/types.js';

const SURFACE: SurfaceDescriptor = {
  provider: 'liveish', modelId: 'gpt-5.1', modelVersion: 'gpt-5.1', surface: 'api',
  grounding: 'grounded_search', searchMode: 'web_search', label: 'liveish',
};

const CITED_URL = 'https://docs.example.com/fees';

/**
 * Shaped exactly like a live adapter: it returns citations with `snapshotText: null`, because
 * a real provider hands back a URL and nothing else. Everything downstream has to fetch.
 */
class LiveShaped implements ProviderAdapter {
  key = 'liveish';
  displayName = 'Live-shaped';
  surfaces = [SURFACE];
  constructor(private answer: string) {}
  available() { return true; }
  async run(_req: RunRequest): Promise<RunResult> {
    return {
      answerText: this.answer,
      citations: [{ url: CITED_URL, title: 'Fees', snapshotText: null }],
      searchQueries: ['fees'],
      latencyMs: 5,
      costUsd: 0.004,
      simulated: false,
      systemConfigHash: 'live:1',
      modelVersion: 'gpt-5.1',
    };
  }
}

let db: DB;
let info: SeedInfo;
let clock: TestClock;

beforeEach(async () => {
  db = openDb(':memory:');
  info = await seed(db);
  clock = new TestClock('2026-06-01T00:00:00.000Z');
});

async function liveRound(page: Record<string, { body?: string; error?: any }>, answer: string, label = 'live') {
  const fetcher = new StubFetcher(page, () => clock.now());
  await runSamplingRound(db, {
    tenantId: info.tenantId, brandId: info.brandId, windowLabel: label, budget: 10,
    actor: 'test', providers: [new LiveShaped(answer)], clock, fetcher,
  });
  return repo.runsForWindow(db, info.tenantId, info.brandId, label)
    .flatMap((r) => repo.citationsForRun(db, info.tenantId, r.id));
}

describe('a live-shaped run with fetching', () => {
  it('returns supports for a page that contains the claim', async () => {
    const citations = await liveRound(
      { [CITED_URL]: { body: '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>' } },
      'Vanar transaction fees are approximately $0.0008.',
    );
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.support === 'supports'),
      'this is the assertion that proves the wedge works against a real provider').toBe(true);
  });

  it('stores the snapshot content-addressed and links it from the citation', async () => {
    const body = '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>';
    const citations = await liveRound({ [CITED_URL]: { body } }, 'Vanar transaction fees are approximately $0.0008.');
    const supported = citations.find((c) => c.support === 'supports')!;
    expect(supported.snapshot_sha256).toBe(sha256Of(body));
    expect(supported.snapshot_fetched_at).toBeTruthy();
    expect(supported.http_status).toBe(200);
    expect(snaps.getSnapshot(db, supported.snapshot_sha256)).toBeTruthy();
  });

  it('says why a page was unreachable instead of shrugging', async () => {
    const citations = await liveRound({}, 'Vanar transaction fees are approximately $0.0008.', 'gone');
    const first = citations[0];
    expect(first.support).toBe('unreachable');
    expect(first.fetch_error).toBe('http_404');
    expect(first.reason).toContain('http_404');
  });

  it('records absent when the page loads but does not contain the claim', async () => {
    const citations = await liveRound(
      { [CITED_URL]: { body: '<p>A page about something else entirely.</p>' } },
      'Vanar transaction fees are approximately $0.0008.',
      'absent',
    );
    expect(citations.every((c) => c.support !== 'supports')).toBe(true);
    expect(citations[0].snapshot_sha256, 'we still keep what we read, even when it did not help').toBeTruthy();
  });

  it('deduplicates identical pages across runs by content hash', async () => {
    const body = '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>';
    await liveRound({ [CITED_URL]: { body } }, 'Vanar transaction fees are approximately $0.0008.', 'a');
    const before = snaps.countSnapshots(db);
    await liveRound({ [CITED_URL]: { body } }, 'Vanar transaction fees are approximately $0.0008.', 'b');
    expect(snaps.countSnapshots(db)).toBe(before);
  });
});

describe('re-checking', () => {
  it('flips support and raises a regression alert when the page changes', async () => {
    const claim = 'Vanar transaction fees are approximately $0.0008.';
    const citations = await liveRound(
      { [CITED_URL]: { body: '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>' } },
      claim,
    );
    const supported = citations.find((c) => c.support === 'supports')!;

    clock.advanceDays(30);
    const changed = new StubFetcher({ [CITED_URL]: { body: '<p>Our pricing page has moved.</p>' } }, () => clock.now());
    const result = await recheckCitation(db, info.tenantId, supported.id, changed, clock);

    expect(result.before).toBe('supports');
    expect(result.after).toBe('absent');
    expect(result.regressed).toBe(true);
    const alerts = sched.listAlertsFor(db, info.tenantId, info.brandId).filter((a) => a.kind === 'citation_regressed');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].headline).toMatch(/n=1 page/);
  });

  it('keeps the earlier snapshot so the change is inspectable', async () => {
    const oldBody = '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>';
    const citations = await liveRound({ [CITED_URL]: { body: oldBody } }, 'Vanar transaction fees are approximately $0.0008.');
    const supported = citations.find((c) => c.support === 'supports')!;
    clock.advanceDays(1);
    await recheckCitation(db, info.tenantId, supported.id, new StubFetcher({ [CITED_URL]: { body: '<p>changed</p>' } }, () => clock.now()), clock);
    expect(snaps.getSnapshot(db, sha256Of(oldBody)), 'the point of a snapshot is that it outlives the page').toBeTruthy();
  });

  it('does not raise an alert when nothing changed', async () => {
    const body = '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>';
    const citations = await liveRound({ [CITED_URL]: { body } }, 'Vanar transaction fees are approximately $0.0008.');
    const supported = citations.find((c) => c.support === 'supports')!;
    const before = sched.listAlertsFor(db, info.tenantId, info.brandId).length;
    const result = await recheckCitation(db, info.tenantId, supported.id, new StubFetcher({ [CITED_URL]: { body } }, () => clock.now()), clock);
    expect(result.changed).toBe(false);
    expect(sched.listAlertsFor(db, info.tenantId, info.brandId)).toHaveLength(before);
  });

  it('records an unreachable re-check without destroying the earlier verdict history', async () => {
    const citations = await liveRound(
      { [CITED_URL]: { body: '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>' } },
      'Vanar transaction fees are approximately $0.0008.',
    );
    const supported = citations.find((c) => c.support === 'supports')!;
    const result = await recheckCitation(db, info.tenantId, supported.id, new StubFetcher({}, () => clock.now()), clock);
    expect(result.after).toBe('unreachable');
    expect(result.error).toBe('http_404');
    expect(snaps.getSnapshot(db, supported.snapshot_sha256)).toBeTruthy();
  });
});

describe('the diff around a claim', () => {
  it('shows only what changed near the sentence being relied on', () => {
    const before = 'Intro sentence. Fees are $0.0008 per transaction. Closing sentence.';
    const after = 'Intro sentence. Fees are $0.0025 per transaction. Closing sentence.';
    const diff = diffAroundClaim(before, after, '$0.0008');
    expect(diff.some((d) => d.side === 'removed' && d.text.includes('$0.0008'))).toBe(true);
  });

  it('returns nothing when the claim never appeared', () => {
    expect(diffAroundClaim('a. b.', 'a. c.', 'nowhere in either')).toEqual([]);
  });
});

describe('retention', () => {
  it('keeps a snapshot an open finding depends on and prunes one nothing refers to', async () => {
    const body = '<p>Vanar transaction fees are approximately $0.0008 per transaction.</p>';
    await liveRound({ [CITED_URL]: { body } }, 'Vanar transaction fees are approximately $0.0008.');
    const referenced = sha256Of(body);

    snaps.putSnapshot(db, {
      sha256: 'orphan'.padEnd(64, '0'), url: 'https://nobody.example/', body: 'x', bytes: 1,
      contentType: 'text/html', truncated: false, httpStatus: 200,
      fetchedAt: '2020-01-01T00:00:00.000Z',
    });

    const cutoff = new Date(clock.now().getTime() - SNAPSHOT_RETENTION_DAYS * 86_400_000).toISOString();
    const pruned = pruneOldSnapshots(db, cutoff);
    expect(pruned).toBe(1);
    expect(snaps.getSnapshot(db, 'orphan'.padEnd(64, '0'))).toBeUndefined();
    expect(snaps.getSnapshot(db, referenced)).toBeTruthy();
  });
});
