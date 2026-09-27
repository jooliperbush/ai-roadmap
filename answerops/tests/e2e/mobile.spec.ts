import { test, expect, type Page } from '@playwright/test';

const EMAIL = 'ops@vanar.example';
const PASSWORD = 'miscited-demo';
const WIDTHS = [320, 360, 390, 768];

async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto('/login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('signin').click();
  await expect(page.getByTestId('whoami')).toBeVisible();
}

/**
 * Everything that runs past the right edge of the viewport. The landing page clips its main element, so a
 * sideways scroll is not the only symptom: a box or a line of text that ends off-screen is cut off instead.
 * Content inside a sideways scroller (a wide table, the app's section tabs) is allowed to extend.
 */
async function spills(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = window.innerWidth + 1;
    const scrolls = (start: Element | null) => {
      for (let el = start; el && el !== document.body; el = el.parentElement) {
        const x = getComputedStyle(el).overflowX;
        if (x === 'auto' || x === 'scroll') return true;
      }
      return false;
    };
    const name = (el: Element) => el.tagName.toLowerCase() + Array.from(el.classList, (c) => '.' + c).join('');
    const found: string[] = [];
    const sideways = document.documentElement.scrollWidth - window.innerWidth;
    if (sideways > 1) found.push(`the page scrolls sideways by ${sideways}px`);
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const box = el.getBoundingClientRect();
      if (box.width && box.height && box.right > limit && !scrolls(el.parentElement))
        found.push(`${name(el)} ends at ${Math.round(box.right)}px`);
    }
    const text = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = text.nextNode(); node; node = text.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width && box.right > limit && !scrolls(node.parentElement))
        found.push(`"${node.textContent.trim().slice(0, 40)}" ends at ${Math.round(box.right)}px`);
    }
    return found.slice(0, 8);
  });
}

async function expectNoSpill(page: Page, path: string) {
  await page.goto(path);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    expect(await spills(page), `${path} at ${width}px`).toEqual([]);
  }
}

test('public pages fit a phone without sideways scrolling or cut-off content', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/blog');
  const post = await page.locator('main a[href^="/blog/"]').first().getAttribute('href');
  expect(post).toBeTruthy();
  for (const path of ['/', '/blog', post!, '/privacy', '/terms', '/login', '/audit/' + '0'.repeat(32)])
    await expectNoSpill(page, path);
});

test('the signed-in answer desk and its main pages fit a phone', async ({ page }) => {
  await signIn(page);
  await page.goto('/observatory');
  const run = await page.locator('a[href^="/runs/"]').first().getAttribute('href');
  expect(run, 'the observatory lists at least one sampled run').toBeTruthy();
  for (const path of ['/', '/weekly', '/alerts', '/clusters', '/truth', '/actions', '/observatory', run!])
    await expectNoSpill(page, path);
});

test('the explainer film holds a 16:9 frame, waits for a click and has a transcript', async ({ page }) => {
  await page.goto('/');
  const video = page.getByTestId('film-video');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).not.toHaveAttribute('autoplay', /.*/);
  await expect(video).toHaveAttribute('poster', /^\/static\/video\/miscited-explainer-poster\.jpg(\?v=\w+)?$/);
  const src = await video.locator('source').getAttribute('src');
  expect(src).toMatch(/^\/static\/video\/miscited-explainer\.mp4(\?v=\w+)?$/);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  // The frame is sized before a byte of media arrives, so nothing below it moves when the poster loads.
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const box = (await video.boundingBox())!;
    expect(Math.abs(box.width / box.height - 16 / 9), `aspect ratio at ${width}px`).toBeLessThan(0.02);
  }

  const poster = await page.request.get((await video.getAttribute('poster'))!);
  expect(poster.status()).toBe(200);
  expect(poster.headers()['content-type']).toContain('image/jpeg');
  // Safari will not play a video from a server that ignores byte ranges.
  const head = await page.request.get(src!, { headers: { range: 'bytes=0-1023' } });
  expect(head.status()).toBe(206);
  expect(head.headers()['content-type']).toContain('video/mp4');
  expect((await head.body()).length).toBe(1024);

  const transcript = page.getByTestId('film-transcript');
  await expect(transcript).not.toHaveAttribute('open', /.*/);
  await transcript.locator('summary').click();
  await expect(transcript.locator('ol > li')).toHaveCount(15);
  await expect(transcript.locator('.transcript-tag', { hasText: 'Illustrative example' }).first()).toBeVisible();
  await expect(transcript.locator('.transcript-tag', { hasText: 'Real case' }).first()).toBeVisible();
  await expect(transcript).toContainText('2024 BCCRT 149');
});

test('the landing page names the method in order and offers the free audit', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero-rule')).toHaveText(/Find.*Trace.*Correct.*Test/i);
  await expect(page.locator('#film-title')).toBeVisible();
  const order = await page.evaluate(() =>
    ['.hero', '#film', '#catches'].map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? NaN),
  );
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
  await expect(page.getByRole('link', { name: /Get a free answer audit/ }).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Writing' })).toHaveAttribute(
    'href',
    '/blog',
  );
});
