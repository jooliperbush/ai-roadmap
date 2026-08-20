import { test, expect, Page } from '@playwright/test';

/**
 * The twelve user flows from the specification, driven in a real browser.
 * These are the flows a customer performs; if one of them regresses, the product is broken
 * regardless of what the unit tests say.
 */

const EMAIL = 'ops@vanar.example';
const PASSWORD = 'answerops-demo';
const OTHER_EMAIL = 'rival@othertenant.example';
const OTHER_PASSWORD = 'other-demo';

async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto('/login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('whoami')).toBeVisible();
}

// ---------------------------------------------------------------- flow 1
test('flow 1 — sign in, reject bad credentials, sign out', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  await page.getByTestId('email').fill(EMAIL);
  await page.getByTestId('password').fill('not-the-password');
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('flash-error')).toContainText('do not match an account');

  await signIn(page);
  await expect(page.locator('h1')).toContainText('Answer desk');

  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

// ---------------------------------------------------------------- flow 2
test('flow 2 — the answer desk shows three sections, each number with its interval and n', async ({ page }) => {
  await signIn(page);

  await expect(page.getByTestId('section-defects')).toBeVisible();
  await expect(page.getByTestId('section-demand')).toBeVisible();
  await expect(page.getByTestId('section-wins')).toBeVisible();

  // Exactly three primary sections plus the per-family coverage table — no mega-dashboard.
  await expect(page.locator('main > section')).toHaveCount(4);

  const measurements = page.getByTestId('measurement');
  await expect(measurements.first()).toBeVisible();
  const count = await measurements.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const text = (await measurements.nth(i).innerText()).trim();
    expect(text, `measurement "${text}" must carry its sample size`).toMatch(/n=\d+/);
    if (/%/.test(text)) expect(text, `measurement "${text}" must carry an interval`).toMatch(/95% CI \d+–\d+%/);
  }

  // No blended visibility score anywhere on the landing screen — the only mention of the
  // phrase is the explanation of why we refuse to compute one.
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(await page.locator('[data-testid=overall-score]').count()).toBe(0);
  expect(body).toContain('no single visibility score');
  expect(body).toContain('never blended');
  const familyRows = await page.getByTestId('family-row').count();
  expect(familyRows, 'defect rates are reported per intent family, not as one number').toBeGreaterThan(2);
});

// ---------------------------------------------------------------- flow 3
test('flow 3 — import demand signals and see clusters filed by intent family', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-clusters').click();

  const before = await page.getByTestId('cluster-row').count();
  await page.getByTestId('import-csv').fill(
    'gsc,best chain for enterprise settlement,120\ngsc,vanar vs avalanche for gaming,90\nbroken_source,unattributable question,50',
  );
  await page.getByTestId('import-submit').click();

  await expect(page.getByTestId('flash-ok')).toContainText('Imported 2 signals');
  await expect(page.getByTestId('flash-ok')).toContainText('1 rejected');
  expect(await page.getByTestId('cluster-row').count()).toBeGreaterThan(before);

  const families = await page.getByTestId('cluster-family').allInnerTexts();
  expect(new Set(families).size).toBeGreaterThan(2);
});

// ---------------------------------------------------------------- flow 4
test('flow 4 — add, approve and supersede a canonical fact, then read its history', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-truth').click();

  await page.getByTestId('truth-predicate').fill('pricing');
  await page.getByTestId('truth-object').fill('$0');
  await page.getByTestId('truth-text').fill('Vanar developer tooling is free to use.');
  await page.getByTestId('truth-from').fill('2026-01-01');
  await page.getByTestId('truth-sensitivity').selectOption('routine');
  await page.getByTestId('truth-submit').click();
  await expect(page.getByTestId('flash-ok')).toContainText('must be approved');

  const unapproved = page.locator('[data-testid=claim-row]', { hasText: 'Vanar developer tooling is free to use.' });
  await expect(unapproved.getByTestId('claim-approval')).toHaveText('unapproved');
  await unapproved.getByTestId('approve-claim').click();
  await expect(page.getByTestId('flash-ok')).toContainText('approved');

  // Supersede it and confirm the old interval closes rather than being overwritten.
  await page.getByTestId('truth-predicate').fill('pricing');
  await page.getByTestId('truth-object').fill('$49');
  await page.getByTestId('truth-text').fill('Vanar developer tooling costs $49 per month from August 2026.');
  await page.getByTestId('truth-from').fill('2026-08-01');
  await page.getByTestId('truth-supersedes').selectOption({ label: 'Vanar developer tooling is free to use.' });
  await page.getByTestId('truth-submit').click();

  const superseded = page.locator('[data-testid=claim-row]', { hasText: 'Vanar developer tooling is free to use.' });
  await expect(superseded).toContainText('2026-08-01');
  await superseded.getByTestId('claim-history').click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);
});

