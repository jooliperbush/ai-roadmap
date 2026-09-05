import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const folder = join(process.cwd(), 'artifacts', 'launch');

test('launch site has working navigation, readable FAQs and responsive evidence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://miscited.com/static/launch-card.png',
  );
  expect((await page.request.get('/static/launch-card.png')).status()).toBe(200);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page
    .getByRole('navigation', { name: 'Sections', exact: true })
    .getByRole('link', { name: 'Who it’s for' })
    .click();
  await expect(page).toHaveURL(/#teams$/);
  await page.locator('#faq summary').filter({ hasText: 'How much does it cost?' }).click();
  await expect(page.locator('#faq details[open]')).toContainText('scoped individually');
  await expect(page.getByTestId('rehearsal-notice')).toBeVisible();
  mkdirSync(folder, { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(folder, `website-${width}.png`), fullPage: true });
    if (width === 1440) await page.screenshot({ path: join(folder, 'website-hero.png') });
  }
  expect(errors).toEqual([]);
});

test('audit failure preserves inputs and retry returns a report link', async ({ page }) => {
  await page.goto('/');
  let attempts = 0;
  await page.route('**/audit-request', async (route) => {
    if (++attempts === 1) return route.abort('failed');
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, domain: 'example.com', reportUrl: '/audit/' + 'a'.repeat(32) }),
    });
  });
  await page.getByTestId('audit-email').fill('founder@example.com');
  await page.getByTestId('audit-domain').fill('example.com');
  await page.getByTestId('audit-submit').click();
  await expect(page.locator('[data-outcome]')).toContainText('could not confirm');
  await expect(page.getByTestId('audit-email')).toHaveValue('founder@example.com');
  await expect(page.getByTestId('audit-submit')).toBeEnabled();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('audit-report-url')).toHaveAttribute('href', '/audit/' + 'a'.repeat(32));
  expect(attempts).toBe(2);
});
