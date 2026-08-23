/**
 * The gate every mutating request goes through: rate limit, CSRF token, minimum role.
 *
 * These used to be three things that did not exist. `Auth.role` was read into the session and
 * never checked, which meant a read-only user could spend the workspace's sampling budget.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, Harness, get, postForm, postFormNoCsrf, postJson, login, encodeForm } from './helpers.js';
import { VIEWER_EMAIL, VIEWER_PASSWORD, DEMO_EMAIL } from '../../src/seed.js';
import { ROUTE_ROLES, PUBLIC_ROUTES } from '../../src/domain/roles.js';
import { undeclaredMutatingRoutes } from '../../src/server.js';
import { LIMITS } from '../../src/domain/ratelimit.js';
import * as repo from '../../src/db/repo/index.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});

describe('CSRF', () => {
  const MUTATING = [
    ['/sampling/run', { window_label: 'x', budget: '10' }],
    ['/demand/import', { csv: 'gsc,a question,10' }],
    ['/truth', { subject: 'Vanar', predicate: 'pricing', object: '$1', claim_text: 'x', effective_from: '2026-01-01' }],
    ['/schedules', { cadence: 'daily' }],
    ['/channels', { kind: 'email', target: 'a@b.c' }],
  ] as const;

  for (const [url, payload] of MUTATING) {
    it(`refuses ${url} without a token`, async () => {
      const res = await postFormNoCsrf(h.app, url, h.cookie, payload as Record<string, string>);
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('data-testid="forbidden"');
    });
  }

  it('accepts the same request with the token', async () => {
    const res = await postForm(h.app, '/sampling/run', h.cookie, { window_label: 'csrf-ok', budget: '10' });
    expect(res.statusCode).toBe(302);
  });

  it('refuses a token belonging to another session', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/sampling/run',
      payload: encodeForm({ _csrf: 'not-the-right-token', window_label: 'x', budget: '10' }),
      headers: { cookie: h.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes an audit row naming the route it refused', async () => {
    await postFormNoCsrf(h.app, '/sampling/run', h.cookie, { window_label: 'x' });
    const rows = repo.listAudit(h.db, h.info.tenantId);
    expect(rows.some((r) => r.action === 'csrf_rejected' && String(r.target_id).includes('/sampling/run'))).toBe(true);
  });

  it('renders the token into every form the console serves', async () => {
    for (const url of ['/observatory', '/truth', '/schedules', '/alerts']) {
      const res = await get(h.app, url, h.cookie);
      const forms = res.body.match(/<form[^>]*method=["']?post/gi) ?? [];
      if (forms.length === 0) continue;
      const tokens = res.body.match(/name="_csrf"/g) ?? [];
      expect(tokens.length, `${url} has ${forms.length} post forms and ${tokens.length} tokens`).toBeGreaterThanOrEqual(forms.length);
    }
  });

  it('allows a JSON body without a token, which a cross-site form cannot send', async () => {
    const res = await postJson(h.app, '/api/runs/sample', h.cookie, { windowLabel: 'json-path', budget: 10 });
    expect([200, 201]).toContain(res.statusCode);
  });
});

describe('roles', () => {
  it('lets a viewer read every page', async () => {
    const viewer = await login(h.app, VIEWER_EMAIL, VIEWER_PASSWORD);
    for (const url of ['/', '/clusters', '/truth', '/observatory', '/alerts', '/schedules', '/portfolio']) {
      const res = await get(h.app, url, viewer);
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('refuses every editor action to a viewer', async () => {
    const viewer = await login(h.app, VIEWER_EMAIL, VIEWER_PASSWORD);
    const attempts: Array<[string, Record<string, string>]> = [
      ['/sampling/run', { window_label: 'nope', budget: '10' }],
      ['/demand/import', { csv: 'gsc,a question,10' }],
      ['/truth', { subject: 'Vanar', predicate: 'pricing', object: '$1', claim_text: 'x', effective_from: '2026-01-01' }],
    ];
    for (const [url, payload] of attempts) {
      const res = await postForm(h.app, url, viewer, payload);
      expect(res.statusCode, url).toBe(403);
      expect(res.body).toContain('data-testid="forbidden"');
    }
  });

  it('refuses an owner-only action to an editor', async () => {
    const claims = repo.listCanonicalClaims(h.db, h.info.tenantId, h.info.brandId);
    h.db.prepare("UPDATE users SET role = 'editor' WHERE email = ?").run(DEMO_EMAIL);
    const editor = await login(h.app, DEMO_EMAIL, 'miscited-demo');
    const res = await postForm(h.app, `/truth/${claims[0].id}/approve`, editor, {});
    expect(res.statusCode).toBe(403);
  });

  it('records the denial with the role that was needed and the role that was held', async () => {
    const viewer = await login(h.app, VIEWER_EMAIL, VIEWER_PASSWORD);
    await postForm(h.app, '/sampling/run', viewer, { window_label: 'nope' });
    const rows = repo.listAudit(h.db, h.info.tenantId);
    const denial = rows.find((r) => r.action === 'role_denied');
    expect(denial?.summary).toMatch(/needs editor, has viewer/);
  });

  it('did not let the refused action leave a trace in the data', async () => {
    const viewer = await login(h.app, VIEWER_EMAIL, VIEWER_PASSWORD);
    const before = repo.listRuns(h.db, h.info.tenantId, h.info.brandId, 500).length;
    await postForm(h.app, '/sampling/run', viewer, { window_label: 'nope', budget: '10' });
    expect(repo.listRuns(h.db, h.info.tenantId, h.info.brandId, 500).length).toBe(before);
  });
});

describe('the route table cannot be forgotten', () => {
  it('declares a minimum role for every mutating route the server registers', () => {
    const routes = (h.app as unknown as { registeredRoutes: Array<{ method: string; url: string }> }).registeredRoutes;
    expect(routes.length).toBeGreaterThan(20);
    expect(
      undeclaredMutatingRoutes(routes),
      'a mutating route with no declared role is a route nobody decided about',
    ).toEqual([]);
  });

  it('fails to boot when a mutating route is added without one', () => {
    // The same function the boot assertion uses, so the test cannot pass while the server fails.
    expect(undeclaredMutatingRoutes([{ method: 'POST', url: '/brand-new-thing' }])).toEqual(['POST /brand-new-thing']);
  });
});

describe('rate limiting', () => {
  it('locks out repeated failed sign-ins and says when to come back', async () => {
    const limit = LIMITS['POST /login'].limit;
    let last = await h.app.inject({ method: 'POST', url: '/login', payload: encodeForm({ email: DEMO_EMAIL, password: 'wrong' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    for (let i = 1; i < limit + 3; i++) {
      last = await h.app.inject({ method: 'POST', url: '/login', payload: encodeForm({ email: DEMO_EMAIL, password: 'wrong' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    }
    expect(last.statusCode).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
  });

  it('limits anonymous audit requests', async () => {
    const limit = LIMITS['POST /audit-request'].limit;
    let last;
    for (let i = 0; i < limit + 2; i++) {
      last = await postJson(h.app, '/audit-request', '', { email: `a${i}@example.com`, domain: 'example.com' });
    }
    expect(last!.statusCode).toBe(429);
  });
});
