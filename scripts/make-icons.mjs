// 앱 아이콘(PNG)을 그린다: 흰 바탕에 빨간 가지선과 형광펜 띠. 사용: node scripts/make-icons.mjs
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const art = `
  <g stroke="#EC3535" stroke-width="4.2" stroke-linecap="round" fill="none"><path d="M18 13V45M18 26H29M18 45H29"/></g>
  <rect x="12" y="7" width="22" height="4.4" rx="2.2" fill="#EC3535"/>
  <rect x="32.5" y="21.6" width="19" height="7.6" rx="3" fill="#FFCB10" fill-opacity=".45"/>
  <rect x="33" y="24" width="16" height="4.2" rx="2.1" fill="#EC3535"/>
  <rect x="33" y="35" width="20" height="3.6" rx="1.8" fill="#15181D"/>
  <rect x="33" y="43" width="14" height="4.2" rx="2.1" fill="#0064E8"/>
  <rect x="33" y="52" width="18" height="3.6" rx="1.8" fill="#15181D"/>`;
const svg = (maskable) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">` +
  `<rect width="64" height="64" rx="${maskable ? 0 : 13}" fill="#ffffff"/>` +
  (maskable ? `<g transform="translate(9.6 9.6) scale(.7)">${art}</g>` : art) +
  `</svg>`;

const out = [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/apple-touch-icon.png', 180, true],
  ['public/icon-maskable-512.png', 512, true],
];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
for (const [file, size, maskable] of out) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(maskable)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true });
  console.log(file, size);
}
await browser.close();
