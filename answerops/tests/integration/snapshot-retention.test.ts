/**
 * Snapshot retention runs on the background loop.
 *
 * The methodology page and the privacy policy both say that page copies nothing relies on are
 * pruned after SNAPSHOT_RETENTION_DAYS. That is only true if something calls the prune, so the
 * loop is asserted to do it once a UTC day. What the prune protects is asserted in evidence.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import * as snaps from '../../src/db/repo/snapshots.js';
import { TestClock } from '../../src/domain/clock.js';
import { SNAPSHOT_RETENTION_DAYS } from '../../src/domain/fetcher.js';
import { Scheduler } from '../../src/services/scheduler.js';

const DAY = 86_400_000;
const databases: DB[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function world(start: string) {
  const db = openDb(':memory:');
  databases.push(db);
  const clock = new TestClock(start);
  const sha = (name: string) => name.padEnd(64, '0');
  const put = (name: string, ageDays: number) =>
    snaps.putSnapshot(db, {
      sha256: sha(name),
      url: `https://cited.example/${name}`,
      body: name,
      bytes: name.length,
      contentType: 'text/html',
      truncated: false,
      httpStatus: 200,
      fetchedAt: new Date(+clock.now() - ageDays * DAY).toISOString(),
    });
  const kept = (name: string) => snaps.getSnapshot(db, sha(name)) !== undefined;
  return { clock, put, kept, scheduler: new Scheduler(db, { clock }) };
}

describe('snapshot retention', () => {
  it('prunes unreferenced snapshots past the retention period on the first pass of each UTC day', async () => {
    const { clock, put, kept, scheduler } = world('2026-09-24T06:00:00.000Z');
    put('expired', SNAPSHOT_RETENTION_DAYS + 1);
    put('recent', SNAPSHOT_RETENTION_DAYS - 10);
    await scheduler.runOnce();
    expect(kept('expired')).toBe(false);
    expect(kept('recent')).toBe(true);

    // One sweep a day: a snapshot found expired later that day waits for the next day's first pass.
    put('later', SNAPSHOT_RETENTION_DAYS + 1);
    clock.advanceHours(12);
    await scheduler.runOnce();
    expect(kept('later')).toBe(true);
    clock.advanceHours(12);
    await scheduler.runOnce();
    expect(kept('later')).toBe(false);
    expect(kept('recent')).toBe(true);
  });
});
