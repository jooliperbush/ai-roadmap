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
  '/',
  '/pricing',
  '/about',
  '/docs',
  '/security',
  '/changelog',
  '/blog',
  '/faq',
  '/product',
  '/legal',
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
  return crawl.pages.reduce<SitePage[]>((pages, page) => {
    if (page.text.length < THIN_TEXT_CHARS && page.bytes >= THIN_HTML_BYTES) pages.push(page);
    return pages;
  }, []);
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
  const host = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  const result: CrawlResult = { domain: host, pages: [], failed: [], brandName: '' };
  for (const path of new Set(CANDIDATE_PATHS)) {
    if (result.pages.length >= MAX_PAGES) break;
    const url = `https://${host}${path}`;
    const response = await fetcher.fetch(url);
    if (response.ok && response.body !== null)
      result.pages.push(parsePage(url, host, response.body, response.status));
    else result.failed.push({ url, error: response.error ?? 'unknown' });
  }
  result.brandName = inferBrandName(result.pages, host);
  return result;
}

export function parsePage(url: string, host: string, html: string, status: number | null): SitePage {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = '/';
  }
  const headings: string[] = [];
  const tags = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(html))) {
    const heading = textOf(tag[1]);
    if (heading.length > 2 && heading.length < 160) headings.push(heading);
  }
  const datePatterns = [
    /(?:last updated|updated|effective)\s*(?:on)?[:\s]*((?:19|20)\d{2}-\d{2}-\d{2})/i,
    /<time[^>]*datetime="((?:19|20)\d{2}-\d{2}-\d{2})/i,
  ];
  const dates = datePatterns.map((pattern) => pattern.exec(html)?.[1]);
  return {
    url,
    path,
    status,
    bytes: html.length,
    text: textOf(html),
    headings,
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() ?? '',
    updatedAt: dates.find(Boolean) ?? null,
  };
}

/** Same-host links in a page's markup, in document order, deduplicated. */
export function navLinks(html: string, base: string, host: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/<a[^>]+href="([^"#?]+)"/gi)) {
    try {
      const target = new URL(match[1], base);
      if (['https:', 'http:'].includes(target.protocol) && target.hostname === host.toLowerCase())
        found.add(target.href);
    } catch {
      /* Invalid links are not crawl targets. */
    }
  }
  return [...found];
}

export function inferBrandName(pages: SitePage[], host: string): string {
  const homepage = pages.find((page) => page.path === '/');
  const title = homepage?.title?.split(/[|–—:]/, 1)[0].trim();
  if (title && title.length >= 2 && title.length <= 40) return title;
  const [label] = host.split('.');
  return label.replace(/^./, (first) => first.toUpperCase());
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
  const sourcePriority = (path: string) => {
    const index = CANDIDATE_PATHS.indexOf(path);
    return index < 0 ? 98 : index === 0 ? 99 : index - 1;
  };
  const pages = crawl.pages.slice().sort((a, b) => sourcePriority(a.path) - sourcePriority(b.path));
  const candidates = pages.flatMap((page) =>
    proposeClaims(page.text, crawl.brandName).map((proposal) => {
      const claim = proposal.claim;
      return {
        subject: crawl.brandName,
        predicate: claim.predicate,
        object: claim.object,
        polarity: claim.polarity,
        claimText: tightenAround(claim.statement, crawl.brandName, claim.object),
        sourceUrl: page.url,
        effectiveFrom: page.updatedAt,
        sensitivity: (REGULATED.has(claim.predicate)
          ? 'regulated'
          : MATERIAL.has(claim.predicate)
            ? 'material'
            : 'routine') as ClaimCandidate['sensitivity'],
      };
    }),
  );
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify([candidate.predicate, candidate.object.toLowerCase()]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const normalized = statement.trim().split(/\s+/).join(' ');
  const lower = normalized.toLowerCase();
  const objectAt = Math.max(0, lower.indexOf(object.toLowerCase()));
  const subjectAt = lower.lastIndexOf(subject.toLowerCase(), objectAt);
  const sentence = normalized.substring(Math.max(0, subjectAt));
  return sentence.length > 240 ? sentence.substring(0, 239).concat('...') : sentence;
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
  return heading.trimEnd().endsWith('?');
}

export function autoDemand(crawl: CrawlResult, competitors: string[] = []): DemandCandidate[] {
  const brand = crawl.brandName;
  const candidates: Array<[string, string, number]> = [
    ...crawl.pages.flatMap((page) =>
      page.headings
        .filter(isQuestionHeading)
        .map((heading) => [heading.replace(/\?+$/, '').trim(), 'site_faq', 40] as [string, string, number]),
    ),
    ...competitors.slice(0, 6).flatMap(
      (competitor) =>
        [
          [`${brand} vs ${competitor}`, 'competitor_pair', 60],
          [`${competitor} alternative`, 'competitor_pair', 30],
        ] as Array<[string, string, number]>,
    ),
    ...TEMPLATES.map(
      (template) => [template.replace(/\{brand\}/g, brand), 'template', 20] as [string, string, number],
    ),
  ];
  const unique = new Map<string, DemandCandidate>();
  for (const [question, source, estimatedVolume] of candidates) {
    const key = question.toLowerCase().trim();
    if (key.length < 8 || unique.has(key)) continue;
    unique.set(key, { question, source, estimatedVolume, family: classifyIntent(question, [brand]) });
  }
  return [...unique.values()];
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
