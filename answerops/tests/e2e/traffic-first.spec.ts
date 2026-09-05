import { test, expect } from '@playwright/test';

test('unconfigured visitors try the example before signup and source follows the audit', async ({ page }) => {
  const events: { source: string; event: string }[] = [];
  await page.route('**/launch-event', async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
  });
  let audit: Record<string, string> = {};
  await page.route('**/audit-request', async (route) => {
    audit = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, domain: 'example.com', reportUrl: '/audit/' + 'a'.repeat(32) }),
    });
  });
  await page.goto('/?utm_source=linkedin&utm_campaign=traffic_test');
  await expect(page.getByTestId('cta-hero')).toHaveText(/Try the worked example/);
  await page.getByTestId('cta-hero').click();
  await expect(page).toHaveURL(/#example$/);
  await expect(page.locator('[data-exhibit]')).toBeVisible();
  await expect
    .poll(() => events.some((e) => e.source === 'linkedin' && e.event === 'landing_view'))
    .toBe(true);
  await expect.poll(() => events.some((e) => e.event === 'primary_cta')).toBe(true);
  await page.getByTestId('audit-email').fill('test@example.com');
  await page.getByTestId('audit-domain').fill('example.com');
  await page.getByTestId('audit-submit').click();
  await expect(page.getByTestId('audit-report-url')).toBeVisible();
  expect(audit.source).toBe('linkedin');
});

test('optional events respect Do Not Track without breaking the example', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }));
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/launch-event')) requests.push(r.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByTestId('cta-hero').click();
  await expect(page.locator('[data-exhibit]')).toHaveAttribute('data-phase', 'done');
  expect(requests).toEqual([]);
});
