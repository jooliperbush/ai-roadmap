/**
 * Builds tests/fixtures/gold-set.json.
 *
 * Two origins, labelled, because they measure different things. `handwritten` entries are
 * sentences in the register models actually produce, including the sloppy ones; `systematic`
 * entries vary one surface form at a time so a regression points at a rule rather than at a
 * paragraph. Both count toward the published numbers and the split is recorded per entry, so
 * a reader of /methodology can discount whichever they distrust.
 *
 * Distractors matter as much as positives. A gold set of only positive examples measures
 * recall and calls it accuracy.
 */

import { writeFileSync } from 'node:fs';

interface Expected { predicate: string; object: string; polarity: 'affirm' | 'negate' }
interface GoldEntry {
  id: string;
  text: string;
  brand: string;
  expected: Expected[];
  split: 'dev' | 'holdout';
  origin: 'handwritten' | 'systematic';
}

const BRAND = 'Northwind';

/** Sentences a model actually writes, per predicate, with the tuple each one asserts. */
const HANDWRITTEN: Array<[string, Expected[]]> = [
  // acquired_by
  [`${BRAND} was acquired by Contoso in 2021.`, [{ predicate: 'acquired_by', object: 'Contoso', polarity: 'affirm' }]],
  [`${BRAND} is now owned by Contoso Group.`, [{ predicate: 'acquired_by', object: 'Contoso Group', polarity: 'affirm' }]],
  [`They were bought out by Fabrikam a few years back.`, [{ predicate: 'acquired_by', object: 'Fabrikam', polarity: 'affirm' }]],
  [`${BRAND} is part of Litware Holdings.`, [{ predicate: 'acquired_by', object: 'Litware Holdings', polarity: 'affirm' }]],
  [`The acquisition by Contoso closed last year.`, [{ predicate: 'acquired_by', object: 'Contoso', polarity: 'affirm' }]],
  [`${BRAND} was snapped up by Tailwind Labs.`, [{ predicate: 'acquired_by', object: 'Tailwind Labs', polarity: 'affirm' }]],
  [`${BRAND} is a subsidiary of Adventure Works.`, [{ predicate: 'acquired_by', object: 'Adventure Works', polarity: 'affirm' }]],

  // ceo
  [`${BRAND}'s CEO is Dana Whitfield.`, [{ predicate: 'ceo', object: 'Dana Whitfield', polarity: 'affirm' }]],
  [`The company is led by Marcus Ellery.`, [{ predicate: 'ceo', object: 'Marcus Ellery', polarity: 'affirm' }]],
  [`${BRAND} is run by Priya Raman these days.`, [{ predicate: 'ceo', object: 'Priya Raman', polarity: 'affirm' }]],
  [`Its chief executive is Tomas Lindqvist.`, [{ predicate: 'ceo', object: 'Tomas Lindqvist', polarity: 'affirm' }]],
  [`${BRAND} was founded and led by Aisha Nour.`, [{ predicate: 'ceo', object: 'Aisha Nour', polarity: 'affirm' }]],

  // pricing
  [`${BRAND} pricing starts at $49 per month.`, [{ predicate: 'pricing', object: '$49 per month', polarity: 'affirm' }]],
  [`Plans start from $199/month for the team tier.`, [{ predicate: 'pricing', object: '$199/month', polarity: 'affirm' }]],
  [`The free tier is discontinued.`, [{ predicate: 'pricing', object: 'discontinued', polarity: 'affirm' }]],
  [`${BRAND} costs $12 per seat.`, [{ predicate: 'pricing', object: '$12 per seat', polarity: 'affirm' }]],
  [`The cheapest plan is $29.`, [{ predicate: 'pricing', object: '$29', polarity: 'affirm' }]],

  // fees
  [`Transaction fees are around 0.5%.`, [{ predicate: 'fees', object: '0.5%', polarity: 'affirm' }]],
  [`${BRAND} charges about $0.02 per transaction.`, [{ predicate: 'fees', object: '$0.02 per transaction', polarity: 'affirm' }]],
  [`Network fees of 0.30 usd apply.`, [{ predicate: 'fees', object: '0.30 usd', polarity: 'affirm' }]],
  [`Gas costs around $0.05 on this network.`, [{ predicate: 'fees', object: '$0.05', polarity: 'affirm' }]],

  // feature_support
  [`${BRAND} supports SSO for enterprise accounts.`, [{ predicate: 'feature_support', object: 'SSO', polarity: 'affirm' }]],
  [`${BRAND} does not support SAML.`, [{ predicate: 'feature_support', object: 'SAML', polarity: 'negate' }]],
  [`There is no SCIM provisioning.`, [{ predicate: 'feature_support', object: 'SCIM', polarity: 'negate' }]],
  [`It ships with webhooks out of the box.`, [{ predicate: 'feature_support', object: 'webhooks', polarity: 'affirm' }]],
  [`${BRAND} lacks audit logs on the lower tiers.`, [{ predicate: 'feature_support', object: 'audit logs', polarity: 'negate' }]],
  [`Built-in MFA is available to all customers.`, [{ predicate: 'feature_support', object: 'MFA', polarity: 'affirm' }]],
  [`${BRAND} offers staking to token holders.`, [{ predicate: 'feature_support', object: 'staking', polarity: 'affirm' }]],

  // integration
  [`${BRAND} integrates with Salesforce.`, [{ predicate: 'integration', object: 'Salesforce', polarity: 'affirm' }]],
  [`There is no native integration with Snowflake.`, [{ predicate: 'integration', object: 'Snowflake', polarity: 'negate' }]],
  [`Integration with Datadog is supported.`, [{ predicate: 'integration', object: 'Datadog', polarity: 'affirm' }]],

  // availability
  [`VANRY is available on Binance.`, [{ predicate: 'availability', object: 'Binance', polarity: 'affirm' }]],
  [`${BRAND} is listed on Coinbase.`, [{ predicate: 'availability', object: 'Coinbase', polarity: 'affirm' }]],
  [`You can buy it on Kraken.`, [{ predicate: 'availability', object: 'Kraken', polarity: 'affirm' }]],
  [`It is not available on Gemini.`, [{ predicate: 'availability', object: 'Gemini', polarity: 'negate' }]],

  // product_status
  [`The product has been discontinued.`, [{ predicate: 'product_status', object: 'discontinued', polarity: 'affirm' }]],
  [`${BRAND} is actively maintained.`, [{ predicate: 'product_status', object: 'actively maintained', polarity: 'affirm' }]],
  [`The project was sunset in 2024.`, [{ predicate: 'product_status', object: 'sunset', polarity: 'affirm' }]],
  [`It is generally available now.`, [{ predicate: 'product_status', object: 'generally available', polarity: 'affirm' }]],

  // compliance
  [`${BRAND} is SOC 2 Type II certified.`, [{ predicate: 'compliance', object: 'SOC 2 Type II', polarity: 'affirm' }]],
  [`The company is ISO 27001 compliant.`, [{ predicate: 'compliance', object: 'ISO 27001', polarity: 'affirm' }]],
  [`${BRAND} is GDPR-compliant.`, [{ predicate: 'compliance', object: 'GDPR-compliant', polarity: 'affirm' }]],
  [`They are MiCA-registered in the EU.`, [{ predicate: 'compliance', object: 'MiCA-registered', polarity: 'affirm' }]],

  // token_supply
  [`Total supply is 2.4 billion tokens.`, [{ predicate: 'token_supply', object: '2.4 billion', polarity: 'affirm' }]],
  [`The maximum supply of 1.2 billion is fixed.`, [{ predicate: 'token_supply', object: '1.2 billion', polarity: 'affirm' }]],
  [`Circulating supply is 850 million.`, [{ predicate: 'token_supply', object: '850 million', polarity: 'affirm' }]],

  // headquarters
  [`${BRAND} is headquartered in Dubai.`, [{ predicate: 'headquarters', object: 'Dubai', polarity: 'affirm' }]],
  [`The team is based in Berlin, Germany.`, [{ predicate: 'headquarters', object: 'Berlin, Germany', polarity: 'affirm' }]],
  [`They operate from Singapore.`, [{ predicate: 'headquarters', object: 'Singapore', polarity: 'affirm' }]],

  // funding (new)
  [`${BRAND} raised $40 million in its Series B.`, [{ predicate: 'funding', object: '$40 million', polarity: 'affirm' }]],
  [`The company secured $8.5m last spring.`, [{ predicate: 'funding', object: '$8.5m', polarity: 'affirm' }]],
  [`They closed a $120 million round.`, [{ predicate: 'funding', object: '$120 million', polarity: 'affirm' }]],
  [`${BRAND} landed $2.3 billion in new capital.`, [{ predicate: 'funding', object: '$2.3 billion', polarity: 'affirm' }]],

  // employee_count (new)
  [`${BRAND} employs 240 people.`, [{ predicate: 'employee_count', object: '240', polarity: 'affirm' }]],
  [`It has around 1,200 employees worldwide.`, [{ predicate: 'employee_count', object: '1,200', polarity: 'affirm' }]],
  [`A team of about 35 builds the product.`, [{ predicate: 'employee_count', object: '35', polarity: 'affirm' }]],

  // founded_year (new)
  [`${BRAND} was founded in 2017.`, [{ predicate: 'founded_year', object: '2017', polarity: 'affirm' }]],
  [`The company launched in 2011.`, [{ predicate: 'founded_year', object: '2011', polarity: 'affirm' }]],
  [`It has been operating since 2009.`, [{ predicate: 'founded_year', object: '2009', polarity: 'affirm' }]],
  [`${BRAND} was established in 2020.`, [{ predicate: 'founded_year', object: '2020', polarity: 'affirm' }]],

  // certification (new)
  [`${BRAND} is licensed by the FCA.`, [{ predicate: 'certification', object: 'FCA', polarity: 'affirm' }]],
  [`They are registered with FinCEN.`, [{ predicate: 'certification', object: 'FinCEN', polarity: 'affirm' }]],
  [`The firm holds a VARA licence.`, [{ predicate: 'certification', object: 'VARA', polarity: 'affirm' }]],

  // partnership (new)
  [`${BRAND} partnered with Contoso on distribution.`, [{ predicate: 'partnership', object: 'Contoso', polarity: 'affirm' }]],
  [`They have a partnership with Fabrikam.`, [{ predicate: 'partnership', object: 'Fabrikam', polarity: 'affirm' }]],
  [`${BRAND} works closely with Adventure Works.`, [{ predicate: 'partnership', object: 'Adventure Works', polarity: 'affirm' }]],
];

