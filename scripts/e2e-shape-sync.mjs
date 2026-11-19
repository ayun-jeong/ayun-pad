import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url='http://localhost:4353/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4353','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  const main=await browser.newPage(),panel=await browser.newPage();await main.setViewport({width:1440,height:1000});await panel.setViewport({width:520,height:1000});
  await main.bringToFront();await main.goto(url,{waitUntil:'networkidle0'});await main.waitForSelector('.editor');await main.evaluate(async()=>await window.__ayunpad.doc().ready);
  const id=await main.evaluate(()=>window.__ayunpad.doc().id);await panel.bringToFront();await panel.goto(url+'?panel=1&note='+id,{waitUntil:'networkidle0'});await panel.waitForSelector('.editor');
  await panel.evaluate(()=>{window.__ayunpad.doc().shapes.set('sync-frame',{id:'sync-frame',t:'rect',a:{l:null,r:0,x:10,y:20},b:{l:null,r:0,x:60,y:25},c:'r',w:.2,z:0});});
  await main.bringToFront();await main.waitForSelector('.shapes-svg rect[data-sid="sync-frame"]');await panel.bringToFront();
  const pos=await panel.$eval('.shapes-svg rect[data-sid="sync-frame"]',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await panel.mouse.click(pos.x,pos.y);await sleep(80);await panel.mouse.click(pos.x,pos.y);await panel.waitForSelector('.tbox.tedit[data-sid="sync-frame"]');await panel.keyboard.type('한국전력공사');
  await main.bringToFront();await main.waitForFunction(()=>document.querySelector('.tbox[data-sid="sync-frame"]')?.textContent.includes('한국전력공사'));
  const result=page=>page.$eval('.tbox[data-sid="sync-frame"]',e=>{const s=getComputedStyle(e);return{border:s.borderTopColor,width:s.borderTopWidth,style:s.borderTopStyle,pad:parseFloat(s.paddingTop),text:e.querySelector('.tb-edit').textContent};});
  assert.deepEqual(await result(main),await result(panel));assert.equal((await result(main)).border,'rgb(236, 53, 53)');assert.ok((await result(main)).pad<1.1);
  assert.deepEqual(await main.evaluate(()=>window.__ayunpad.doc().shapes.get('sync-frame')),await panel.evaluate(()=>window.__ayunpad.doc().shapes.get('sync-frame')));
  await sleep(300);await main.reload({waitUntil:'networkidle0'});await main.waitForSelector('.tbox[data-sid="sync-frame"]');assert.equal((await result(main)).text,'한국전력공사');assert.equal((await result(main)).border,'rgb(236, 53, 53)');
  console.log('ok  사이드 패널의 네모·글·테두리가 본페이지에 실시간 반영 · 두 창 모양 동일 · 새로고침 뒤 보존 · 네모 위아래 여백 0.25mm');
}finally{await browser?.close();server.kill();}
