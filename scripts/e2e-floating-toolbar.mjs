import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const url = 'http://localhost:4339/ayun-pad/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4339', '--strictPort'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} await sleep(200); }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 }); await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('.editor');
  await page.$eval('.addnote', e => e.click()); await page.waitForFunction(() => window.__ayunpad.view()?.state.doc.textContent === '');
  await page.click('.paper-width-options button:last-child'); await page.waitForSelector('.fold-live-window');
  const point = await page.$eval('.folded-snapshots .phalf[data-half="0"] .pwin', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width * .72, y: r.y + r.width * .2 }; });
  await page.mouse.click(point.x, point.y); await page.waitForSelector('.tb-edit'); await page.keyboard.type('ABC DEF');
  await page.waitForSelector('.tb-bar-floating', { visible: true });
  const id = await page.evaluate(() => [...window.__ayunpad.doc().shapes.values()].find(s => s.t === 'text').id);
  const toolbar = `.tb-bar[data-box-id="${id}"]`;
  const verify = async () => {
    const result = await page.$eval(toolbar, e => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, viewport: innerWidth, root: e.parentElement === document.body,
        buttons: [...e.querySelectorAll('button')].map(b => { const p = b.getBoundingClientRect(); const hit = document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2); return b === hit || b.contains(hit); }) };
    });
    assert.ok(result.root); assert.ok(result.x >= 0 && result.right <= result.viewport); assert.ok(result.y >= 0 && result.bottom <= 1000);
    assert.ok(result.buttons.every(Boolean), `Every control must be visible and clickable: ${JSON.stringify(result)}`);
    return result;
  };
  let r = await verify();
  const fold = await page.$eval('.folded-snapshots .pfold', e => e.getBoundingClientRect().x);
  assert.ok(r.x < fold && r.right > fold);
  console.log('ok  반쪽 경계를 가로지르는 도구 막대의 모든 버튼이 잘리지 않고 클릭 가능');
  const selection = await page.$eval('.fold-live-window .tb-edit .ln', e => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let t; while (t = w.nextNode()) if (t.textContent.includes('ABC')) break;
    const range = document.createRange(); range.setStart(t, 0); range.setEnd(t, 3); const r = range.getBoundingClientRect(); return { x: r.x + .1, y: r.y + r.height / 2, right: r.right };
  });
  await page.mouse.move(selection.x, selection.y); await page.mouse.down(); await page.mouse.move(selection.right, selection.y, { steps: 8 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => getSelection().toString()), 'ABC');
  await page.click(`${toolbar} button[aria-label="파랑 글자"]`);
  await page.waitForFunction(id => window.__ayunpad.doc().shapes.get(id).doc.content[0].content[0].marks?.some(m => m.type === 'pen' && m.attrs.c === 'b'), {}, id);
  const saved = await page.evaluate(id => window.__ayunpad.doc().shapes.get(id), id);
  assert.equal(saved.doc.content[0].content[0].text, 'ABC'); assert.ok(!saved.doc.content[0].content.at(-1).marks?.some(m => m.type === 'pen'));
  console.log('ok  떠 있는 도구 막대를 눌러도 드래그 선택을 유지하고 선택 글자만 서식 적용');
  await page.click(`${toolbar} button[aria-label="보라 형광펜"]`);
  await page.waitForFunction(id => window.__ayunpad.doc().shapes.get(id).doc.content[0].content[0].marks?.some(m => m.type === 'hl' && m.attrs.c === 'p'), {}, id);
  const purple = await page.evaluate(id => window.__ayunpad.doc().shapes.get(id), id);
  assert.equal(purple.doc.content[0].content[0].text, 'ABC');
  assert.ok(!purple.doc.content[0].content.at(-1).marks?.some(m => m.type === 'hl'));
  console.log('ok  보라색 형광펜 버튼 표시 · 드래그한 글자에만 적용');
  await page.$eval('.desk', e => { e.scrollTop += 30; }); await sleep(100); await verify();
  await page.mouse.move(point.x, point.y); await page.keyboard.down('Meta'); await page.mouse.wheel({ deltaY: -150 }); await page.keyboard.up('Meta'); await sleep(150); await verify();
  console.log('ok  스크롤·확대 후에도 막대가 글상자를 따라 이동하며 화면 안에 유지');
  mkdirSync('/tmp/ayunpad-qa', { recursive: true }); await page.screenshot({ path: '/tmp/ayunpad-qa/floating-toolbar.png' });
  await page.emulateMediaType('print'); assert.ok(await page.evaluate(selector => { const e = document.querySelector(selector); return !e || !e.isConnected || getComputedStyle(e).display === 'none'; }, toolbar)); await page.emulateMediaType('screen');
  console.log('ok  도구 막대는 인쇄에 포함하지 않음');
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 390, height: 844 });
  if (!(await page.$eval('.side', e => e.classList.contains('hidden')))) await page.$eval('.side-backdrop', e => e.click());
  await page.waitForSelector('.side.hidden'); await page.$eval('.desk', e => { e.scrollTop = 0; e.scrollLeft = 0; }); await sleep(200);
  const tb = await page.$eval(`.fold-live-window .tbox[data-sid="${id}"]`, e => { const r = e.getBoundingClientRect(); return { x: r.x + 3, y: r.y + r.height / 2 }; });
  await page.mouse.click(tb.x, tb.y, { count: 2 }); await page.waitForSelector(toolbar, { visible: true }); await sleep(150); await verify();
  assert.deepEqual(errors, []); await page.screenshot({ path: '/tmp/ayunpad-qa/floating-toolbar-mobile.png' });
  console.log('ok  좁은 화면에서도 막대를 화면 폭 안으로 접어 표시 · 실행 오류 없음');
} catch (error) {
  if (browser) { const page = (await browser.pages()).at(-1); mkdirSync('/tmp/ayunpad-qa', { recursive: true }); await page?.screenshot({ path: '/tmp/ayunpad-qa/floating-toolbar-failure.png' }).catch(() => {}); }
  throw error;
} finally { await browser?.close(); server.kill(); }
