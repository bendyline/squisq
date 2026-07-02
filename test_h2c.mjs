import { chromium } from 'playwright';
import fs from 'fs';
const OUT = '/private/tmp/claude-501/-Users-mike-gh-squisq/43335268-323d-4534-a771-874fc20558b2/scratchpad';
const h2c = fs.readFileSync('/Users/mike/gh/squisq/node_modules/html2canvas/dist/html2canvas.min.js','utf8');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:5210/?sample=about-squisq', { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: 'Play' }).click();
await page.waitForTimeout(1200);
const next = page.locator('button[aria-label="Next slide"]');
for (let i=0;i<22;i++){
  await page.waitForTimeout(600);
  const isIcon = await page.evaluate(()=>/becomes an icon/i.test((document.querySelector('[data-testid="preview-panel"]')?.innerText||'')));
  if (isIcon) break;
  if (await next.first().isDisabled().catch(()=>true)) break;
  await next.first().click();
}
await page.addScriptTag({ content: h2c });
// Rasterize the slide's SVG container the way html2canvas export would.
const result = await page.evaluate(async () => {
  // find the slide root (the doc-player block area)
  const el = document.querySelector('[data-testid="preview-panel"] .doc-player') || document.querySelector('[data-testid="preview-panel"]');
  const canvas = await window.html2canvas(el, { scale: 1, backgroundColor: '#000', logging: false, useCORS: true, allowTaint: true });
  // Sample: count non-near-black pixels in the region where icons are (approx center-right band)
  const ctx = canvas.getContext('2d');
  const dataUrl = canvas.toDataURL('image/png');
  return { w: canvas.width, h: canvas.height, dataUrl };
});
fs.writeFileSync(`${OUT}/h2c_iconslide.png`, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
console.log('h2c canvas', result.w, 'x', result.h, '-> saved h2c_iconslide.png');
await browser.close();
