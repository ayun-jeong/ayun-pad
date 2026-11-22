import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import puppeteer from 'puppeteer-core';
const url=process.env.E2E_URL??'http://localhost:4371/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4371','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
 browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');await page.evaluate(async()=>await window.__ayunpad.doc().ready);await page.$eval('.addnote',e=>e.click());
 const starTool=async()=>{await page.click('.insert-btn');const labels=await page.$$eval('.ins-drawing button',es=>es.map(e=>e.textContent));assert.deepEqual(labels,['글상자','화살표','선','네모','원','별표']);await page.$$eval('.ins-drawing button',es=>es.find(e=>e.textContent==='별표').click());await page.waitForSelector('.shapes-layer.tool-star');};
 const shapes=()=>page.evaluate(()=>[...window.__ayunpad.doc().shapes.values()]);
 await starTool();const origin=await page.$eval('.shapes-layer',e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,ppm:r.width/100};});const p=(x,y)=>[origin.x+x*origin.ppm,origin.y+y*origin.ppm];
 await page.mouse.click(...p(20,25));await page.waitForFunction(()=>window.__ayunpad.doc().shapes.size===1);const small=(await shapes())[0];assert.equal(small.t,'path');assert.equal(small.head,0);assert.equal(small.c,'k');assert.equal(small.pts.length,7);assert.ok(small.cs.some(cs=>cs[0].x||cs[1].y));
 const path=await page.$eval(`.paper g[data-sid="${small.id}"] path`,e=>e.getAttribute('d'));assert.ok(path.includes('C'),'살짝 휜 획은 곡선으로 표현');
 const mod=await page.evaluate(()=>/Mac/.test(navigator.platform)?'Meta':'Control');const key=async code=>{await page.keyboard.down(mod);await page.keyboard.press(code);await page.keyboard.up(mod);};
 await key('KeyZ');await page.waitForFunction(()=>window.__ayunpad.doc().shapes.size===0);await page.keyboard.down(mod);await page.keyboard.down('Shift');await page.keyboard.press('KeyZ');await page.keyboard.up('Shift');await page.keyboard.up(mod);await page.waitForFunction(()=>window.__ayunpad.doc().shapes.size===1);
 await starTool();await page.mouse.move(...p(45,30));await page.mouse.down();await page.mouse.move(...p(72,58),{steps:12});assert.ok(await page.$('.sh-preview, .shapes-svg g[data-sid="draft"] path'),'드래그 중 별표 미리보기');await page.mouse.up();await page.waitForFunction(()=>window.__ayunpad.doc().shapes.size===2);
 let large=(await shapes()).find(s=>s.id!==small.id);assert.ok(Math.max(...large.pts.map(p=>p.x))-Math.min(...large.pts.map(p=>p.x))>20);
 await page.click('.drawbar button[title^="빨강"]');await page.waitForFunction(id=>window.__ayunpad.doc().shapes.get(id).c==='r',{},large.id);
 const before=await shapes();await page.keyboard.press('ArrowRight');await page.waitForFunction(({id,x})=>window.__ayunpad.doc().shapes.get(id).pts[0].x>x,{}, {id:large.id,x:before.find(s=>s.id===large.id).pts[0].x});
 large=(await shapes()).find(s=>s.id===large.id);assert.ok(large.pts[0].x>before.find(s=>s.id===large.id).pts[0].x,'선택한 별표 전체를 방향키로 이동');
 const saved=await shapes();await page.click('.paper-width-options button:last-child');await page.waitForSelector('.fold-live-window');await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));const printed=await page.$eval(`.print-root g[data-sid="${small.id}"] path`,e=>e.getAttribute('d'));assert.equal(printed,path);await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.click('.top .read-btn');await page.screenshot({path:'/tmp/ayun-pad-stars.png'});await page.reload({waitUntil:'networkidle0'});await page.waitForSelector(`.paper g[data-sid="${small.id}"] path`);assert.deepEqual(await shapes(),saved);assert.deepEqual(errors,[]);
 console.log('ok hand-drawn star replaces select/move: click/drag preview, curved stroke, color, nudge, undo/redo, A4/print/reload');
}finally{await browser?.close();server.kill();}
