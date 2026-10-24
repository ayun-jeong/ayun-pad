import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const server = spawn('npx', ['vite', 'preview', '--port', '4334', '--strictPort'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://localhost:4334/ayun-pad/', { waitUntil: 'networkidle0' });
await page.waitForSelector('.editor > p');
const cdp = await page.createCDPSession();
const k = page.keyboard;
// 한글 입력기처럼: 글자마다 조합(imeSetComposition) → 확정(insertText). 띄어쓰기 · 기호는 바로 확정.
async function hangul(text) {
  for (const ch of text) {
    if (/[가-힣]/.test(ch)) {
      await cdp.send('Input.imeSetComposition', { text: ch, selectionStart: 1, selectionEnd: 1 });
      await sleep(15);
      await cdp.send('Input.insertText', { text: ch });
    } else await cdp.send('Input.insertText', { text: ch });
    await sleep(15);
  }
}
await page.click('.addnote');
await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
await page.click('.editor');
await hangul('안녕하세요'); await k.press('Enter');
await hangul('- '); await hangul('테스트하는중'); await k.press('Enter');
await k.press('Backspace'); // 꺾쇠 풀기 → 보통 줄
await hangul('테스트 하는 중:'); await k.press('Enter');
await hangul('- ');
await hangul('테스'); await k.press('Enter');
await hangul('안녕:');
await sleep(300);
console.log(JSON.stringify(await page.$$eval('.editor > p', (ps) => ps.map((p) => ({ k: p.dataset.kind, d: p.dataset.depth, t: p.textContent, red: [...p.querySelectorAll('.a-red')].map((x) => x.textContent).join('') }))), null, 0));
console.log('composing state', await page.evaluate(() => { const v = window.__ayunpad.view(); const st = v.state.plugins.find((p) => p.key.startsWith('auto$'))?.getState(v.state); return st?.composing; }));
await browser.close();
server.kill();
