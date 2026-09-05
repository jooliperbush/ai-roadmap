import { test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manifest from '../fixtures/legacy-manifest.json';
import { openDb } from '../../src/db/index.js';
import * as repo from '../../src/db/repo/index.js';
import { buildServer } from '../../src/server.js';
import { createApplication } from '../../src/runtime/application.js';
import { runtimeConfig } from '../../src/runtime/config.js';

test('upgrades an original-schema database without losing accounts or requiring password reset', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'miscited-upgrade-')),
    file = join(directory, 'legacy.sqlite');
  let db: Database.Database | undefined;
  let app: ReturnType<typeof buildServer> | undefined;
  try {
    db = new Database(file);
    db.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const migration of manifest.protectedFiles.filter((entry) => entry.file.endsWith('.sql'))) {
      db.exec(readFileSync(join(process.cwd(), migration.file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(
        migration.file.split('/').pop(),
        '2026-08-23T00:00:00Z',
      );
    }
    const tenant = repo.createTenant(db, 'Existing customer'),
      brand = repo.createBrand(db, tenant.id, 'Existing brand', 'existing.example');
    const salt = 'unchanged-legacy-salt',
      hash = createHash('sha256').update(`${salt}:existing-password`).digest('hex');
    repo.createUser(db, tenant.id, 'existing@example.com', hash, salt);
    db.close();
    db = openDb(file);
    expect(repo.getBrand(db, tenant.id, brand.id)?.name).toBe('Existing brand');
    expect(repo.findUserByEmail(db, 'existing@example.com')?.password_hash).toBe(hash);
    expect(
      (db.pragma('table_info(sessions)') as Array<{ name: string }>).some(
        (c) => c.name === 'active_brand_id',
      ),
    ).toBe(true);
    app = buildServer({ db });
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'existing@example.com', password: 'existing-password' },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers['set-cookie']).toBeTruthy();
  } finally {
    if (app) await app.close();
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('complete application closes its database once and permits repeated shutdown', async () => {
  const application = await createApplication(
    runtimeConfig({ MISCITED_DB: ':memory:', MISCITED_NO_FETCH: '1', MISCITED_NO_SCHEDULER: '1' }),
  );
  await application.app.ready();
  expect((await application.app.inject('/healthz')).json()).toEqual({ ok: true });
  await Promise.all([application.close(), application.close()]);
  expect(application.db.open).toBe(false);
});
