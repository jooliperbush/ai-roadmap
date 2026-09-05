import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import fixture from '../fixtures/http-contract.json';
import { makeHarness, get, type Harness } from './helpers.js';

describe('frozen reference HTTP contracts (8c114f6)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness();
  });
  afterAll(async () => {
    await h.app.close();
    h.db.close();
  });

  test('retains every original registered route and method', () => {
    const actual = (h.app as unknown as { registeredRoutes: Array<{ method: string; url: string }> })
      .registeredRoutes;
    for (const route of fixture.routes) expect(actual, `${route.method} ${route.url}`).toContainEqual(route);
  });

  for (const expected of fixture.pages) {
    test(`preserves the workspace workflow at ${expected.path}`, async () => {
      const r = await get(h.app, expected.path, h.cookie);
      expect(r.statusCode).toBe(expected.status);
      const headings = [...r.body.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) =>
        m[1].replace(/<[^>]*>/g, '').trim(),
      );
      for (const heading of expected.headings) expect(headings).toContain(heading);
      const forms = [...r.body.matchAll(/<form\b[^>]*>/g)].map((m) => ({
        method: m[0].match(/method="([^"]+)"/)?.[1] ?? 'get',
        action: m[0].match(/action="([^"]+)"/)?.[1] ?? '',
      }));
      for (const form of expected.forms) {
        // Seed identifiers differ between databases. Match only the path shape;
        // mutation behavior and ownership are independently asserted by integration tests.
        const shape = (s: string) => s.replace(/\b[a-z]{2,5}_[a-f0-9]{20}\b/g, ':id');
        expect(forms.map((f) => ({ ...f, action: shape(f.action) }))).toContainEqual({
          ...form,
          action: shape(form.action),
        });
      }
    });
  }

  for (const path of fixture.pages.map((p) => p.path).filter((p) => p !== '/')) {
    test(`anonymous requests cannot read ${path}`, async () => {
      const r = await h.app.inject({ method: 'GET', url: path });
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe('/login');
    });
  }
});
