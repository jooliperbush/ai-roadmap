/**
 * The plumbing around the public pages: the feed, the share cards and icons, structured data, the 404 page, one
 * address per page, security headers, compression and static caching.
 *
 * Each is invisible when it works and silently costly when it breaks: a share with no card, a crawler that
 * indexes /blog and /blog/ as two pages, a stylesheet pinned in browsers for a year after it changed.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTS, postsNewestFirst } from '../../src/content/posts.js';
import { openDb, type DB } from '../../src/db/index.js';
import { CONTENT_SECURITY_POLICY, INLINE_HANDLERS } from '../../src/http/security.js';
import { buildServer } from '../../src/server.js';
import { IMMUTABLE_CACHE, PUBLIC_ROOT, SHORT_CACHE, staticVersion } from '../../src/web/assets.js';
import { BRAND_PAPER, canonical, EXPLAINER, FEED_PATH, faviconSvg, SITE_URL } from '../../src/web/seo.js';

let db: DB;
let app: FastifyInstance;
beforeAll(async () => {
  db = openDb(':memory:');
  app = buildServer({ db });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  db.close();
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });
const PUBLIC_PAGES = ['/', '/blog', ...POSTS.map((p) => `/blog/${p.slug}`), '/privacy', '/terms'];
const decode = (text: string) =>
  text.replace(/&(?:#(\d+)|(amp|lt|gt|quot|apos));/g, (_, code, name) =>
    code ? String.fromCharCode(Number(code)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name as string]!,
  );
const meta = (body: string, key: string) =>
  body.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`))?.[1];
const linkedData = (body: string): Array<Record<string, any>> =>
  [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const local = (url: string) => (url.startsWith(SITE_URL) ? url.slice(SITE_URL.length) : url);
const pngSize = (png: Buffer) => {
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}
/** Just enough of an XML parser to prove the output is well formed: every tag closes in order, every & is an entity. */
function parseXml(xml: string): XmlNode {
  const source = xml.replace(/^<\?xml [^?]*\?>/, '');
  const document: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const open = [document];
  const token = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/y;
  while (token.lastIndex < source.length) {
    const at = token.lastIndex;
    const match = token.exec(source);
    if (!match) throw new Error(`not well formed at ${at}: ${source.slice(at, at + 60)}`);
    const [, closing, name, attrs, selfClosing, text] = match;
    const parent = open[open.length - 1];
    if (text !== undefined) {
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/.test(text)) throw new Error(`bare & in ${text}`);
      parent.text += decode(text);
    } else if (closing) {
      if (parent.name !== name) throw new Error(`</${name}> closes <${parent.name}>`);
      open.pop();
    } else {
      const node: XmlNode = {
        name,
        attrs: Object.fromEntries([...attrs.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])),
        children: [],
        text: '',
      };
      parent.children.push(node);
      if (!selfClosing) open.push(node);
    }
  }
  if (open.length !== 1 || document.children.length !== 1) throw new Error('unclosed or multiple root elements');
  return document.children[0];
}
const child = (node: XmlNode, name: string) => node.children.find((c) => c.name === name);
const children = (node: XmlNode, name: string) => node.children.filter((c) => c.name === name);

describe('the RSS feed', () => {
  it('is well-formed RSS 2.0 listing every post, newest first', async () => {
    const res = await get(FEED_PATH);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/rss+xml; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    const rss = parseXml(res.body);
    expect(rss.name).toBe('rss');
    expect(rss.attrs.version).toBe('2.0');
    const channel = child(rss, 'channel')!;
    expect(child(channel, 'link')?.text).toBe(canonical('/blog'));
    expect(child(channel, 'title')?.text).toBeTruthy();
    expect(child(channel, 'description')?.text).toBeTruthy();
    expect(child(channel, 'atom:link')?.attrs).toMatchObject({ href: canonical(FEED_PATH), rel: 'self' });
    const items = children(channel, 'item');
    expect(items.map((item) => child(item, 'link')?.text)).toEqual(
      postsNewestFirst().map((p) => canonical(`/blog/${p.slug}`)),
    );
    for (const post of POSTS) {
      const item = items.find((i) => child(i, 'link')?.text === canonical(`/blog/${post.slug}`))!;
      expect(child(item, 'title')?.text).toBe(post.title);
      expect(child(item, 'description')?.text).toBe(post.summary);
      expect(child(item, 'guid')?.text).toBe(canonical(`/blog/${post.slug}`));
      const pubDate = child(item, 'pubDate')!.text;
      expect(pubDate).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
      expect(new Date(pubDate).toISOString().slice(0, 10)).toBe(post.published);
    }
  });

  it('is advertised in the head of every public page', async () => {
    for (const path of PUBLIC_PAGES)
      expect((await get(path)).body, path).toContain(
        `<link rel="alternate" type="application/rss+xml" title="Miscited · Writing" href="${canonical(FEED_PATH)}">`,
      );
  });
});

