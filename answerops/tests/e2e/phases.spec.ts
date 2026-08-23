import { test, expect, Page } from '@playwright/test';

/**
 * The flows added in phases 1 to 8, driven in a real browser.
 *
 * Same rule as the original twelve: a flow that only works when a test calls the service layer
 * is not a flow a customer has.
 */

const EMAIL = 'ops@vanar.example';
const PASSWORD = 'miscited-demo';
const VIEWER_EMAIL = 'analyst@vanar.example';
const VIEWER_PASSWORD = 'miscited-viewer';

async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto('/login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('whoami')).toBeVisible();
}

// ---------------------------------------------------------------- flow 14
test('flow 14 — a schedule exists, runs on demand, and records what the window cost', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-schedules').click();
  await expect(page.locator('h1')).toContainText('Schedules');

  // The seeded workspace ships with one, so the loop is visible on first boot.
  await expect(page.getByTestId('schedule-row').first()).toBeVisible();
  await expect(page.getByTestId('schedule-enabled').first()).toBeVisible();
  await expect(page.getByTestId('mtd-spend')).toBeVisible();

  // Add a second one and confirm it lands with a next-run time.
  await page.getByTestId('schedule-cadence').selectOption('weekly');
  await page.getByTestId('schedule-budget').fill('250');
  await page.getByTestId('schedule-runs').fill('40');
  await page.getByTestId('create-schedule').click();
  await expect(page.getByTestId('flash-ok')).toContainText('weekly schedule is set');
  await expect(page.getByTestId('schedule-row')).toHaveCount(2);

  // Run one now. This drives the same tick the timer drives.
  const before = await page.getByTestId('window-row').count();
  await page.getByTestId('run-schedule-now').first().click();
  await expect(page.getByTestId('flash-ok')).toContainText(/Ran 1 scheduled round/);
  await expect(page.getByTestId('window-row')).toHaveCount(before + 1);

  // Pausing it stops the loop, and says so rather than just changing a pill.
  await page.getByTestId('toggle-schedule').first().click();
  await expect(page.getByTestId('flash-ok')).toContainText('Nothing will sample on its own');
  await expect(page.getByTestId('schedule-disabled').first()).toBeVisible();

  // Put it back, because the flows share one workspace and a paused schedule is a trap for
  // whichever flow runs next.
  await page.getByTestId('toggle-schedule').first().click();
  await expect(page.getByTestId('schedule-enabled').first()).toBeVisible();
});

// ---------------------------------------------------------------- flow 15
test('flow 15 — alerts carry their sample size, and a delivery channel can be added and tested', async ({ page }) => {
  await signIn(page);

  // Produce a window and let the round raise whatever it raises.
  await page.getByTestId('nav-schedules').click();
  await page.getByTestId('run-schedule-now').first().click();
  await expect(page.getByTestId('flash-ok')).toBeVisible();

  await page.getByTestId('nav-alerts').click();
  await expect(page.locator('h1')).toContainText('Alerts');

  const rows = page.getByTestId('alert-row');
  if ((await rows.count()) > 0) {
    // Whatever fired, it must carry its n. An alert is read fastest and questioned least.
    await expect(rows.first()).toContainText(/n=\d+/);
  } else {
    await expect(page.getByTestId('no-alerts')).toBeVisible();
  }

  await page.getByTestId('channel-kind').selectOption('webhook');
  await page.getByTestId('channel-target').fill('https://hooks.example.com/miscited');
  await page.getByTestId('channel-severity').selectOption('low');
  await page.getByTestId('create-channel').click();
  await expect(page.getByTestId('flash-ok')).toContainText('hooks.example.com');
  await expect(page.getByTestId('channel-row')).toHaveCount(2);

  // Sending a test records the attempt either way; the outcome is honest about which.
  await page.getByTestId('test-channel').last().click();
  await expect(page.getByTestId('attempt-row').first()).toBeVisible();
});

