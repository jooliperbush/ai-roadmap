/**
 * The machine-readable surface: crawler policy, sitemap, structured data, head tags, blog.
 *
 * This product's whole claim is that it can tell you what assistants say about your company.
 * A robots.txt that blocked GPTBot, or a JSON-LD block asserting a rating nobody left, would be
 * the same defect the product exists to find, committed by us. Both are asserted here rather
 * than left to review.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import { seed } from '../../src/seed.js';
import { buildServer } from '../../src/server.js';
import { StubFetcher } from '../../src/domain/fetcher.js';
import { AI_CRAWLERS, canonical, renderRobots, renderSitemap, sitemapEntries, renderLlmsTxt, SITE_URL } from '../../src/web/seo.js';
import { POSTS, postsNewestFirst } from '../../src/content/posts.js';

let db: DB;
let app: ReturnType<typeof buildServer>;

beforeEach(async () => {
  db = openDb(':memory:');
  await seed(db);
  app = buildServer({ db, fetcher: new StubFetcher({}) });
});

async function get(url: string) {
  return app.inject({ method: 'GET', url });
}

describe('crawler policy', () => {
  it('serves robots.txt', async () => {
    const res = await get('/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('allows every assistant that could cite us, by name', async () => {
    const body = (await get('/robots.txt')).body;
    for (const bot of ['GPTBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'OAI-SearchBot', 'Bingbot']) {
      const block = body.split(`User-agent: ${bot}`)[1] ?? '';
      expect(block.trimStart().startsWith('Allow: /'), `${bot} must be allowed; blocking it means that assistant can never cite us`).toBe(true);
    }
  });

  it('never disallows a retrieval crawler anywhere in the file', async () => {
    const body = (await get('/robots.txt')).body;
    for (const bot of AI_CRAWLERS) {
      const block = (body.split(`User-agent: ${bot}`)[1] ?? '').split('User-agent:')[0];
      expect(block).not.toMatch(/Disallow: \/\s*$/m);
    }
  });

  it('keeps private surfaces out of the index', async () => {
    const body = (await get('/robots.txt')).body;
    for (const path of ['/audit/', '/api/', '/login', '/snapshot/']) {
      expect(body).toContain(`Disallow: ${path}`);
    }
  });

  it('points at the sitemap with an absolute URL', async () => {
    expect((await get('/robots.txt')).body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});

describe('sitemap', () => {
  it('is valid XML listing every public page', async () => {
    const res = await get('/sitemap.xml');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.body).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(res.body).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(res.body).toContain(`<loc>${SITE_URL}/blog</loc>`);
    for (const p of POSTS) expect(res.body).toContain(`<loc>${SITE_URL}/blog/${p.slug}</loc>`);
  });

  it('lists no page that requires a session or carries noindex', async () => {
    const body = (await get('/sitemap.xml')).body;
    for (const bad of ['/login', '/observatory', '/audit/', '/api/', '/actions']) {
      expect(body, `${bad} is not publicly indexable and must not be advertised`).not.toContain(`<loc>${SITE_URL}${bad}`);
    }
  });

  it('every listed URL actually resolves to a 200', async () => {
    const locs = [...(await get('/sitemap.xml')).body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(2);
    for (const loc of locs) {
      const res = await get(loc.replace(SITE_URL, '') || '/');
      expect(res.statusCode, `${loc} is in the sitemap`).toBe(200);
    }
  });

  it('dates each post with its own updated date', () => {
    const xml = renderSitemap(sitemapEntries([{ slug: 'x', updated: '2026-08-23' }]));
    expect(xml).toContain('<lastmod>2026-08-23</lastmod>');
  });
});

describe('llms.txt', () => {
  it('states what the product is, its measurement rules and its refusals', async () => {
    const res = await get('/llms.txt');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/Wilson score interval/);
    expect(res.body).toMatch(/insufficient data/);
    expect(res.body).toMatch(/Benjamini-Hochberg/);
    expect(res.body).toMatch(/refuses to claim/i);
  });

  it('links every post with an absolute URL', async () => {
    const body = (await get('/llms.txt')).body;
    for (const p of POSTS) expect(body).toContain(canonical(`/blog/${p.slug}`));
  });

  it('does not promise control over a model', () => {
    const body = renderLlmsTxt([]);
    expect(body).not.toMatch(/control what (a )?model says\b(?! *\. Nobody)/i);
    expect(body).toMatch(/Nobody outside a lab/i);
  });
});

describe('head tags on public pages', () => {
  const pages = ['/', '/blog', `/blog/${POSTS[0].slug}`];

  it('gives every public page a self-referencing canonical', async () => {
    for (const path of pages) {
      const body = (await get(path)).body;
      expect(body, path).toContain(`<link rel="canonical" href="${canonical(path)}">`);
    }
  });

  it('gives every public page a title and a description under the truncation limits', async () => {
    for (const path of pages) {
      const body = (await get(path)).body;
      const title = body.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
      const desc = body.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
      expect(title.length, `${path} title`).toBeGreaterThan(10);
      expect(title.length, `${path} title is truncated in results past ~60`).toBeLessThanOrEqual(70);
      expect(desc.length, `${path} description`).toBeGreaterThan(50);
      expect(desc.length, `${path} description is truncated past ~155`).toBeLessThanOrEqual(165);
    }
  });

  it('carries Open Graph and Twitter cards with a resolved URL', async () => {
    const body = (await get('/')).body;
    expect(body).toContain('<meta property="og:url" content="https://miscited.com/">');
    expect(body).toContain('<meta property="og:site_name" content="Miscited">');
    expect(body).toContain('<meta name="twitter:card" content="summary">');
  });

  it('serves a favicon rather than 404ing on it', async () => {
    const res = await get('/favicon.svg');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/svg/);
  });

  it('leaves the audit report noindexed, because it is somebody else being measured', async () => {
    const layout = (await import('node:fs')).readFileSync('src/web/views/layout.ts', 'utf8');
    expect(layout).toMatch(/noindex, nofollow/);
  });
});

describe('structured data', () => {
  function ldBlocks(body: string): any[] {
    return [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1].replace(/\\u003c/g, '<')),
    );
  }

  it('parses as valid JSON on every page that emits it', async () => {
    for (const path of ['/', '/blog', `/blog/${POSTS[0].slug}`]) {
      const blocks = ldBlocks((await get(path)).body);
      expect(blocks.length, path).toBeGreaterThan(0);
      for (const b of blocks) expect(b['@context']).toBe('https://schema.org');
    }
  });

  it('describes the organization, the software and its real prices', async () => {
    const blocks = ldBlocks((await get('/')).body);
    const org = blocks.find((b) => b['@type'] === 'Organization');
    const soft = blocks.find((b) => b['@type'] === 'SoftwareApplication');
    expect(org?.name).toBe('Miscited');
    expect(soft?.offers?.map((o: any) => o.price).sort()).toEqual(['0', '2000', '750']);
  });

  it('never asserts a rating or a review, because there are none', async () => {
    for (const path of ['/', '/blog', `/blog/${POSTS[0].slug}`]) {
      const json = JSON.stringify(ldBlocks((await get(path)).body));
      expect(json, `${path} must not invent social proof`).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
    }
  });

  it('marks up every post as a BlogPosting with both dates', async () => {
    for (const p of POSTS) {
      const blocks = ldBlocks((await get(`/blog/${p.slug}`)).body);
      const post = blocks.find((b) => b['@type'] === 'BlogPosting');
      expect(post?.headline, p.slug).toBe(p.title);
      expect(post?.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(post?.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('emits a FAQPage whose answers match the visible copy', async () => {
    const p = POSTS[0];
    const blocks = ldBlocks((await get(`/blog/${p.slug}`)).body);
    const faq = blocks.find((b) => b['@type'] === 'FAQPage');
    expect(faq.mainEntity).toHaveLength(p.faq.length);
    const html = (await get(`/blog/${p.slug}`)).body;
    for (const entry of p.faq) {
      // Structured data that says something the page does not is the machine-readable version
      // of a citation that does not support its claim.
      expect(html, `"${entry.q}" must be visible, not schema-only`).toContain(entry.q);
    }
  });

  it('cannot be broken out of by a description containing markup', async () => {
    const body = (await get('/')).body;
    const between = body.split('<script type="application/ld+json">').slice(1).map((s) => s.split('</script>')[0]);
    for (const block of between) expect(block).not.toContain('<');
  });
});

describe('the blog', () => {
  it('lists every post, newest first', async () => {
    const res = await get('/blog');
    expect(res.statusCode).toBe(200);
    for (const p of POSTS) expect(res.body).toContain(p.title);
    const order = postsNewestFirst().map((p) => res.body.indexOf(p.title));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('renders each post with its heading, body and visible date', async () => {
    for (const p of POSTS) {
      const res = await get(`/blog/${p.slug}`);
      expect(res.statusCode, p.slug).toBe(200);
      expect(res.body).toContain(p.title);
      expect(res.body).toMatch(/Published \d+ \w+ 2026/);
    }
  });

  it('gives exactly one h1 per post, which is the title', async () => {
    for (const p of POSTS) {
      const body = (await get(`/blog/${p.slug}`)).body;
      const h1s = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
      expect(h1s.length, p.slug).toBe(1);
      expect(h1s[0][1]).toContain(p.title);
    }
  });

  it('404s an unknown slug instead of rendering an empty post', async () => {
    const res = await get('/blog/no-such-post');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Not found');
  });

  it('links posts to each other, so neither the reader nor a crawler dead-ends', async () => {
    for (const p of POSTS) {
      const body = (await get(`/blog/${p.slug}`)).body;
      const links = [...body.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]);
      expect(new Set(links).size, `${p.slug} links to siblings`).toBeGreaterThan(0);
    }
  });

  it('routes every internal blog link to a real post', async () => {
    for (const p of POSTS) {
      const body = (await get(`/blog/${p.slug}`)).body;
      for (const slug of new Set([...body.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]))) {
        expect((await get(`/blog/${slug}`)).statusCode, `${p.slug} -> ${slug}`).toBe(200);
      }
    }
  });

  it('sends every post to the audit, which is the only thing being sold', async () => {
    for (const p of POSTS) {
      expect((await get(`/blog/${p.slug}`)).body).toContain('/#audit');
    }
  });
});

describe('the writing is held to the product standard', () => {
  it('states a sample size or an interval wherever it states a rate', () => {
    for (const p of POSTS) {
      const percentages = [...p.body.matchAll(/(\d+)%/g)];
      if (percentages.length === 0) continue;
      expect(
        /n\s*=|sample size|interval|runs|95%/i.test(p.body),
        `${p.slug} quotes percentages and must show what they were measured on`,
      ).toBe(true);
    }
  });

  it('dates every external claim it makes about prices', () => {
    const post = POSTS.find((p) => p.body.includes('$0.0'));
    if (post) expect(post.body).toMatch(/reviewed on \d+ \w+ 2026|list prices/i);
  });

  it('keeps meta titles and descriptions inside their truncation limits', () => {
    for (const p of POSTS) {
      expect(p.metaTitle.length, `${p.slug} metaTitle`).toBeLessThanOrEqual(60);
      expect(p.metaDescription.length, `${p.slug} metaDescription`).toBeLessThanOrEqual(160);
      expect(p.summary.length, `${p.slug} summary`).toBeGreaterThan(40);
    }
  });

  it('gives every post a unique slug, title and target query', () => {
    expect(new Set(POSTS.map((p) => p.slug)).size).toBe(POSTS.length);
    expect(new Set(POSTS.map((p) => p.metaTitle)).size).toBe(POSTS.length);
    expect(new Set(POSTS.map((p) => p.targetQuery)).size).toBe(POSTS.length);
  });

  it('answers each FAQ in the 40 to 60 words an answer engine will lift', () => {
    for (const p of POSTS) {
      for (const f of p.faq) {
        const words = f.a.trim().split(/\s+/).length;
        expect(words, `"${f.q}" is ${words} words`).toBeGreaterThanOrEqual(20);
        expect(words, `"${f.q}" is ${words} words`).toBeLessThanOrEqual(90);
      }
    }
  });
});

/**
 * www and the apex are two addresses for one site. The canonical tag tells a crawler which one
 * counts; this settles it before the request is answered, so a link someone typed with www in
 * front still lands on the page rather than splitting the site in two.
 *
 * The DNS for www was correct all along. What was missing was the domain being registered with
 * the host, so no certificate covered it and the handshake failed before any of this ran.
 */
