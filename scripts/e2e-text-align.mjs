import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url='http://localhost:4352/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4352','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');await page.evaluate(async()=>await window.__ayunpad.doc().ready);const noteId=await page.evaluate(()=>window.__ayunpad.doc().id);
  await page.evaluate(()=>{const shapes=window.__ayunpad.doc().shapes;
    for(const [i,frame] of [undefined,'rect','ellipse'].entries()) {const id=`align-${i}`;shapes.set(id,{id,t:'text',frame,stroke:'k',a:{l:null,r:0,x:10,y:20+i*45},bw:65,bh:30,text:'first\nsecond\nthird',doc:{type:'doc',content:['first','second','third'].map(text=>({type:'line',content:[{type:'text',text}]}))},c:'k',w:.2,z:i});}
  });await page.waitForSelector('.tbox[data-sid="align-0"]');
  const style=id=>page.$$eval(`.paper .tbox[data-sid="${id}"] .ln`,es=>es.map(e=>getComputedStyle(e).textAlign));
  const button=name=>`.tb-bar-floating [aria-label="${name} 정렬"]`;
  await page.click('.tbox[data-sid="align-0"]');await page.waitForSelector(button('가운데'));await page.click(button('가운데'));assert.deepEqual(await style('align-0'),['center','center','center']);
  assert.equal(await page.$eval(button('가운데'),e=>e.getAttribute('aria-pressed')),'true');
  await page.$eval('.tbox[data-sid="align-0"] .tb-edit',e=>e.focus({preventScroll:true}));await sleep(100);
  const pos=await page.$eval('.tbox[data-sid="align-0"] .ln',e=>{const range=document.createRange();range.selectNodeContents(e);const r=range.getBoundingClientRect();return{x:r.x+.1,y:r.y+r.height/2,right:r.right};});
  await page.mouse.move(pos.x,pos.y);await page.mouse.down();await page.mouse.move(pos.right,pos.y,{steps:8});await page.mouse.up();assert.equal(await page.evaluate(()=>getSelection().toString()),'first');
  await page.click(button('오른쪽'));assert.deepEqual(await style('align-0'),['right','center','center']);assert.equal(await page.evaluate(()=>getSelection().toString()),'first');
  await page.keyboard.down('Meta');await page.keyboard.press('KeyZ');await page.keyboard.up('Meta');await sleep(100);assert.deepEqual(await style('align-0'),['center','center','center']);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  console.log('ok  도구 막대의 왼쪽·가운데·오른쪽 버튼 · 상자 전체 또는 선택 문단 정렬 · 선택 범위 유지 · 되돌리기');
  for(const id of ['align-1','align-2']) {
    await page.click(`.tbox[data-sid="${id}"]`);await page.waitForSelector(button('오른쪽'));await page.click(button('오른쪽'));assert.deepEqual(await style(id),['right','right','right']);
    await page.click(button('왼쪽'));assert.deepEqual(await style(id),['left','left','left']);await page.click(button('가운데'));assert.deepEqual(await style(id),['center','center','center']);
    await page.keyboard.press('Escape');
  }
  await page.click('.paper-width-options button:last-child');await page.waitForSelector('.fold-live-window');await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));await page.waitForSelector('.print-root .tbox');
  assert.ok(await page.$$eval('.print-root .tbox .ln',es=>es.every(e=>getComputedStyle(e).textAlign==='center')));
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await sleep(300);await page.goto(url+'?note='+noteId,{waitUntil:'networkidle0'});await page.waitForSelector('.tbox[data-sid="align-2"]');assert.deepEqual(await style('align-2'),['center','center','center']);assert.deepEqual(errors,[]);
  console.log('ok  네모·원 안의 글도 3가지 정렬 지원 · A4·인쇄·새로고침 뒤 정렬 보존');
} finally {await browser?.close();server.kill();}
