import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const url = process.env.E2E_URL ?? 'http://localhost:4337/ayun-pad/';
const server = process.env.E2E_URL ? { kill() {} } : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4337', '--strictPort'], { stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} await pause(200); }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('.editor');
  await page.$eval('.addnote', e => e.click());
  await page.waitForFunction(() => window.__ayunpad.view()?.state.doc.textContent === '');
  await page.click('.paper-width-options button:last-child');
  await page.waitForSelector('.fold-live-window .editor');
  const initial = await page.evaluate(() => {
    const doc = window.__ayunpad.doc(), v = window.__ayunpad.view();
    const t = doc.meta.get('typo') ?? {}; const usable = 297 - 2 * (t.mTop ?? 3);
    const anchor = (x, y) => ({ l: null, r: 0, x, y });
    doc.ydoc.transact(() => {
      for (let i = 0; i < 3; i++) doc.shapes.set(`half-${i}`, { id: `half-${i}`, t: 'text', a: anchor(10, i * usable + 20), bw: 45, text: ['LEFT 1-1', 'RIGHT 1-2', 'LEFT 2-1'][i], c: 'k', w: .2, z: i });
    });
    const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, v.state.schema.node('line', { id: 'legacy-line' }, v.state.schema.text('Legacy body unchanged'))); v.dispatch(tr);
    return { usable, shapes: JSON.stringify([...doc.shapes.values()]), doc: JSON.stringify(v.state.doc.toJSON()) };
  });
  await page.waitForSelector('.folded-snapshots .psheet[data-sheet="1"]');
  await page.waitForSelector('.fold-live-window .tbox[data-sid="half-0"]');
  const before = await page.evaluate(() => ({ shapes: JSON.stringify([...window.__ayunpad.doc().shapes.values()]), doc: JSON.stringify(window.__ayunpad.view().state.doc.toJSON()) }));
  assert.equal(before.shapes, initial.shapes); assert.equal(before.doc, initial.doc);
  const locations = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; };
    return { left: rect('.folded-snapshots .phalf[data-half="0"]'), right: rect('.folded-snapshots .phalf[data-half="1"]'), next: rect('.folded-snapshots .phalf[data-half="2"]'), source: document.querySelector('.fold-live-window .sheet-src').offsetWidth };
  });
  assert.ok(locations.right.x > locations.left.x + locations.left.width - 2);
  assert.ok(Math.abs(locations.right.y - locations.left.y) < 1);
  assert.ok(locations.next.y > locations.left.y + 500); assert.ok(Math.abs(locations.next.x - locations.left.x) < 1);
  assert.ok(Math.abs(locations.source - 100 * 96 / 25.4) < 2);
  console.log('ok  1-1 왼쪽 · 1-2 같은 A4 오른쪽 · 2-1 다음 A4 왼쪽, 필기 폭은 100mm 유지');
  await page.click('.paper-width-options button:first-child');
  await page.waitForSelector('.half-live-window');
  await page.click('.paper-width-options button:last-child');
  await page.waitForSelector('.fold-live-window'); await pause(150);
  const unchanged = await page.evaluate(() => ({ shapes: JSON.stringify([...window.__ayunpad.doc().shapes.values()]), doc: JSON.stringify(window.__ayunpad.view().state.doc.toJSON()) }));
  assert.deepEqual(unchanged, before);
  console.log('ok  반쪽 ↔ 한 장 전환이 원문·줄바꿈·그림 좌표를 바꾸지 않음');
  const rightPoint = await page.$eval('.folded-snapshots .phalf[data-half="1"] .pwin', e => { const r = e.getBoundingClientRect(); const ppm = r.width / 100; return { x: r.x + 60 * ppm, y: r.y + 75 * ppm }; });
  await page.mouse.click(rightPoint.x, rightPoint.y);
  await page.waitForSelector('.fold-live-window[data-live-half="1"] .tbox.tedit .tb-edit');
  await page.keyboard.type('NEW RIGHT NOTE'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => [...window.__ayunpad.doc().shapes.values()].some(s => s.text === 'NEW RIGHT NOTE'));
  const added = await page.evaluate(() => [...window.__ayunpad.doc().shapes.values()].find(s => s.text === 'NEW RIGHT NOTE'));
  assert.ok(added.a.y > initial.usable && added.a.y < initial.usable * 2); assert.ok(added.a.x < 100);
  console.log('ok  A4 오른쪽에서 바로 만든 글상자가 1-2의 반쪽 좌표로 저장');
  await page.click('.fold-live-window .tbox[data-sid="half-1"]', { count: 2 });
  await page.waitForSelector('.fold-live-window .tbox[data-sid="half-1"].tedit');
  await page.keyboard.press('End'); await page.keyboard.type(' edited'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__ayunpad.doc().shapes.get('half-1').text.includes('edited'));
  console.log('ok  오른쪽의 기존 글상자도 한 장 화면에서 직접 편집');
  await pause(200);
  const box = await page.$eval('.fold-live-window .tbox[data-sid="half-1"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + 5, y: r.y + r.height / 2 }; });
  const leftPoint = await page.$eval('.folded-snapshots .phalf[data-half="0"] .pwin', e => { const r = e.getBoundingClientRect(); return { x: r.x + 20 * r.width / 100, y: r.y + 50 * r.width / 100 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(leftPoint.x, leftPoint.y, { steps: 15 }); await page.mouse.up();
  await page.waitForFunction(u => window.__ayunpad.doc().shapes.get('half-1').a.y < u, {}, initial.usable);
  console.log('ok  오른쪽 반쪽의 글상자를 왼쪽으로 끌어 옮기면 1-1 좌표로 이동');
  await page.keyboard.press('Escape'); await pause(200);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const print = await page.$$eval('.print-root .psheet', sheets => sheets.map(s => [...s.querySelectorAll('.phalf')].map(h => Number(h.dataset.half))));
  assert.deepEqual(print, [[0, 1], [2, 3]]);
  console.log('ok  인쇄도 1-1|1-2, 2-1|2-2 순서의 A4 두 장');
  await pause(250); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.folded-snapshots .psheet[data-sheet="1"]');
  assert.ok(await page.evaluate(() => [...window.__ayunpad.doc().shapes.values()].some(s => s.text === 'NEW RIGHT NOTE' && s.a.y > 291)));
  assert.deepEqual(errors, []);
  mkdirSync('/tmp/ayunpad-qa', { recursive: true }); await page.screenshot({ path: '/tmp/ayunpad-qa/folded.png' });
  console.log('ok  새로고침 뒤 오른쪽 필기 보존 · 실행 오류 없음');
} catch (e) {
  if (browser) { const pages = await browser.pages(); const page = pages.at(-1); mkdirSync('/tmp/ayunpad-qa', { recursive: true }); await page?.screenshot({ path: '/tmp/ayunpad-qa/folded-failure.png' }).catch(() => {}); }
  throw e;
} finally { await browser?.close(); server.kill(); }
