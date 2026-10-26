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
  await (await page.waitForSelector('.editor')).click();
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

  // 4-1) 판을 닫았다 열어도(글자 선택 없이) 검색어와 고름 상태가 그대로
  await (await page.waitForSelector('.editor')).click();
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atStart(v.state.doc)));
  });
  await combo([meta], 'KeyF');
  await page.waitForSelector('.panel.find input[type=search]');
  await sleep(150);
  const kept = await page.evaluate(() => ({ q: document.querySelector('.panel.find input[type=search]').value, c: [...document.querySelectorAll('.find-list li input[type=checkbox]')].map((e) => e.checked).join() }));
  check(kept.q === '모집' && kept.c === 'true,false,true,true', `다시 열면 검색어 · 고름 그대로 (${JSON.stringify(kept)})`);
  await k.press('ArrowDown');
  await k.press('ArrowDown');
  await sleep(100);
  const curIdx = await page.$$eval('.find-list li', (ls) => ls.findIndex((l) => l.classList.contains('cur')));
  check(curIdx === 1, `↓ 두 번 → 두 번째 결과로 (${curIdx})`);
  await k.press('Escape');
  await sleep(100);

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

  // 6-0) 강조 모아 보기(⌘K 명령): 종류별로 보고, ×로 하나씩 · 단추로 한꺼번에 지우고, 되돌리기
  const emphCount = (M) => ({ c: M['circ:r']?.length ?? 0, u: M['u:b']?.length ?? 0 });
  await (await page.waitForSelector('.editor')).click();
  await combo([meta], 'KeyK');
  await page.waitForSelector('.palette input');
  await k.type('강조 지우기');
  await sleep(200);
  await clickText('.pal-list button .pal-title', '강조 모아 보기');
  const emphOpen = await page.waitForSelector('.panel.emph', { timeout: 3000 }).then(() => true, () => false);
  check(emphOpen, '⌘K ‘강조 지우기’ → 강조 모아 보기 판');
  const chips = await page.$$eval('.panel.emph .chips button', (b) => b.map((x) => x.textContent).join(','));
  check(chips === '전체 6,동그라미 3,밑줄 3,형광펜 0,글자색 0', `종류별 개수 (${chips})`);
  await clickText('.panel.emph .chips button', '동그라미');
  await sleep(100);
  const circHits = await page.$$eval('.emph-list li .find-snip .circ', (e) => e.map((x) => x.textContent).join(','));
  check(circHits === '모집,모집,모집', `동그라미만 3개, 종이와 같은 모양으로 (${circHits})`);
  await page.$$eval('.emph-list .emph-x', (b) => b[0].click());
  await sleep(150);
  let EC = emphCount(await marks(page));
  check(EC.c === 2 && EC.u === 3, `× → 그 동그라미 하나만 지움, 밑줄은 그대로 (${JSON.stringify(EC)})`);
  const bulkLabel = await page.$eval('.panel.emph .fx-actions .primary', (e) => e.textContent);
  check(bulkLabel === '동그라미 전부 지우기 (2)', `단추 이름 (${bulkLabel})`);
  await page.click('.panel.emph .fx-actions .primary');
  await sleep(150);
  EC = emphCount(await marks(page));
  check(EC.c === 0 && EC.u === 3, `동그라미 전부 지우기 → 동그라미만 사라짐 (${JSON.stringify(EC)})`);
  await clickText('.panel.emph .fx-actions button', '↶');
  await sleep(150);
  EC = emphCount(await marks(page));
  check(EC.c === 2, `되돌리기 한 번 → 한꺼번에 지운 2개가 돌아옴 (${JSON.stringify(EC)})`);
  await clickText('.panel.emph .fx-actions button', '↶');
  await sleep(150);
  check(emphCount(await marks(page)).c === 3, '한 번 더 → ×로 지운 것도 돌아옴');
  await clickText('.panel.emph .chips button', '전체');
  await sleep(100);
  await page.click('.panel.emph .fx-actions .primary');
  await sleep(150);
  EC = emphCount(await marks(page));
  const emptyNote = await page.$eval('.panel.emph .note', (e) => e.textContent);
  check(EC.c === 0 && EC.u === 0 && emptyNote.includes('없어요'), `전부 지우기 → 강조 0개 (${JSON.stringify(EC)} · ${emptyNote})`);
  await combo([meta], 'KeyZ');
  await sleep(150);
  EC = emphCount(await marks(page));
  check(EC.c === 3 && EC.u === 3, `⌘Z 한 번 → 전부 돌아옴 (${JSON.stringify(EC)})`);
  await page.$$eval('.emph-list li > button:first-child', (b) => b[0].click());
  await sleep(150);
  const went = await page.evaluate(() => {
    const st = window.__ayunpad.view().state;
    return st.doc.textBetween(st.selection.from, st.selection.to);
  });
  check(went === '모집', `줄을 누르면 그 강조가 골라짐 (${went})`);
  await k.press('Escape');
  await sleep(100);
  check(!(await page.$('.panel.emph')), 'Esc → 강조 판 닫힘');
  await page.click('.more-btn');
  await clickText('.menu.more button', '강조 모아 보기');
  const byMenu = await page.waitForSelector('.panel.emph', { timeout: 3000 }).then(() => true, () => false);
  await k.press('Escape');
  await sleep(100);
  check(byMenu && !(await page.$('.panel.emph')) && !(await page.$('.menu.more')), '⋯ 메뉴의 강조 모아 보기로 열기(메뉴는 닫힘), Esc로 닫기');

  // 6-1) 글상자 안도 찾고 효과를 넣는다. 본문과 글상자를 한 번의 ⌘Z로 되돌린다.
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await (await page.waitForSelector('.editor')).click();
  await k.type('재무관리 본문');
  await combo(['Alt'], 'KeyD');
  await page.waitForSelector('.drawbar');
  await k.press('KeyT');
  const lb = await page.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
  });
  await page.mouse.click(lb.x + (40 / lb.mmW) * lb.w, lb.y + 60);
  await page.waitForSelector('.tbox.tedit .tb-edit');
  await k.type('재무관리 글상자');
  await k.press('Escape');
  await sleep(100);
  await k.press('Escape');
  await k.press('Escape');
  await sleep(100);
  await (await page.waitForSelector('.editor')).click();
  await combo([meta], 'KeyF');
  await page.waitForSelector('.panel.find input[type=search]');
  await page.$eval('.panel.find input[type=search]', (e) => e.select());
  await k.type('재무관리');
  await sleep(200);
  const at2 = await page.$$eval('.find-list .find-at', (e) => e.map((x) => x.textContent));
  check(at2.length === 2 && at2[1].includes('글상자'), `본문 1곳 + 글상자 1곳 (${at2.join(' / ')})`);
  await page.$$eval('.fx-actions button', (b) => b[0].click());
  await sleep(150);
  const both = await page.evaluate(() => {
    const d = window.__ayunpad.doc();
    const tb = Object.values(d.shapes.toJSON()).find((s) => s.t === 'text');
    let body = 0;
    window.__ayunpad.view().state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'circ')) body++;
      return true;
    });
    return { body, box: JSON.stringify(tb?.doc ?? {}).includes('"circ"') };
  });
  check(both.body === 1 && both.box, `본문과 글상자 모두 동그라미 (${JSON.stringify(both)})`);
  check((await page.$$eval('.tbox .circ', (e) => e.length)) === 1, '글상자에 동그라미가 보임');
  await page.$$eval('.find-undo button', (b) => b[0].click());
  await sleep(150);
  const undone = await page.evaluate(() => {
    const tb = Object.values(window.__ayunpad.doc().shapes.toJSON()).find((s) => s.t === 'text');
    let body = 0;
    window.__ayunpad.view().state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'circ')) body++;
      return true;
    });
    return { body, box: JSON.stringify(tb?.doc ?? {}).includes('"circ"') };
  });
  check(undone.body === 0 && !undone.box, `되돌리기 한 번에 본문 · 글상자 둘 다 취소 (${JSON.stringify(undone)})`);
  // 6-2) 강조 모아 보기에 글상자 것도 나오고, 본문과 함께 지우고 되돌린다
  const circs = () =>
    page.evaluate(() => {
      const tb = Object.values(window.__ayunpad.doc().shapes.toJSON()).find((s) => s.t === 'text');
      let body = 0;
      window.__ayunpad.view().state.doc.descendants((n) => {
        if (n.isText && n.marks.some((m) => m.type.name === 'circ')) body++;
        return true;
      });
      return { body, box: JSON.stringify(tb?.doc ?? {}).includes('"circ"') };
    });
  await page.$$eval('.fx-actions button', (b) => b[0].click());
  await sleep(150);
  await clickText('.panel.find button', '강조 모아');
  await page.waitForSelector('.panel.emph');
  await sleep(100);
  const emAt = await page.$$eval('.emph-list .find-at', (e) => e.map((x) => x.textContent));
  check(!(await page.$('.panel.find')) && emAt.length === 2 && emAt[1].includes('글상자'), `찾기 판 단추 → 강조 판, 본문 + 글상자 (${emAt.join(' / ')})`);
  await page.$$eval('.emph-list .emph-x', (b) => b[1].click());
  await sleep(150);
  let cc = await circs();
  check(cc.body === 1 && !cc.box && (await page.$$eval('.tbox .circ', (e) => e.length)) === 0, `× → 글상자 동그라미만 지움 (${JSON.stringify(cc)})`);
  await clickText('.panel.emph .fx-actions button', '↶');
  await sleep(150);
  cc = await circs();
  check(cc.body === 1 && cc.box, `되돌리기 → 글상자 동그라미 돌아옴 (${JSON.stringify(cc)})`);
  await page.click('.panel.emph .fx-actions .primary');
  await sleep(150);
  cc = await circs();
  check(cc.body === 0 && !cc.box, `전부 지우기 → 본문 · 글상자 둘 다 (${JSON.stringify(cc)})`);
  await clickText('.panel.emph .fx-actions button', '↶');
  await sleep(150);
  cc = await circs();
  check(cc.body === 1 && cc.box, `되돌리기 한 번에 둘 다 돌아옴 (${JSON.stringify(cc)})`);
  await k.press('Escape');
  await page.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '견본 · 경영학')?.click());
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 11);
  await sleep(300);

  // 6-3) 위쪽 ⌕ = 찾기 판, 다른 노트 결과 → 누르면 그 노트로 가서 이어서 강조 / ⌘K는 글상자 글도 찾는다
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await (await page.waitForSelector('.editor')).click();
  await k.type('다른 노트의 직무분석 줄');
  await sleep(300);
  const Lx = await page.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
  });
  await page.mouse.click(Lx.x + (40 / Lx.mmW) * Lx.w, Lx.y + (50 / Lx.mmW) * Lx.w, { count: 2 });
  await page.waitForSelector('.tbox.tedit .tb-edit');
  await k.type('글상자에만 쓴 보상관리');
  await (await page.waitForSelector('.editor')).click();
  await sleep(700);
  await page.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '견본 · 경영학')?.click());
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 11);
  await sleep(300);
  await page.click('.top .tbtn[aria-label="찾기"]');
  const panelOpen = await page.waitForSelector('.panel.find input[type=search]', { timeout: 3000 }).then(() => true, () => false);
  check(panelOpen, '위쪽 ⌕ → 찾기 판(동그라미 · 밑줄 · 강조 모아 보기)');
  await page.$eval('.panel.find input[type=search]', (e) => e.select());
  await k.type('직무분석');
  await page.waitForFunction(() => document.querySelectorAll('.find-others .find-list li').length > 0, { timeout: 6000 }).catch(() => {});
  const other = await page.$$eval('.find-others .find-list li', (ls) => ls.map((l) => l.textContent));
  check(other.length === 1 && other[0].includes('직무분석'), `찾기 판 아래에 다른 노트 결과 (${other.join(' / ')})`);
  const ob = await page.$('.find-others .find-list li button');
  const obox = await ob.boundingBox();
  const atClick = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return `${e?.tagName}.${e?.className}`; }, [obox.x + obox.width / 2, obox.y + obox.height / 2]);
  await ob.click();
  const wentOther = await page.waitForFunction(() => !!window.__ayunpad.view()?.state.doc.textContent.includes('직무분석'), { timeout: 5000 }).then(() => true, () => false);
  check(wentOther, `다른 노트 결과를 누르면 그 노트로 (${atClick}, y ${Math.round(obox.y)}, 제목 ${await page.$eval('.crumb input', (e) => e.value)})`);
  await sleep(300);
  const nHere = await page.$eval('.find-n', (e) => e.textContent).catch(() => '');
  await page.$$eval('.fx-actions button', (b) => b[0].click());
  await sleep(150);
  const circledThere = await page.evaluate(() => {
    let c = '';
    window.__ayunpad.view().state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'circ')) c += n.text;
    });
    return c;
  });
  check(nHere === '1곳' && circledThere === '직무분석', `누르면 그 노트로 가고 판 그대로 동그라미 (${nHere}, ${circledThere})`);
  await k.press('Escape');
  await sleep(100);
  await combo([meta], 'KeyK');
  await page.waitForSelector('.palette input');
  await k.type('보상관리');
  await page.waitForFunction(() => [...document.querySelectorAll('.pal-snip')].some((e) => e.textContent.includes('보상관리')), { timeout: 5000 }).catch(() => {});
  const boxHit = await page.$$eval('.pal-list button', (bs) => bs.map((b) => b.textContent).find((t) => t.includes('보상관리')) ?? '');
  check(boxHit.includes('글상자'), `⌘K 전체 검색이 글상자 글도 찾음 (${boxHit})`);
  await k.press('Escape');
  await page.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '견본 · 경영학')?.click());
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 11);
  await sleep(300);

  // 7) ⌘K: 초성으로 본문 찾기 → 그 줄로
  await (await page.waitForSelector('.editor')).click();
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

  // 7-1) ⌘K 명령: '>'는 전부, '반쪽' → 반쪽 보기. 글을 쓰지 않을 때 / 로도 열린다.
  await page.click('.desk', { offset: { x: 30, y: 400 } });
  await page.evaluate(() => document.activeElement?.blur());
  await k.press('Slash');
  const slashOpen = await page.waitForSelector('.palette input', { timeout: 3000 }).then(() => true, () => false);
  check(slashOpen, '글을 쓰지 않을 때 / → 검색 열림');
  await k.type('>');
  await sleep(150);
  const ncmd = await page.$$eval('.pal-group', (gs) => gs.find((g) => g.querySelector('h4')?.textContent === '명령')?.querySelectorAll('button').length ?? 0);
  check(ncmd >= 15, `'>' → 명령 전부 (${ncmd}개)`);
  await k.press('Backspace');
  await k.type('반쪽');
  await sleep(150);
  const firstCmd = await page.$eval('.pal-list button.on .pal-title', (e) => e.textContent);
  check(firstCmd === '반쪽 보기', `'반쪽' → 반쪽 보기 명령 (${firstCmd})`);
  await k.press('Enter');
  const halfView = await page.waitForSelector('.pages.half', { timeout: 3000 }).then(() => true, () => false);
  check(halfView, '명령 실행 → 반쪽 보기');
  await combo(['Alt'], 'Digit1');
  await sleep(200);

  // 7-2) ⌥C: 최근 색 5개 기억 → 숫자로 바로
  await page.evaluate(() => localStorage.setItem('ayunpad-recent-colors', JSON.stringify(['#12A4B5'])));
  await (await page.waitForSelector('.editor')).click();
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, 1, 4)));
  });
  await sleep(100);
  await combo(['Alt'], 'KeyC');
  await page.waitForSelector('.colorpop');
  await k.press('Digit1');
  await sleep(150);
  const custom = await marks(page);
  check(!!custom['pen:#12A4B5'], `⌥C → 최근 색 1번으로 칠함 (${Object.keys(custom).join(',')})`);
  await combo([meta], 'KeyZ');
  await sleep(100);

  // 7-3) 자동 규칙 끄기 · 켜기(글자 모양 판)
  await combo(['Alt'], 'KeyT');
  await page.waitForSelector('.panel');
  const autoBox = await page.$$('.panel label.check input');
  await autoBox[0].click();
  await sleep(150);
  const redOff = await page.$$eval('.editor .a-red', (e) => e.length);
  check(redOff === 0, `자동 색 끄면 빨강 · 형광펜 사라짐 (${redOff})`);
  await autoBox[0].click();
  await sleep(150);
  check((await page.$$eval('.editor .a-red', (e) => e.length)) > 5, '다시 켜면 돌아옴');
  await autoBox[1].click();
  await sleep(100);
  await k.press('Escape');
  const lastP = await page.evaluateHandle(() => [...document.querySelectorAll('.editor > p')].pop());
  await lastP.click();
  await k.press('End');
  await k.type(' a->b');
  await sleep(100);
  const plain = await page.$eval('.editor > p:last-child', (e) => e.textContent);
  check(plain.endsWith('a->b'), `화살표 변환 끄면 -> 그대로 (${plain.slice(-6)})`);
  await combo(['Alt'], 'KeyT');
  await page.waitForSelector('.panel');
  await (await page.$$('.panel label.check input'))[1].click();
  await k.press('Escape');
  await sleep(100);

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
  await (await page.waitForSelector('.editor')).click();
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
  await page.click('.more-btn');
  await clickText('.menu.more button', '백업 내보내기');
  await page.waitForFunction(() => !!window.__blob, { timeout: 8000 });
  const json = await page.evaluate(() => window.__blob);
  const data = JSON.parse(json);
  check(data.app === 'ayun-pad' && Object.keys(data.notes).length === 4, `백업 파일: 노트 4개 (${Object.keys(data.notes).length})`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ayunpad-')), 'backup.json');
  fs.writeFileSync(file, json);
  const ctx = await browser.createBrowserContext();
  const p2 = await ctx.newPage();
  await p2.setViewport({ width: 1400, height: 1000 });
  p2.on('pageerror', (e) => errors.push(`p2: ${e}`));
  await p2.goto(URL, { waitUntil: 'networkidle0' });
  await p2.waitForSelector('.editor > p');
  const input = await p2.$('input.import-input');
  await input.uploadFile(file);
  await p2.waitForFunction(() => [...document.querySelectorAll('.note-item .t')].some((e) => e.textContent === '회계원리'), { timeout: 8000 }).catch(() => {});
  const titles = await p2.$$eval('.note-item .t', (els) => els.map((e) => e.textContent));
  check(titles.includes('회계원리') && titles.filter((x) => x === '견본 · 경영학').length === 1, `새 기기에서 가져오기: 노트 합쳐짐, 견본은 한 벌 (${titles.join(', ')})`);
  await p2.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '회계원리')?.click());
  await p2.waitForFunction(() => document.querySelector('.editor')?.textContent.includes('차변과 대변'), { timeout: 5000 }).catch(() => {});
  check((await p2.$eval('.editor', (e) => e.textContent)).includes('차변과 대변'), '가져온 노트 내용');
  await ctx.close();

  // 9-1) 버그 고친 것들: '+ 과목' 이름 짓기, 빈 노트 이름 되돌리기, 연도 넣은 연표에 바로 치기, 종이 끝 글상자
  await clickText('.subject-name .mini', '+ 과목');
  await page.waitForSelector('.subject-name input');
  await sleep(400); // 새 노트가 열리며 편집 칸이 커서를 가져가던 때를 기다린다
  const subjFocused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await k.type('회계원리');
  await k.press('Enter');
  await sleep(150);
  const subjNames = await page.$$eval('.subject-name span', (e) => e.map((x) => x.textContent));
  check(subjFocused === '과목 이름' && subjNames.includes('회계원리'), `+ 과목 → 이름 칸에 커서가 남아 바로 이름 짓기 (${subjFocused}, ${subjNames.join(' · ')})`);
  const titleBox = await page.$('.crumb input');
  await titleBox.click({ count: 3 });
  await k.press('Backspace');
  await (await page.waitForSelector('.editor')).click();
  await sleep(150);
  check((await page.$eval('.crumb input', (e) => e.value)) === '새 노트', `노트 이름을 비우고 나가면 원래 이름으로 (${await page.$eval('.crumb input', (e) => e.value)})`);
  await k.type('/연표 1950 4');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.editor .wg.tl');
  await sleep(150);
  await k.type('6·25');
  await sleep(150);
  const tlCells = await page.evaluate(() => ({ year: document.querySelector('.wg.tl .tl-val .wg-ed')?.textContent, ev: document.querySelector('.wg.tl .tl-lab .wg-ed')?.textContent }));
  check(tlCells.year === '1950' && tlCells.ev === '6·25', `연도를 넣은 연표에 바로 치면 첫 사건 칸에 (${JSON.stringify(tlCells)})`);
  await k.press('Escape');
  await k.press('ArrowDown');
  const p0 = await (await page.$('.editor > p')).boundingBox();
  await page.mouse.click(p0.x + p0.width - 6, p0.y + p0.height / 2, { count: 2 });
  await page.waitForSelector('.tbox.tedit .tb-edit');
  await k.type('끝');
  await (await page.waitForSelector('.editor')).click();
  await sleep(150);
  const edge = await page.evaluate(() => {
    const L = document.querySelector('.shapes-layer').getBoundingClientRect();
    const b = document.querySelector('.tbox').getBoundingClientRect();
    return { over: Math.round(b.right - L.right), w: Math.round(b.width) };
  });
  check(edge.over <= 1 && edge.w > 60, `종이 오른쪽 끝에서 만든 글상자도 종이 안에 (넘친 ${edge.over}px, 폭 ${edge.w}px)`);

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
  await m.click('.top .tbtn[aria-label="과목 목록 열고 닫기"]');
  await m.waitForSelector('.side:not(.hidden)');
  await m.waitForSelector('.side-backdrop');
  await m.mouse.click(370, 500); // 목록 바깥(어두운 곳)
  await sleep(150);
  check(!!(await m.$('.side.hidden')), '폰: 과목 목록 바깥을 누르면 닫힘');
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
