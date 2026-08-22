import { openDb, DB } from '../../src/db/index.js';
import { buildServer } from '../../src/server.js';
import { seed, DEMO_EMAIL, DEMO_PASSWORD, OTHER_EMAIL, OTHER_PASSWORD, SeedInfo } from '../../src/seed.js';
import { VANAR_AFTER, VANAR_BEFORE } from '../../seed/simulation.js';
import type { FastifyInstance } from 'fastify';

export interface Harness {
  db: DB;
  app: FastifyInstance;
  info: SeedInfo;
  cookie: string;
  otherCookie: string;
}

/**
 * Cookie to CSRF token. Forms carry the token, so a test that posts a form has to have it;
 * looking it up here rather than at every call site keeps the tests about the feature under
 * test instead of about the security hook.
 */
const csrfByCookie = new Map<string, string>();

export function csrfFor(cookie: string): string {
  return csrfByCookie.get(cookie) ?? '';
}

export async function makeHarness(overrides: Partial<Parameters<typeof buildServer>[0]> = {}): Promise<Harness> {
  const db = openDb(':memory:');
  const info = await seed(db);
  const app = buildServer({
    db,
    beliefsFor: (w) => (w === 'baseline' ? VANAR_BEFORE : VANAR_AFTER),
    demoHint: null,
    ...overrides,
  });
  await app.ready();
  const cookie = await login(app, DEMO_EMAIL, DEMO_PASSWORD);
  const otherCookie = await login(app, OTHER_EMAIL, OTHER_PASSWORD);
  return { db, app, info, cookie, otherCookie };
}

export function encodeForm(payload: Record<string, string>): string {
  return new URLSearchParams(payload).toString();
}

export async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/login',
    payload: encodeForm({ email, password }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.headers.location ?? ''}`);
  const cookie = header.split(';')[0];
  const sid = cookie.split('=')[1];
  const row = (app as any).db ?? null;
  if (row) {
    const s = row.prepare('SELECT csrf FROM sessions WHERE id = ?').get(sid) as { csrf?: string } | undefined;
    if (s?.csrf) csrfByCookie.set(cookie, s.csrf);
  }
  return cookie;
}

export function get(app: FastifyInstance, url: string, cookie: string) {
  return app.inject({ method: 'GET', url, headers: { cookie } });
}

export function postForm(app: FastifyInstance, url: string, cookie: string, payload: Record<string, string>) {
  return app.inject({
    method: 'POST', url, payload: encodeForm({ _csrf: csrfFor(cookie), ...payload }),
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
}

/** Deliberately omits the token, for the tests that assert the CSRF gate actually gates. */
export function postFormNoCsrf(app: FastifyInstance, url: string, cookie: string, payload: Record<string, string>) {
  return app.inject({
    method: 'POST', url, payload: encodeForm(payload),
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
}

export function postJson(app: FastifyInstance, url: string, cookie: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST', url, payload: JSON.stringify(payload),
    headers: { cookie, 'content-type': 'application/json' },
  });
}