describe('share cards', () => {
  it('gives every public page a large card with its size and alt text, and the card is served', async () => {
    for (const path of PUBLIC_PAGES) {
      const body = (await get(path)).body;
      const image = meta(body, 'og:image') ?? '';
      expect(image, path).toMatch(/^https:\/\/miscited\.com\/static\/.+\.png$/);
      expect(meta(body, 'twitter:card'), path).toBe('summary_large_image');
      expect(meta(body, 'twitter:image'), path).toBe(image);
      expect(meta(body, 'og:image:alt')?.length, path).toBeGreaterThan(10);
      const png = await get(local(image));
      expect(png.statusCode, image).toBe(200);
      expect(pngSize(png.rawPayload), image).toEqual({
        width: Number(meta(body, 'og:image:width')),
        height: Number(meta(body, 'og:image:height')),
      });
    }
  });

  it('gives each post its own card and article dates', async () => {
    for (const post of POSTS) {
      const body = (await get(`/blog/${post.slug}`)).body;
      expect(meta(body, 'og:image'), `run npm run og to render the card for ${post.slug}`).toBe(
        canonical(`/static/og/${post.slug}.png`),
      );
      expect(meta(body, 'og:type')).toBe('article');
      expect(meta(body, 'article:published_time')).toBe(post.published);
      expect(meta(body, 'article:modified_time')).toBe(post.updated);
      expect(decode(meta(body, 'og:image:alt')!)).toBe(`Miscited: ${post.title}`);
    }
    expect(meta((await get('/')).body, 'og:type')).toBe('website');
  });
});

describe('icons and the web app manifest', () => {
  it('links the favicons, touch icon, manifest and theme colour from every page', async () => {
    for (const path of [...PUBLIC_PAGES, '/login']) {
      const body = (await get(path)).body;
      expect(body, path).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(body, path).toContain('<link rel="manifest" href="/site.webmanifest">');
      expect(body, path).toContain(`<meta name="theme-color" content="${BRAND_PAPER}">`);
      for (const [rel, size] of [
        ['icon', 32],
        ['apple-touch-icon', 180],
      ] as const) {
        const href = body.match(new RegExp(`<link rel="${rel}" href="([^"]+\\.png\\?v=[0-9a-f]{10})"`))?.[1];
        expect(href, `${path} ${rel}`).toBeTruthy();
        expect(pngSize((await get(href!)).rawPayload)).toEqual({ width: size, height: size });
      }
    }
  });

  it('serves a manifest whose icons exist at the sizes it states', async () => {
    const res = await get('/site.webmanifest');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/manifest+json; charset=utf-8');
    const manifest = JSON.parse(res.body);
    expect(manifest).toMatchObject({ name: 'Miscited', short_name: 'Miscited', start_url: '/' });
    expect(manifest.theme_color).toBe(BRAND_PAPER);
    expect(manifest.background_color).toBe(BRAND_PAPER);
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const file = await get(icon.src);
      expect(file.statusCode, icon.src).toBe(200);
      if (icon.type === 'image/png') {
        const [width, height] = icon.sizes.split('x').map(Number);
        expect(pngSize(file.rawPayload), icon.src).toEqual({ width, height });
      }
    }
  });

  it('serves a favicon SVG that parses', async () => {
    const res = await get('/favicon.svg');
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    const svg = parseXml(res.body);
    expect(svg.name).toBe('svg');
    expect(svg.children.map((c) => c.name)).toEqual(['rect', 'path']);
    expect(parseXml(faviconSvg()).attrs.viewBox).toBe('0 0 1024 1024');
  });

  it('answers /favicon.ico with the favicon itself, cached like the SVG', async () => {
    const res = await get('/favicon.ico');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/x-icon');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(res.headers['cache-control']).toBe((await get('/favicon.svg')).headers['cache-control']);
    const ico = res.rawPayload;
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)], 'an ICONDIR header').toEqual([0, 1]);
    const images = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
      const entry = 6 + 16 * index;
      const start = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(start, start + ico.readUInt32LE(entry + 8));
      expect(pngSize(png)).toEqual({ width: ico[entry], height: ico[entry + 1] });
      return png;
    });
    expect(images.map((png) => pngSize(png).width)).toEqual([16, 32, 48]);
    expect(images[1].equals(readFileSync(join(PUBLIC_ROOT, 'icons', 'favicon-32.png'))), 'the 32 px PNG').toBe(true);
  });
});

