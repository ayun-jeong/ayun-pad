import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url='http://localhost:4349/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4349','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try{
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');
  await page.$eval('.addnote',e=>e.click());await page.waitForSelector('.shapes-layer');
  const p=await page.$eval('.shapes-layer',e=>{const r=e.getBoundingClientRect();return{x:r.x+80,y:r.y+120};});
  await page.mouse.click(p.x,p.y);await page.waitForSelector('.tbox.tedit');
  await page.keyboard.type('배전방식---가공배전: 전주와 전선을 이용해 공급');
  await page.keyboard.press('Enter');await page.keyboard.type('하위 설명');await page.keyboard.press('Enter');await page.keyboard.type('다음 설명');await sleep(400);
  const saved=await page.evaluate(()=>[...window.__ayunpad.doc().shapes.values()].find(s=>s.t==='text').doc);
  assert.deepEqual(saved.content.map(n=>[n.content?.map(n=>n.text??'').join('')??'',n.attrs.depth,n.attrs.kind,n.attrs.side]),[
    ['배전방식',1,'plain',true],['가공배전: 전주와 전선을 이용해 공급',2,'branch',false],['하위 설명',3,'branch',false],['다음 설명',3,'branch',false],
  ]);
  const rects=await page.$$eval('.tb-edit .ln',es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,style:e.getAttribute('style')};}));
  assert.ok(Math.abs(rects[0].y-rects[1].y)<1,'옆 주제어는 같은 줄에 표시');
  assert.ok(rects[1].x>rects[0].x,'가공배전은 배전방식 오른쪽');
  assert.ok(rects[2].y>rects[1].y,'하위 가지는 다음 줄');
  assert.ok(/padding-left:\s*calc\(/.test(rects[2].style),'하위 가지는 옆 주제어 기준으로 들여쓰기');
  console.log('ok  --- 변환 뒤 Enter는 옆 주제어의 하위 가지 · 다음 Enter는 형제 가지 · 같은 줄 배치 유지');
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.tbox .ln');
  const reloaded=await page.evaluate(()=>[...window.__ayunpad.doc().shapes.values()].find(s=>s.t==='text').doc);
  assert.deepEqual(reloaded,saved);assert.deepEqual(errors,[]);
  console.log('ok  새로고침 후 가지 구조·설명 저장 유지 · 실행 오류 없음');
}finally{await browser?.close();server.kill();}
