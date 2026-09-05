import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const artifacts = join(process.cwd(), 'artifacts', 'rebuild');

test('rebuilt console supports keyboard navigation and narrow screens', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('ops@vanar.example');
  await page.getByLabel('Password').fill('miscited-demo');
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('section-defects')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await expect(page.locator('a[aria-current="page"]')).toHaveAttribute('href', '/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(new URL(page.url()).hash).toBe('#main-content');
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, 'dashboard-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: /Answer desk/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: join(artifacts, 'dashboard-mobile.png'), fullPage: true });
});

test('public page respects reduced motion and has no runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('cta-hero')).toBeVisible();
  await expect(page.getByTestId('audit-form')).toBeVisible();
  await expect(page.locator('[data-exhibit]')).toHaveAttribute('data-phase', 'done');
  await expect(page.locator('[data-exhibit] .cursor')).toBeHidden();
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, 'landing-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});