describe('language, sitemap dates and llms.txt', () => {
  it('declares British English on public, workspace and error pages', async () => {
    for (const path of [...PUBLIC_PAGES, '/login', '/no-such-page'])
      expect((await get(path)).body, path).toMatch(/^<!DOCTYPE html>\s*<html lang="en-GB">/);
  });

  it('dates the home page and the index by the newest post', async () => {
    const newest = POSTS.map((p) => p.updated).sort().at(-1);
    const body = (await get('/sitemap.xml')).body;
    for (const path of ['/', '/blog'])
      expect(body).toContain(`<loc>${canonical(path)}</loc><lastmod>${newest}</lastmod>`);
  });

  it('lists every post and the explainer film in llms.txt', async () => {
    const body = (await get('/llms.txt')).body;
    for (const post of POSTS) expect(body).toContain(`](${canonical(`/blog/${post.slug}`)}): ${post.summary}`);
    expect(body).toContain(`[${EXPLAINER.name}](${canonical(EXPLAINER.path)})`);
  });
});

describe('structured data', () => {
  it('describes the site, the organisation and the explainer film on the home page', async () => {
    const nodes = linkedData((await get('/')).body);
    const byType = (type: string) => nodes.find((n) => n['@type'] === type)!;
    expect(nodes.map((n) => n['@type'])).toEqual(
      expect.arrayContaining(['Organization', 'WebSite', 'SoftwareApplication', 'VideoObject', 'FAQPage']),
    );
    expect(byType('WebSite')).toMatchObject({ name: 'Miscited', url: `${SITE_URL}/`, inLanguage: 'en-GB' });
    const logo = byType('Organization').logo;
    expect(logo['@type']).toBe('ImageObject');
    expect(pngSize((await get(local(logo.url))).rawPayload)).toEqual({ width: logo.width, height: logo.height });
    const video = byType('VideoObject');
    expect(video).toMatchObject({
      name: 'Miscited in 69 seconds',
      description:
        'Why AI answers about your company go wrong, a real case (Moffatt v. Air Canada), and how Miscited finds, traces, corrects and tests them.',
      contentUrl: 'https://miscited.com/static/video/miscited-explainer.mp4',
      thumbnailUrl: 'https://miscited.com/static/video/miscited-explainer-poster.jpg',
      uploadDate: '2026-09-27',
      duration: 'PT1M9S',
    });
    for (const url of [video.contentUrl, video.thumbnailUrl])
      expect((await get(local(url), { range: 'bytes=0-0' })).statusCode, url).toBe(206);
  });

  it('describes the index as a Blog of every post', async () => {
    const blog = linkedData((await get('/blog')).body).find((n) => n['@type'] === 'Blog')!;
    expect(blog.url).toBe(canonical('/blog'));
    expect(blog.blogPost.map((p: { url: string }) => p.url).sort()).toEqual(
      POSTS.map((p) => canonical(`/blog/${p.slug}`)).sort(),
    );
  });

  it('gives each BlogPosting its card, publisher logo, page, language and dates', async () => {
    for (const post of POSTS) {
      const url = canonical(`/blog/${post.slug}`);
      const posting = linkedData((await get(`/blog/${post.slug}`)).body).find((n) => n['@type'] === 'BlogPosting')!;
      expect(posting).toMatchObject({
        image: { '@type': 'ImageObject', url: canonical(`/static/og/${post.slug}.png`), width: 1200, height: 630 },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        inLanguage: 'en-GB',
        datePublished: post.published,
        dateModified: post.updated,
        publisher: { '@type': 'Organization', name: 'Miscited' },
      });
      expect((await get(local(posting.publisher.logo.url))).statusCode).toBe(200);
    }
  });

  it('ends each breadcrumb trail at the page it is on, named as its heading', async () => {
    for (const path of ['/blog', ...POSTS.map((p) => `/blog/${p.slug}`)]) {
      const body = (await get(path)).body;
      const trail = linkedData(body).find((n) => n['@type'] === 'BreadcrumbList')!.itemListElement;
      expect(trail.slice(0, 2).map((item: { name: string }) => item.name), path).toEqual(['Miscited', 'Writing']);
      expect(trail.at(-1).item, path).toBe(canonical(path));
      expect(trail.at(-1).name, path).toBe(decode(body.match(/<h1>([^<]*)<\/h1>/)![1]));
    }
  });
});