/** Text that asserts nothing we track. If the extractor fires here, precision is the casualty. */
const DISTRACTORS: string[] = [
  `${BRAND} is a popular choice among mid-market teams.`,
  `Many reviewers praise the onboarding experience.`,
  `It depends on what you are trying to build.`,
  `${BRAND} has a clean interface and a helpful community.`,
  `I would recommend evaluating a few options before deciding.`,
  `The documentation could be better organised.`,
  `Performance has improved noticeably over the last release.`,
  `Support response times vary by plan.`,
  `${BRAND} appears frequently in comparison articles.`,
  `Some users report a learning curve in the first week.`,
  `There is an active community forum.`,
  `The mobile experience is adequate.`,
  `${BRAND} publishes a public roadmap.`,
  `Pricing information is available on their website.`,
  `Several factors affect which option suits you.`,
  `The company posts regular engineering updates.`,
  `Customers mention reliability as a strength.`,
  `It integrates into most modern stacks without difficulty.`,
  `${BRAND} has been discussed on several podcasts.`,
  `Reviews are broadly positive.`,
  `The trial period gives you time to evaluate.`,
  `Their blog covers infrastructure topics.`,
  `${BRAND} sponsors a number of open source projects.`,
  `Consider your compliance requirements before choosing.`,
  `Migration effort depends on your current setup.`,
  `The changelog is updated frequently.`,
  `${BRAND} has a status page for incidents.`,
  `Community sentiment has been favourable this year.`,
  `You may want to speak to their sales team.`,
  `The API documentation includes code samples.`,
  `Choosing between them comes down to your team's priorities.`,
  `${BRAND} appears in several industry roundups.`,
  `The onboarding flow walks you through the basics.`,
  `Uptime has been steady in recent months.`,
  `Their support team is responsive on weekdays.`,
  `A number of tutorials cover the common setups.`,
  `${BRAND} maintains an open source SDK.`,
  `The dashboard is straightforward to navigate.`,
  `Feedback from early adopters has been encouraging.`,
  `You can request a demo through the website.`,
  `Different teams weigh these tradeoffs differently.`,
  `The product has evolved considerably.`,
  `${BRAND} runs an annual user conference.`,
  `Their newsletter covers product changes.`,
  `Onboarding materials are thorough.`,
  `The company is frequently compared with its peers.`,
  `Adoption has grown steadily.`,
  `Documentation quality varies across sections.`,
  `${BRAND} contributes to standards work in the space.`,
  `It is worth trialling before committing.`,
];

