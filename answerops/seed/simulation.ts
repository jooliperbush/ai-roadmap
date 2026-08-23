/**
 * Seed world: Vanar as the first hostile test case.
 *
 * Fast-moving infrastructure brands are where this product earns its keep — the facts change
 * quarterly, models keep repeating the previous version of the story, and being wrong about
 * fees, listings or supply has financial consequences for the reader.
 *
 * Two belief profiles are defined. BEFORE is the world the models describe at baseline;
 * AFTER is the world after the corrections shipped in this workspace have been crawled.
 * This is how the simulation represents an intervention landing — the pipeline still has to
 * detect the difference statistically, and it can still come back "inconclusive".
 */

import type { BeliefProfile } from '../src/providers/types.js';

const OWNED = 'vanarchain.com';

export const DEMAND_CSV = `gsc,best l1 blockchain for payments,880
gsc,cheapest blockchain for micropayments,410
gsc,vanar chain vs base,320
gsc,vanar vs polygon for gaming,260
community,is vanar chain legitimate,190
support_chat,how do I migrate my VANRY tokens,210
gsc,where can I buy VANRY,300
gsc,vanar chain transaction fees,240
review_site,vanar chain reviews,120
sales_call,does vanar support staking,150
crm_loss,which chains support enterprise compliance,140
site_search,vanar docs,90
gsc,best chain for AI agents payments,350
community,vanar total supply,130`;

export interface SeedClaim {
  subject: string;
  predicate: string;
  object: string;
  claimText: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sensitivity: 'routine' | 'material' | 'regulated';
  supersedes?: string; // predicate key of the claim it supersedes, matched by object
}

/** The customer-approved record. Dates are what make stale-but-sourced answers detectable. */
export const CANONICAL_CLAIMS: SeedClaim[] = [
  {
    subject: 'Vanar', predicate: 'acquired_by', object: 'Terra Virtua',
    claimText: 'Vanar Chain grew out of Terra Virtua, which was its operating entity until the November 2023 rebrand.',
    effectiveFrom: '2021-01-01T00:00:00.000Z', effectiveTo: '2023-11-01T00:00:00.000Z', sensitivity: 'material',
  },
  {
    subject: 'Vanar', predicate: 'acquired_by', object: 'Vanar Foundation',
    claimText: 'Since November 2023 Vanar Chain operates independently under the Vanar Foundation; it has not been acquired.',
    effectiveFrom: '2023-11-01T00:00:00.000Z', effectiveTo: null, sensitivity: 'material',
  },
  {
    subject: 'Vanar', predicate: 'fees', object: '$0.0002',
    claimText: 'Vanar Chain transaction fees are approximately $0.0002 per transaction.',
    effectiveFrom: '2025-01-15T00:00:00.000Z', effectiveTo: null, sensitivity: 'material',
  },
  {
    subject: 'Vanar', predicate: 'feature_support', object: 'staking',
    claimText: 'Vanar Chain has supported native staking since June 2024.',
    effectiveFrom: '2024-06-01T00:00:00.000Z', effectiveTo: null, sensitivity: 'material',
  },
  {
    subject: 'Vanar', predicate: 'availability', object: 'Gate',
    claimText: 'VANRY was listed on Gate from March 2023.',
    effectiveFrom: '2023-03-01T00:00:00.000Z', effectiveTo: '2025-03-01T00:00:00.000Z', sensitivity: 'material',
  },
  {
    subject: 'Vanar', predicate: 'availability', object: 'Coinbase',
    claimText: 'VANRY has been listed on Coinbase since March 2025; this is the listing customers should be pointed to.',
    effectiveFrom: '2025-03-01T00:00:00.000Z', effectiveTo: null, sensitivity: 'material',
  },
  {
    subject: 'Vanar', predicate: 'token_supply', object: '2.4 billion',
    claimText: 'The total supply of VANRY is 2.4 billion tokens.',
    effectiveFrom: '2024-01-01T00:00:00.000Z', effectiveTo: null, sensitivity: 'regulated',
  },
  {
    subject: 'Vanar', predicate: 'headquarters', object: 'London',
    claimText: 'Vanar Chain is headquartered in London.',
    effectiveFrom: '2023-11-01T00:00:00.000Z', effectiveTo: null, sensitivity: 'routine',
  },
];

const OPENINGS = [
  '{brand} is a layer-1 blockchain aimed at consumer applications, gaming and AI-driven payments.',
  'Here is what I know about {brand}.',
  '{brand} positions itself as a low-cost L1 for high-volume consumer transactions.',
];

const CLOSINGS = [
  'Check their official documentation before relying on any of this for a financial decision.',
  'Figures change frequently in this category, so verify against primary sources.',
  'That is my understanding based on what I can retrieve.',
];

