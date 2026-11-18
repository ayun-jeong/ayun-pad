import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const url = 'http://localhost:4341/ayun-pad/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4341', '--strictPort'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} await sleep(200); }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 }); await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor'); await page.$eval('.addnote', e => e.click());
  await page.waitForFunction(() => document.querySelector('.editor')?.textContent === '');
  await page.evaluate(() => {
    const shapes = window.__ayunpad.doc().shapes;
    const anchor = (x, y) => ({ l: null, r: 0, x, y });
    shapes.set('a', { id: 'a', t: 'rect', a: anchor(10, 20), b: anchor(20, 30), c: 'k', w: .2, z: 0 });
    shapes.set('b', { id: 'b', t: 'ellipse', a: anchor(40, 50), b: anchor(60, 70), c: 'k', w: .2, z: 1 });
    shapes.set('c', { id: 'c', t: 'text', a: anchor(65, 80), bw: 30, text: 'Keep this note', c: 'r', w: .2, z: 2 });
  });
  await page.waitForSelector('.tbox'); await page.click('.tb-draw'); await page.waitForSelector('.drawbar');
  await page.evaluate(() => document.activeElement?.blur());
  const mod = await page.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
  const key = async code => { await page.keyboard.down(mod); await page.keyboard.press(code); await page.keyboard.up(mod); };
  const shapes = () => page.evaluate(() => [...window.__ayunpad.doc().shapes.values()]);
  const action = async label => {
    await page.click('button[aria-label="정렬 및 크기"]'); await page.waitForSelector('.arrange-menu');
    await page.$$eval('.arrange-grid button', (buttons, text) => buttons.find(b => b.textContent === text).click(), label);
    await page.waitForFunction(() => !document.querySelector('.arrange-menu'));
  };
  await key('KeyA'); await page.waitForSelector('button[aria-label="정렬 및 크기"]');
  const original = await shapes();
  await action('왼쪽 정렬'); await page.waitForFunction(() => [...window.__ayunpad.doc().shapes.values()].every(s => s.a.x === 10));
  await key('KeyZ'); await page.waitForFunction(() => window.__ayunpad.doc().shapes.get('b').a.x === 40);
  assert.deepEqual(await shapes(), original);
  console.log('ok  도형 · 글상자 혼합 선택 왼쪽 정렬 · 한 번의 실행 취소로 원래 위치 복원');
  await action('오른쪽 정렬');
  await page.waitForFunction(() => window.__ayunpad.doc().shapes.get('a').b.x === 95);
  let saved = await shapes(); assert.equal(saved.find(s => s.id === 'b').b.x, 95); assert.equal(saved.find(s => s.id === 'c').a.x + 30, 95);
  await key('KeyZ');
  await page.waitForFunction(() => window.__ayunpad.doc().shapes.get('a').a.x === 10);
  await action('크기 같게');
  await page.waitForFunction(() => window.__ayunpad.doc().shapes.get('c').bh > 19.99);
  saved = await shapes();
  for (const s of saved.filter(s => s.t !== 'text')) { assert.equal(Math.abs(s.b.x - s.a.x), 30); assert.equal(Math.abs(s.b.y - s.a.y), 20); }
  const rect = await page.$eval('.tbox', e => ({ h: e.offsetHeight / (96 / 25.4), text: e.textContent }));
  assert.ok(Math.abs(rect.h - 20) < .4); assert.ok(rect.text.includes('Keep this note'));
  console.log('ok  너비 · 높이를 최대 크기로 통일 · 글상자 높이 실제 렌더링 · 내용 보존');
  await action('가로 간격 같게');
  await page.waitForFunction(() => window.__ayunpad.doc().shapes.get('b').a.x !== 40);
  saved = await shapes(); assert.equal(saved[1].a.x - saved[0].b.x, saved[2].a.x - saved[1].b.x);
  console.log('ok  양 끝 위치를 유지하고 가로 간격 통일');
  await page.click('button[aria-label="정렬 및 크기"]'); await page.waitForSelector('.arrange-menu');
  mkdirSync('/tmp/ayunpad-qa', { recursive: true });
  await page.screenshot({ path: '/tmp/ayunpad-qa/arrange-menu.png' });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.arrange-menu'));
  assert.ok(await page.$('button[aria-label="정렬 및 크기"]'));
  console.log('ok  Escape는 정렬 메뉴만 닫고 선택 유지');
  await sleep(250); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.tbox');
  assert.deepEqual(await shapes(), saved);
  console.log('ok  새로고침 뒤 정렬 · 크기 · 글상자 높이 보존');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); server.kill(); }