describe('the 404 page', () => {
  it('answers an unknown address with a noindex page in the site chrome and two ways back', async () => {
    for (const path of ['/no-such-page', '/blog/no-such-post', '/static/no-such-file.css']) {
      const res = await get(path);
      expect(res.statusCode, path).toBe(404);
      expect(res.headers['content-type'], path).toBe('text/html; charset=utf-8');
      expect(res.body, path).toContain('<meta name="robots" content="noindex">');
      expect(res.body, path).not.toContain('rel="canonical"');
      expect(res.body, path).not.toContain('og:url');
      expect(res.body, path).toContain('<h1>Not found</h1>');
      expect(res.body, path).toMatch(/<link rel="stylesheet" href="\/static\/blog\.css\?v=[0-9a-f]{10}">/);
      const main = res.body.match(/<main>[\s\S]*<\/main>/)?.[0] ?? '';
      expect(main, path).toContain('href="/"');
      expect(main, path).toContain('href="/blog"');
      const crumbs = main.match(/<nav class="crumbs" aria-label="Breadcrumb">[\s\S]*?<\/nav>/)?.[0] ?? '';
      expect(crumbs, path).toContain('<a href="/">Miscited</a>');
      expect(crumbs.match(/aria-current="page">([^<]*)</)?.[1], 'the trail ends at this page, named as its heading').toBe('Not found');
      const footer = res.body.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
      for (const link of ['<a href="/privacy">Privacy</a>', '<a href="/terms">Terms</a>']) expect(footer).toContain(link);
    }
  });

  it('keeps JSON 404s under /api/', async () => {
    const res = await get('/api/no-such-thing');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toEqual({ message: 'Route GET:/api/no-such-thing not found', error: 'Not Found', statusCode: 404 });
  });
});

describe('one address per page', () => {
  it('redirects a trailing slash permanently and keeps the query string', async () => {
    for (const [from, to] of [
      ['/blog/', '/blog'],
      ['/blog//', '/blog'],
      [`/blog/${POSTS[0].slug}/`, `/blog/${POSTS[0].slug}`],
      ['/privacy/?ref=launch&x=1', '/privacy?ref=launch&x=1'],
    ]) {
      const res = await get(from);
      expect(res.statusCode, from).toBe(301);
      expect(res.headers.location, from).toBe(to);
    }
    const head = await app.inject({ method: 'HEAD', url: '/terms/' });
    expect([head.statusCode, head.headers.location]).toEqual([301, '/terms']);
  });

  it('leaves the root, other methods and protocol-relative paths alone', async () => {
    expect((await get('/')).statusCode).toBe(200);
    expect((await get('/?ref=x')).statusCode).toBe(200);
    // Trimmed, //evil.example/ would redirect off the site.
    expect((await get('//evil.example/')).headers.location).toBeUndefined();
    const post = await app.inject({ method: 'POST', url: '/audit-request/', payload: {} });
    expect(post.statusCode).not.toBe(301);
  });

  it('sends www to the bare domain in one hop, slash and all', async () => {
    const res = await get('/blog/?ref=x', { host: 'www.miscited.com' });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('https://miscited.com/blog?ref=x');
  });
});

describe('security headers', () => {
  const EXPECTED = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': CONTENT_SECURITY_POLICY,
  };

  it('sends them on pages, redirects, 404s, JSON and static files, without HSTS outside production', async () => {
    for (const path of ['/', '/blog/', '/no-such-page', '/api/no-such-thing', '/static/landing.css', FEED_PATH]) {
      const res = await get(path);
      expect(res.headers, path).toMatchObject(EXPECTED);
      expect(res.headers['strict-transport-security'], path).toBeUndefined();
    }
  });

  it('adds HSTS in production, for a year and without subdomains', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      for (const path of ['/', '/no-such-page'])
        expect((await get(path)).headers['strict-transport-security'], path).toBe('max-age=31536000');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('forbids plugins, framing, a rewritten base URL and forms posting off the site', () => {
    const directives = CONTENT_SECURITY_POLICY.split('; ');
    for (const directive of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"])
      expect(directives).toContain(directive);
    for (const directive of directives) expect(directive, 'every source is the site itself').not.toMatch(/https?:|\*/);
  });

  it('allows every inline handler in the views by its hash, and no other inline script', async () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? sources(path) : /\.(ts|js)$/.test(path) ? [path] : [];
      });
    const handlers = sources(join(process.cwd(), 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/g)].map((m) => m[1]),
    );
    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) {
      expect(INLINE_HANDLERS, `add ${handler} to INLINE_HANDLERS or move it into a script file`).toContain(handler);
      expect(CONTENT_SECURITY_POLICY).toContain(`'sha256-${createHash('sha256').update(handler).digest('base64')}'`);
    }
    for (const path of [...PUBLIC_PAGES, '/login'])
      for (const [tag] of (await get(path)).body.matchAll(/<script\b[^>]*>/g))
        expect(tag, path).toMatch(/\ssrc="\/static\/[^"]+"|type="application\/ld\+json"/);
  });
});