/** One surface form varied at a time, so a regression points at a rule. */
const SYSTEMATIC: Array<{ predicate: string; frames: string[]; objects: string[]; polarity?: 'affirm' | 'negate' }> = [
  {
    predicate: 'acquired_by',
    frames: [`${BRAND} was acquired by {o}.`, `${BRAND} is now owned by {o}.`, `${BRAND} is part of {o}.`],
    objects: ['Contoso', 'Fabrikam', 'Litware', 'Adventure Works', 'Tailwind Labs'],
  },
  {
    predicate: 'pricing',
    frames: [`${BRAND} pricing starts at {o}.`, `${BRAND} is priced at {o}.`, `Plans start from {o}.`],
    objects: ['$9 per month', '$49 per month', '$250/month', '$1,200/month'],
  },
  {
    predicate: 'feature_support',
    frames: [`${BRAND} supports {o}.`, `${BRAND} provides {o}.`, `It comes with {o}.`],
    objects: ['SSO', 'webhooks', 'audit logs', 'API access'],
  },
  {
    predicate: 'feature_support',
    polarity: 'negate',
    frames: [`${BRAND} does not support {o}.`, `There is no {o}.`, `${BRAND} lacks {o}.`],
    objects: ['SSO', 'SAML', 'SCIM'],
  },
  {
    predicate: 'headquarters',
    frames: [`${BRAND} is headquartered in {o}.`, `${BRAND} is based in {o}.`, `They operate from {o}.`],
    objects: ['Dubai', 'Berlin', 'Singapore', 'Toronto', 'Lisbon', 'Austin'],
  },
  {
    predicate: 'founded_year',
    frames: [`${BRAND} was founded in {o}.`, `${BRAND} launched in {o}.`, `${BRAND} was established in {o}.`],
    objects: ['2011', '2017', '2020', '2023'],
  },
  {
    predicate: 'funding',
    frames: [`${BRAND} raised {o}.`, `${BRAND} secured {o}.`, `${BRAND} closed {o}.`],
    objects: ['$5 million', '$40 million', '$1.2 billion', '$8.5m'],
  },
  {
    predicate: 'availability',
    frames: [`${BRAND} is available on {o}.`, `${BRAND} is listed on {o}.`, `You can buy it on {o}.`],
    objects: ['Binance', 'Coinbase', 'Kraken', 'Bybit'],
  },
  {
    predicate: 'compliance',
    frames: [`${BRAND} is {o}.`, `${BRAND} is certified for {o}.`],
    objects: ['SOC 2 Type II', 'ISO 27001'],
  },
  {
    predicate: 'employee_count',
    frames: [`${BRAND} employs {o} people.`, `A team of {o} builds it.`],
    objects: ['35', '240', '1,200'],
  },
  {
    predicate: 'ceo',
    frames: [`${BRAND}'s CEO is {o}.`, `${BRAND} is led by {o}.`, `${BRAND} is run by {o}.`],
    objects: ['Dana Whitfield', 'Marcus Ellery', 'Priya Raman', 'Tomas Lindqvist'],
  },
  {
    predicate: 'integration',
    frames: [`${BRAND} integrates with {o}.`, `Integration with {o} is supported.`],
    objects: ['Salesforce', 'Datadog', 'Snowflake', 'Slack'],
  },
  {
    predicate: 'fees',
    frames: [`Transaction fees are {o}.`, `${BRAND} charges {o}.`, `Network fees of {o} apply.`],
    objects: ['0.5%', '$0.02', '1.9%'],
  },
  {
    predicate: 'token_supply',
    frames: [`Total supply is {o}.`, `Circulating supply is {o}.`, `Maximum supply of {o} is fixed.`],
    objects: ['2.4 billion', '850 million', '1.2 billion'],
  },
  {
    predicate: 'product_status',
    frames: [`The product has been {o}.`, `The project was {o} last year.`],
    objects: ['discontinued', 'deprecated', 'sunset'],
  },
  {
    predicate: 'certification',
    frames: [`${BRAND} is licensed by the {o}.`, `They are registered with {o}.`],
    objects: ['FCA', 'FinCEN', 'VARA', 'MAS'],
  },
  {
    predicate: 'partnership',
    frames: [`${BRAND} partnered with {o}.`, `${BRAND} works closely with {o}.`],
    objects: ['Contoso', 'Fabrikam', 'Adventure Works', 'Litware'],
  },
  {
    predicate: 'availability',
    polarity: 'negate',
    frames: [`${BRAND} is not available on {o}.`, `${BRAND} is not listed on {o}.`],
    objects: ['Gemini', 'Bitstamp'],
  },
  {
    predicate: 'integration',
    polarity: 'negate',
    frames: [`There is no native integration with {o}.`, `${BRAND} has no integration with {o}.`],
    objects: ['Snowflake', 'Workday'],
  },
];

