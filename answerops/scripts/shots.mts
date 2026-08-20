import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4399';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.goto(`${BASE}/login`);
await page.screenshot({ path: '/tmp/shots/01-login.png' });
await page.fill('[data-testid=email]', 'ops@vanar.example');
await page.fill('[data-testid=password]', 'answerops-demo');
await page.click('[data-testid=signin]');
await page.waitForSelector('[data-testid=section-defects]');
await page.screenshot({ path: '/tmp/shots/02-dashboard.png', fullPage: true });

await page.click('[data-testid=defect-card]');
await page.waitForSelector('[data-testid=defect-detail-headline]');
await page.screenshot({ path: '/tmp/shots/03-defect.png', fullPage: true });

for (const [nav, name] of [['clusters','04-demand'],['truth','05-truth'],['observatory','06-observatory'],['actions','07-actions'],['experiments','08-experiments'],['crawlers','09-crawlers'],['entities','10-entities'],['methodology','11-methodology']] as const) {
  await page.click(`[data-testid=nav-${nav}]`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });
}
await page.click('[data-testid=nav-experiments]');
await page.click('[data-testid=experiment-link]');
await page.waitForSelector('[data-testid=exp-verdict]');
await page.screenshot({ path: '/tmp/shots/12-experiment-detail.png', fullPage: true });

await browser.close();
console.log('shots written');