// ---------------------------------------------------------------- flow 5
test('flow 5 — run a sampling round and inspect a run with full provenance', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-observatory').click();

  await page.getByTestId('window-label').fill('e2e_round');
  await page.getByTestId('budget').fill('40');
  await page.getByTestId('run-sampling').click();

  await expect(page.getByTestId('flash-ok')).toContainText('Sampled');
  await expect(page.getByTestId('flash-ok')).toContainText('citations checked');

  // A partial probe must not become the default view of the answer desk.
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('window-picker')).toContainText('e2e_round');
  await expect(page.locator('.lede')).not.toContainText('Window e2e_round');
  await page.getByTestId('nav-observatory').click();

  await page.getByTestId('run-link').first().click();
  const provenance = page.getByTestId('run-provenance');
  for (const field of ['Provider', 'Model', 'Version', 'Surface', 'Grounding', 'Search mode', 'Personalization', 'System config', 'Seed', 'Simulated', 'Raw response']) {
    await expect(provenance).toContainText(field);
  }
});

// ---------------------------------------------------------------- flow 6
test('flow 6 — open a critical defect and see answers, the conflicting fact and citation checks', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('defect-card').first()).toBeVisible();
  await page.getByTestId('defect-card').first().click();

  await expect(page.getByTestId('defect-detail-headline')).toBeVisible();
  await expect(page.getByTestId('answer-block').first()).toBeVisible();
  await expect(page.getByTestId('provenance').first()).toBeVisible();
  await expect(page.getByTestId('canonical-panel')).toBeVisible();
  await expect(page.getByTestId('priority-explanation')).toContainText('defect(lower bound)');
  await expect(page.getByTestId('crawler-note')).toContainText('crawler class');

  // The citation table states whether the cited page actually contains the claim.
  const citations = page.getByTestId('citation-row');
  if (await citations.count()) {
    await expect(citations.first()).toContainText(/supports|absent|contradicts|unreachable|paywalled/);
  }
});

// ---------------------------------------------------------------- flow 7
test('flow 7 — missed demand drill-down shows absence with its interval', async ({ page }) => {
  await signIn(page);
  const cards = page.getByTestId('demand-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText('demand share');
  await cards.first().click();

  await expect(page.getByTestId('cluster-detail-label')).toBeVisible();
  await expect(page.getByTestId('absence-measure')).toContainText('n=');
  await expect(page.getByTestId('absence-measure')).toContainText('95% CI');
  await expect(page.getByTestId('variant').first()).toBeVisible();
});

// ---------------------------------------------------------------- flow 8
test('flow 8 — an action without evidence is rejected; with evidence it is created', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('defect-card').first().click();

  await page.getByTestId('drop-evidence').check();
  await page.getByTestId('create-action').click();
  await expect(page.getByTestId('flash-error')).toContainText('requires at least one evidence reference');

  await page.getByTestId('action-type').selectOption('update_owned_page');
  await page.getByTestId('action-title').fill('E2E: correct the record on the affected pages');
  await page.getByTestId('create-action').click();

  await expect(page.getByTestId('flash-ok')).toContainText('evidence attached');
  await expect(page.getByTestId('action-title')).toContainText('E2E: correct the record');
  await expect(page.getByTestId('evidence-item').first()).toBeVisible();
  await expect(page.getByTestId('assumption-item').first()).toBeVisible();
  await expect(page.getByTestId('expected-range')).toBeVisible();
});

