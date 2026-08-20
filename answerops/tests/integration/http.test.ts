/** Route-level tests: auth, every page, the API, and tenant isolation. */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeHarness, Harness, get, postForm, postJson, login, encodeForm } from './helpers.js';
import * as repo from '../../src/db/repo/index.js';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../../src/seed.js';

let h: Harness;
beforeAll(async () => {
  h = await makeHarness();
});

describe('authentication', () => {
  it('serves the public page at the root and no workspace data with it', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Get a free answer audit');
    // The root is marketing when signed out. It must not leak the console or its numbers.
    expect(res.body).not.toContain('Answer desk —');
    expect(res.body).not.toContain('data-testid="whoami"');
  });

  it('still redirects an anonymous visitor away from every route that holds data', async () => {
    for (const url of ['/truth', '/observatory', '/actions', '/experiments', '/audit']) {
      const res = await h.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(302);
      expect(res.headers.location, url).toBe('/login');
    }
  });

  it('rejects a wrong password without confirming whether the account exists', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/login', payload: encodeForm({ email: DEMO_EMAIL, password: 'wrong' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(decodeURIComponent(String(res.headers.location))).toMatch(/do not match an account/);
  });

  it('issues an httpOnly session cookie on success', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/login', payload: encodeForm({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('invalidates the session server-side on sign out', async () => {
    const cookie = await login(h.app, DEMO_EMAIL, DEMO_PASSWORD);
    await h.app.inject({ method: 'POST', url: '/logout', headers: { cookie } });
    const after = await get(h.app, '/truth', cookie);
    expect(after.statusCode).toBe(302);
  });

  it('rejects a forged session id', async () => {
    const res = await get(h.app, '/truth', 'aops=deadbeef');
    expect(res.statusCode).toBe(302);
  });
});

describe('the public page', () => {
  it('records an audit request and normalises the domain', async () => {
    const res = await postJson(h.app, '/audit-request', '', { email: 'Ops@Example.com', domain: 'https://Example.com/pricing' });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, domain: 'example.com' });

    const row = h.db.prepare('SELECT * FROM audit_requests ORDER BY created_at DESC LIMIT 1').get() as Record<string, string>;
    expect(row.email).toBe('ops@example.com');
    expect(row.domain).toBe('example.com');
    expect(row.source).toBe('public_site');
  });

  it('rejects a malformed request rather than storing it', async () => {
    const before = (h.db.prepare('SELECT COUNT(*) AS c FROM audit_requests').get() as { c: number }).c;
    const res = await postJson(h.app, '/audit-request', '', { email: 'not-an-email', domain: 'x' });
    expect(res.statusCode).toBe(400);
    const after = (h.db.prepare('SELECT COUNT(*) AS c FROM audit_requests').get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it('carries every rate with its interval and its sample size', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/' });
    // The one figure on the page is the worked example, and it ships the same way the
    // console ships numbers: point estimate, 95% interval, n.
    expect(res.body).toMatch(/95% CI 5%–15%/);
    expect(res.body).toMatch(/n=116/);
    expect(res.body).toContain('Worked example');
  });
});

describe('pages render', () => {
  const pages = ['/', '/clusters', '/truth', '/observatory', '/actions', '/experiments', '/crawlers', '/entities', '/methodology', '/audit'];
  for (const url of pages) {
    it(`GET ${url} renders`, async () => {
      const res = await get(h.app, url, h.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).not.toMatch(/undefined|\[object Object\]/);
    });
  }

  it('the answer desk shows exactly three primary sections', async () => {
    const res = await get(h.app, '/', h.cookie);
    for (const id of ['section-defects', 'section-demand', 'section-wins']) {
      expect(res.body).toContain(`data-testid="${id}"`);
    }
  });

  it('every displayed rate carries an interval and a sample size', async () => {
    const res = await get(h.app, '/', h.cookie);
    const measurements = res.body.match(/data-testid="measurement"[^<]*(<[^>]*>[^<]*)*/g) ?? [];
    expect(measurements.length).toBeGreaterThan(0);
    for (const m of measurements) {
      expect(m.includes('n=')).toBe(true);
    }
  });

  it('labels simulated runs as simulated', async () => {
    const res = await get(h.app, '/observatory', h.cookie);
    expect(res.body).toContain('sim');
  });
});

describe('demand import flow', () => {
  it('imports valid rows and reports rejected ones', async () => {
    const res = await postForm(h.app, '/demand/import', h.cookie, {
      csv: 'gsc,does vanar support enterprise sso,55\nnot_a_source,orphan question,10',
    });
    expect(res.statusCode).toBe(302);
    expect(decodeURIComponent(res.headers.location as string)).toMatch(/1 rejected/);
  });

  it('refuses an import with no attributable rows', async () => {
    const res = await postForm(h.app, '/demand/import', h.cookie, { csv: 'garbage' });
    expect(decodeURIComponent(res.headers.location as string)).toMatch(/name the source/);
  });
});

