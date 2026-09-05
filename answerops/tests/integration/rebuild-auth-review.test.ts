import { afterEach, beforeEach, expect, test } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { TestClock } from '../../src/domain/clock.js';
import { createAuditReport } from '../../src/services/audit.js';
let h: Harness;
let clock: TestClock;
beforeEach(async () => {
  clock = new TestClock('2026-09-05T10:00:00Z');
  h = await makeHarness({ clock });
});
afterEach(async () => {
  await h.app.close();
  h.db.close();
});
const attempt = (password: string) =>
  h.app.inject({ method: 'POST', url: '/login', payload: { email: 'ops@vanar.example', password } });
test('login lockout is enforced before checking even a correct password', async () => {
  for (let i = 0; i < 11; i++) await attempt('wrong');
  const response = await attempt('miscited-demo');
  expect(response.statusCode).toBe(429);
  expect(response.headers['set-cookie']).toBeUndefined();
  clock.advance(16 * 60_000);
  expect((await attempt('miscited-demo')).statusCode).toBe(302);
});
test('audit conversion validates credentials on the server', async () => {
  const report = createAuditReport(h.db, null, 'validation.example');
  const response = await h.app.inject({
    method: 'POST',
    url: `/audit/${report.token}/start`,
    payload: { email: 'not-an-email', password: '' },
  });
  expect(response.statusCode).toBe(302);
  expect(decodeURIComponent(String(response.headers.location))).toContain('valid email');
  expect(response.headers['set-cookie']).toBeUndefined();
});
test('conversion failure is visible and escaped on the report', async () => {
  const report = createAuditReport(h.db, null, 'validation.example');
  const response = await h.app.inject({
    method: 'GET',
    url: `/audit/${report.token}?msg=${encodeURIComponent('Failure <script>alert(1)</script>')}&kind=error`,
  });
  expect(response.body).toContain('Failure &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(response.body).not.toContain('<script>alert(1)</script>');
});
