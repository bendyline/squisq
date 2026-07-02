import { chromium } from 'playwright';
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
const info = await page.evaluate(() => {
  const fos = Array.from(document.querySelectorAll('[data-testid="preview-panel"] foreignObject'));
  return fos.map(fo => {
    const div = fo.querySelector('div');
    const firstIcon = fo.querySelector('i[class*="fa-"]');
    return {
      foAttrs: { x: fo.getAttribute('x'), y: fo.getAttribute('y'), w: fo.getAttribute('width'), h: fo.getAttribute('height') },
      divInline: div?.getAttribute('style')?.slice(0,160),
      innerHTMLstart: div?.innerHTML?.slice(0, 120),
      iconDisplay: firstIcon ? getComputedStyle(firstIcon).display : null,
      divWidth: div ? div.getBoundingClientRect().width : null,
      hasIcon: !!firstIcon,
    };
  }).filter(f => f.hasIcon || (f.innerHTMLstart||'').includes('FontAwesome'));
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