// ---------------------------------------------------------------- flow 16
test('flow 16 — a citation carries a dated snapshot you can open, and can be re-checked', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-observatory').click();

  // Whichever run sorts first is whichever round an earlier flow happened to sample last, and
  // an answer that cites nothing is a normal outcome the product reports rather than a fault.
  // Asserting on run-link.first() therefore asserted on an accident of ordering: it passed or
  // failed depending on which flow ran before it. Scan for a run that actually cites something,
  // and only then require a snapshot behind one of those citations.
  let found = false;
  let link = page.getByTestId('snapshot-link').first();
  const runs = await page.getByTestId('run-link').count();
  for (let i = 0; i < Math.min(runs, 12); i++) {
    await page.goto('/observatory');
    await page.getByTestId('run-link').nth(i).click();
    await expect(page.locator('h1')).toContainText('Run ');
    if ((await page.getByTestId('citation-row').count()) === 0) continue;
    found = true;
    link = page.getByTestId('snapshot-link').first();
    if ((await link.count()) > 0) break;
  }
  expect(found, 'no sampled answer in the window cited anything at all').toBe(true);
  expect(await link.count(), 'no sampled answer cited a retrievable page').toBeGreaterThan(0);

  await link.click();
  await expect(page.getByTestId('snapshot-banner')).toContainText('not the live page');
  await expect(page.getByTestId('snapshot-sha')).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId('snapshot-body')).toBeVisible();

  await page.goBack();
  await page.getByTestId('recheck').first().click();
  await expect(page.locator('[data-testid="flash-ok"], [data-testid="flash-error"]').first()).toBeVisible();
});

// ---------------------------------------------------------------- flow 17
test('flow 17 — a cluster can be sampled in several markets, reported separately', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-clusters').click();
  await page.getByTestId('cluster-link').first().click();
  await page.getByTestId('cluster-markets-link').click();
  await expect(page.locator('h1')).toContainText('Markets for');

  await page.getByTestId('market-DE').check();
  await page.getByTestId('market-FR').check();
  await page.getByTestId('market-US').check();
  await page.getByTestId('save-markets').click();
  await expect(page.getByTestId('flash-ok')).toContainText(/market variants created/);

  // A German variant is actually in German, otherwise the market is decoration.
  await expect(page.getByTestId('variant-row').filter({ hasText: 'Germany' })).toBeVisible();
  await expect(page.getByText('Auf Deutsch').first()).toBeVisible();
  await expect(page.getByText('never combined')).toBeVisible();
});

// ---------------------------------------------------------------- flow 18
test('flow 18 — an agency can see every brand and switch between them', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-portfolio').click();
  await expect(page.locator('h1')).toContainText('Portfolio');
  await expect(page.getByTestId('portfolio-row')).toHaveCount(2);

  await page.getByTestId('open-brand').last().click();
  await expect(page.getByTestId('flash-ok')).toContainText('Now showing');

  // The switcher in the top bar reflects the change and survives navigation.
  await expect(page.getByTestId('brand-switcher')).toBeVisible();
  await page.getByTestId('nav-observatory').click();
  await expect(page.getByTestId('brand-switcher')).toBeVisible();

  await page.getByTestId('brand-switcher').selectOption({ label: 'Vanar' });
  await expect(page.getByTestId('flash-ok')).toContainText('Now showing Vanar');
});

// ---------------------------------------------------------------- flow 19
test('flow 19 — the methodology page publishes the extractor accuracy and its caveat', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-methodology').click();

  await expect(page.getByTestId('extractor-table')).toBeVisible();
  await expect(page.getByTestId('gold-size')).toHaveText(/\d{3}/);
  await expect(page.getByTestId('extractor-evaluated')).toContainText(/evaluated \d{4}-\d{2}-\d{2}/);

  // The caveat is the point. A perfect score on a self-authored gold set is a warning.
  await expect(page.getByTestId('extractor-caveat')).toContainText('authored alongside the extractor');
  await expect(page.getByTestId('extractor-caveat')).toContainText('unverified against real traffic');

  await expect(page.getByTestId('snapshot-count')).toContainText('snapshots held');
  await expect(page.getByText('list prices reviewed')).toBeVisible();
});

// ---------------------------------------------------------------- flow 20
test('flow 20 — index participation is off by default, opt-in, and revocable', async ({ page }) => {
  await signIn(page);
  await page.goto('/index');
  await expect(page.locator('h1')).toContainText('AI Brand Accuracy Index');

  await expect(page.getByTestId('export-fields')).toContainText('provider, model_version');
  await expect(page.getByTestId('toggle-consent')).toContainText('Contribute to the index');

  await page.getByTestId('toggle-consent').click();
  await expect(page.getByTestId('flash-ok')).toContainText('Contributing');
  await expect(page.getByTestId('toggle-consent')).toContainText('Stop contributing');

  // One workspace is fewer than five, so every cell is suppressed rather than published.
  const suppressed = page.getByTestId('index-suppressed');
  const empty = page.getByTestId('index-empty');
  expect((await suppressed.count()) + (await empty.count())).toBeGreaterThan(0);

  await page.getByTestId('toggle-consent').click();
  await expect(page.getByTestId('flash-ok')).toContainText('No longer contributing');
});

