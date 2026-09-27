import { html, raw, type Raw, escapeHtml } from './html.js';
import { LEGAL_UPDATED, OPERATOR } from '../content/operator.js';
import { asset, hasAsset } from './assets.js';
import { LOGO_MARK } from './logo-mark.js';
export const SITE_URL = 'https://miscited.com';
export const CANONICAL_HOST = 'miscited.com';
export const SITE_NAME = 'Miscited';
export const SITE_TAGLINE = 'Quality control for what AI says about your company';
export const SITE_LANGUAGE = 'en-GB';
/** The first mark; kept because it is a published export. The mark is now the ’m logo in LOGO_MARK. */
export const BRAND_MARK = '◧';
/** --ink, --paper and --red from landing.css. */
export const BRAND_INK = '#252820';
export const BRAND_PAPER = '#f7f4ed';
export const BRAND_RED = '#b63724';
/** The first accent; kept because it is a published export. */
export const BRAND_CLAY = '#9c6f4a';
export const BLOG_DESCRIPTION =
  'How to measure what AI assistants say about a company without fooling yourself: sample sizes, intervals, and what separates a wrong answer from a missing one.';
export const FEED_PATH = '/blog/feed.xml';
export function canonical(path: string): string {
  return SITE_URL + (path === '/' ? '/' : path.replace(/\/+$/, ''));
}
export interface SocialImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}
export const DEFAULT_SOCIAL_IMAGE: SocialImage = {
  url: canonical('/static/launch-card.png'),
  width: 1270,
  height: 760,
  alt: 'Miscited: your product changed, the answer did not. AI answer accuracy for B2B SaaS.',
};
/** The post's own 1200 × 630 card from `npm run og`, or the launch card until one has been rendered. */
export function postSocialImage(post: { slug: string; title: string }): SocialImage {
  const path = `/static/og/${post.slug}.png`;
  return hasAsset(path)
    ? { url: canonical(path), width: 1200, height: 630, alt: `${SITE_NAME}: ${post.title}` }
    : DEFAULT_SOCIAL_IMAGE;
}
const newest = (posts: Array<{ updated: string }>) =>
  posts.reduce<string | null>((latest, post) => (latest && latest > post.updated ? latest : post.updated), null);
