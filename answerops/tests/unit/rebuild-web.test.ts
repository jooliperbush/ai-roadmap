import { describe, expect, it } from 'vitest';
import { html, raw, escapeHtml, pct } from '../../src/web/html.js';
import { injectCsrf, page, publicPage, reportPage, flash } from '../../src/web/views/layout.js';
import { loginView } from '../../src/web/views/login.js';
import { blogIndexView, postView } from '../../src/web/views/blog.js';
import { canonical, faqLd, renderSitemap, sitemapEntries } from '../../src/web/seo.js';

const ctx = {
  email: 'reader@example.com',
  tenantName: 'Team',
  brandName: 'Brand',
  active: 'dashboard',
  csrf: 'token',
  brands: [],
  brandId: null,
  role: 'admin',
};
describe('presentation compatibility at the rendering boundary', () => {
  it('escapes nested values and reserves raw markup for explicit callers', () => {
    expect(html`a${['<b>', null, false, [42, raw('<i>x</i>')]]}z`.value).toBe('a&lt;b&gt;42<i>x</i>z');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect([pct(null), pct(NaN), pct(0.125, 1)]).toEqual(['—', '—', '12.5%']);
  });
  it('puts csrf tokens in post forms but leaves get forms alone', () => {
    expect(injectCsrf('<form method="POST"></form><form method="get"></form>', 'abc')).toBe(
      '<form method="POST"><input type="hidden" name="_csrf" value="abc"></form><form method="get"></form>',
    );
  });
  it('retains console navigation, session actions and public separation', () => {
    const console = page('Desk', ctx, html`<h1>Desk</h1>`);
    for (const path of ['/truth', '/observatory', '/actions', '/experiments', '/logout'])
      expect(console).toContain(`"${path}"`);
    expect(console).toContain('name="_csrf"');
    const publicHtml = publicPage(
      { title: 'Public', description: 'D', path: '/blog', script: null },
      html`<h1>Public</h1>`,
    );
    expect(publicHtml).toContain('https://miscited.com/blog');
    expect(publicHtml).not.toContain('/static/app.css');
    expect(publicHtml).not.toContain('<script src=');
    expect(reportPage('Audit', 'A', html`Report`)).toContain('noindex, nofollow');
  });
  it('preserves login field identity and escapes user feedback', () => {
    const output = loginView('<bad>', 'demo').value;
    for (const id of ['email', 'password', 'signin', 'demo-hint'])
      expect(output).toContain(`data-testid="${id}"`);
    expect(output).toContain('&lt;bad&gt;');
    expect(flash(null).value).toBe('');
  });
  it('renders dated article content and optional FAQs and related reading', () => {
    const post: any = {
      slug: 'first',
      title: 'Title',
      summary: 'Summary',
      published: '2026-01-02',
      updated: '2026-02-03',
      readingMinutes: 4,
      body: '<p>Trusted editorial body</p>',
      faq: [{ q: 'Why?', a: 'Evidence.' }],
    };
    expect(blogIndexView([post]).value).toContain('/blog/first');
    const output = postView(post, [{ ...post, slug: 'second' }]).value;
    for (const text of [
      '2 January 2026',
      '3 February 2026',
      'Why?',
      '/blog/second',
      '<p>Trusted editorial body</p>',
    ])
      expect(output).toContain(text);
  });
  it('keeps public discovery and JSON-LD safe', () => {
    expect(canonical('/blog/')).toBe('https://miscited.com/blog');
    const entries = sitemapEntries([{ slug: 'first', updated: '2026-01-02' }]);
    expect(entries.map((x) => x.path)).toEqual(['/', '/blog', '/blog/first', '/privacy', '/terms']);
    expect(renderSitemap(entries)).toContain('<lastmod>2026-01-02</lastmod>');
    expect(faqLd([{ q: '</script>', a: 'x' }]).value).toContain('\\u003c/script>');
  });
});

describe('replacement renderer safety improvements', () => {
  it('escapes all shell metadata and csrf attribute values', () => {
    const markup = page(
      '<script>x</script>',
      { ...ctx, csrf: '" onclick="bad' },
      html`<form method="post"></form>`,
    );
    expect(markup).toContain('<title>&lt;script&gt;x&lt;/script&gt; · Miscited</title>');
    expect(markup).not.toContain('value="" onclick=');
    expect(markup).toContain('&quot; onclick=&quot;bad');
    expect(reportPage('x', '"><script>bad</script>', html`x`)).not.toContain('<script>bad</script>');
  });
  it('accepts conventional quoted, unquoted and spaced POST method attributes', () => {
    const input = `<form method = 'post'></form><form method=POST></form><form method="get"></form>`;
    expect(injectCsrf(input, 'safe').match(/name="_csrf"/g)).toHaveLength(2);
  });
  it('emits active navigation and announcement semantics', () => {
    expect(page('Desk', ctx, html`x`)).toContain('aria-current="page"');
    expect(page('Desk', ctx, html`x`)).toContain('href="#main-content"');
    expect(flash('Saved').value).toContain('role="status"');
    expect(flash('Failed', 'error').value).toContain('role="alert"');
  });
  it('escapes sitemap values rather than creating extra XML elements', () => {
    const output = renderSitemap([
      {
        path: '/blog?a=1&b=2',
        changefreq: 'weekly',
        priority: '0.7',
        lastmod: '</lastmod><evil>',
      },
    ]);
    expect(output).toContain('?a=1&amp;b=2');
    expect(output).not.toContain('<evil>');
  });
  it('highlights overlapping claims once without corrupting escaped markup', async () => {
    const { highlight } = await import('../../src/web/views/dashboard.js');
    const output = highlight('Prices are <expensive> and prices are <expensive>.', [
      'Prices are <expensive>',
      '<expensive>',
    ]);
    expect(output.value.match(/<mark>/g)).toHaveLength(2);
    expect(output.value).not.toContain('<mark><mark>');
    expect(output.value).not.toContain('<expensive>');
    expect(output.value).toContain('&lt;expensive&gt;');
  });
});
