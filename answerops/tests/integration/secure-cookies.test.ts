/**
 * The session and brand cookies are marked Secure in production, where the site is served over HTTPS, so a
 * browser never sends them over plain HTTP. Local development and the tests use plain HTTP, where a browser
 * would drop a Secure cookie, so there they are not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../../src/seed.js';
import { encodeForm, makeHarness, postForm, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.app.close();
  h.db.close();
  vi.unstubAllEnvs();
});

/** The Set-Cookie headers a sign-in and a brand switch send, by cookie name. */
async function issued(): Promise<Record<string, string>> {
  const signIn = await h.app.inject({
    method: 'POST',
    url: '/login',
    payload: encodeForm({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const switched = await postForm(h.app, '/brands/switch', h.cookie, { brand_id: h.info.brandId });
  const headers = [signIn, switched].flatMap((res) => [res.headers['set-cookie'] ?? []].flat());
  return Object.fromEntries(headers.map((header) => [header.split('=')[0], header]));
}

describe('cookie flags', () => {
  it('marks the session and brand cookies Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const cookies = await issued();
    expect(cookies.aops).toMatch(/; Secure/);
    expect(cookies.brand).toMatch(/; Secure/);
  });

  it('leaves Secure off in development and tests, which use plain HTTP', async () => {
    const cookies = await issued();
    expect(cookies.aops).toMatch(/^aops=\w+; /);
    expect(cookies.brand).toMatch(/^brand=/);
    expect(cookies.aops).not.toMatch(/Secure/);
    expect(cookies.brand).not.toMatch(/Secure/);
  });
});
