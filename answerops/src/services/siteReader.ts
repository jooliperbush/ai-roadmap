/**
 * Reading a customer's own site.
 *
 * The free audit used to be a form that emailed a human. To deliver it at zero marginal cost
 * the system has to be able to answer, unaided, two questions it currently asks the customer:
 * what does this company say is true about itself, and what do its buyers ask.
 *
 * Both answers are candidates, never facts. Nothing here can approve a canonical claim, and a
 * test asserts that the automated path cannot write `approved_by`.
 */

import { textOf, type Fetcher } from '../domain/fetcher.js';
import { proposeClaims } from '../domain/extractor.js';
import { classifyIntent, type IntentFamily } from '../domain/intent.js';

export const CANDIDATE_PATHS = [
  '/', '/pricing', '/about', '/docs', '/security', '/changelog', '/blog', '/faq', '/product', '/legal',
];

export const MAX_PAGES = 12;

/**
 * The client-rendered signature: a large response carrying almost no prose.
 *
 * This is what silently emptied the first real audit. The fetcher reads server-rendered HTML,
 * so a site that builds its copy in the browser answers 200 with a shell. onvanar.com's
 * homepage came back as 190,811 bytes of markup and script containing 843 characters of text.
 * The crawl counted it as a page read, the extractor found no facts in it, and the report said
 * "0 answer defects" with an empty registry behind the zero.
 *
 * The test is deliberately not "is this page short". A genuinely short page that arrived whole
 * was read completely, and there is nothing to disclose about it. What has to be disclosed is a
 * page where most of what a person sees never reached us. A thin page is still kept — its title
 * and headings are real — but it is named on the report, so a reader can tell "we checked and
 * found nothing wrong" apart from "we could not read your site".
 */
export const THIN_TEXT_CHARS = 1200;
export const THIN_HTML_BYTES = 20_000;

/** Pages whose markup was substantial but whose readable text was not. */
export function thinPages(crawl: CrawlResult): SitePage[] {
  return crawl.pages.filter((p) => p.bytes >= THIN_HTML_BYTES && p.text.length < THIN_TEXT_CHARS);
}

export interface SitePage {
  url: string;
  path: string;
  title: string;
  text: string;
  headings: string[];
  updatedAt: string | null;
  status: number | null;
  /** Size of the response we parsed, so a shell can be told from a small page. */
  bytes: number;
}

export interface CrawlResult {
  domain: string;
  pages: SitePage[];
  failed: Array<{ url: string; error: string }>;
  brandName: string;
}

/**
 * Visit the pages a company keeps its facts on, plus same-host links from the homepage nav.
 * Twelve pages is not a crawl of the site; it is the part of a site where claims live.
 */
export async function crawlSite(domain: string, fetcher: Fetcher): Promise<CrawlResult> {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const base = `https://${host}`;
  const pages: SitePage[] = [];
  const failed: Array<{ url: string; error: string }> = [];
  const seen = new Set<string>();

  const visit = async (url: string): Promise<SitePage | null> => {
    if (seen.has(url) || pages.length >= MAX_PAGES) return null;
    seen.add(url);
    const out = await fetcher.fetch(url);
    if (!out.ok || out.body === null) {
      failed.push({ url, error: out.error ?? 'unknown' });
      return null;
    }
    const page = parsePage(url, host, out.body, out.status);
    pages.push(page);
    return page;
  };

  await visit(base + '/');
  for (const path of CANDIDATE_PATHS.filter((p) => p !== '/')) {
    if (pages.length >= MAX_PAGES) break;
    await visit(base + path);
  }

  return { domain: host, pages, failed, brandName: inferBrandName(pages, host) };
}

export function parsePage(url: string, host: string, html: string, status: number | null): SitePage {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => textOf(m[1]))
    .filter((h) => h.length > 2 && h.length < 160);
  const updatedAt =
    html.match(/(?:last updated|updated|effective)\s*(?:on)?[:\s]*((?:19|20)\d{2}-\d{2}-\d{2})/i)?.[1] ??
    html.match(/<time[^>]*datetime="((?:19|20)\d{2}-\d{2}-\d{2})/i)?.[1] ??
    null;
  let path = '/';
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep '/' */
  }
  return { url, path, title, text: textOf(html), headings, updatedAt, status, bytes: html.length };
}