// ---------------------------------------------------------------- flow 9
test('flow 9 — the lifecycle advances legally and blocks illegal transitions', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-actions').click();
  await page.getByTestId('action-link').first().click();

  await expect(page.getByTestId('state-track')).toBeVisible();
  const state = await page.locator('.state-track .current').innerText();

  if (state === 'Detected') {
    // The browser disables an illegal target before it can be submitted.
    await page.getByTestId('transition-select').selectOption('confirmed');
    await expect(page.getByTestId('transition-submit')).toBeDisabled();
    await expect(page.getByTestId('transition-submit')).toHaveText('Illegal transition');

    await page.getByTestId('transition-select').selectOption('approved');
    await expect(page.getByTestId('transition-submit')).toBeEnabled();
    await page.getByTestId('transition-note').fill('Reviewed against the truth registry');
    await page.getByTestId('transition-submit').click();
    await expect(page.getByTestId('flash-ok')).toContainText('Advanced to approved');

    await page.getByTestId('transition-select').selectOption('shipped');
    await page.getByTestId('transition-submit').click();
    await expect(page.getByTestId('flash-ok')).toContainText('Advanced to shipped');
    await expect(page.getByTestId('action-experiment-link')).toBeVisible();
  }

  await expect(page.getByTestId('transition-row').first()).toBeVisible();
});

// --------------------------------------------------------------- flow 10
test('flow 10 — analyze an experiment and see a confirmed win on the answer desk', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-experiments').click();
  await expect(page.getByTestId('experiment-row').first()).toBeVisible();

  await page.getByTestId('experiment-link').first().click();
  await page.getByTestId('analyze-submit').click();
  await expect(page.getByTestId('flash-ok')).toContainText('Analyzed');

  await expect(page.getByTestId('exp-verdict')).toHaveText(/confirmed|rejected|inconclusive/);
  await expect(page.getByTestId('exp-probability')).toBeVisible();
  await expect(page.getByTestId('alternatives')).toBeVisible();
  await expect(page.getByTestId('control-clusters')).toBeVisible();

  // The seeded, controlled intervention appears in section three with its probability.
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('win-card').first()).toBeVisible();
  await expect(page.getByTestId('win-headline').first()).toContainText(/probability the improvement is real/i);
});

// --------------------------------------------------------------- flow 11
test('flow 11 — crawlers are classified by purpose and entities by typed relation', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-crawlers').click();
  const classes = await page.getByTestId('bot-class').allInnerTexts();
  expect(new Set(classes).size).toBeGreaterThan(1);
  await expect(page.locator('body')).toContainText('Search / retrieval index');
  await expect(page.locator('body')).toContainText('Training ingestion');

  await page.getByTestId('nav-entities').click();
  await expect(page.getByTestId('entity-row').first()).toBeVisible();

  // A co-mention cannot be promoted to a competitor edge.
  const comention = page.locator('[data-testid=entity-row]', { has: page.locator('[data-testid=entity-basis]', { hasText: 'observed_comention' }) }).first();
  if (await comention.count()) {
    await comention.getByTestId('relation-select').selectOption('competitor');
    await comention.getByTestId('basis-select').selectOption('observed_comention');
    await comention.getByTestId('classify-submit').click();
    await expect(page.getByTestId('flash-error')).toContainText('Refusing to assert');
  }
});

// --------------------------------------------------------------- flow 12
test('flow 12 — methodology and audit are published, and tenants are isolated', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-methodology').click();
  await expect(page.getByTestId('methodology-sampling')).toContainText('Wilson');
  await expect(page.getByTestId('methodology-limits')).toContainText('cannot control what an external model says');
  await expect(page.locator('body')).toContainText('$750/mo');

  await page.getByTestId('nav-audit').click();
  await expect(page.getByTestId('audit-row').first()).toBeVisible();

  await page.getByTestId('logout').click();
  await signIn(page, OTHER_EMAIL, OTHER_PASSWORD);
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('Vanar');

  await page.getByTestId('nav-audit').click();
  const auditBody = await page.locator('body').innerText();
  expect(auditBody).not.toContain('ops@vanar.example');
});
