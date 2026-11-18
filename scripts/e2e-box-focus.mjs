import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url = 'http://localhost:4344/ayun-pad/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4344', '--strictPort'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  for(let i=0;i<60;i++){ try {if((await fetch(url)).ok)break;}catch{} await sleep(200); }
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:1000}); await page.goto(url,{waitUntil:'networkidle0'}); await page.waitForSelector('.editor');
  await page.$eval('.addnote',e=>e.click()); await page.waitForFunction(()=>window.__ayunpad.view().state.doc.textContent==='');
  await page.evaluate(()=>window.__ayunpad.doc().shapes.set('long',{id:'long',t:'text',a:{l:null,r:0,x:10,y:20},bw:70,text:Array.from({length:70},(_,i)=>`Line ${i+1} selected text`).join('\n'),c:'k',w:.2,z:0}));
  for(const mode of ['half','a4']){
    await page.keyboard.press('Escape');
    await page.click(`.paper-width-options button:${mode==='half'?'first':'last'}-child`);
    await page.waitForSelector(mode==='half'?'.half-live-window':'.fold-live-window');
    await page.$eval('.desk',e=>{e.scrollTop=600;}); await sleep(200);
    const point=await page.evaluate(()=>{const d=document.querySelector('.desk').getBoundingClientRect(), b=document.querySelector('.paper .tbox[data-sid="long"]').getBoundingClientRect();return{x:b.left+30,y:d.top+300};});
    await page.mouse.click(point.x,point.y); await page.waitForSelector('.tb-bar[data-box-id="long"][data-editing="false"]'); await sleep(500);
    const before=await page.$eval('.desk',e=>({x:e.scrollLeft,y:e.scrollTop}));
    await page.mouse.click(point.x,point.y,{count:2}); await page.waitForSelector('.paper .tbox[data-sid="long"].tedit'); await sleep(200);
    const after=await page.$eval('.desk',e=>({x:e.scrollLeft,y:e.scrollTop}));
    assert.deepEqual(after,before,`${mode}: double-click must keep the current viewport`);
    await page.keyboard.type('X');
    await page.waitForFunction(()=>window.__ayunpad.doc().shapes.get('long').text.includes('X'));
    console.log(`ok  ${mode}: 긴 글상자 중간을 선택 후 더블클릭해도 화면 위치 유지 · 바로 입력 가능`);
  }
  assert.deepEqual(errors,[]);
} finally {await browser?.close();server.kill();}
