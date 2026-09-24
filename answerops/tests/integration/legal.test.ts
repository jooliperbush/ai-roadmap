/**
 * The privacy policy and the terms.
 *
 * A legal page that prints "null" where the operator's address should be, or that nobody can
 * find from the page that collects the email address, is worse than no page. Both are asserted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import { buildServer } from '../../src/server.js';
import { OPERATOR } from '../../src/content/operator.js';
import { POSTS } from '../../src/content/posts.js';
import { canonical, SITE_URL } from '../../src/web/seo.js';
import { html } from '../../src/web/html.js';
import { reportPage } from '../../src/web/views/layout.js';
import { privacyView, termsView } from '../../src/web/views/legal.js';

const databases: DB[] = [];
function server() {
  const db = openDb(':memory:');
  databases.push(db);
  return buildServer({ db });
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));

async function get(url: string) {
  return server().inject({ method: 'GET', url });
}
const visibleText = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const LEGAL_LINKS = ['<a href="/privacy">Privacy</a>', '<a href="/terms">Terms</a>'];

describe('legal pages', () => {
  for (const [path, heading] of [
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
  ]) {
    it(`serves ${path} with its heading, date, title, description and canonical`, async () => {
      const res = await get(path);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect([...res.body.matchAll(/<h1>([^<]*)<\/h1>/g)].map((m) => m[1])).toEqual([heading]);
      expect(res.body).toContain('Last updated: 24 September 2026');
      expect(res.body).toContain(`<title>${heading} · Miscited</title>`);
      expect(res.body).toContain(`<link rel="canonical" href="${canonical(path)}">`);
      const desc = res.body.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
      expect(desc.length).toBeGreaterThan(50);
      expect(desc.length).toBeLessThanOrEqual(155);
      // No landing.js, so reading the policy is never counted as a landing view.
      expect(res.body).not.toContain('/static/landing.js');
      for (const link of LEGAL_LINKS) expect(res.body).toContain(link);
      expect(res.body).toContain(`href="mailto:${OPERATOR.email}"`);
    });
  }

  it('lists both pages in the sitemap with their date', async () => {
    const body = (await get('/sitemap.xml')).body;
    for (const path of ['/privacy', '/terms'])
      expect(body).toContain(`<loc>${SITE_URL}${path}</loc><lastmod>2026-09-24</lastmod>`);
  });
});

describe('links to the legal pages', () => {
  it('puts both in the home page footer', async () => {
    const body = (await get('/')).body;
    const footer = body.match(/<footer class="shell lp-footer">[\s\S]*?<\/footer>/)?.[0] ?? '';
    for (const link of LEGAL_LINKS) expect(footer).toContain(link);
  });

  it('puts both in the footer of the other public pages', async () => {
    for (const path of ['/blog', `/blog/${POSTS[0].slug}`, '/login']) {
      const footer = (await get(path)).body.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
      for (const link of LEGAL_LINKS) expect(footer, path).toContain(link);
    }
    const report = reportPage('Report', 'An audit report', html`x`).match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
    for (const link of LEGAL_LINKS) expect(report).toContain(link);
  });

  it('states the consent line directly under the audit submit button', async () => {
    const body = (await get('/')).body;
    const afterButton = body.split('data-testid="audit-submit"')[1]?.split('</button>')[1] ?? '';
    const consent = afterButton.match(/^\s*(<p class="fineprint consent" data-testid="audit-consent">[\s\S]*?<\/p>)/)?.[1] ?? '';
    expect(consent.replace(/<[^>]*>/g, '')).toBe('By requesting an audit you agree to our Terms and Privacy Policy.');
    expect(consent).toContain('<a href="/terms">Terms</a>');
    expect(consent).toContain('<a href="/privacy">Privacy Policy</a>');
  });
});

describe('operator details', () => {
  const undeclared = { ...OPERATOR, legalName: null, address: null, companyNumber: null, jurisdiction: null };

  it('leaves out every line the owner has not declared, with no placeholder in its place', () => {
    for (const view of [privacyView(undeclared), termsView(undeclared)]) {
      const text = visibleText(view.value);
      expect(text).not.toMatch(/\b(null|undefined|TODO|TBC|TBD)\b|\[[^\]]*\]/);
      expect(view.value).not.toMatch(/<dt>(Operator|Company number|Address)<\/dt>/);
      expect(text).toContain(OPERATOR.email);
    }
    expect(termsView(undeclared).value).not.toContain('Governing law');
  });

  it('prints each detail once it is declared', () => {
    const declared = {
      ...OPERATOR,
      legalName: 'Example Operator Ltd',
      address: '1 Example Street, Example Town',
      companyNumber: '00000000',
      jurisdiction: 'Exampleland',
    };
    const terms = termsView(declared).value;
    for (const value of ['Example Operator Ltd', '1 Example Street, Example Town', '00000000']) {
      expect(privacyView(declared).value).toContain(value);
      expect(terms).toContain(value);
    }
    expect(terms).toContain('<h2>Governing law</h2>');
    expect(terms).toContain('governed by the law of Exampleland');
  });
});
