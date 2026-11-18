import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url='http://localhost:4345/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4345','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');
  await page.$eval('.addnote',e=>e.click());await page.waitForFunction(()=>window.__ayunpad.view().state.doc.textContent==='');
  await page.evaluate(()=>{const d=window.__ayunpad.doc();d.meta.set('typo',{...(d.meta.get('typo')??{}),auto:false,arrows:false});});await sleep(150);
  const p=await page.$eval('.shapes-layer',e=>{const r=e.getBoundingClientRect();return{x:r.x+80,y:r.y+120};});
  await page.mouse.click(p.x,p.y);await page.waitForSelector('.tbox.tedit');
  await page.keyboard.down('Alt');await page.keyboard.press('KeyB');await page.keyboard.up('Alt');
  await page.keyboard.type('--');
  assert.equal(await page.$eval('.tb-edit',e=>e.textContent),'--');
  await page.keyboard.type('-');await page.waitForSelector('.tb-edit [data-branch-dash]');
  assert.equal(await page.$eval('.tb-edit',e=>e.textContent),'–');
  assert.equal(await page.$eval('.tb-edit [data-branch-dash]',e=>getComputedStyle(e).color),'rgb(236, 53, 53)');
  console.log('ok  두 번까지는 -- 유지 · 세 번째에 – 변환 · 자동 색·화살표를 꺼도 파란 펜과 관계없이 빨강');
  await page.keyboard.press('Backspace');assert.equal(await page.$eval('.tb-edit',e=>e.textContent),'---');
  assert.equal(await page.$('.tb-edit [data-branch-dash]'),null);
  await page.keyboard.press('Backspace');await page.keyboard.type('-B');await page.waitForSelector('.tb-edit [data-branch-dash]');
  assert.equal(await page.$eval('.tb-edit',e=>e.textContent),'–B');
  assert.equal(await page.$eval('.tb-edit .ln',e=>{return getComputedStyle(e.querySelector('[data-pen="b"]:last-child')??e.lastElementChild).color;}),'rgb(0, 100, 232)');
  console.log('ok  바로 Backspace는 ---로 복원 · 다음 글자는 원래 파란 펜 유지');
  await page.keyboard.press('Escape');await page.click('.tbox');await page.waitForSelector('.tb-bar-floating');await page.click('.tb-bar-floating button[aria-label="파랑 글자"]');
  assert.equal(await page.$eval('.tb-edit [data-branch-dash]',e=>getComputedStyle(e).color),'rgb(236, 53, 53)');
  await sleep(250);await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.tbox [data-branch-dash]');
  assert.equal(await page.$eval('.tbox [data-branch-dash]',e=>getComputedStyle(e).color),'rgb(236, 53, 53)');
  assert.deepEqual(errors,[]);
  console.log('ok  상자 전체 펜 변경과 새로고침 뒤에도 가지 대시는 빨강 유지 · 실행 오류 없음');
} finally {await browser?.close();server.kill();}
