/**
 * The demo passwords are published in this repository, and the demo owner can start paid sampling. So
 * production seeds nothing, stops accepting the published passwords, and names no demo login on the sign-in page
 * unless told to.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, verifyPassword, type DB } from '../../src/db/index.js';
import * as repo from '../../src/db/repo/index.js';
import { buildServer } from '../../src/server.js';
import { createApplication } from '../../src/runtime/application.js';
import { runtimeConfig } from '../../src/runtime/config.js';
import {
  ensureSeed, seed, DEMO_EMAIL, DEMO_PASSWORD, OTHER_EMAIL, OTHER_PASSWORD, VIEWER_EMAIL, VIEWER_PASSWORD,
} from '../../src/seed.js';
import { login } from './helpers.js';

const SECRET = 'a-long-demo-secret';
const PUBLISHED: Array<[string, string]> = [
  [DEMO_EMAIL, DEMO_PASSWORD],
  [VIEWER_EMAIL, VIEWER_PASSWORD],
  [OTHER_EMAIL, OTHER_PASSWORD],
];
const accepts = (db: DB, email: string, password: string) => {
  const user = repo.findUserByEmail(db, email)!;
  return verifyPassword(password, user.password_hash, user.password_salt);
};
const sessions = (db: DB, email: string) =>
  (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(repo.findUserByEmail(db, email)!.id) as {
    n: number;
  }).n;

describe('demo login', () => {
  it('reads production, the hint switch and the demo password from the environment', () => {
    expect(runtimeConfig({})).toMatchObject({ production: false, showDemoHint: true, demoPassword: null });
    expect(runtimeConfig({ NODE_ENV: 'production' })).toMatchObject({
      production: true,
      showDemoHint: false,
      demoPassword: null,
    });
    expect(runtimeConfig({ NODE_ENV: 'production', MISCITED_SHOW_DEMO_HINT: '1' }).showDemoHint).toBe(true);
    expect(runtimeConfig({ MISCITED_DEMO_PASSWORD: SECRET }).demoPassword).toBe(SECRET);
    expect(() => runtimeConfig({ MISCITED_DEMO_PASSWORD: 'short' })).toThrow(/at least 12 characters/);
  });

  it('seeds nothing in production', async () => {
    const db = openDb(':memory:');
    try {
      expect(await ensureSeed(db, { production: true, demoPassword: SECRET })).toBeNull();
      expect(db.prepare('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM tenants) AS n').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('retires the published passwords on an existing production database and signs those logins out', async () => {
    const db = openDb(':memory:');
    await seed(db);
    const app = buildServer({ db, demoHint: null });
    try {
      await app.ready();
      for (const [email, password] of PUBLISHED) await login(app, email, password);
      expect(await ensureSeed(db, { production: true })).toBeNull();
      for (const [email, password] of PUBLISHED) {
        expect(accepts(db, email, password), email).toBe(false);
        expect(sessions(db, email), email).toBe(0);
      }
      await expect(login(app, DEMO_EMAIL, DEMO_PASSWORD)).rejects.toThrow(/login failed/);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('gives the demo owner MISCITED_DEMO_PASSWORD in production, and keeps it across restarts', async () => {
    const db = openDb(':memory:');
    await seed(db);
    const app = buildServer({ db, demoHint: null });
    try {
      await app.ready();
      expect(await ensureSeed(db, { production: true, demoPassword: SECRET })).toMatchObject({
        email: DEMO_EMAIL,
        password: SECRET,
      });
      await login(app, DEMO_EMAIL, SECRET);
      await expect(login(app, DEMO_EMAIL, DEMO_PASSWORD)).rejects.toThrow(/login failed/);
      expect(accepts(db, VIEWER_EMAIL, VIEWER_PASSWORD) || accepts(db, OTHER_EMAIL, OTHER_PASSWORD)).toBe(false);
      await ensureSeed(db, { production: true, demoPassword: SECRET });
      expect(sessions(db, DEMO_EMAIL), 'a restart with the same password keeps the owner signed in').toBe(1);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('leaves development seeding and passwords as they were', async () => {
    const db = openDb(':memory:');
    try {
      expect(await ensureSeed(db)).toMatchObject({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      expect(await ensureSeed(db)).toMatchObject({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      for (const [email, password] of PUBLISHED) expect(accepts(db, email, password), email).toBe(true);
    } finally {
      db.close();
    }
  });

  it('names the demo login outside production, and in production only when asked to', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'miscited-demo-'));
    const base = { MISCITED_DB: join(directory, 'app.sqlite'), MISCITED_NO_FETCH: '1', MISCITED_NO_SCHEDULER: '1' };
    const hint = async (env: NodeJS.ProcessEnv) => {
      const application = await createApplication(runtimeConfig({ ...base, ...env }));
      try {
        const page = await application.app.inject('/login');
        return /data-testid="demo-hint">([^<]*)</.exec(page.body)?.[1] ?? null;
      } finally {
        await application.close();
      }
    };
    try {
      expect(await hint({})).toBe(`Demo workspace: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
      const production = { NODE_ENV: 'production', MISCITED_DEMO_PASSWORD: SECRET };
      expect(await hint(production)).toBeNull();
      expect(await hint({ ...production, MISCITED_SHOW_DEMO_HINT: '1' })).toBe(`Demo workspace: ${DEMO_EMAIL} / ${SECRET}`);
      expect(await hint({ NODE_ENV: 'production', MISCITED_SHOW_DEMO_HINT: '1' }), 'a locked login is not named').toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
