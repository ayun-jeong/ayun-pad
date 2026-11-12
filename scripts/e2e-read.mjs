// 읽기 모드 시험: 눌러도 · 쳐도 노트가 안 바뀜(본문 · 표 · 글상자 · 그림 · 붙여넣기 · 되돌리기 · 판), 확대 · 축소 · 찾기만.
// 폰은 처음부터 읽기 모드 · 아래 편집 막대 없음 · 두 손가락 오므리기 · 벌리기로 배율.
// 사용: npm run build && node scripts/e2e-read.mjs
import { spawn } from 'node:child_process';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4326;
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
  await browser.defaultBrowserContext().overridePermissions(new globalThis.URL(URL).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  const k = page.keyboard;
  const meta = (await page.evaluate(() => /Mac/.test(navigator.platform))) ? 'Meta' : 'Control';
  const combo = async (mods, code, opts) => {
    for (const m of mods) await k.down(m);
    await k.press(code, opts);
    for (const m of [...mods].reverse()) await k.up(m);
  };
  const docJSON = (pg = page) => pg.evaluate(() => JSON.stringify(window.__ayunpad.view().state.doc.toJSON()));
  const docText = (pg = page) => pg.evaluate(() => window.__ayunpad.view().state.doc.textContent);
  const shapesJSON = () => page.evaluate(() => JSON.stringify(window.__ayunpad.doc().shapes.toJSON()));
  const reading = (pg = page) => pg.$eval('.app', (e) => e.classList.contains('reading'));
  const lockedAttr = (pg = page) => pg.$eval('.editor', (e) => e.getAttribute('contenteditable'));
  const zoomNow = (pg = page) => pg.evaluate(() => Number(localStorage.getItem('ayunpad-zoom')));

  check(!(await reading()), 'PC는 처음에 고치기 모드');

  // 1) 새 노트: 글 두 줄 · 표 · 글상자, 되돌릴 거리 하나
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('읽기 시험');
  await k.press('Enter');
  await k.type('둘째 줄');
  await k.press('Enter');
  await k.type('/표 2x2');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.editor table');
  await k.type('칸');
  const L = await page.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
  });
  const ppm = L.w / L.mmW;
  await k.down('Alt');
  await page.mouse.click(L.x + 60 * ppm, L.y + 2 * ppm);
  await k.up('Alt');
  await page.waitForSelector('.tbox.tedit .tb-edit');
  await k.type('상자 글');
  await k.press('Escape');
  await sleep(200);
  // 줄 오른쪽 끝은 누르지 않는다(표 칸에 커서가 있으면 표 위 막대 — 표 지우기 단추 — 가 윗줄 오른쪽 끝에 떠 있다)
  const line1 = await (await page.$$('.editor > p'))[1].boundingBox();
  await page.mouse.click(line1.x + 12, line1.y + line1.height / 2);
  await k.press('End');
  await k.type(' 끝');
  await sleep(700); // 되돌리기 칸 나누기
  const doc0 = await docJSON();
  const sh0 = await shapesJSON();
  check(doc0.includes('둘째 줄 끝') && sh0.includes('상자 글') && !!(await page.$('.editor td')), `준비: 글 · 표 · 글상자 (${JSON.stringify(await docText())}, 글상자 ${sh0.includes('상자 글')})`);

  // 2) 위쪽 ‘읽기’ → 읽기 모드
  await page.click('.read-btn');
  await sleep(150);
  check(await reading(), '위쪽 ‘읽기’ → 읽기 모드');
  check((await page.$eval('.read-btn', (e) => e.textContent)) === '읽기 중', '단추가 ‘읽기 중’으로');
  check((await lockedAttr()) === 'false', '본문 편집 칸 잠김(contenteditable=false · 커서 · 폰 자판 없음)');
  check(await page.$eval('.crumb input', (e) => e.readOnly), '노트 이름 칸도 잠김');
  check(!(await page.$('.tb-draw')) && !(await page.$('.top button[title^="표 · 수직선"]')), '그리기 · 넣기 단추 숨김');

  // 3) 본문: 눌러서 치기 · Enter · ⌫ · ⌘Z · ⌘⇧Z
  const line0 = await (await page.$$('.editor > p'))[0].boundingBox();
  await page.mouse.click(line0.x + 10, line0.y + line0.height / 2);
  await k.type('XYZ');
  await k.press('Enter');
  await k.press('Backspace');
  await combo([meta], 'KeyZ');
  await combo([meta, 'Shift'], 'KeyZ');
  await sleep(150);
  check((await docJSON()) === doc0, '본문을 눌러 치고 · Enter · ⌫ · ⌘Z · ⌘⇧Z → 그대로');

  // 4) 표 칸
  const cell = await (await page.$('.editor td')).boundingBox();
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await k.type('Q');
  await k.press('Backspace');
  await sleep(100);
  check((await docJSON()) === doc0 && !(await page.$('.tbl-ctl[style*="flex"]')), '표 칸을 눌러 쳐도 그대로');

  // 5) 글상자: 누르기 · 두 번 누르기 · 끌기
  const tb = await (await page.$('.tbox')).boundingBox();
  await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await sleep(120);
  check(!(await page.$('.shapes-layer.on')) && !(await page.$('.tbox .tb-bar')), '글상자를 눌러도 안 골라짐(막대 없음)');
  await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2, { count: 2 });
  await sleep(150);
  check(!(await page.$('.tbox.tedit')), '두 번 눌러도 안 고쳐짐');
  await page.mouse.move(tb.x + 4, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 60, tb.y + tb.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await sleep(150);
  check((await shapesJSON()) === sh0, '글상자를 끌어도 그대로');

  // 6) ⌥+클릭 · 빈 곳 두 번 누르기 · ⌥D · 배경 끌기
  await k.down('Alt');
  await page.mouse.click(L.x + 30 * ppm, L.y + 45 * ppm);
  await k.up('Alt');
  await page.mouse.click(L.x + 70 * ppm, L.y + 60 * ppm, { count: 2 });
  await sleep(150);
  await combo(['Alt'], 'KeyD');
  await sleep(150);
  const desk = await page.$eval('.paper', (e) => e.getBoundingClientRect().right + 40);
  await page.mouse.move(desk, L.y + 5);
  await page.mouse.down();
  await page.mouse.move(desk - 300, L.y + 40 * ppm, { steps: 6 });
  await page.mouse.up();
  await sleep(150);
  check((await shapesJSON()) === sh0 && !(await page.$('.tbox.tedit')) && !(await page.$('.shapes-layer.on')) && !(await page.$('.drawbar')), '⌥+클릭 · 빈 곳 두 번 누르기 → 글상자 안 생김, ⌥D → 그리기 안 켜짐, 배경 끌기 → 안 골라짐');

  // 7) 붙여넣기: 그냥 글 · 그림(옛 표시 글)
  await page.mouse.click(line0.x + 10, line0.y + line0.height / 2);
  await page.evaluate(() => navigator.clipboard.writeText('붙인 글'));
  await combo([meta], 'KeyV', { commands: ['Paste'] });
  await sleep(150);
  const one = JSON.parse(sh0);
  const first = Object.values(one)[0];
  await page.evaluate((s) => navigator.clipboard.writeText(`ayunpad-shapes:${JSON.stringify([{ ...s, id: 'pasted-x' }])}`), first);
  await combo([meta], 'KeyV', { commands: ['Paste'] });
  await sleep(200);
  check((await docJSON()) === doc0 && (await shapesJSON()) === sh0, '⌘V(글 · 그림) → 아무것도 안 붙음');

  // 8) 고치는 판 · 단축키: ⌥T 글자 모양, ⌥A 펜, ⌥⇧X 형광펜 지우기, ⋯ 메뉴
  await combo(['Alt'], 'KeyT');
  await combo(['Alt'], 'KeyR');
  await combo(['Alt', 'Shift'], 'KeyX');
  await sleep(150);
  check(!(await page.$('section.panel[aria-label="글자 모양"]')) && (await docJSON()) === doc0, '⌥T · ⌥R · ⌥⇧X → 판 안 열림 · 그대로');
  await page.click('.more-btn');
  await page.waitForSelector('.menu.more');
  const items = await page.$$eval('.menu.more button[role="menuitem"]', (bs) => bs.map((b) => b.textContent));
  check(items.some((t) => t.startsWith('읽기 모드 끄기')) && !items.some((t) => t.startsWith('강조 모아') || t.startsWith('글자 모양')), `⋯ 메뉴: ‘읽기 모드 끄기’ 있고 고치는 항목 없음 (${items.length}개)`);
  await k.press('Escape');
  await sleep(100);

  // 9) 찾기 판: 찾기 · 옮겨 다니기만(강조 · 바꾸기 · 되돌리기 숨김, ⌘Enter도 안 먹음)
  await combo([meta], 'KeyF');
  await page.waitForSelector('.panel.find');
  await page.$eval('.panel.find input[type=search]', (e) => e.select());
  await k.type('줄');
  await sleep(300);
  const fp = await page.$eval('.panel.find', (p) => ({
    title: p.querySelector('h3')?.textContent,
    fx: getComputedStyle(p.querySelector('.find-fx')).display,
    rep: getComputedStyle(p.querySelector('.find-rep')).display,
    boxes: p.querySelectorAll('.find-list input[type=checkbox]').length,
    rows: p.querySelectorAll('.find-list li').length,
  }));
  check(fp.title === '찾기' && fp.fx === 'none' && fp.rep === 'none' && fp.boxes === 0 && fp.rows >= 1, `찾기 판은 찾기만 (${JSON.stringify(fp)})`);
  await combo([meta], 'Enter');
  await sleep(150);
  check((await docJSON()) === doc0, '찾기 판 ⌘Enter → 그대로');
  await k.press('Escape');
  await sleep(100);

  // 10) 확대 · 축소는 됨(⌘+휠, ⋯ 메뉴 + −)
  const z0 = await zoomNow();
  await page.mouse.move(line0.x + 40, line0.y + 40);
  await k.down(meta);
  await page.mouse.wheel({ deltaY: -150 });
  await k.up(meta);
  await sleep(250);
  const z1 = await zoomNow();
  check(z1 > z0, `⌘+휠 확대는 됨 (${z0} → ${z1})`);
  await page.click('.more-btn');
  await page.waitForSelector('.menu.more');
  await page.click('.menu.more button[aria-label="작게"]');
  await sleep(150);
  const z2 = await zoomNow();
  check(z2 < z1, `⋯ 메뉴 배율 − 도 됨 (${z1} → ${z2})`);
  await k.press('Escape');

  // 11) 반쪽 보기에서 줄을 눌러도 편집 화면으로 넘어가지 않음
  await combo(['Alt'], 'Digit2');
  await page.waitForSelector('.pages .pcol .editor > p');
  const pl = await (await page.$('.pages .pcol .editor > p')).boundingBox();
  await page.mouse.click(pl.x + 10, pl.y + pl.height / 2);
  await sleep(200);
  check(!!(await page.$('.pages .pcol')), '반쪽 보기에서 줄을 눌러도 그대로');
  await combo(['Alt'], 'Digit1');
  await sleep(200);

  // 12) ⌥L → 고치기 모드: 다시 쳐지고 ⌘Z도 됨
  await combo(['Alt'], 'KeyL');
  await sleep(150);
  check(!(await reading()) && (await lockedAttr()) === 'true' && !!(await page.$('.tb-draw')), '⌥L → 고치기 모드(편집 칸 · 그리기 단추 돌아옴)');
  // 배율을 바꾼 뒤라 화면 자리가 늦게 움직일 수 있다 → 누르는 순간의 줄 자리로(요소 기준 offset)
  await sleep(300);
  const line0h = (await page.$$('.editor > p'))[0];
  const h0 = (await line0h.boundingBox()).height;
  await line0h.click({ offset: { x: 12, y: h0 / 2 } });
  const st = await page.evaluate(() => ({ a: document.activeElement?.className, sel: window.__ayunpad.view().state.selection.from }));
  await k.press('End');
  await k.type('!');
  await sleep(100);
  const typed = (await docText()).includes('읽기 시험!');
  if (!typed) console.log('  디버그:', JSON.stringify(st), JSON.stringify(await docText()));
  await sleep(600);
  await combo([meta], 'KeyZ');
  await sleep(150);
  check(typed && (await docJSON()) === doc0, `고치기 모드에서는 쳐지고(읽는 동안 끌어 고른 범위를 덮어쓰지 않음) ⌘Z로 되돌려짐 (친 뒤 ${typed}, 되돌린 뒤 ${JSON.stringify(await docText())})`);

  // 13) 기기에 기억: 읽기 모드로 두고 새로 고침 → 처음부터 잠긴 채
  await combo(['Alt'], 'KeyL');
  await sleep(150);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await sleep(300);
  check((await reading()) && (await lockedAttr()) === 'false', '새로 고쳐도 읽기 모드 그대로(이 기기에 기억)');
  await combo(['Alt'], 'KeyL');
  await sleep(150);
  check(!(await reading()), '다시 ⌥L → 고치기');
  check(errors.length === 0, `콘솔 오류 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);

  // 14) 폰: 처음부터 읽기 모드 · 아래 편집 막대 없음 · 눌러도 안 바뀜 · 두 손가락으로 배율
  const ctx = await browser.createBrowserContext();
  const mp = await ctx.newPage();
  const merr = [];
  mp.on('pageerror', (e) => merr.push(String(e)));
  await mp.emulate(KnownDevices['iPhone 13']);
  await mp.goto(URL, { waitUntil: 'networkidle0' });
  await mp.waitForSelector('.editor > p');
  await sleep(300);
  check((await reading(mp)) && (await lockedAttr(mp)) === 'false', '폰은 처음부터 읽기 모드');
  const rb = await (await mp.$('.read-btn')).boundingBox();
  check(!!rb && rb.width > 20 && rb.y < 80, `폰 위쪽에 ‘읽기 중’ 단추 보임 (${rb && Math.round(rb.width)}px)`);
  check(!(await mp.$('.touchbar')), '읽기 모드에선 아래 편집 막대 없음');
  const mdoc0 = await docJSON(mp);
  const mline = await (await mp.$$('.editor > p'))[1].boundingBox();
  await mp.touchscreen.tap(mline.x + 20, mline.y + mline.height / 2);
  await mp.keyboard.type('폰');
  await sleep(150);
  const act = await mp.evaluate(() => document.activeElement?.className ?? '');
  check((await docJSON(mp)) === mdoc0 && !String(act).includes('editor'), `폰에서 글을 눌러도 커서 · 자판 없음, 그대로 (active: ${act || 'body'})`);
  // 두 손가락 벌리기 → 크게, 오므리기 → 작게
  const cdp = await mp.createCDPSession();
  const pinch = async (from, to) => {
    const cx = 195;
    const cy = 420;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - from, y: cy, id: 1 }, { x: cx + from, y: cy, id: 2 }] });
    for (let i = 1; i <= 8; i++) {
      const d = from + ((to - from) * i) / 8;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }] });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  const mz0 = await zoomNow(mp);
  await pinch(40, 100);
  const mz1 = await zoomNow(mp);
  await pinch(100, 50);
  const mz2 = await zoomNow(mp);
  check(mz1 > mz0 * 1.8 && mz2 < mz1 * 0.7, `두 손가락 벌리기 · 오므리기로 노트 배율 (${mz0} → ${mz1} → ${mz2})`);
  check((await docJSON(mp)) === mdoc0, '배율을 바꿔도 노트는 그대로');
  // 폰에서 ‘읽기 중’을 누르면 고치기(아래 편집 막대 돌아옴)
  await mp.touchscreen.tap(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await sleep(200);
  check(!(await reading(mp)) && !!(await mp.$('.touchbar')), '폰에서 ‘읽기 중’ 누르기 → 고치기(아래 편집 막대)');
  check(merr.length === 0, `폰 콘솔 오류 없음 ${merr.length ? JSON.stringify(merr.slice(0, 3)) : ''}`);
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