describe('compression', () => {
  it('compresses pages with brotli or gzip, as the browser prefers', async () => {
    const br = await get('/', { 'accept-encoding': 'br, gzip' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers.vary).toMatch(/accept-encoding/i);
    expect(brotliDecompressSync(br.rawPayload).toString()).toMatch(/^<!DOCTYPE html>/);
    const gzip = await get('/blog', { 'accept-encoding': 'gzip' });
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gzip.rawPayload).toString()).toMatch(/^<!DOCTYPE html>[\s\S]*<\/html>$/);
    const css = await get('/static/landing.css', { 'accept-encoding': 'br' });
    expect(css.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(css.rawPayload).equals(readFileSync(join(PUBLIC_ROOT, 'landing.css')))).toBe(true);
    expect((await get('/', { 'accept-encoding': 'identity' })).headers['content-encoding']).toBeUndefined();
  });

  it('leaves images untouched', async () => {
    for (const path of ['/static/launch-card.png', EXPLAINER.poster]) {
      const res = await get(path, { 'accept-encoding': 'br, gzip' });
      expect(res.statusCode, path).toBe(200);
      expect(res.headers['content-encoding'], path).toBeUndefined();
      expect(res.rawPayload.equals(readFileSync(join(PUBLIC_ROOT, path.slice('/static/'.length)))), path).toBe(true);
    }
  });

  it('serves byte ranges of the explainer film, uncompressed', async () => {
    const file = readFileSync(join(PUBLIC_ROOT, 'video', 'miscited-explainer.mp4'));
    const res = await get(EXPLAINER.path, { range: 'bytes=1000-1999', 'accept-encoding': 'br, gzip' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 1000-1999/${file.length}`);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.rawPayload.equals(file.subarray(1000, 2000))).toBe(true);
  });
});

describe('static caching', () => {
  it('versions every stylesheet, script and icon a page names with its content hash', async () => {
    for (const path of [...PUBLIC_PAGES, '/login']) {
      const body = (await get(path)).body;
      const refs = [...body.matchAll(/(?:src|href)="(\/static\/[^"]+)"/g)].map((m) => m[1]);
      expect(refs.length, path).toBeGreaterThan(1);
      for (const ref of refs) {
        const [file, version] = ref.split('?v=');
        expect(version, ref).toBe(staticVersion(file));
      }
    }
  });

  it('caches a current version for a year and anything else for an hour', async () => {
    const version = staticVersion('/static/landing.css')!;
    expect(version).toMatch(/^[0-9a-f]{10}$/);
    for (const [url, cache] of [
      [`/static/landing.css?v=${version}`, IMMUTABLE_CACHE],
      ['/static/landing.css', SHORT_CACHE],
      ['/static/landing.css?v=0000000000', SHORT_CACHE],
      [`${EXPLAINER.path}?v=${staticVersion(EXPLAINER.path)}`, IMMUTABLE_CACHE],
    ]) {
      const res = await get(url, url.includes('.mp4') ? { range: 'bytes=0-9' } : {});
      expect(res.statusCode, url).toBe(url.includes('.mp4') ? 206 : 200);
      expect(res.headers['cache-control'], url).toBe(cache);
    }
    expect(IMMUTABLE_CACHE).toBe('public, max-age=31536000, immutable');
    expect(SHORT_CACHE).toBe('public, max-age=3600');
  });

  it('keeps the cache header on a revalidation', async () => {
    const version = staticVersion('/static/blog.css');
    const first = await get(`/static/blog.css?v=${version}`);
    const again = await get(`/static/blog.css?v=${version}`, { 'if-none-match': String(first.headers.etag) });
    expect(again.statusCode).toBe(304);
    expect(again.headers['cache-control']).toBe(IMMUTABLE_CACHE);
  });
});