/** Same-host links in a page's markup, in document order, deduplicated. */
export function navLinks(html: string, base: string, host: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"#?]+)"/gi)) {
    const href = m[1];
    let url: string;
    try {
      url = new URL(href, base).toString();
    } catch {
      continue;
    }
    if (!url.startsWith(`https://${host}`) && !url.startsWith(`http://${host}`)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function inferBrandName(pages: SitePage[], host: string): string {
  const home = pages.find((p) => p.path === '/');
  if (home?.title) {
    // "Northwind — the fastest X" and "Northwind | Pricing" both begin with the name.
    const head = home.title.split(/[|–—:]/)[0].trim();
    if (head.length >= 2 && head.length <= 40) return head;
  }
  const label = host.split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// -------------------------------------------------------------- claim candidates

export interface ClaimCandidate {
  subject: string;
  predicate: string;
  object: string;
  polarity: 'affirm' | 'negate';
  claimText: string;
  sourceUrl: string;
  effectiveFrom: string | null;
  sensitivity: 'routine' | 'material' | 'regulated';
}

const MATERIAL = new Set(['acquired_by', 'pricing', 'fees', 'availability', 'product_status', 'funding']);
const REGULATED = new Set(['compliance', 'certification']);

/**
 * Candidates come from the company's own pages, using the same extractor that reads model
 * answers. That symmetry is the point: the audit compares what a model says about you with
 * what you say about yourself, and both sides were read the same way.
 */
export function proposeCanonicalClaims(crawl: CrawlResult): ClaimCandidate[] {
  const byKey = new Map<string, ClaimCandidate>();
  const order = (p: string) => CANDIDATE_PATHS.indexOf(p);
  const pages = [...crawl.pages].sort((a, b) => (order(a.path) + 99) % 100 - ((order(b.path) + 99) % 100));

  for (const page of pages) {
    for (const proposed of proposeClaims(page.text, crawl.brandName)) {
      const c = proposed.claim;
      const key = `${c.predicate}|${c.object.toLowerCase()}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        subject: crawl.brandName,
        predicate: c.predicate,
        object: c.object,
        polarity: c.polarity,
        claimText: tightenAround(c.statement, crawl.brandName, c.object),
        sourceUrl: page.url,
        effectiveFrom: page.updatedAt,
        sensitivity: REGULATED.has(c.predicate) ? 'regulated' : MATERIAL.has(c.predicate) ? 'material' : 'routine',
      });
    }
  }
  return [...byKey.values()];
}

/**
 * The sentence a claim actually lives in.
 *
 * Stripped page text runs headings, timestamps and body copy together with no punctuation
 * between them, so the raw clause comes out as "Pricing Last updated: 2026-04-02 Demo Corp
 * pricing starts at $29 per month." Quoting that back at a customer as their own canonical
 * fact reads as though we cannot tell a page from a sentence.
 */
export function tightenAround(statement: string, subject: string, object: string): string {
  const t = statement.trim().replace(/\s+/g, ' ');
  const from = t.toLowerCase().lastIndexOf(subject.toLowerCase(), Math.max(0, t.toLowerCase().indexOf(object.toLowerCase())));
  const sliced = from > 0 ? t.slice(from) : t;
  return sliced.length <= 240 ? sliced : `${sliced.slice(0, 239)}...`;
}

// --------------------------------------------------------------- estimated demand

export interface DemandCandidate {
  question: string;
  family: IntentFamily;
  source: string;
  estimatedVolume: number;
}

/**
 * Questions a buyer plausibly asks, in the absence of the customer's own search data. Three
 * sources, in descending order of how much they are worth: the company's own FAQ and doc
 * headings, comparison pairs against named competitors, and a fixed template per family.
 *
 * Every cluster built from these is labelled `estimated`. Estimated demand may rank a defect;
 * it may not appear in a sentence about money.
 */
/**
 * Is this heading a buyer question, or a section label?
 *
 * The first version accepted any heading opening with an interrogative word, which let "How it
 * works." onto a customer's report as though buyers were asking it, and then spent five runs
 * sampling it. Marketing pages are full of those: "What we do", "Why choose us", "How it
 * works". They open with a question word and are not questions.
 *
 * A question mark is the only signal on a page that the author meant a question, so it is the
 * only signal accepted here. Losing an unpunctuated real FAQ heading costs one estimated
 * cluster; keeping a nav label costs the customer's trust in the whole report, and the
 * templates already supply generic buyer questions.
 */
export function isQuestionHeading(heading: string): boolean {
  return /\?\s*$/.test(heading.trim());
}

export function autoDemand(crawl: CrawlResult, competitors: string[] = []): DemandCandidate[] {
  const out: DemandCandidate[] = [];
  const brand = crawl.brandName;
  const seen = new Set<string>();
  const push = (question: string, source: string, estimatedVolume: number) => {
    const key = question.toLowerCase().trim();
    if (seen.has(key) || key.length < 8) return;
    seen.add(key);
    out.push({ question, family: classifyIntent(question, [brand]), source, estimatedVolume });
  };

  for (const page of crawl.pages) {
    for (const h of page.headings) {
      // A heading that is already a question is the closest thing to real demand on the site.
      if (isQuestionHeading(h)) push(h.replace(/\?+$/, '').trim(), 'site_faq', 40);
    }
  }

  for (const c of competitors.slice(0, 6)) {
    push(`${brand} vs ${c}`, 'competitor_pair', 60);
    push(`${c} alternative`, 'competitor_pair', 30);
  }

  for (const t of TEMPLATES) push(t.replace(/\{brand\}/g, brand), 'template', 20);

  return out;
}

/** One per intent family, so a report always covers the taxonomy rather than whatever the site happened to publish. */
export const TEMPLATES = [
  'is {brand} legitimate',
  'what does {brand} cost',
  'how much are {brand} fees',
  'who owns {brand}',
  'is {brand} still operating',
  'does {brand} support SSO',
  'where can I buy {brand}',
  '{brand} documentation',
  'how do I get started with {brand}',
  'best alternative to {brand}',
];