const entries: GoldEntry[] = [];
let n = 0;

for (const [text, expected] of HANDWRITTEN) {
  entries.push({ id: `gs-${String(++n).padStart(3, '0')}`, text, brand: BRAND, expected, origin: 'handwritten', split: 'dev' });
}

for (const group of SYSTEMATIC) {
  for (const frame of group.frames) {
    for (const object of group.objects) {
      entries.push({
        id: `gs-${String(++n).padStart(3, '0')}`,
        text: frame.replace('{o}', object),
        brand: BRAND,
        expected: [{ predicate: group.predicate, object, polarity: group.polarity ?? 'affirm' }],
        origin: 'systematic',
        split: 'dev',
      });
    }
  }
}

for (const text of DISTRACTORS) {
  entries.push({ id: `gs-${String(++n).padStart(3, '0')}`, text, brand: BRAND, expected: [], origin: 'handwritten', split: 'dev' });
}

// Deterministic split: every third entry is held out, so both origins and every predicate
// appear on both sides. A random split with no seed would make the published numbers
// unreproducible, which for a page that publishes its own accuracy is not acceptable.
for (let i = 0; i < entries.length; i++) entries[i].split = i % 3 === 0 ? 'holdout' : 'dev';

writeFileSync(
  'tests/fixtures/gold-set.json',
  `${JSON.stringify({ brand: BRAND, builtBy: 'scripts/build-gold-set.mts', entries }, null, 2)}\n`,
);
console.log(`gold set: ${entries.length} entries (${entries.filter((e) => e.split === 'holdout').length} held out)`);
