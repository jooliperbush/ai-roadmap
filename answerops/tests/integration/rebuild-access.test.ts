import { afterEach, beforeEach, expect, test } from 'vitest';
import { makeHarness, get, postForm, login, type Harness } from './helpers.js';
import { VIEWER_EMAIL, VIEWER_PASSWORD } from '../../src/seed.js';
import * as repo from '../../src/db/repo/index.js';
import { createAuditReport } from '../../src/services/audit.js';
let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
  h.db.close();
});
test('mutation permission follows the target action brand, not the selected brand', async () => {
  const viewer = await login(h.app, VIEWER_EMAIL, VIEWER_PASSWORD);
  const second = repo.listBrands(h.db, h.info.tenantId).find((b) => b.id !== h.info.brandId)!;
  await postForm(h.app, '/brands/switch', viewer, { brand_id: second.id });
  const action = repo.listActions(h.db, h.info.tenantId, h.info.brandId)[0];
  const response = await postForm(h.app, `/actions/${action.id}/transition`, viewer, { to: 'approved' });
  expect(response.statusCode).toBe(403);
  expect(repo.getAction(h.db, h.info.tenantId, action.id)?.state).toBe(action.state);
});
test('workspace audit list does not disclose another workspace report token', async () => {
  const report = createAuditReport(h.db, null, 'private-customer.example');
  h.db
    .prepare('UPDATE audit_reports SET tenant_id = ?, status = ? WHERE id = ?')
    .run(h.info.otherTenantId, 'complete', report.id);
  const response = await get(h.app, '/audits', h.cookie);
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain('private-customer.example');
  expect(response.body).not.toContain(report.token);
});

test('supersession cannot modify a predecessor from a different brand', async () => {
  const viewer = await login(h.app, VIEWER_EMAIL, VIEWER_PASSWORD);
  const second = repo.listBrands(h.db, h.info.tenantId).find((b) => b.id !== h.info.brandId)!;
  const predecessor = repo.listCanonicalClaims(h.db, h.info.tenantId, h.info.brandId)[0];
  await postForm(h.app, '/brands/switch', viewer, { brand_id: second.id });
  const response = await postForm(h.app, '/truth', viewer, {
    predicate: predecessor.predicate,
    object: 'malicious-successor',
    claim_text: 'A different brand fact',
    supersedes: predecessor.id,
  });
  expect(response.statusCode).toBe(403);
  expect(repo.getCanonicalClaim(h.db, h.info.tenantId, predecessor.id)?.superseded_by_id).toBe(
    predecessor.superseded_by_id,
  );
});

test('snapshot contents require a citation belonging to the requesting workspace', async () => {
  const sha = 'a'.repeat(64);
  h.db
    .prepare('INSERT INTO snapshots (sha256, url, body, fetched_at) VALUES (?, ?, ?, ?)')
    .run(sha, 'https://private.example/fact', 'other-workspace-evidence', new Date().toISOString());
  const response = await get(h.app, `/snapshot/${sha}`, h.cookie);
  expect(response.statusCode).toBe(404);
  expect(response.body).not.toContain('other-workspace-evidence');
});
