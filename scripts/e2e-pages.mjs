// 글상자로 쓰기 · 반쪽(페이지) 시험: 종이에 바로 쓰기는 기본으로 꺼짐(빈 종이를 누르면 그 자리에 글상자),
// 예전 본문 글은 두 번 눌러 글상자로, A4 · 반쪽 보기에서 반쪽 ◀ ▶ · 끌어 놓기 · ＋ 빈 반쪽 · × 빈 반쪽 지우기.
// 사용: npm run build && node scripts/e2e-pages.mjs
import { spawn } from 'node:child_process';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4327;
const URL = process.env.E2E_URL ?? `http://localhost:${PORT}/ayun-pad/`;
const server = process.env.E2E_URL ? { kill() {} } : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('preview server did not start');
}

try {
  await waitServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  const k = page.keyboard;
  const combo = async (mods, code) => {
    for (const m of mods) await k.down(m);
    await k.press(code);
    for (const m of [...mods].reverse()) await k.up(m);
  };
  const boxes = () => page.evaluate(() => Object.values(window.__ayunpad.doc().shapes.toJSON()).filter((s) => s.t === 'text').map((s) => ({ id: s.id, text: s.text, y: s.a.y, x: s.a.x })));
  const bodyText = () => page.evaluate(() => window.__ayunpad.view().state.doc.textContent);
  const usable = await page.evaluate(() => 297 - 2 * 3); // 기본 위아래 여백 3mm
  const layer = async () =>
    page.$eval('.shapes-layer', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
    });
  const newNote = async () => {
    await page.click('.addnote');
    await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
    await sleep(150);
  };

  // 1) 기본: 종이에 바로 쓰지 않음 — 빈 종이를 누르면 그 자리에 글상자
  await newNote();
  check(
    (await page.$eval('.app', (e) => e.classList.contains('paper-off'))) && (await page.$eval('.editor', (e) => e.getAttribute('contenteditable'))) === 'false',
    '기본은 종이에 바로 쓰기 끔(본문에 커서가 안 들어감)',
  );
  let L = await layer();
  let ppm = L.w / L.mmW;
  let P = (x, y) => [L.x + x * ppm, L.y + y * ppm];
  await page.mouse.click(...P(20, 30));
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  check(!!(await page.$('.tbox.tedit .tb-edit')), '빈 종이를 누르면 그 자리에 글상자(바로 쓰기)');
  await k.type('첫 글상자');
  await sleep(100);
  await page.mouse.click(...P(60, 80));
  await sleep(200);
  let B = await boxes();
  check(B.length === 1 && B[0].text === '첫 글상자' && !(await page.$('.tbox.tedit')) && (await bodyText()) === '', `고치던 중 빈 곳 누르기 → 끝내기만(새 글상자 없음), 본문은 비어 있음 (${B.map((b) => b.text).join('|')})`);
  await page.mouse.click(...P(60, 80));
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  await k.type('둘째');
  await k.press('Escape');
  await sleep(200);
  await page.mouse.click(...P(30, 120));
  await sleep(150);
  await page.mouse.click(...P(70, 125)); // 쓰지 않고 나온 글상자는 저절로 사라짐
  await sleep(200);
  await k.press('Escape');
  await sleep(150);
  B = await boxes();
  check(B.length === 2 && B.some((b) => b.text === '둘째'), `다시 누르면 새 글상자, 쓰지 않고 나오면 사라짐 (${B.length}개)`);

  // 2) A4 보기: 반쪽마다 단추, ＋ 빈 반쪽, ◀ 자리 바꾸기(그 반쪽 글상자가 같이), × 빈 반쪽 지우기, 끌어 놓기
  await combo(['Alt'], 'Digit3');
  await page.waitForSelector('.pages.a4 .phalf[data-half="0"] .pctl');
  const acts = async () => page.$$eval('.pages .phalf[data-half]', (hs) => hs.map((h) => [...h.querySelectorAll('.pctl button')].map((b) => b.dataset.act + (b.disabled ? '-' : '')).join(',')));
  check((await acts()).join('|') === 'prev-,next-,add', `A4 보기: 반쪽에 ◀ ▶ ＋ 단추 (${(await acts()).join('|')})`);
  const press = async (half, act) => {
    await page.evaluate((h, a) => document.querySelector(`.pages .phalf[data-half="${h}"] .pctl button[data-act="${a}"]`).click(), half, act);
    await sleep(500);
  };
  const y0 = (await boxes()).map((b) => b.y).sort((a, b) => a - b);
  await press(0, 'add');
  check((await acts()).join('|') === 'prev-,next,add|prev,next-,add,del', `＋ → 뒤에 빈 반쪽(1-2), 빈 반쪽에는 × (${(await acts()).join('|')})`);
  await press(1, 'prev');
  const y1 = (await boxes()).map((b) => b.y).sort((a, b) => a - b);
  check(y1.every((y, i) => Math.abs(y - y0[i] - usable) < 0.2), `◀ → 1-2와 1-1 자리 바꾸기: 글상자가 반쪽 높이만큼 오른쪽(다음) 반쪽으로 (${y0.map((v) => v.toFixed(0))} → ${y1.map((v) => v.toFixed(0))})`);
  check((await acts())[0].includes('del'), '이제 1-1이 빈 반쪽(×)');
  // 끌어 놓기: 1-2(글상자) → 1-1 자리
  const h1 = await (await page.$('.pages .phalf[data-half="1"]')).boundingBox();
  const h0 = await (await page.$('.pages .phalf[data-half="0"]')).boundingBox();
  // 화면 안쪽(반쪽 윗부분)을 잡고 끈다
  await page.mouse.move(h1.x + h1.width / 2, h1.y + 250);
  await page.mouse.down();
  await page.mouse.move(h0.x + h0.width / 2, h0.y + 250, { steps: 10 });
  await page.mouse.up();
  await sleep(600);
  const y2 = (await boxes()).map((b) => b.y).sort((a, b) => a - b);
  check(y2.every((y, i) => Math.abs(y - y0[i]) < 0.2), `반쪽을 끌어 다른 반쪽에 놓기 → 그 자리로 (${y2.map((v) => v.toFixed(0))})`);
  check(await page.$eval('.pages', () => true), '끌어 놓아도 보기 화면 그대로(편집 화면으로 안 넘어감)');
  await press(1, 'del');
  check((await acts()).length === 1 && (await boxes()).length === 2, `빈 반쪽 × → 지움 (${(await acts()).length}반쪽)`);
  await combo(['Meta'], 'KeyZ');
  await sleep(300);
  await combo(['Alt'], 'Digit1');
  await sleep(300);

  // 3) 예전 본문 글: 두 번 누르면 그 반쪽 글이 같은 자리의 글상자로(바로 고치기)
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '1'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await newNote();
  await page.click('.editor');
  await k.type('예전 본문 글');
  await k.press('Enter');
  await k.type('둘째 줄');
  await sleep(300);
  const lineTop = await page.$eval('.editor > p', (e) => {
    const L = document.querySelector('.shapes-layer').getBoundingClientRect();
    return (e.getBoundingClientRect().top - L.top) / (L.width / (document.querySelector('.shapes-layer').offsetWidth / (96 / 25.4)));
  });
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '0'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await sleep(300);
  const p0 = await (await page.$('.editor > p')).boundingBox();
  await page.mouse.click(p0.x + 15, p0.y + p0.height / 2);
  await sleep(150);
  check((await boxes()).length === 0, '예전 본문 글 위 한 번 누르기는 글상자를 만들지 않음');
  await page.mouse.click(p0.x + 15, p0.y + p0.height / 2, { count: 2 });
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  B = await boxes();
  const tbTop = await page.$eval('.tbox .tb-edit > p', (e) => {
    const L = document.querySelector('.shapes-layer').getBoundingClientRect();
    return (e.getBoundingClientRect().top - L.top) / (L.width / (document.querySelector('.shapes-layer').offsetWidth / (96 / 25.4)));
  });
  check(B.length === 1 && B[0].text === '예전 본문 글\n둘째 줄' && (await bodyText()) === '' && !!(await page.$('.tbox.tedit')), `두 번 누르면 그 반쪽 본문 글이 글상자로(바로 고치기) (${JSON.stringify(B.map((b) => b.text))})`);
  check(Math.abs(tbTop - lineTop) < 0.3, `같은 자리에 (본문 ${lineTop.toFixed(2)}mm → 글상자 ${tbTop.toFixed(2)}mm)`);
  await k.press('Escape');
  await sleep(150);

  // 4) 본문 글이 남은 노트에서 반쪽 옮기기 → 먼저 글상자로 바꾸고 옮김
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '1'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await newNote();
  await page.click('.editor');
  await k.type('옮길 본문');
  await sleep(300);
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '0'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await combo(['Alt'], 'Digit3');
  await page.waitForSelector('.pages.a4 .phalf[data-half="0"] .pctl');
  await press(0, 'add');
  await press(1, 'prev');
  B = await boxes();
  check(B.length === 1 && B[0].text === '옮길 본문' && Math.abs(B[0].y - usable) < 1 && (await bodyText()) === '', `본문 글이 남은 반쪽을 옮기면 글상자로 바뀌어 같이 옮겨짐 (${JSON.stringify(B.map((b) => [b.text, b.y.toFixed(1)]))})`);
  await combo(['Alt'], 'Digit1');
  await sleep(300);

  // 5) ⋯ 메뉴: 종이에 바로 쓰기 켜고 끄기
  await page.click('.more-btn');
  await page.waitForSelector('.menu.more');
  await page.$$eval('.menu.more button[role="menuitem"]', (bs) => bs.find((b) => b.textContent.startsWith('종이에 바로 쓰기 켜기')).click());
  await sleep(200);
  check((await page.$eval('.editor', (e) => e.getAttribute('contenteditable'))) === 'true' && !(await page.$('.app.paper-off')), '⋯ › 종이에 바로 쓰기 켜기 → 본문에 바로 쓰기');
  await page.click('.more-btn');
  await page.waitForSelector('.menu.more');
  await page.$$eval('.menu.more button[role="menuitem"]', (bs) => bs.find((b) => b.textContent.startsWith('종이에 바로 쓰기 끄기')).click());
  await sleep(200);
  check((await page.$eval('.editor', (e) => e.getAttribute('contenteditable'))) === 'false', '다시 끄기');

  // 6) ＋ 넣기(쓰던 글상자 없음): 넣을 곳을 누르면 그 자리 새 글상자에 표
  await newNote();
  await page.click('.top button[title^="표 · 수직선"]');
  await page.waitForSelector('.panel.insert');
  await page.$$eval('.panel.insert .ins-row button.primary', (bs) => bs[0].click());
  await sleep(200);
  L = await layer();
  ppm = L.w / L.mmW;
  P = (x, y) => [L.x + x * ppm, L.y + y * ppm];
  await page.mouse.click(...P(10, 40));
  await page.waitForSelector('.tbox.tedit table', { timeout: 3000 }).catch(() => {});
  check(!!(await page.$('.tbox.tedit table')) && (await bodyText()) === '', '쓰던 글상자가 없으면 ＋ 넣기 › 표 → 누른 자리 새 글상자에 표(본문엔 안 들어감)');
  await k.type('칸');
  await k.press('Escape');
  await sleep(200);

  // 6-1) 커서가 아무 데도 없을 때 다른 앱 글을 ⌘V → 보이는 자리에 새 글상자(본문엔 안 들어감)
  await browser.defaultBrowserContext().overridePermissions(new globalThis.URL(URL).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await page.evaluate(() => navigator.clipboard.writeText('붙인 글'));
  await page.evaluate(() => document.activeElement?.blur?.());
  const nb = (await boxes()).length;
  await k.down('Meta');
  await k.press('KeyV', { commands: ['Paste'] });
  await k.up('Meta');
  await sleep(300);
  check((await boxes()).some((b) => b.text === '붙인 글') && (await boxes()).length === nb + 1 && !(await bodyText()).includes('붙인 글'), '커서 없이 ⌘V → 붙인 글은 새 글상자로');
  await k.press('Escape');
  await sleep(150);

  // 7) 읽기 모드에서는 빈 종이를 눌러도 글상자 안 생김
  const n0 = (await boxes()).length;
  await combo(['Alt'], 'KeyL');
  await sleep(150);
  await page.mouse.click(...P(50, 150));
  await sleep(200);
  check((await boxes()).length === n0 && !(await page.$('.tbox.tedit')), '읽기 모드: 빈 종이를 눌러도 글상자 안 생김');
  await combo(['Alt'], 'KeyL');
  await sleep(150);
  check(errors.length === 0, `콘솔 오류 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);

  // 8) 폰(고치기 모드): 빈 종이를 톡 누르면 그 자리에 글상자
  const ctx = await browser.createBrowserContext();
  const mp = await ctx.newPage();
  await mp.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('ayunpad-read', '0');
    } catch {}
  });
  await mp.emulate(KnownDevices['iPhone 13']);
  await mp.goto(URL, { waitUntil: 'networkidle0' });
  await mp.waitForSelector('.editor > p');
  await mp.click('.addnote').catch(() => {});
  await mp.evaluate(() => document.querySelector('.addnote')?.click());
  await mp.waitForFunction(() => document.querySelector('.editor')?.textContent === '', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await mp.evaluate(() => document.querySelector('.side-backdrop')?.click());
  await sleep(200);
  const ml = await mp.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width };
  });
  await mp.touchscreen.tap(ml.x + ml.w * 0.4, ml.y + 120);
  await mp.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  check(!!(await mp.$('.tbox.tedit .tb-edit')), '폰: 빈 종이를 톡 누르면 그 자리에 글상자');
  await ctx.close();
  await browser.close();
} catch (e) {
  console.log(`FAIL 예외: ${e?.message ?? e}`);
  fails.push(String(e));
} finally {
  server.kill();
}
console.log(fails.length ? `\n${fails.length}개 실패` : '\n전부 통과');
process.exit(fails.length ? 1 : 0);
