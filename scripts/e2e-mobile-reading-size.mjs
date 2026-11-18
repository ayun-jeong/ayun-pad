import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer,{KnownDevices} from 'puppeteer-core';
const url='http://localhost:4348/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4348','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try{
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  for(const device of ['iPhone 13','Pixel 5','Desktop']){
    const context=await browser.createBrowserContext(),page=await context.newPage();if(device==='Desktop')await page.setViewport({width:1440,height:1000});else await page.emulate(KnownDevices[device]);
    await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');
    await page.evaluate(()=>{const shapes=window.__ayunpad.doc().shapes,a=(x,y)=>({l:null,r:0,x,y});
      const texts=['경영학 효율 향상 의무화 제도 '.repeat(30),'기본 글씨 크기와 줄 간격 유지 '.repeat(60),'짧은 필기'];
      for(let i=0;i<3;i++)shapes.set(`mobile-${i}`,{id:`mobile-${i}`,t:'text',a:a(5,20+i*100),bw:i===1?170:85,text:texts[i],c:'k',w:.2,z:i,fs:i===2?1.4:1});
    });
    await page.waitForSelector('.tbox[data-sid="mobile-2"]');await sleep(300);
    const measure=()=>page.$$eval('.paper .tbox',es=>es.map(e=>{const p=e.querySelector('.ln'),r=e.getBoundingClientRect(),line=p.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(p);const text=range.getBoundingClientRect();return{id:e.dataset.sid,w:r.width,h:r.height,lineH:line.height,font:getComputedStyle(p).fontSize,glyphH:text.height,editable:e.querySelector('.tb-edit').contentEditable};}));
    if(await page.$eval('.app',e=>e.classList.contains('reading')))await page.click('.read-btn');await page.waitForFunction(()=>!document.querySelector('.app').classList.contains('reading'));await sleep(200);const edit=await measure();
    await page.click('.read-btn');await page.waitForFunction(()=>document.querySelector('.app').classList.contains('reading'));await sleep(200);const read=await measure();
    assert.equal(await page.$eval('.paper .tb-edit',e=>getComputedStyle(e).webkitTextSizeAdjust),'100%');
    for(let i=0;i<edit.length;i++)for(const key of ['w','h','lineH','font','glyphH'])assert.equal(read[i][key],edit[i][key],`${device} ${read[i].id} ${key}`);
    assert.ok(read.every(e=>e.editable==='false'));
    console.log(`ok  ${device}: 편집→읽기 전환 후 글자·줄 높이·상자 크기 유지 · 자동 글자 확대 보정 100%`);
    await page.$eval('.paper-width-options button:last-child',e=>e.click());await page.waitForSelector('.fold-live-window');await sleep(200);
    const wideRead=await measure();await page.click('.read-btn');await sleep(200);const wideEdit=await measure();
    for(let i=0;i<wideRead.length;i++)for(const key of ['w','h','lineH','font','glyphH'])assert.equal(wideRead[i][key],wideEdit[i][key],`${device} A4 ${wideRead[i].id} ${key}`);
    await page.click('.read-btn');await sleep(150);
    if(device!=='Desktop'){
      const cdp=await page.createCDPSession(),cx=195,cy=420;
      const saved=await page.evaluate(()=>JSON.stringify([...window.__ayunpad.doc().shapes.values()]));
      const zoom=await page.evaluate(()=>Number(localStorage.getItem('ayunpad-zoom')));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-40,y:cy,id:1},{x:cx+40,y:cy,id:2}]});
      for(let i=1;i<=8;i++){const d=40+7.5*i;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-d,y:cy,id:1},{x:cx+d,y:cy,id:2}]});await sleep(16);}
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(200);
      assert.ok(await page.evaluate(z=>Number(localStorage.getItem('ayunpad-zoom'))>z*1.8,zoom));
      assert.equal(await page.evaluate(()=>JSON.stringify([...window.__ayunpad.doc().shapes.values()])),saved);
    }
    console.log(`ok  ${device}: 한 장 보기에서도 모드 간 크기 동일 · 휴대폰 핀치 확대 유지`);
    await context.close();
  }
}finally{await browser?.close();server.kill();}