export interface SitemapEntry {
  path: string;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: string;
  lastmod?: string | null;
}
export function sitemapEntries(posts: Array<{ slug: string; updated: string }>): SitemapEntry[] {
  // Neither the home page nor the index has a date of its own, so both carry the newest post's.
  const index: SitemapEntry[] = [
    { path: '/', changefreq: 'weekly', priority: '1.0', lastmod: newest(posts) },
    { path: '/blog', changefreq: 'weekly', priority: '0.8', lastmod: newest(posts) },
  ];
  for (const post of posts)
    index.push({
      path: `/blog/${post.slug}`,
      changefreq: 'monthly',
      priority: '0.7',
      lastmod: post.updated,
    });
  for (const path of ['/privacy', '/terms'])
    index.push({ path, changefreq: 'yearly', priority: '0.3', lastmod: LEGAL_UPDATED });
  return index;
}
export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map(
    (entry) =>
      html`<url><loc>${canonical(entry.path)}</loc>${
        entry.lastmod ? html`<lastmod>${entry.lastmod}</lastmod>` : null
      }<changefreq>${entry.changefreq}</changefreq
        ><priority>${entry.priority}</priority></url
      >`,
  );
  return html`<?xml version="1.0" encoding="UTF-8"?><urlset
      xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
      >${urls}</urlset
    >`.value;
}
/** RSS dates are RFC 822; a post's date is a day, so it is stamped at midnight UTC. */
const rfc822 = (date: string) => new Date(`${date}T00:00:00Z`).toUTCString();
export function renderFeed(
  posts: Array<{ slug: string; title: string; summary: string; published: string; updated: string }>,
): string {
  const built = newest(posts);
  const items = posts.map((post) => {
    const url = canonical(`/blog/${post.slug}`);
    return html`<item><title>${post.title}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${rfc822(post.published)}</pubDate><description>${post.summary}</description></item>`;
  });
  const channel = html`<title>${SITE_NAME} · Writing</title><link>${canonical('/blog')}</link><description>${BLOG_DESCRIPTION}</description><language>en-gb</language>${
    built ? html`<lastBuildDate>${rfc822(built)}</lastBuildDate>` : null
  }<atom:link href="${canonical(FEED_PATH)}" rel="self" type="application/rss+xml"/>`;
  return html`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>${channel}${items}</channel></rss>`
    .value;
}
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-User',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
  'meta-externalagent',
];
export function renderRobots(): string {
  const groups = [
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /audit/',
      'Disallow: /api/',
      'Disallow: /login',
      'Disallow: /snapshot/',
    ],
    ...AI_CRAWLERS.map((agent) => [`User-agent: ${agent}`, 'Allow: /']),
    ['User-agent: CCBot', 'Disallow: /'],
    [`Sitemap: ${SITE_URL}/sitemap.xml`],
  ];
  return groups.map((lines) => lines.join('\n')).join('\n\n') + '\n';
}
export const EXPLAINER = {
  path: '/static/video/miscited-explainer.mp4',
  poster: '/static/video/miscited-explainer-poster.jpg',
  name: 'Miscited in 69 seconds',
  description:
    'Why AI answers about your company go wrong, a real case (Moffatt v. Air Canada), and how Miscited finds, traces, corrects and tests them.',
  uploadDate: '2026-09-27',
  duration: 'PT1M9S',
};
// Public product brief, preserved as editorial copy.
export function renderLlmsTxt(posts: Array<{ slug: string; title: string; summary: string }>): string {
  const film = hasAsset(EXPLAINER.path)
    ? `## Video

- [${EXPLAINER.name}](${canonical(EXPLAINER.path)}): ${EXPLAINER.description}

`
    : '';
  return `# ${SITE_NAME}

> ${SITE_TAGLINE}. Miscited measures whether AI assistants state true things about a company,
> corrects the source pages those answers came from, and runs a controlled experiment to test
> whether the answers changed.

## What it is

Miscited is a B2B SaaS product for answer accuracy, not answer visibility. The distinction is
the product. Visibility tools count whether a brand was mentioned and whether the tone was
positive. Miscited checks whether the claim in the answer is true against a dated registry of
the company's own facts, and whether each citation actually supports the claim it is attached
to. An answer that names the brand, sounds positive and states a price that changed two years
ago is scored as a defect here and as a success by a share-of-voice tool.

## How it works

1. Truth registry: the company's facts, each with a source, an owner, an effective date and an expiry.
2. Sampling: real buyer questions asked repeatedly across OpenAI, Anthropic, Google and Perplexity, storing provider, model, version, grounding mode, geo, language and system config with every run.
3. Verification: every extracted claim is checked against the registry, and every citation is fetched and checked for whether it contains the claim.
4. Actions: a closed catalogue of eleven correction types, each requiring evidence.
5. Experiments: re-sample, compare against matched controls that were left alone, and report a difference-in-differences with a p-value.

## Measurement rules

- No rate is shown below five runs for a question cluster in a window. Under the floor the product prints "insufficient data" rather than a percentage.
- Every rate ships with a 95% Wilson score interval and its sample size.
- Change detection requires a two-proportion z-test at p < 0.05, a minimum ten-point move, and a Benjamini-Hochberg correction at q = 0.1 across everything tested in that round.
- There is no blended visibility score. Intent families are never averaged, and markets are never pooled.
- A run whose provider returned no usage block is recorded as unknown cost, never as free.

## What Miscited refuses to claim

- That it can control what a model says. Nobody outside a lab can. Miscited measures, corrects the sources, and tests whether answers moved.
- That a percentage means anything without its sample size.
- That an intervention worked because a number went up, absent a controlled comparison.
- Any guarantee of ranking, mention or placement.

Each refusal is enforced by a failing test in the codebase, not by editorial discipline alone.

## Pricing

The one-time Answer Risk Audit is free. Ongoing monitoring and correction pilots are scoped
individually during early access; usage, responsibilities and price are agreed before a paid engagement.

${film}## Writing

${posts.map((p) => `- [${p.title}](${canonical(`/blog/${p.slug}`)}): ${p.summary}`).join('\n')}

## Contact

${OPERATOR.email}
`;
}

