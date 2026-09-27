import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POSTS } from '../src/content/posts.js';
import { escapeHtml } from '../src/web/html.js';
import { BRAND_INK, BRAND_PAPER, BRAND_RED, faviconSvg, iconSvg } from '../src/web/seo.js';

// Share cards and icons, flat on the site's paper. A card per post goes to src/web/public/og/<slug>.png, which
// the post's og:image and BlogPosting image then name. Run `npm run og` after adding or retitling a post: every
// file is rewritten from its source, so a second run changes nothing, and nothing is deleted.
const PUBLIC = join(process.cwd(), 'src', 'web', 'public');
const MUTED = '#64675e';
const LINE = '#d6d5ca';
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
const MONO = "'SFMono-Regular', Consolas, monospace";
const logo = `data:image/png;base64,${readFileSync(join(PUBLIC, 'miscited-logo-rust.png')).toString('base64')}`;
// The red-pencil stroke under the wordmark, as .wordmark::after draws it in landing.css.
const underline = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 60" fill="none" stroke="${BRAND_RED}" stroke-width="20" stroke-linecap="round"><path d="M10 34 C 220 50, 500 18, 740 36 S 940 46, 990 26"/></svg>`,
)}`;
const style = `*{box-sizing:border-box}html,body{margin:0}body{background:${BRAND_PAPER};color:${BRAND_INK}}
main{width:1200px;height:630px;padding:58px 72px 50px;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:16px}
.wordmark{position:relative;font:500 46px ${SERIF};letter-spacing:-1.6px}
.wordmark::after{content:'';position:absolute;left:-2%;top:calc(50% + 0.38em);width:104%;aspect-ratio:1000/60;background:url("${underline}") 0 0/100% 100% no-repeat}
.eyebrow{margin-left:auto;font:15px ${MONO};letter-spacing:2px;text-transform:uppercase;color:${MUTED}}
.title{flex:1;display:flex;align-items:center;min-height:0;margin:28px 0}
h1{margin:0;max-width:1040px;font:400 72px/1.08 ${SERIF};letter-spacing:-0.025em;text-wrap:balance}
footer{border-top:1px solid ${LINE};padding-top:20px;display:flex;justify-content:space-between;font:15px ${MONO};letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}}`;
const card = (title: string) =>
  `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><style>${style}</style></head><body><main><header><img src="${logo}" alt="" width="84" height="55"><span class="wordmark">miscited</span><span class="eyebrow">Writing</span></header><div class="title"><h1>${escapeHtml(title)}</h1></div><footer><span>miscited.com/blog</span><span>Measured, not controlled.</span></footer></main></body></html>`;
// Steps the title down from 72px until it fits its band. A string, so the bundler cannot add helpers to it.
const FIT = `(async () => {
  await document.fonts.ready;
  const band = document.querySelector('.title'), title = document.querySelector('h1');
  for (let size = 72; size > 40; size -= 2) {
    title.style.fontSize = size + 'px';
    if (title.offsetHeight <= band.clientHeight) break;
  }
})()`;
const square = (svg: string, size: number) =>
  `<!DOCTYPE html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
// The favicon keeps its rounded tile; the others are full squares, since iOS and Android cut their own shape.
// A mark 66% of the tile wide stays inside the maskable safe circle, so icon-512 serves as the maskable icon too.
const ICONS: Array<[string, number, string]> = [
  ['apple-touch-icon.png', 180, iconSvg({ span: 0.66, radius: 0 })],
  ['icon-192.png', 192, iconSvg({ span: 0.66, radius: 0 })],
  ['icon-512.png', 512, iconSvg({ span: 0.66, radius: 0 })],
];
const FAVICON_SIZES = [16, 32, 48];
/** A .ico of PNG images, which every current browser reads. It answers /favicon.ico for clients that ask by habit. */
function ico(images: Array<[number, Buffer]>): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, png], index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(([, png]) => png)]);
}

mkdirSync(join(PUBLIC, 'og'), { recursive: true });
mkdirSync(join(PUBLIC, 'icons'), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const post of POSTS) {
    await page.setContent(card(post.title));
    await page.evaluate(FIT);
    await page.screenshot({ path: join(PUBLIC, 'og', `${post.slug}.png`) });
    console.log(`og/${post.slug}.png`);
  }
  const render = async (svg: string, size: number) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(square(svg, size));
    return page.screenshot({ omitBackground: true });
  };
  for (const [name, size, svg] of ICONS) {
    writeFileSync(join(PUBLIC, 'icons', name), await render(svg, size));
    console.log(`icons/${name}`);
  }
  const favicons: Array<[number, Buffer]> = [];
  for (const size of FAVICON_SIZES) favicons.push([size, await render(faviconSvg(), size)]);
  writeFileSync(join(PUBLIC, 'icons', 'favicon-32.png'), favicons.find(([size]) => size === 32)![1]);
  writeFileSync(join(PUBLIC, 'icons', 'favicon.ico'), ico(favicons));
  console.log('icons/favicon-32.png', 'icons/favicon.ico');
} finally {
  await browser.close();
}
