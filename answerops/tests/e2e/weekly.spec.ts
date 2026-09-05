import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
test('owner enables a weekly plan, edits questions and skips without needing provider access', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByTestId('email').fill('ops@vanar.example');
  await page.getByTestId('password').fill('miscited-demo');
  await page.getByTestId('signin').click();
  await page.goto('/weekly');
  await expect(page.locator('h1')).toHaveText('Your weekly answer check');
  await page.getByTestId('weekly-enable').click();
  await expect(page.getByTestId('weekly-next')).toContainText('Active');
  await page
    .getByTestId('weekly-questions')
    .fill('What does Vanar cost?\nWhich integrations does Vanar support?');
  await page.getByTestId('weekly-save').click();
  await expect(page.getByTestId('weekly-questions')).toHaveValue(
    'What does Vanar cost?\nWhich integrations does Vanar support?',
  );
  await page.goto('/schedules');
  await page.getByTestId('run-schedule-now').last().click();
  await page.goto('/weekly');
  await expect(page.getByTestId('weekly-job')).toContainText('planned');
  await page.getByRole('button', { name: 'Skip this week', exact: true }).click();
  await expect(page.getByTestId('weekly-job')).toContainText('skipped');
  await expect(page.getByTestId('flash-ok')).toContainText('Skipped');
  await page.getByRole('button', { name: 'Pause monitoring', exact: true }).click();
  await page.goto('/weekly');
  await expect(page.getByTestId('weekly-next')).toContainText('Paused');
  mkdirSync('artifacts/launch', { recursive: true });
  await page.screenshot({ path: 'artifacts/launch/weekly-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate('document.documentElement.scrollWidth-innerWidth')).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/launch/weekly-mobile.png', fullPage: true });
});
