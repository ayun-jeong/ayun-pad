import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url='http://localhost:4350/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4350','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
  await page.goto(url+'lab/keys.html',{waitUntil:'networkidle0'});
  await page.evaluate(url=>{localStorage.setItem('ayunpad-zoom','1.5');document.body.replaceChildren(Object.assign(document.createElement('iframe'),{src:url+'?panel=1',id:'panel',style:'width:360px;height:850px;border:0'}));},url);
  const frame=await (await page.waitForSelector('#panel')).contentFrame();await frame.waitForSelector('.editor');
  const scale=()=>frame.$eval('.zoom-inner',e=>new DOMMatrix(getComputedStyle(e).transform).a);
  const panelZoom=()=>frame.evaluate(()=>Number(localStorage.getItem('ayunpad-panel-zoom')));
  await frame.click('.more-btn');await frame.waitForSelector('[aria-label="배율 퍼센트"]');
  await frame.focus('[aria-label="배율 퍼센트"]');await page.keyboard.type('175');await page.keyboard.press('Enter');await sleep(150);
  assert.equal(await panelZoom(),1.75);assert.equal(await scale(),1.75);
  await frame.click('.more-btn');await page.$eval('#panel',e=>e.style.width='520px');await sleep(200);assert.equal(await scale(),1.75);
  assert.equal(await frame.evaluate(()=>localStorage.getItem('ayunpad-zoom')),'1.5');
  console.log('ok  확장과 동일한 좁은 iframe에서 175% 직접 입력·실제 확대 · 패널 너비 변경에도 유지 · 본 사이트 배율 분리');
  const rect=await frame.$eval('.desk',e=>{const r=e.getBoundingClientRect();return{x:r.x+100,y:r.y+100};});
  const outer=await page.$eval('#panel',e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y};});
  await page.mouse.move(outer.x+rect.x,outer.y+rect.y);await page.keyboard.down('Control');await page.mouse.wheel({deltaY:-100});await page.keyboard.up('Control');await sleep(200);assert.ok(await scale()>1.75);
  await page.keyboard.down('Control');await page.keyboard.press('Digit0');await page.keyboard.up('Control');await sleep(150);assert.equal(await scale(),1);
  await page.keyboard.down('Control');await page.keyboard.press('Equal');await page.keyboard.up('Control');await sleep(150);assert.equal(await scale(),1.1);
  console.log('ok  패널 위 트랙패드 방식 Ctrl 휠 확대 · Ctrl+0 복원 · Ctrl++ 확대');
  await page.keyboard.down('Alt');await page.keyboard.press('Digit3');await page.keyboard.up('Alt');await frame.waitForSelector('.pages.a4');await sleep(200);
  assert.equal(await frame.$eval('.pages.a4',e=>new DOMMatrix(getComputedStyle(e).transform).a),1.1);
  await page.keyboard.down('Control');await page.keyboard.press('Equal');await page.keyboard.up('Control');await sleep(150);
  assert.equal(await frame.$eval('.pages.a4',e=>new DOMMatrix(getComputedStyle(e).transform).a),1.2);
  console.log('ok  A4 보기에서도 패널 폭에 막히지 않고 지정 배율 반영');
  await frame.evaluate(()=>location.reload());await frame.waitForSelector('.editor');await sleep(300);assert.equal(await panelZoom(),1.2);assert.equal(await scale(),1.2);
  assert.deepEqual(errors,[]);console.log('ok  패널 새로고침 후 수동 배율 복원 · 실행 오류 없음');
} finally {await browser?.close();server.kill();}
