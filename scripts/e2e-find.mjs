// 5단계 시험: ⌘F 찾기 · 일괄 강조(고르기 · 효과 · 되돌리기 · 바꾸기 · 보존), ⌘K 전체 검색(초성 · 줄로 가기 · 새 노트), 백업, 폰 선택 막대
// 사용: npm run build && node scripts/e2e-find.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4324;
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

// 문서에서 표시(mark)별로 칠해진 글자 모으기
const marks = (page) =>
  page.evaluate(() => {
    const out = {};
    window.__ayunpad.view().state.doc.descendants((n) => {
      if (!n.isText) return true;
      for (const m of n.marks) {
        const key = `${m.type.name}${m.attrs.c ? `:${m.attrs.c}` : ''}`;
        (out[key] ??= []).push(n.text);
      }
      return false;
    });
    return out;
  });
const docText = (page) => page.evaluate(() => window.__ayunpad.view().state.doc.textBetween(0, window.__ayunpad.view().state.doc.content.size, '\n'));

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
  await sleep(300);
  const k = page.keyboard;
  const meta = (await page.evaluate(() => /Mac/.test(navigator.platform))) ? 'Meta' : 'Control';
  const combo = async (mods, code) => {
    for (const m of mods) await k.down(m);
    await k.press(code);
    for (const m of [...mods].reverse()) await k.up(m);
  };
  const clickText = (sel, text) => page.$$eval(sel, (els, t) => els.find((e) => e.textContent.trim().startsWith(t))?.click(), text);

  // 1) ⌘F → '모집' 4곳, 위치(반쪽 · 트리 경로)
  await page.click('.editor');
  await combo([meta], 'KeyF');
  await page.waitForSelector('.panel.find input[type=search]');
  await k.type('모집');
  await sleep(150);
  const n = await page.$eval('.find-n', (e) => e.textContent);
  check(n === '4곳', `‘모집’ 4곳 찾음 (${n})`);
  const at0 = await page.$eval('.find-list li .find-at', (e) => e.textContent);
  check(at0 === '1-1 · 경영학 › 인사관리', `위치: 반쪽 번호 + 트리 경로 (${at0})`);
  check((await page.$$eval('.editor .fh.on', (e) => e.length)) === 4, '노트에 찾은 곳 4곳 표시(기본은 모두 고름)');

  // 2) 두 번째는 빼고, 동그라미(빨강) + 밑줄(파랑)
  await page.$$eval('.find-list li input[type=checkbox]', (els) => els[1].click());
  await sleep(50);
  const picked = await page.$eval('.find-sel span', (e) => e.textContent);
  check(picked.includes('3곳'), `4곳 중 3곳 고름 (${picked})`);
  await page.$$eval('.fx-row', (rows) => rows.find((r) => r.textContent.includes('밑줄')).querySelectorAll('.fx-colors button')[1].click());
  await clickText('.fx-actions button', '고른');
  await sleep(150);
  let M = await marks(page);
  check(M['circ:r']?.length === 3 && M['u:b']?.length === 3, `고른 3곳에만 빨간 동그라미 + 파란 밑줄 (${JSON.stringify(M)})`);
  const second = await page.evaluate(() => {
    const st = window.__ayunpad.view().state;
    let found = null;
    st.doc.descendants((nd, pos) => {
      if (found || !nd.isText) return !found;
      const i = nd.text.indexOf('내부모집 vs');
      if (i >= 0) found = st.doc.resolve(pos + i + 3).marks().map((m) => m.type.name);
      return false;
    });
    return found;
  });
  check(Array.isArray(second) && !second.includes('circ'), `고르지 않은 곳은 그대로 (${JSON.stringify(second)})`);
  check((await page.$$eval('.find-list li input[type=checkbox]', (els) => els.map((e) => e.checked).join())) === 'true,false,true,true', '적용한 뒤에도 고름 상태 그대로');

  // 3) 판의 되돌리기 · 다시
  await clickText('.find-undo button', '↶');
  await sleep(100);
  M = await marks(page);
  check(!M['circ:r'] && !M['u:b'], `되돌리기 한 번에 전부 취소 (${JSON.stringify(M)})`);
  await clickText('.find-undo button', '↷');
  await sleep(100);
  M = await marks(page);
  check(M['circ:r']?.length === 3, '다시 하기');

  // 4) Esc로 닫으면 표시가 사라지고, 편집 칸 ⌘Z도 한 번에
  await k.press('Escape');
  await sleep(100);
  check(!(await page.$('.panel.find')) && (await page.$$eval('.editor .fh', (e) => e.length)) === 0, 'Esc → 판 닫힘, 찾은 곳 표시 사라짐');
  await combo([meta], 'KeyZ');
  await sleep(100);
  M = await marks(page);
  check(!M['circ:r'], '편집 칸에서 ⌘Z 한 번 → 일괄 강조 전체 취소');
  await combo([meta, 'Shift'], 'KeyZ');
  await sleep(100);
  check((await marks(page))['circ:r']?.length === 3, '⌘⇧Z → 다시');

  // 5) 바꾸기: 유통 → 물류
  await combo([meta], 'KeyF');
  await page.waitForSelector('.panel.find input[type=search]');
  await k.type('유통');
  await sleep(100);
  await page.type('.find-rep input', '물류');
  await clickText('.find-rep button', '고른');
  await sleep(150);
  const t = await docText(page);
  check(!t.includes('유통') && (t.match(/물류/g) || []).length === 2, '고른 곳 바꾸기: 유통 → 물류 2곳');
  await k.press('Escape');

  // 6) 새로고침해도 강조 그대로
  await sleep(700);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await sleep(400);
  M = await marks(page);
  check(M['circ:r']?.length === 3 && M['u:b']?.length === 3, '새로고침 뒤에도 동그라미 · 밑줄 보존');
  const circled = await page.$$eval('.editor .circ.circ-r', (e) => e.length);
  check(circled === 3, `화면에 빨간 동그라미 3개 (${circled})`);

  // 7) ⌘K: 초성으로 본문 찾기 → 그 줄로
  await page.click('.editor');
  await combo([meta], 'KeyK');
  await page.waitForSelector('.palette input');
  await k.type('ㅅㅌㅂㅅ');
  await page.waitForFunction(() => [...document.querySelectorAll('.pal-snip mark')].some((m) => m.textContent === '스타벅스'), { timeout: 5000 });
  const title = await page.$eval('.pal-list button.on .pal-title', (e) => e.textContent);
  check(title === '견본 · 경영학 › 경영학 › 마케팅 › 4P 전략', `초성 ㅅㅌㅂㅅ → 스타벅스 줄, 트리 경로 (${title})`);
  await k.press('Enter');
  await sleep(250);
  const selText = await page.evaluate(() => {
    const st = window.__ayunpad.view().state;
    return st.doc.textBetween(st.selection.from, st.selection.to);
  });
  check(selText === '스타벅스', `Enter → 그 줄의 찾은 말이 골라짐 (${selText})`);

  // 8) ⌘K에서 새 노트
  await combo([meta], 'KeyK');
  await page.waitForSelector('.palette input');
  await k.type('회계원리');
  await sleep(200);
  const last = await page.$$eval('.pal-list button', (b) => b.length);
  for (let i = 0; i < last - 1; i++) await k.press('ArrowDown');
  await k.press('Enter');
  await page.waitForFunction(() => document.querySelector('.crumb input')?.value === '회계원리', { timeout: 5000 }).catch(() => {});
  check((await page.$eval('.crumb input', (e) => e.value)) === '회계원리', '⌘K → 새 노트 ‘회계원리’');
  await page.click('.editor');
  await k.type('차변과 대변');
  await sleep(600);

  // 9) 백업 내보내기 → 다른 기기(새 창)에서 가져오기
  await page.evaluate(() => {
    window.__blob = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) fetch(this.href).then((r) => r.text()).then((x) => (window.__blob = x));
      else orig.call(this);
    };
  });
  await clickText('.side-foot .backup button', '백업 내보내기');
  await page.waitForFunction(() => !!window.__blob, { timeout: 8000 });
  const json = await page.evaluate(() => window.__blob);
  const data = JSON.parse(json);
  check(data.app === 'ayun-pad' && Object.keys(data.notes).length === 2, `백업 파일: 노트 2개 (${Object.keys(data.notes).length})`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ayunpad-')), 'backup.json');
  fs.writeFileSync(file, json);
  const ctx = await browser.createBrowserContext();
  const p2 = await ctx.newPage();
  await p2.setViewport({ width: 1400, height: 1000 });
  p2.on('pageerror', (e) => errors.push(`p2: ${e}`));
  await p2.goto(URL, { waitUntil: 'networkidle0' });
  await p2.waitForSelector('.editor > p');
  const input = await p2.$('.side-foot .backup input[type=file]');
  await input.uploadFile(file);
  await p2.waitForFunction(() => [...document.querySelectorAll('.note-item .t')].some((e) => e.textContent === '회계원리'), { timeout: 8000 }).catch(() => {});
  const titles = await p2.$$eval('.note-item .t', (els) => els.map((e) => e.textContent));
  check(titles.includes('회계원리') && titles.filter((x) => x === '견본 · 경영학').length === 1, `새 기기에서 가져오기: 노트 합쳐짐, 견본은 한 벌 (${titles.join(', ')})`);
  await p2.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '회계원리')?.click());
  await p2.waitForFunction(() => document.querySelector('.editor')?.textContent.includes('차변과 대변'), { timeout: 5000 }).catch(() => {});
  check((await p2.$eval('.editor', (e) => e.textContent)).includes('차변과 대변'), '가져온 노트 내용');
  await ctx.close();

  // 10) 폰: 글자를 고르면 아래 막대가 색 도구로
  const ctx3 = await browser.createBrowserContext();
  const m = await ctx3.newPage();
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  m.on('pageerror', (e) => errors.push(`mobile: ${e}`));
  await m.goto(URL, { waitUntil: 'networkidle0' });
  await m.waitForSelector('.editor > p');
  check(!!(await m.$('.touchbar:not(.selbar)')), '폰: 평소에는 들여쓰기 · 꺾쇠 막대');
  await m.evaluate(() => {
    const v = window.__ayunpad.view();
    v.focus();
    const S = v.state.selection.constructor;
    v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, 2, 4)));
  });
  await m.waitForSelector('.touchbar.selbar', { timeout: 3000 }).catch(() => {});
  check(!!(await m.$('.touchbar.selbar')), '폰: 글자를 고르면 색 막대');
  await m.$$eval('.touchbar.selbar button', (b) => b[0].click());
  await sleep(100);
  const pen = await m.$eval('.editor > p [data-pen]', (e) => `${e.dataset.pen}:${e.textContent}`).catch(() => '');
  check(pen === 'r:영학', `색 막대 빨강 → 고른 글자 빨강 (${pen})`);
  await ctx3.close();

  check(errors.length === 0, `콘솔 오류 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  await browser.close();
} catch (e) {
  console.log(`FAIL 예외: ${e?.message ?? e}`);
  fails.push(String(e));
} finally {
  server.kill();
}
console.log(fails.length ? `\n${fails.length}개 실패` : '\n전부 통과');
process.exit(fails.length ? 1 : 0);