/** The web app manifest. Paper for both colours, so the browser's chrome matches the page rather than framing it. */
export function webManifest(): string {
  return JSON.stringify({
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: `${SITE_TAGLINE}.`,
    lang: SITE_LANGUAGE,
    start_url: '/',
    scope: '/',
    display: 'browser',
    theme_color: BRAND_PAPER,
    background_color: BRAND_PAPER,
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: asset('/static/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: asset('/static/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
      { src: asset('/static/icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}

type Schema = Record<string, unknown>;
function linkedData(type: string, properties: Schema): Raw {
  const serialized = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': type,
    ...properties,
  }).replace(/</g, '\\u003c');
  return raw(`<script type="application/ld+json">${serialized}</script>`);
}
const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const organizationRef = () => ({ '@id': ORGANIZATION_ID });
const LOGO = { '@type': 'ImageObject', url: canonical('/static/icons/icon-512.png'), width: 512, height: 512 };
export function organizationLd(): Raw {
  return linkedData('Organization', {
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: LOGO,
    email: OPERATOR.email,
    description:
      'Miscited measures whether AI assistants state true things about a company, corrects the source pages those answers came from, and tests whether the answers changed.',
  });
}
export function websiteLd(): Raw {
  return linkedData('WebSite', {
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: canonical('/'),
    inLanguage: SITE_LANGUAGE,
    publisher: organizationRef(),
  });
}
/** Empty until the film is deployed, so the markup never points at a file that is not there. */
export function videoLd(): Raw {
  if (!hasAsset(EXPLAINER.path)) return raw('');
  return linkedData('VideoObject', {
    '@id': `${SITE_URL}/#explainer`,
    name: EXPLAINER.name,
    description: EXPLAINER.description,
    contentUrl: canonical(EXPLAINER.path),
    thumbnailUrl: canonical(EXPLAINER.poster),
    uploadDate: EXPLAINER.uploadDate,
    duration: EXPLAINER.duration,
    inLanguage: SITE_LANGUAGE,
    publisher: organizationRef(),
  });
}
export function softwareLd(): Raw {
  const offers = [['Answer Risk Audit', '0', 'One-time audit of what assistants say about your domain.']];
  return linkedData('SoftwareApplication', {
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'AI answer accuracy monitoring',
    operatingSystem: 'Web',
    url: SITE_URL,
    publisher: organizationRef(),
    offers: offers.map(([name, price, description]) => ({
      '@type': 'Offer',
      name,
      price,
      priceCurrency: 'USD',
      description,
    })),
  });
}
export interface FaqItem {
  q: string;
  a: string;
}
export function faqLd(items: FaqItem[]): Raw {
  return linkedData('FAQPage', {
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  });
}
export function blogLd(posts: Array<{ slug: string; title: string; published: string }>): Raw {
  const url = canonical('/blog');
  return linkedData('Blog', {
    '@id': `${url}#blog`,
    name: `${SITE_NAME} · Writing`,
    description: BLOG_DESCRIPTION,
    url,
    inLanguage: SITE_LANGUAGE,
    publisher: organizationRef(),
    blogPost: posts.map((post) => ({
      '@type': 'BlogPosting',
      '@id': `${canonical(`/blog/${post.slug}`)}#post`,
      headline: post.title,
      url: canonical(`/blog/${post.slug}`),
      datePublished: post.published,
    })),
  });
}
export function blogPostingLd(post: {
  slug: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
}): Raw {
  const url = canonical(`/blog/${post.slug}`);
  const image = postSocialImage(post);
  return linkedData('BlogPosting', {
    '@id': `${url}#post`,
    headline: post.title,
    description: post.summary,
    image: { '@type': 'ImageObject', url: image.url, width: image.width, height: image.height },
    datePublished: post.published,
    dateModified: post.updated,
    inLanguage: SITE_LANGUAGE,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    isPartOf: { '@id': `${canonical('/blog')}#blog` },
    publisher: { '@type': 'Organization', '@id': ORGANIZATION_ID, name: SITE_NAME, url: SITE_URL, logo: LOGO },
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  });
}
export function breadcrumbLd(trail: Array<{ name: string; path: string }>): Raw {
  return linkedData('BreadcrumbList', {
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: canonical(item.path),
    })),
  });
}
/**
 * The ’m mark in brand red on a square paper tile. `span` is the share of the tile's width the mark covers and
 * `radius` rounds the corners, both relative to a 1024-unit tile.
 */
export function iconSvg({ span, radius }: { span: number; radius: number }): string {
  const tile = 1024;
  const scale = (tile * span) / LOGO_MARK.width;
  const x = (tile - LOGO_MARK.width * scale) / 2;
  const y = (tile - LOGO_MARK.height * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tile} ${tile}"><rect width="${tile}" height="${tile}" rx="${radius}" fill="${BRAND_PAPER}"/><path fill="${BRAND_RED}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})" d="${LOGO_MARK.path}"/></svg>`;
}
export function faviconSvg(): string {
  return iconSvg({ span: 0.9, radius: 180 });
}
