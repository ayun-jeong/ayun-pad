import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const url = 'http://localhost:4343/ayun-pad/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4343', '--strictPort'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} await sleep(200); }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 }); await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('.editor');
  await page.$eval('.addnote', e => e.click()); await page.waitForFunction(() => window.__ayunpad.view().state.doc.textContent === '');
  await page.evaluate(() => {
    const content = [['경영학',1,'plain'],['마케팅',2,'branch'],['STP 전략',3,'branch'],['인사관리',2,'branch']].map(([text,depth,kind]) => ({ type:'line', attrs:{depth,kind}, content:[{type:'text',text}] }));
    const shape = { id:'density', t:'text', a:{l:null,r:0,x:10,y:20}, bw:70, text:'경영학\n마케팅\nSTP 전략\n인사관리', doc:{type:'doc',content}, c:'k', w:.2, z:0 };
    window.__ayunpad.doc().shapes.set(shape.id, shape);
  });
  await page.waitForSelector('.tbox[data-sid="density"] .ln[data-depth="2"]');
  const density = () => page.$eval('.tbox[data-sid="density"] .ln[data-depth="2"]', e => ({ padding:parseFloat(getComputedStyle(e).paddingLeft), font:parseFloat(getComputedStyle(e).fontSize), gap:getComputedStyle(e).getPropertyValue('--tgap').trim() }));
  let d = await density(); assert.ok(Math.abs(d.padding/d.font - .75) < .02); assert.equal(parseFloat(d.gap), .02);
  console.log('ok  이전 노트에도 기본 들여쓰기 .75em · 가지선과 글자 여백 .02em 적용');
  await page.click('.tbox[data-sid="density"]', { count:2 }); await page.waitForSelector('.tbox.tedit');
  await page.keyboard.down('Alt'); await page.keyboard.press('KeyT'); await page.keyboard.up('Alt'); await page.waitForSelector('#ty-indent');
  await page.$eval('#ty-indent', e => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1.1'); e.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.waitForFunction(() => window.__ayunpad.doc().meta.get('typo').indentEm === 1.1);
  d = await density(); assert.ok(Math.abs(d.padding/d.font - 1.1) < .02);
  await page.click('.panel[aria-label="글자 모양"] .close'); await page.keyboard.press('Escape');
  await page.click('.paper-width-options button:last-child'); await page.waitForSelector('.folded-snapshots .tbox');
  const paired = await page.$eval('.fold-box-window .ln[data-depth="2"]', e => parseFloat(getComputedStyle(e).paddingLeft)/parseFloat(getComputedStyle(e).fontSize));
  assert.ok(Math.abs(paired - 1.1) < .02);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const printed = await page.$eval('.print-root .pcol .ln[data-depth="2"]', e => parseFloat(getComputedStyle(e).paddingLeft)/parseFloat(getComputedStyle(e).fontSize));
  assert.ok(Math.abs(printed - 1.1) < .02);
  console.log('ok  들여쓰기 입력 즉시 반영 · 한 장 보기와 인쇄에도 같은 간격');
  await sleep(250); await page.reload({ waitUntil:'networkidle0' }); await page.waitForSelector('.fold-live-window .tbox');
  assert.ok(Math.abs((await density()).padding/(await density()).font - 1.1) < .02);
  await page.keyboard.down('Alt'); await page.keyboard.press('KeyT'); await page.keyboard.up('Alt'); await page.waitForSelector('#ty-indent');
  await page.$$eval('[aria-label="밀도 프리셋"] button', es => es.find(e => e.textContent === '초고밀도').click());
  await page.waitForFunction(() => window.__ayunpad.doc().meta.get('typo').indentEm === .55);
  assert.ok(Math.abs((await density()).padding/(await density()).font - .55) < .02);
  mkdirSync('/tmp/ayunpad-qa',{recursive:true}); await page.screenshot({path:'/tmp/ayunpad-qa/density.png'});
  assert.deepEqual(errors, []);
  console.log('ok  새로고침 뒤 간격 보존 · 초고밀도 프리셋 연동 · 실행 오류 없음');
} finally { await browser?.close(); server.kill(); }
