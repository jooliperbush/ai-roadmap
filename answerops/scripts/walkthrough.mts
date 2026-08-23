/**
 * Drives every user flow in a real browser and photographs each screen, so the product can be
 * looked at rather than only asserted about. Assertions live in the test suite; this exists to
 * make the result inspectable.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.WALK_BASE ?? 'http://127.0.0.1:4400';
const OUT = process.env.WALK_OUT ?? '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const notes: string[] = [];
let n = 0;

async function shot(name: string, note: string) {
  n++;
  const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  notes.push(`${String(n).padStart(2, '0')} ${name}: ${note}`);
  console.log(`shot ${file}`);
}

async function signIn(email = 'ops@vanar.example', password = 'miscited-demo') {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('signin').click();
  await page.getByTestId('whoami').waitFor();
}

// 1 public page
await page.goto(BASE);
await shot('public-page', 'signed-out marketing page with the worked example');

// 2 self-serve audit request
await page.getByTestId('audit-email').fill('cto@demo.example');
await page.getByTestId('audit-domain').fill('demo.example');
await page.getByTestId('audit-submit').click();
await page.getByTestId('audit-report-url').waitFor({ timeout: 30_000 });
const reportHref = await page.getByTestId('audit-report-url').getAttribute('href');
await shot('audit-requested', `report link returned: ${reportHref}`);

// 3 sign in, answer desk
await signIn();
await shot('answer-desk', 'three sections, every rate with its interval and n');

// 4 defect drill-down
await page.getByTestId('defect-card').first().click();
await shot('defect-drilldown', 'sampled answers, conflicting fact, citations with verdicts');

// 5 schedules
await page.goto(`${BASE}/schedules`);
await shot('schedules', 'month-to-date spend, active schedules, window ledger');

// 6 run a scheduled round now
await page.getByTestId('run-schedule-now').first().click();
await page.getByTestId('flash-ok').waitFor();
await shot('schedule-ran', 'a round ran on demand and a new window appeared');

// 7 alerts and channels
await page.goto(`${BASE}/alerts`);
await shot('alerts', 'alerts with sample sizes, channels, delivery attempts');

// 8 add a channel
await page.getByTestId('channel-kind').selectOption('slack');
await page.getByTestId('channel-target').fill('https://hooks.slack.example/T000/B000/xxx');
await page.getByTestId('create-channel').click();
await page.getByTestId('flash-ok').waitFor();
await shot('channel-added', 'a Slack channel added; a test send records an attempt');

// 9 observatory and a run
await page.goto(`${BASE}/observatory`);
await shot('observatory', 'runs with full provenance, simulated labelled');
await page.getByTestId('run-link').first().click();
await shot('run-detail', 'answer, extracted claims, citations with snapshots');

// 10 snapshot
let link = page.getByTestId('snapshot-link').first();
for (let i = 1; i < 8 && (await link.count()) === 0; i++) {
  await page.goto(`${BASE}/observatory`);
  await page.getByTestId('run-link').nth(i).click();
  link = page.getByTestId('snapshot-link').first();
}
if (await link.count()) {
  await link.click();
  await shot('snapshot', 'a dated snapshot behind a banner saying it is not the live page');
  await page.goBack();
}

// 11 re-check a citation
await page.getByTestId('recheck').first().click();
await page.locator('[data-testid="flash-ok"], [data-testid="flash-error"]').first().waitFor();
await shot('recheck', 'a citation re-checked against a fresh fetch');

// 12 markets
await page.goto(`${BASE}/clusters`);
await page.getByTestId('cluster-link').first().click();
await page.getByTestId('cluster-markets-link').click();
await page.getByTestId('market-DE').check();
await page.getByTestId('market-FR').check();
await page.getByTestId('save-markets').click();
await page.getByTestId('flash-ok').waitFor();
await shot('markets', 'localised variants per market, rates reported separately');

// 13 portfolio and brand switch
await page.goto(`${BASE}/portfolio`);
await shot('portfolio', 'brands ranked by open critical defects');
await page.getByTestId('open-brand').last().click();
await page.getByTestId('flash-ok').waitFor();
await shot('brand-switched', 'the switcher now shows the second brand');
await page.getByTestId('brand-switcher').selectOption({ label: 'Vanar' });
await page.getByTestId('flash-ok').waitFor();

// 14 truth registry
await page.goto(`${BASE}/truth`);
await shot('truth-registry', 'temporal facts, approvals, supersession chains');

// 15 actions and experiments
await page.goto(`${BASE}/actions`);
await shot('actions', 'the closed action catalogue with evidence and state');
await page.goto(`${BASE}/experiments`);
await shot('experiments', 'controlled experiments including an inconclusive verdict');

// 16 crawlers and entities
await page.goto(`${BASE}/crawlers`);
await shot('crawlers', 'bots classified by purpose, not lumped together');
await page.goto(`${BASE}/entities`);
await shot('entities', 'typed relationships, co-mentions awaiting classification');

// 17 methodology
await page.goto(`${BASE}/methodology`);
await shot('methodology-top', 'sampling design and the extractor accuracy table');
await page.evaluate('window.scrollBy(0, 900)');
await shot('methodology-extractor', 'per-predicate precision and recall, with the caveat');

// 18 index
await page.goto(`${BASE}/index`);
await shot('index-before', 'participation off by default, export fields listed');
await page.getByTestId('toggle-consent').click();
await page.getByTestId('flash-ok').waitFor();
await shot('index-after', 'consenting, and every cell suppressed below k of five');
await page.getByTestId('toggle-consent').click();

// 19 audit report
if (reportHref) {
  await page.goto(`${BASE}${reportHref}`);
  await shot('audit-report', 'the dated self-serve report a stranger receives');
  await page.evaluate('window.scrollBy(0, 1200)');
  await shot('audit-report-notested', 'what the audit did not test, stated plainly');
}

// 20 role denial
const viewer = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await viewer.goto(`${BASE}/login`);
await viewer.getByTestId('email').fill('analyst@vanar.example');
await viewer.getByTestId('password').fill('miscited-viewer');
await viewer.getByTestId('signin').click();
await viewer.getByTestId('whoami').waitFor();
await viewer.goto(`${BASE}/observatory`);
await viewer.getByTestId('run-sampling').click();
n++;
await viewer.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-role-denied.png` });
notes.push(`${String(n).padStart(2, '0')} role-denied: a viewer is refused, and told which role it needs`);

// 21 audit log
await page.goto(`${BASE}/audit`);
await shot('audit-log', 'append-only record of every mutating operation');

await browser.close();
console.log('\n' + notes.join('\n'));