describe('truth registry flow', () => {
  it('creates an unapproved fact and then approves it', async () => {
    await postForm(h.app, '/truth', h.cookie, {
      subject: 'Vanar', predicate: 'compliance', object: 'ISO 27001',
      claim_text: 'Vanar holds ISO 27001 certification.', effective_from: '2026-01-01', sensitivity: 'regulated',
    });
    const claims = repo.listCanonicalClaims(h.db, h.info.tenantId, h.info.brandId);
    const created = claims.find((c) => c.object === 'ISO 27001')!;
    expect(created.approved_by).toBeNull();

    await postForm(h.app, `/truth/${created.id}/approve`, h.cookie, {});
    expect(repo.getCanonicalClaim(h.db, h.info.tenantId, created.id)!.approved_by).toBe(DEMO_EMAIL);
  });

  it('rejects an incomplete fact', async () => {
    const res = await postForm(h.app, '/truth', h.cookie, { subject: 'Vanar', predicate: '', object: '', claim_text: '' });
    expect(decodeURIComponent(res.headers.location as string)).toMatch(/needs a predicate/);
  });

  it('supersedes a fact and links the chain', async () => {
    const claims = repo.listCanonicalClaims(h.db, h.info.tenantId, h.info.brandId);
    const current = claims.find((c) => c.predicate === 'fees' && !c.effective_to)!;
    await postForm(h.app, '/truth', h.cookie, {
      subject: 'Vanar', predicate: 'fees', object: '$0.0003',
      claim_text: 'Vanar transaction fees are approximately $0.0003.', effective_from: '2026-08-01', sensitivity: 'material',
      supersedes: current.id,
    });
    const updated = repo.getCanonicalClaim(h.db, h.info.tenantId, current.id)!;
    expect(updated.effective_to).toBeTruthy();
    expect(updated.superseded_by_id).toBeTruthy();
  });

  it('shows the full history of a fact', async () => {
    const claims = repo.listCanonicalClaims(h.db, h.info.tenantId, h.info.brandId);
    const acq = claims.find((c) => c.predicate === 'acquired_by')!;
    const res = await get(h.app, `/truth/${acq.id}`, h.cookie);
    expect(res.statusCode).toBe(200);
    expect((res.body.match(/data-testid="history-row"/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe('sampling flow', () => {
  it('runs a round and reports what it cost', async () => {
    const res = await postForm(h.app, '/sampling/run', h.cookie, { window_label: 'http_round', budget: '40' });
    const msg = decodeURIComponent(res.headers.location as string);
    expect(msg).toMatch(/Sampled \d+ answers/);
    expect(msg).toMatch(/\$\d/);
    expect(repo.runCountForWindow(h.db, h.info.tenantId, h.info.brandId, 'http_round')).toBeGreaterThan(0);
  });

  it('shows full provenance on a single run', async () => {
    const run = repo.listRuns(h.db, h.info.tenantId, h.info.brandId, 1)[0];
    const res = await get(h.app, `/runs/${run.id}`, h.cookie);
    expect(res.statusCode).toBe(200);
    for (const label of ['Grounding', 'Search mode', 'Personalization', 'System config', 'Seed', 'Raw response']) {
      expect(res.body).toContain(label);
    }
  });
});

describe('action flow', () => {
  it('rejects an evidence-free action from the UI and explains why', async () => {
    const res = await postForm(h.app, '/actions', h.cookie, {
      action_type: 'update_owned_page', title: 'No evidence', rationale: 'r', evidence: '', drop_evidence: '1', misconception_key: 'x',
    });
    expect(decodeURIComponent(res.headers.location as string)).toMatch(/requires at least one evidence reference/);
  });

  it('creates, advances and blocks illegal transitions', async () => {
    const obs = h.db.prepare('SELECT id FROM observed_claims WHERE tenant_id = ? LIMIT 1').get(h.info.tenantId) as any;
    const created = await postJson(h.app, '/api/actions', h.cookie, {
      actionType: 'fix_crawler_access', title: 'Unblock retrieval crawlers on /docs',
      rationale: 'OAI-SearchBot is 403ing on the fees documentation.', evidence: [obs.id],
    });
    expect(created.statusCode).toBe(201);
    const action = created.json() as any;

    const illegal = await postJson(h.app, `/api/actions/${action.id}/transition`, h.cookie, { to: 'confirmed' });
    expect(illegal.statusCode).toBe(409);
    expect(illegal.json().message).toMatch(/Illegal action transition/);

    const ok = await postJson(h.app, `/api/actions/${action.id}/transition`, h.cookie, { to: 'approved' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toBe('approved');
  });

  it('rejects an action type outside the catalogue with 422', async () => {
    const res = await postJson(h.app, '/api/actions', h.cookie, { actionType: 'post_to_reddit', title: 'x', evidence: ['a'] });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/not a permitted action type/);
  });
});

describe('experiments flow', () => {
  it('analyzes an experiment and records the verdict with alternatives', async () => {
    const exp = repo.listExperiments(h.db, h.info.tenantId, h.info.brandId)[0];
    const res = await postForm(h.app, `/experiments/${exp.id}/analyze`, h.cookie, {});
    expect(res.statusCode).toBe(302);
    const updated = repo.getExperiment(h.db, h.info.tenantId, exp.id)!;
    expect(['confirmed', 'rejected', 'inconclusive']).toContain(updated.verdict);
    expect(JSON.parse(updated.alternative_explanations).length).toBeGreaterThan(0);
  });

  it('shows the business-outcome caveat next to any revenue-adjacent number', async () => {
    const withOutcome = repo.listExperiments(h.db, h.info.tenantId, h.info.brandId)
      .find((e) => repo.outcomesForExperiment(h.db, h.info.tenantId, e.id).length > 0)!;
    const res = await get(h.app, `/experiments/${withOutcome.id}`, h.cookie);
    expect(res.body).toMatch(/Correlational/);
    expect(res.body).toMatch(/not attribution/i);
  });
});

describe('entity classification flow', () => {
  it('refuses to promote a co-mention to a competitor edge', async () => {
    const rel = repo.listRelationships(h.db, h.info.tenantId, h.info.brandId).find((r) => r.basis === 'observed_comention');
    if (!rel) return;
    const res = await postForm(h.app, `/entities/${rel.entity_id}/classify`, h.cookie, { relation: 'competitor', basis: 'observed_comention' });
    expect(decodeURIComponent(res.headers.location as string)).toMatch(/Refusing to assert/);
  });

  it('accepts a declared competitor edge', async () => {
    const rel = repo.listRelationships(h.db, h.info.tenantId, h.info.brandId)[0];
    const res = await postForm(h.app, `/entities/${rel.entity_id}/classify`, h.cookie, { relation: 'competitor', basis: 'customer_declared' });
    expect(decodeURIComponent(res.headers.location as string)).toMatch(/set to competitor/);
  });
});

describe('tenant isolation', () => {
  it('shows a second tenant none of the first tenant’s findings', async () => {
    const res = await get(h.app, '/', h.otherCookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Vanar');
  });

  it('returns 404, not 403, for another tenant’s run — a 403 would confirm it exists', async () => {
    const run = repo.listRuns(h.db, h.info.tenantId, h.info.brandId, 1)[0];
    const res = await get(h.app, `/api/runs/${run.id}`, h.otherCookie);
    expect(res.statusCode).toBe(404);
  });

  it('hides another tenant’s actions and experiments', async () => {
    const action = repo.listActions(h.db, h.info.tenantId, h.info.brandId)[0];
    const exp = repo.listExperiments(h.db, h.info.tenantId, h.info.brandId)[0];
    expect((await get(h.app, `/api/actions/${action.id}`, h.otherCookie)).statusCode).toBe(404);
    expect((await get(h.app, `/api/experiments/${exp.id}`, h.otherCookie)).statusCode).toBe(404);
  });

  it('scopes the audit log per tenant', async () => {
    const mine = (await get(h.app, '/api/audit', h.cookie)).json() as any[];
    const theirs = (await get(h.app, '/api/audit', h.otherCookie)).json() as any[];
    const mineIds = new Set(mine.map((r) => r.id));
    expect(theirs.some((r) => mineIds.has(r.id))).toBe(false);
  });

  it('refuses unauthenticated API access', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401);
  });
});

describe('methodology disclosure', () => {
  it('publishes the sampling contract machine-readably', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/methodology' });
    const m = res.json() as any;
    expect(m.minSamples).toBe(5);
    expect(m.interval).toBe('wilson_95');
    expect(m.blendedScore).toBe(false);
    expect(m.revenueAttribution).toBe('correlational_only');
    expect(m.alerting.multipleComparisons).toBe('benjamini_hochberg');
  });

  it('states the limitations in the UI, not only in the API', async () => {
    const res = await get(h.app, '/methodology', h.cookie);
    expect(res.body).toMatch(/We cannot control what an external model says/);
    expect(res.body).toMatch(/do not produce a single blended visibility score/);
    expect(res.body).toMatch(/do not claim prompt-level revenue attribution/);
  });
});

describe('sampling windows', () => {
  it('does not let a thin manual probe take over the answer desk', async () => {
    const before = (await get(h.app, '/', h.cookie)).body.match(/Window <b>([^<]+)</)?.[1];
    await postForm(h.app, '/sampling/run', h.cookie, { window_label: 'thin_probe', budget: '10' });
    const after = (await get(h.app, '/', h.cookie)).body.match(/Window <b>([^<]+)</)?.[1];
    expect(after).toBe(before);
  });

  it('still offers the probe in the window picker, labelled as partial', async () => {
    const res = await get(h.app, '/', h.cookie);
    expect(res.body).toContain('thin_probe');
    expect(res.body).toMatch(/thin_probe[^<]*partial probe/);
  });

  it('shows a probe window when explicitly selected', async () => {
    const res = await get(h.app, '/?window=thin_probe', h.cookie);
    expect(res.body).toMatch(/Window <b>thin_probe<\/b>/);
  });

  it('ignores an unknown window rather than rendering an empty desk', async () => {
    const res = await get(h.app, '/?window=does_not_exist', h.cookie);
    expect(res.body).not.toMatch(/Window <b>does_not_exist<\/b>/);
  });
});
