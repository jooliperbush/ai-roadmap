/**
 * Everything the outside world reads about this site when we are not there to explain it:
 * canonical URLs, the page registry behind the sitemap, crawler policy, and structured data.
 *
 * One rule runs through this file. This product sells the claim that we can tell you what
 * assistants say about your company, so the assistants have to be able to read us. A robots.txt
 * that blocks GPTBot while the landing page promises answer integrity would be the same defect
 * the product is built to find, committed by us.
 *
 * The structured data is held to the product's own evidence standard too. Schema.org lets you
 * assert an aggregateRating with no reviews behind it, an offer price you do not honour, and a
 * founding date you invented. None of those appear here. A JSON-LD block is a claim to a
 * machine, and a claim to a machine is still a claim.
 */

import type { Raw } from './html.js';
import { raw } from './html.js';

export const SITE_URL = 'https://miscited.com';
export const SITE_NAME = 'Miscited';
export const SITE_TAGLINE = 'Quality control for what AI says about your company';

/** Where the mark comes from, so the favicon and the OG card cannot drift apart. */
export const BRAND_MARK = '◧';
export const BRAND_INK = '#16150f';
export const BRAND_PAPER = '#f7f6f3';
export const BRAND_CLAY = '#9c6f4a';

export function canonical(path: string): string {
  return `${SITE_URL}${path === '/' ? '/' : path.replace(/\/+$/, '')}`;
}

// ------------------------------------------------------------------ sitemap

export interface SitemapEntry {
  path: string;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: string;
  lastmod?: string | null;
}

/**
 * Only pages a stranger can open and that we want indexed.
 *
 * The console is behind a session, and audit reports carry `noindex` because they are somebody
 * else's company being measured at an unguessable URL. Neither belongs here, and a sitemap that
 * lists a 302 or a private report teaches a crawler to trust the file less.
 */
export function sitemapEntries(posts: Array<{ slug: string; updated: string }>): SitemapEntry[] {
  return [
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    { path: '/blog', changefreq: 'weekly', priority: '0.8' },
    ...posts.map((p) => ({
      path: `/blog/${p.slug}`,
      changefreq: 'monthly' as const,
      priority: '0.7',
      lastmod: p.updated,
    })),
  ];
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const url = (e: SitemapEntry) =>
    `  <url>\n    <loc>${canonical(e.path)}</loc>\n` +
    (e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : '') +
    `    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map(url).join('\n') +
    '\n</urlset>\n'
  );
}

// ------------------------------------------------------------------- robots

/**
 * Retrieval crawlers are allowed by name rather than by silence, because silence is not a
 * policy and the next person to edit this file should see the decision.
 *
 * CCBot is the one exclusion. Common Crawl is a bulk training corpus with no retrieval path
 * back to us, so allowing it trades content for nothing a reader can click.
 */
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
  const lines = [
    '# Miscited measures what AI assistants say about companies.',
    '# Blocking the assistants that answer those questions would be the same defect',
    '# this product exists to find, so every retrieval crawler is allowed by name.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# Private by construction: the console needs a session and an audit report belongs to the',
    '# company it measured. Both are excluded here and the reports also carry a noindex header.',
    'Disallow: /audit/',
    'Disallow: /api/',
    'Disallow: /login',
    'Disallow: /snapshot/',
    '',
  ];
  for (const bot of AI_CRAWLERS) {
    lines.push(`User-agent: ${bot}`, 'Allow: /', '');
  }
  lines.push(
    '# Bulk training corpus with no retrieval path back to a reader.',
    'User-agent: CCBot',
    'Disallow: /',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  );
  return lines.join('\n');
}

/**
 * llms.txt: a plain-text brief for a model that lands here with one question and no patience
 * for our navigation. It states what we do, what we refuse to claim, and where the numbers
 * come from, because a summary written by us is more accurate than one inferred from the CSS.
 */
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

Free Answer Risk Audit, then $750/month (Monitor, 50 question clusters sampled weekly),
$2,000/month (Operate, 100 clusters sampled daily), $5,000+/month (Enterprise, multi-brand).

## Writing

${posts.map((p) => `- [${p.title}](${canonical(`/blog/${p.slug}`)}): ${p.summary}`).join('\n')}

## Contact

hello@miscited.com
`;
}

// -------------------------------------------------------------- structured data

function jsonLd(obj: unknown): Raw {
  // JSON.stringify escapes nothing that matters here except the script terminator, and a
  // stray </script> inside a description would end the block early and inject markup.
  return raw(
    `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`,
  );
}

export function organizationLd(): Raw {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    email: 'hello@miscited.com',
    description:
      'Miscited measures whether AI assistants state true things about a company, corrects the ' +
      'source pages those answers came from, and proves whether the answers changed.',
  });
}

/**
 * SoftwareApplication with an offer, because the price is public and a buyer asking an
 * assistant "what does Miscited cost" should get the real number rather than a guess.
 * No aggregateRating: there are no reviews, and inventing one is the exact behaviour this
 * product was built to detect.
 */
export function softwareLd(): Raw {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'AI answer accuracy monitoring',
    operatingSystem: 'Web',
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
    offers: [
      { '@type': 'Offer', name: 'Answer Risk Audit', price: '0', priceCurrency: 'USD', description: 'One-time audit of what assistants say about your domain.' },
      { '@type': 'Offer', name: 'Monitor', price: '750', priceCurrency: 'USD', description: '50 question clusters across four assistants, sampled weekly.' },
      { '@type': 'Offer', name: 'Operate', price: '2000', priceCurrency: 'USD', description: '100 clusters sampled daily, plus the fact registry, action list and experiment ledger.' },
    ],
  });
}

export interface FaqItem {
  q: string;
  a: string;
}

export function faqLd(items: FaqItem[]): Raw {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  });
}

export function blogPostingLd(p: {
  slug: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
}): Raw {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${canonical(`/blog/${p.slug}`)}#post`,
    headline: p.title,
    description: p.summary,
    datePublished: p.published,
    dateModified: p.updated,
    mainEntityOfPage: canonical(`/blog/${p.slug}`),
    publisher: { '@id': `${SITE_URL}/#organization` },
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  });
}

export function breadcrumbLd(trail: Array<{ name: string; path: string }>): Raw {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: canonical(t.path),
    })),
  });
}

/** The wordmark, as a favicon. Inline so it costs no request and cannot 404. */
export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="12" fill="${BRAND_INK}"/>
<text x="32" y="45" font-family="Georgia,serif" font-size="40" fill="${BRAND_PAPER}" text-anchor="middle">${BRAND_MARK}</text>
</svg>`;
}
