import { afterAll, beforeAll, expect, test } from 'vitest';
import { makeHarness, postForm, get, login, type Harness } from './helpers.js';
import { createBrand } from '../../src/db/repo/index.js';
let h: Harness;
beforeAll(async () => {
  h = await makeHarness();
});
afterAll(async () => {
  await h.app.close();
  h.db.close();
});
test('brand selection belongs to a browser request, not a user-global mutable map', async () => {
  const tenant = h.db.prepare('SELECT tenant_id FROM users WHERE email = ?').get('ops@vanar.example') as {
    tenant_id: string;
  };
  const second = createBrand(h.db, tenant.tenant_id, 'Browser Two Client', 'client-two.example');
  const independentCookie = await login(h.app, 'ops@vanar.example', 'miscited-demo');
  const switched = await postForm(h.app, '/brands/switch', h.cookie, { brand_id: second.id });
  expect(switched.statusCode).toBe(302);
  const otherBrowser = await get(h.app, '/', independentCookie);
  expect(otherBrowser.body).toContain('Answer desk — Vanar');
  const selectedBrowser = await get(h.app, '/', `${h.cookie}; brand=${second.id}`);
  expect(selectedBrowser.body).toContain('Answer desk — Browser Two Client');
});