const CITE_OFFICIAL = { url: `https://${OWNED}/docs/fees`, title: 'Vanar — network fees', snapshotText: 'Vanar Chain transaction fees are approximately $0.0002 per transaction.' };
const CITE_STALE_PR = { url: 'https://techcrunch.com/2021/terra-virtua-vanar', title: 'Terra Virtua raises', snapshotText: 'Terra Virtua, the NFT platform, announced a new funding round in 2021.' };
const CITE_LISTICLE = { url: 'https://top10cryptolists.example.com/best-l1-2024', title: 'Best L1 chains 2024', snapshotText: 'Our affiliate partners rank the top chains of the year.' };
const CITE_UGC = { url: 'https://reddit.com/r/cryptocurrency/comments/vanar', title: 'Anyone using Vanar?', snapshotText: 'Some users report that Vanar does not support staking yet.' };
const CITE_UNREACHABLE = { url: 'https://cryptonews.example.com/vanar-supply', title: 'Vanar supply explained', snapshotText: null };

/** The world at baseline: several confident, well-formatted, wrong statements. */
export const VANAR_BEFORE: BeliefProfile = {
  brandName: 'Vanar',
  brandDomain: OWNED,
  opening: OPENINGS,
  closing: CLOSINGS,
  absenceByFamily: {
    unaided_discovery: 0.82,
    comparison: 0.58,
    transactional: 0.3,
  },
  beliefs: [
    {
      // The marquee defect: sourced, confident, and two years out of date.
      text: '{brand} was acquired by Terra Virtua in 2021, and the team has operated under that umbrella since.',
      probability: 0.42,
      citations: [CITE_STALE_PR],
      surfaceBias: { anthropic: 1.2, openai: 1.1 },
    },
    {
      text: 'Transaction fees are around $0.05 per transaction, which is competitive for consumer applications.',
      probability: 0.38,
      citations: [CITE_LISTICLE],
      surfaceBias: { google: 1.2 },
    },
    {
      text: '{brand} does not support staking at present, so holders cannot earn yield natively.',
      probability: 0.36,
      citations: [CITE_UGC],
      surfaceBias: { perplexity: 1.15 },
    },
    {
      text: 'VANRY is available on Gate for most retail buyers.',
      probability: 0.34,
      citations: [],
    },
    {
      text: 'The total supply is 3 billion tokens.',
      probability: 0.3,
      citations: [CITE_UNREACHABLE],
    },
    {
      text: '{brand} integrates with Unreal Engine for game studios.',
      probability: 0.25,
      citations: [],
    },
    {
      text: '{brand} is headquartered in London.',
      probability: 0.5,
      citations: [CITE_OFFICIAL],
    },
  ],
};

/**
 * The world after the corrections have been published and crawled. The defect beliefs are
 * suppressed rather than deleted — models do not forget on command, and a product that
 * modelled a fix as instantaneous would teach customers the wrong expectation.
 */
export const VANAR_AFTER: BeliefProfile = {
  ...VANAR_BEFORE,
  // Correcting factual defects does not conjure presence in unaided discovery. The fix
  // shipped here was a corrections page, so absence barely moves — and the dashboard is
  // expected to keep section 2 open while section 1 improves.
  absenceByFamily: {
    unaided_discovery: 0.78,
    comparison: 0.54,
    transactional: 0.25,
  },
  beliefs: VANAR_BEFORE.beliefs.map((b) => {
    if (b.text.startsWith('{brand} was acquired by Terra Virtua')) return { ...b, probability: 0.06 };
    if (b.text.startsWith('Transaction fees are around $0.05')) return { ...b, probability: 0.08 };
    if (b.text.startsWith('{brand} does not support staking')) return { ...b, probability: 0.1 };
    if (b.text.startsWith('VANRY is available on Gate')) return { ...b, probability: 0.12 };
    if (b.text.startsWith('The total supply is 3 billion')) return { ...b, probability: 0.1 };
    return b;
  }).concat([
    {
      text: 'Transaction fees are approximately $0.0002 per transaction according to the network documentation.',
      probability: 0.55,
      citations: [CITE_OFFICIAL],
    },
    {
      text: '{brand} supports staking natively.',
      probability: 0.5,
      citations: [{ url: `https://${OWNED}/staking`, title: 'Vanar staking', snapshotText: 'Vanar Chain supports staking natively since June 2024.' }],
    },
    {
      text: 'VANRY is available on Coinbase.',
      probability: 0.48,
      citations: [{ url: `https://${OWNED}/listings`, title: 'Where to buy VANRY', snapshotText: 'VANRY is available on Coinbase.' }],
    },
  ]),
};

