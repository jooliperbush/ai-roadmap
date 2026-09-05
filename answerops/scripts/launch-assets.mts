import { chromium } from '@playwright/test';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

// Render original typographic launch artwork; no customer data or live findings.
const folder = join(process.cwd(), 'docs', 'launch', 'assets');
mkdirSync(folder, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1270, height: 760 }, deviceScaleFactor: 1 });
  const base = `<style>*{box-sizing:border-box}body{margin:0;background:#f7f4ed;color:#252820;font-family:'Avenir Next',sans-serif}main{height:760px;padding:54px 64px;display:flex;flex-direction:column}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d6d5ca;padding-bottom:22px;margin-bottom:45px}.brand{font:bold 30px 'Avenir Next',sans-serif;letter-spacing:-1.5px}.brand b{color:#b63724;font:italic 42px Georgia,serif;margin-right:12px}.eyebrow{font:11px monospace;letter-spacing:1px;color:#64675e}h1{font:normal 76px/1.06 'Iowan Old Style',Georgia,serif;letter-spacing:-4px;margin:0 0 24px;max-width:800px}h1 em{color:#b63724;font-weight:normal}p{font-size:20px;line-height:1.6;max-width:800px;color:#64675e;margin:0}footer{margin-top:auto;border-top:1px solid #d6d5ca;padding-top:18px;display:flex;justify-content:space-between;font:11px monospace;color:#64675e}.row{display:grid;grid-template-columns:1fr 1fr;gap:25px}.box{padding:25px;border:1px solid #d6d5ca;background:#fffdf7}.box p{font-size:23px;color:#252820}.tag{font:11px monospace;text-transform:uppercase;color:#b63724;display:block;margin-bottom:18px}.good{background:#eaf0e6;border-left:3px solid #32483b}.small{font-size:13px;margin-top:16px}.steps{display:flex;margin-top:35px}.steps>div{flex:1;padding:24px;border-top:1px solid #c3c8b9;border-right:1px solid #c3c8b9}.steps strong{display:block;font:30px Georgia;margin:28px 0 15px}.steps p{font-size:15px;max-width:23ch}mark{background:#f6e4db;color:#b63724}</style>`;
  const cards = [
    [
      '01-position.png',
      '01 / THE QUESTION',
      '<h1>Your product changed.<br><em>The answer didn’t.</em></h1><p>AI answer accuracy for B2B SaaS.<br>Find the wrong fact. Follow the evidence. Recheck the correction.</p>',
    ],
    [
      '02-evidence.png',
      '02 / THE EVIDENCE',
      '<h1 style="font-size:59px">A citation is a place to <em>look closer.</em></h1><div class="row"><section class="box"><span class="tag">Illustrative answer</span><p>“Acme’s starter plan includes <mark>unlimited projects.</mark>”</p><p class="small">Cites a retired comparison page.</p></section><section class="box good"><span class="tag">Illustrative dated fact</span><p>The starter plan includes <b>three projects.</b></p><p class="small">A reviewed source gives the claim a standard to check against.</p></section></div><p class="small">Synthetic example. Acme and these plan details are fictional.</p>',
    ],
    [
      '03-workflow.png',
      '03 / THE FOLLOW-THROUGH',
      '<h1 style="font-size:63px">Give the finding <em>a next step.</em></h1><div class="steps"><div><span class="tag">01 / Find</span><strong>Inspect the record.</strong><p>Claim, dated fact, source and model setup.</p></div><div><span class="tag">02 / Correct</span><strong>Review a change.</strong><p>A targeted correction to a source you control.</p></div><div><span class="tag">03 / Recheck</span><strong>Measure the result.</strong><p>Compare follow-up samples and keep uncertainty visible.</p></div></div>',
    ],
  ];
  for (const [name, label, body] of cards) {
    await page.setContent(
      `${base}<main><header><span class="brand"><b>m·</b>miscited</span><span class="eyebrow">${label}</span></header>${body}<footer><span>MISCITED / EARLY ACCESS</span><span>Measured, not controlled.</span></footer></main>`,
    );
    await page.screenshot({ path: join(folder, name) });
  }
  await page.setViewportSize({ width: 240, height: 240 });
  await page.setContent(
    '<body style="margin:0;background:#f7f4ed;display:grid;place-items:center;height:240px"><span style="font:italic bold 175px Georgia;color:#b63724;letter-spacing:-16px;transform:translate(-8px,-13px)">m·</span></body>',
  );
  await page.screenshot({ path: join(folder, 'thumbnail-240.png') });
  copyFileSync(
    join(folder, '01-position.png'),
    join(process.cwd(), 'src', 'web', 'public', 'launch-card.png'),
  );
} finally {
  await browser.close();
}
