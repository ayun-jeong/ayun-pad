import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import puppeteer from 'puppeteer-core';
const url='http://localhost:4355/ayun-pad/',server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4355','--strictPort'],{stdio:'ignore'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
 browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');
 await page.evaluate(()=>window.__ayunpad.doc().shapes.set('keep',{id:'keep',t:'text',a:{l:null,r:0,x:10,y:20},bw:35,text:'KEEP',c:'k',w:.2,z:0}));await page.waitForSelector('.tbox[data-sid="keep"]');await page.click('.tbox[data-sid="keep"]');await page.$eval('.tbox .tb-edit',e=>e.focus({preventScroll:true}));await page.keyboard.press('End');await page.keyboard.type('2');await page.keyboard.press('Escape');
 const saved=await page.evaluate(()=>JSON.stringify([...window.__ayunpad.doc().shapes.values()]));await page.click('.drawbar .dtools');await page.click('.drawbar button[title^="화살표 ("]');await page.waitForSelector('.tool-arrow');
 const point=async(x,y)=>page.$eval('.shapes-layer',(e,p)=>{const r=e.getBoundingClientRect(),scale=r.width/e.offsetWidth*96/25.4;return{x:r.x+p.x*scale,y:r.y+p.y*scale};},{x,y});
 const click=async(x,y)=>{const p=await point(x,y);await page.mouse.click(p.x,p.y);};
 await click(10,65);const p=await point(30,75);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+12,p.y-10,{steps:5});await page.mouse.up();await click(55,65);
 const count=()=>page.$$eval('.shapes-svg > circle.sh-ui:not(.sh-knob)',es=>es.length);
 const key=async redo=>{await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');await page.keyboard.press('KeyZ');if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');await sleep(50);};
 assert.equal(await count(),3);await page.click('[aria-label="그리기 실행취소"]');assert.equal(await count(),2);await key(false);assert.equal(await count(),1);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ayunpad-drawing-history',{cancelable:true,detail:{redo:false}})));assert.equal(await count(),0);await page.click('[aria-label="그리기 실행취소"]');assert.equal(await count(),0);assert.equal(await page.evaluate(()=>JSON.stringify([...window.__ayunpad.doc().shapes.values()])),saved);
 await key(true);await page.click('[aria-label="그리기 다시 실행"]');await page.click('[aria-label="그리기 다시 실행"]');assert.equal(await count(),3);
 console.log('ok  그리기 버튼·⌘Z·편집 막대 요청은 마지막 점부터 취소 · 점이 없어도 기존 글/도형 건드리지 않음 · 다시 실행으로 곡선 점 복원');
 await page.click('[aria-label="그리기 실행취소"]');await click(60,90);await page.click('[aria-label="그리기 다시 실행"]');assert.equal(await count(),3);await page.keyboard.press('Enter');await sleep(100);
 const path=await page.evaluate(()=>[...window.__ayunpad.doc().shapes.values()].find(s=>s.t==='path'));assert.equal(path.pts.length,3);assert.ok(path.cs?.some(Boolean));assert.ok(path.pts.at(-1).y>80);
 await page.click('[aria-label="그리기 실행취소"]');assert.equal(await page.evaluate(()=>JSON.stringify([...window.__ayunpad.doc().shapes.values()])),saved);await page.keyboard.press('Escape');await page.setViewport({width:520,height:900});if(await page.$('.side-backdrop'))await page.$eval('.side-backdrop',e=>e.click());
 await page.waitForSelector('.touchbar[aria-label="편집 도구"]');await page.click('.touchbar[aria-label="편집 도구"] [aria-label="되돌리기"]');await sleep(100);assert.equal(await page.evaluate(()=>window.__ayunpad.doc().shapes.get('keep').text),'KEEP');
 await page.click('.touchbar[aria-label="편집 도구"] [aria-label="다시 하기"]');await sleep(100);assert.equal(await page.evaluate(()=>window.__ayunpad.doc().shapes.get('keep').text),'KEEP2');assert.deepEqual(errors,[]);
 console.log('ok  새 점은 이전 다시 실행 기록을 교체 · 완성 뒤에는 완성 도형만 실행취소 · 일반 편집 취소/다시도 정상 · 실행 오류 없음');
}finally{await browser?.close();server.kill();}