export const CRAWLER_EVENTS = [
  { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', path: '/docs/fees', status: 403, blockedBy: 'robots.txt Disallow: /docs' },
  { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', path: '/staking', status: 403, blockedBy: 'robots.txt Disallow: /docs' },
  { userAgent: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', path: '/docs/fees', status: 403, blockedBy: 'CDN bot rule' },
  { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', path: '/', status: 200, blockedBy: '' },
  { userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', path: '/', status: 200, blockedBy: '' },
  { userAgent: 'Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)', path: '/listings', status: 200, blockedBy: '' },
  { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', path: '/', status: 200, blockedBy: '' },
  { userAgent: 'Mozilla/5.0 (compatible; Google-Extended)', path: '/', status: 200, blockedBy: '' },
  { userAgent: 'SomeUnknownScraper/0.3', path: '/', status: 200, blockedBy: '' },
];

export const ENTITIES = [
  { name: 'Base', relation: 'competitor', basis: 'customer_declared', domain: 'base.org', note: 'Named in competitive deals; declared by the customer.' },
  { name: 'Polygon', relation: 'competitor', basis: 'market_registry', domain: 'polygon.technology', note: 'Same category in the market registry.' },
  { name: 'Unreal Engine', relation: 'integration', basis: 'contract', domain: 'unrealengine.com', note: 'Integration partner under contract.' },
  { name: 'Coinbase', relation: 'partner', basis: 'contract', domain: 'coinbase.com', note: 'Listing venue.' },
  { name: 'CoinDesk', relation: 'publisher', basis: 'customer_declared', domain: 'coindesk.com', note: 'Covers the category.' },
];

/**
 * The pages the stand-in upstream cites, as a fetchable map.
 *
 * Used by the demo and by the end-to-end suite so the re-check flow works without reaching the
 * internet. `CITE_UNREACHABLE` is deliberately absent, because a citation that cannot be
 * retrieved is one of the outcomes the product has to be able to report.
 */
export const DEMO_AUDIT_DOMAIN = 'demo.example';

/**
 * A fixture company, so the self-serve audit can be exercised end to end in the demo and in
 * the browser suite without auditing somebody's real website. Its pages are written to contain
 * facts the stand-in upstream gets wrong.
 */
export const DEMO_SITE: Record<string, { body: string }> = {
  [`https://${DEMO_AUDIT_DOMAIN}/`]: {
    body: '<title>Demo Corp | Payments infrastructure</title><h1>Demo Corp</h1>'
      + '<p>Demo Corp was founded in 2019 and is headquartered in Lisbon.</p>'
      + '<h2>How do I get started with Demo Corp?</h2><h2>Is Demo Corp legitimate?</h2>',
  },
  [`https://${DEMO_AUDIT_DOMAIN}/pricing`]: {
    body: '<title>Pricing</title><p>Last updated: 2026-04-02</p>'
      + '<p>Demo Corp pricing starts at $29 per month. Transaction fees are 0.4%.</p>'
      + '<h2>What does Demo Corp cost?</h2>',
  },
  [`https://${DEMO_AUDIT_DOMAIN}/about`]: {
    body: '<title>About</title><p>Demo Corp employs 90 people. Demo Corp raised $12 million in its Series A.</p>'
      + '<h2>Demo Corp vs Contoso</h2>',
  },
  [`https://${DEMO_AUDIT_DOMAIN}/security`]: {
    body: '<title>Security</title><p>Demo Corp is SOC 2 Type II certified. Demo Corp supports SSO on every plan.</p>',
  },
};

/**
 * What the stand-in upstream believes about the fixture company: three confident statements
 * that contradict what its own pages say, plus one that agrees. The audit is only worth
 * demonstrating if it finds something a reader can check against the site itself.
 */
export const DEMO_AUDIT_BELIEFS: BeliefProfile = {
  brandName: 'Demo Corp',
  brandDomain: DEMO_AUDIT_DOMAIN,
  opening: ['Here is what I know about {brand}.'],
  closing: ['Check their site for the current details.'],
  absenceByFamily: { unaided_discovery: 0.5, comparison: 0.4 },
  beliefs: [
    {
      text: '{brand} pricing starts at $99 per month.',
      probability: 0.55,
      citations: [{ url: `https://${DEMO_AUDIT_DOMAIN}/pricing`, title: 'Pricing', snapshotText: null }],
    },
    { text: '{brand} does not support SSO.', probability: 0.45, citations: [] },
    { text: '{brand} was founded in 2015.', probability: 0.4, citations: [] },
    { text: '{brand} is SOC 2 Type II certified.', probability: 0.5, citations: [] },
  ],
};

export const DEMO_PAGES: Record<string, { body: string }> = {
  ...DEMO_SITE,
  [CITE_OFFICIAL.url]: { body: `<html><body><p>${CITE_OFFICIAL.snapshotText}</p></body></html>` },
  [CITE_STALE_PR.url]: { body: `<html><body><p>${CITE_STALE_PR.snapshotText}</p></body></html>` },
  [CITE_LISTICLE.url]: { body: `<html><body><p>${CITE_LISTICLE.snapshotText}</p></body></html>` },
  [CITE_UGC.url]: { body: `<html><body><p>${CITE_UGC.snapshotText}</p></body></html>` },
};
