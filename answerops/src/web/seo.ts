import { html, raw, type Raw, escapeHtml } from './html.js';
import { LEGAL_UPDATED, OPERATOR } from '../content/operator.js';
export const SITE_URL = 'https://miscited.com';
export const CANONICAL_HOST = 'miscited.com';
export const SITE_NAME = 'Miscited';
export const SITE_TAGLINE = 'Quality control for what AI says about your company';
export const BRAND_MARK = '◧';
export const BRAND_INK = '#16150f';
export const BRAND_PAPER = '#f7f6f3';
export const BRAND_CLAY = '#9c6f4a';
export function canonical(path: string): string {
  return SITE_URL + (path === '/' ? '/' : path.replace(/\/+$/, ''));
}
export interface SitemapEntry {
  path: string;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: string;
  lastmod?: string | null;
}
export function sitemapEntries(posts: Array<{ slug: string; updated: string }>): SitemapEntry[] {
  const index: SitemapEntry[] = [
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    { path: '/blog', changefreq: 'weekly', priority: '0.8' },
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
// Public product brief, preserved as editorial copy.
export function renderLlmsTxt(posts: Array<{ slug: string; title: string; summary: string }>): string {
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

## Writing

${posts.map((p) => `- [${p.title}](${canonical(`/blog/${p.slug}`)}): ${p.summary}`).join('\n')}

## Contact

${OPERATOR.email}
`;
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
const organizationRef = () => ({ '@id': `${SITE_URL}/#organization` });
export function organizationLd(): Raw {
  return linkedData('Organization', {
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    email: OPERATOR.email,
    description:
      'Miscited measures whether AI assistants state true things about a company, corrects the source pages those answers came from, and tests whether the answers changed.',
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
export function blogPostingLd(post: {
  slug: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
}): Raw {
  const url = canonical(`/blog/${post.slug}`);
  return linkedData('BlogPosting', {
    '@id': `${url}#post`,
    headline: post.title,
    description: post.summary,
    datePublished: post.published,
    dateModified: post.updated,
    mainEntityOfPage: url,
    publisher: organizationRef(),
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
export function faviconSvg(): string {
  return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="12" fill="${BRAND_INK}">
    <text
      x="32"
      y="45"
      font-family="Georgia,serif"
      font-size="40"
      fill="${BRAND_PAPER}"
      text-anchor="middle"
    >
      ${BRAND_MARK}
    </text>
  </svg>`.value;
}
