import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import * as repo from '../../src/db/repo/index.js';
import {
  createSchedule,
  claimSchedule,
  upsertWindow,
  getWindow,
  insertAlertOnce,
} from '../../src/db/repo/unattended.js';
import { putSnapshot, pruneSnapshots, countSnapshots } from '../../src/db/repo/snapshots.js';
import { setBrandRole, brandRole } from '../../src/db/repo/agency.js';
const databases: DB[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function world() {
  const db = openDb(':memory:');
  databases.push(db);
  const tenant = repo.createTenant(db, 'First');
  const other = repo.createTenant(db, 'Other');
  const brand = repo.createBrand(db, tenant.id, 'Acme', 'acme.test');
  return { db, tenant: tenant.id, other: other.id, brand: brand.id };
}
describe('replacement repository contracts', () => {
  it('retains tenant isolation through reads, updates and per-brand role upserts', () => {
    const { db, tenant, other, brand } = world();
    const user = repo.createUser(db, tenant, 'EDITOR@ACME.TEST', 'hash', 'salt');
    setBrandRole(db, tenant, user.id, brand, 'editor');
    setBrandRole(db, tenant, user.id, brand, 'viewer');
    expect(brandRole(db, tenant, user.id, brand)).toBe('viewer');
    expect(brandRole(db, other, user.id, brand)).toBeNull();
    expect(repo.getBrand(db, other, brand)).toBeUndefined();
    expect(repo.findUserByEmail(db, 'EDITOR@ACME.TEST')?.email).toBe('editor@acme.test');
  });
  it('makes schedule claims exclusive and window/alert replay idempotent', () => {
    const { db, tenant, brand } = world();
    const schedule = createSchedule(db, tenant, { brand_id: brand, next_run_at: '2026-01-01' });
    expect(claimSchedule(db, tenant, schedule.id, 'worker-a', '2026-01-02', '2026-01-03')).toBe(true);
    expect(claimSchedule(db, tenant, schedule.id, 'worker-b', '2026-01-02', '2026-01-03')).toBe(false);
    const first = upsertWindow(db, tenant, brand, 'w1', { actual_runs: 10 });
    const second = upsertWindow(db, tenant, brand, 'w1', { actual_runs: 20 });
    expect(second.id).toBe(first.id);
    expect(getWindow(db, tenant, brand, 'w1')?.actual_runs).toBe(20);
    const alert = {
      brand_id: brand,
      kind: 'defect',
      headline: 'Acme',
      window_label: 'w1',
      subject_key: 'sso',
    };
    expect(insertAlertOnce(db, tenant, alert)).not.toBeNull();
    expect(insertAlertOnce(db, tenant, alert)).toBeNull();
  });
  it('preserves protected snapshots while pruning only old unprotected records', () => {
    const { db } = world();
    for (const sha256 of ['protected', 'expired', 'recent'])
      putSnapshot(db, {
        sha256,
        url: 'https://acme.test',
        body: 'body',
        bytes: 4,
        contentType: 'text/plain',
        truncated: false,
        httpStatus: 200,
        fetchedAt: sha256 === 'recent' ? '2026-08-01' : '2020-01-01',
      });
    expect(pruneSnapshots(db, '2026-01-01', ['protected'])).toBe(1);
    expect(countSnapshots(db)).toBe(2);
  });
  it('does not let caller payload override the authenticated tenant', () => {
    const { db, tenant, other, brand } = world();
    const event = repo.insertCrawlerEvent(db, tenant, {
      tenant_id: other,
      brand_id: brand,
      user_agent: 'bot',
      bot_name: 'bot',
      bot_class: 'search_index',
      path: '/',
      status_code: 200,
      blocked_by: '',
      occurred_at: '2026-01-01',
    });
    expect(event.tenant_id).toBe(tenant);
    expect(repo.listCrawlerEvents(db, other, brand)).toEqual([]);
  });
  it('rolls back a batch cluster attachment when any member update fails', () => {
    const { db, tenant, brand } = world();
    const first = repo.insertDemandSignal(db, tenant, brand, { source: 'test', question: 'first' });
    const second = repo.insertDemandSignal(db, tenant, brand, { source: 'test', question: 'second' });
    const cluster = repo.createCluster(db, tenant, brand, {
      label: 'Acme',
      intent_family: 'factual',
      buyer_stage: 'evaluation',
    });
    db.exec(
      "CREATE TRIGGER block_second BEFORE UPDATE ON demand_signals WHEN OLD.question = 'second' BEGIN SELECT RAISE(ABORT, 'rejected member'); END",
    );
    expect(() => repo.attachSignalsToCluster(db, tenant, cluster.id, [first.id, second.id])).toThrow(
      'rejected member',
    );
    expect(repo.listDemandSignals(db, tenant, brand).map((row) => row.cluster_id)).toEqual([null, null]);
  });
});

it('executes SQLite distinct aggregation with comma-containing labels', async () => {
  const { sqliteDialect } = await import('../../src/db/dialect.js');
  const { db } = world();
  db.exec("CREATE TABLE labels(value TEXT); INSERT INTO labels VALUES ('a,b'), ('c'), ('a,b')");
  const result = db
    .prepare('SELECT ' + sqliteDialect.groupConcat('value') + ' AS combined FROM labels')
    .get() as { combined: string };
  expect(sqliteDialect.split(result.combined)).toEqual(['a,b', 'c']);
});

it('rejects malformed session expiry and mismatched tenant/user joins', () => {
  const { db, tenant, other, brand } = world();
  const user = repo.createUser(db, tenant, 'session@acme.test', 'hash', 'salt');
  repo.createSession(db, tenant, user.id, 'valid');
  db.prepare('UPDATE sessions SET active_brand_id = ? WHERE id = ?').run(brand, 'valid');
  expect(repo.getSession(db, 'valid')?.active_brand_id).toBe(brand);
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run('not-a-date', 'valid');
  expect(repo.getSession(db, 'valid')).toBeUndefined();
  expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get('valid')).toBeUndefined();
  db.prepare(
    'INSERT INTO sessions (id, tenant_id, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('mismatch', other, user.id, '', '2026-01-01', '2999-01-01');
  expect(repo.getSession(db, 'mismatch')).toBeUndefined();
});