// ---------------------------------------------------------------- flow 21
test('flow 21 — a read-only user can read everything and change nothing', async ({ page }) => {
  await signIn(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  await expect(page.getByTestId('role')).toHaveText('viewer');

  for (const nav of ['nav-clusters', 'nav-truth', 'nav-observatory', 'nav-alerts', 'nav-schedules']) {
    await page.getByTestId(nav).click();
    await expect(page.locator('h1')).toBeVisible();
  }

  await page.goto('/observatory');
  await page.getByTestId('run-sampling').click();
  await expect(page.getByTestId('forbidden')).toContainText('needs the editor role');

  // The same user is an editor on the second brand, and there the same action is allowed.
  await page.goto('/portfolio');
  await page.getByTestId('open-brand').last().click();
  await expect(page.getByTestId('role')).toHaveText('editor');
});

// ---------------------------------------------------------------- flow 22
test('flow 22 — a stranger requests an audit and gets a dated report they can act on', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('audit-email').fill('cto@demo.example');
  await page.getByTestId('audit-domain').fill('demo.example');
  await page.getByTestId('audit-submit').click();

  const link = page.getByTestId('audit-report-url');
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/audit\/[0-9a-f]{32}$/);

  // The report fills in as the sample completes.
  await expect(async () => {
    await page.goto(href!);
    await expect(page.getByTestId('audit-sample')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });

  await expect(page.locator('h1')).toContainText('Answer risk audit');
  await expect(page.getByTestId('audit-power')).toContainText('points');
  await expect(page.getByTestId('audit-not-tested')).toContainText(/market|search console/i);
  await expect(page.getByTestId('audit-candidate').first()).toBeVisible();

  // The demo deployment has no provider keys, so this sample came from the stand-in. A stranger
  // must be told that before reading a single number, not in a footnote under them.
  const simBanner = page.getByTestId('audit-simulated-banner');
  await expect(simBanner).toBeVisible();
  await expect(simBanner).toContainText(/No real assistant was asked/i);
  const bannerBox = await simBanner.boundingBox();
  const firstStat = await page.getByTestId('audit-sample').boundingBox();
  expect(bannerBox!.y, 'the disclosure has to sit above the first figure').toBeLessThan(firstStat!.y);

  // One action, and it converts the workspace the audit already built.
  await page.getByTestId('convert-email').fill('founder@demo.example');
  await page.getByTestId('convert-password').fill('a-long-enough-password');
  await page.getByTestId('start-monitoring').click();
  await expect(page.getByTestId('whoami')).toBeVisible();
  await expect(page.getByTestId('flash-ok')).toContainText('Monitoring started');

  // The converted workspace has its own schedule and its own data on day one.
  await page.getByTestId('nav-schedules').click();
  await expect(page.getByTestId('schedule-row')).toHaveCount(1);
  await page.getByTestId('nav-observatory').click();
  await expect(page.getByTestId('run-row').first()).toBeVisible();
});

// ---------------------------------------------------------------- flow 23
test('flow 23 — every state-changing form carries its security token', async ({ page }) => {
  await signIn(page);
  for (const url of ['/observatory', '/truth', '/schedules', '/alerts', '/clusters']) {
    await page.goto(url);
    const forms = await page.locator('form[method="post"]').count();
    if (forms === 0) continue;
    const tokens = await page.locator('input[name="_csrf"]').count();
    expect(tokens, `${url}: ${forms} forms, ${tokens} tokens`).toBeGreaterThanOrEqual(forms);
  }

  // Stripping the token out client-side and posting must be refused by the server.
  await page.goto('/observatory');
  // tsconfig omits the DOM lib on purpose, so this is a string rather than a closure.
  await page.evaluate('document.querySelectorAll(\'input[name="_csrf"]\').forEach(function (el) { el.remove(); })');
  await page.getByTestId('run-sampling').click();
  await expect(page.getByTestId('forbidden')).toContainText('security token');
});

// ---------------------------------------------------------------- flow 24
test('flow 24 — a stranger reads the writing and can reach the audit from it', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.locator('h1')).toContainText('Writing');

  const cards = page.locator('.post-card');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count, 'the index lists every post').toBeGreaterThanOrEqual(3);

  await cards.first().click();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.dateline').first()).toContainText(/Published/);

  // A post has to carry its own structured data or it cannot be cited as a source.
  const ld = await page.locator('script[type="application/ld+json"]').count();
  expect(ld, 'BlogPosting, FAQPage and BreadcrumbList').toBeGreaterThanOrEqual(3);

  // The FAQ answers are visible, not schema-only. Marking up an answer the page does not show
  // is the machine-readable version of a citation that does not support its claim.
  await expect(page.locator('.faq .qa').first()).toBeVisible();

  await page.locator('.post-cta a.btn').click();
  await expect(page.getByTestId('audit-form')).toBeVisible();
});