describe('one host, one canonical URL', () => {
  it('sends www to the apex permanently, keeping the path', async () => {
    const res = await app.inject({ method: 'GET', url: '/blog', headers: { host: 'www.miscited.com' } });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('https://miscited.com/blog');
  });

  it('keeps the query string, so a campaign link survives the hop', async () => {
    const res = await app.inject({ method: 'GET', url: '/?utm_source=x&utm_campaign=y', headers: { host: 'www.miscited.com' } });
    expect(res.headers.location).toBe('https://miscited.com/?utm_source=x&utm_campaign=y');
  });

  it('ignores the port when matching the host', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'www.miscited.com:443' } });
    expect(res.statusCode).toBe(301);
  });

  it('leaves every other host alone', async () => {
    for (const host of ['miscited.com', 'answerops-production.up.railway.app', 'localhost:4300', '127.0.0.1:4399']) {
      const res = await app.inject({ method: 'GET', url: '/', headers: { host } });
      expect(res.statusCode, `${host} must not be redirected`).toBe(200);
    }
  });

  it('does not redirect a lookalike host that merely contains our name', async () => {
    const res = await app.inject({ method: 'GET', url: '/', headers: { host: 'www.miscited.com.evil.example' } });
    expect(res.statusCode).not.toBe(301);
  });
})
