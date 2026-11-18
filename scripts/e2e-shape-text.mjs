import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url='http://localhost:4351/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4351','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');
  await page.evaluate(()=>{const shapes=window.__ayunpad.doc().shapes,a=(x,y)=>({l:null,r:0,x,y});
    shapes.set('rect-label',{id:'rect-label',t:'rect',a:a(10,20),b:a(65,50),c:'r',fill:'y',dash:true,w:.35,z:0});
    shapes.set('ellipse-label',{id:'ellipse-label',t:'ellipse',a:a(10,65),b:a(65,100),c:'b',w:.5,z:1});
    shapes.set('empty-label',{id:'empty-label',t:'rect',a:a(70,20),b:a(98,45),c:'k',w:.2,z:2});
  });await sleep(200);
  const shape=id=>page.evaluate(id=>window.__ayunpad.doc().shapes.get(id),id);
  const dbl=async id=>{
    const s=await shape(id),pos=await page.$eval('.shapes-layer',(el,s)=>{const r=el.getBoundingClientRect(),scale=r.width/el.offsetWidth,px=96/25.4;return{x:r.x+(s.a.x+s.b.x)/2*px*scale,y:r.y+(s.a.y+s.b.y)/2*px*scale};},s);
    const scroll=await page.$eval('.desk',e=>e.scrollTop);await page.mouse.click(pos.x,pos.y);await sleep(80);await page.mouse.click(pos.x,pos.y);await page.waitForSelector(`.tbox.tedit[data-sid="${id}"]`,{timeout:5000}).catch(async error=>{console.log(await page.evaluate(pos=>({pos,under:document.elementFromPoint(pos.x,pos.y)?.outerHTML.slice(0,400),boxes:[...document.querySelectorAll('.tbox')].map(e=>e.outerHTML.slice(0,180))}),pos));await page.screenshot({path:'/tmp/shape-text-failure.png'});throw error;});await sleep(100);assert.equal(await page.$eval('.desk',e=>e.scrollTop),scroll);
  };
  await dbl('rect-label');await page.keyboard.type('AAA BBB');await page.keyboard.press('Enter');await page.keyboard.type('second line');
  assert.equal((await shape('rect-label')).frame,'rect');assert.equal((await shape('rect-label')).stroke,'r');assert.equal((await shape('rect-label')).fill,'y');assert.equal((await shape('rect-label')).dash,true);assert.equal((await shape('rect-label')).bw,55);
  // Select only AAA with a real drag so every formatting control uses the same selection semantics.
  const rect=await page.$eval('.tbox[data-sid="rect-label"] .ln',e=>{const t=e.firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,3);const b=r.getBoundingClientRect();return{x:b.x+.1,y:b.y+b.height/2,right:b.right};});
  await page.mouse.move(rect.x,rect.y);await page.mouse.down();await page.mouse.move(rect.right,rect.y,{steps:8});await page.mouse.up();assert.equal(await page.evaluate(()=>getSelection().toString()),'AAA');
  await page.click('.tb-bar-floating [aria-label="보라 글자"]');await page.click('.tb-bar-floating [aria-label="글씨 크게"]');
  await page.keyboard.down('Alt');await page.keyboard.press('KeyT');await page.keyboard.up('Alt');await page.waitForSelector('#ty-track');
  const set=async (id,value)=>page.$eval(id,(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await set('#ty-track','.08');await set('#ty-pitch','5');await sleep(200);
  const styled=await shape('rect-label'),nodes=styled.doc.content[0].content;
  assert.equal(nodes[0].text,'AAA');assert.ok(nodes[0].marks.some(m=>m.type==='pen'&&m.attrs.c==='p'));assert.ok(nodes[0].marks.some(m=>m.type==='size'&&m.attrs.v===1.1));assert.ok(nodes[0].marks.some(m=>m.type==='track'&&m.attrs.v===.08));assert.ok(!nodes.at(-1).marks?.length);
  assert.ok(styled.doc.content[0].attrs.leading>1);assert.equal(styled.doc.content[1].attrs.leading,null);assert.equal(styled.stroke,'r');
  assert.equal(await page.$eval('.tbox[data-sid="rect-label"]',e=>getComputedStyle(e).borderTopStyle),'dashed');
  await page.click('.panel .close');await page.keyboard.press('Escape');
  console.log('ok  네모 내부 더블클릭·직접 입력 · 선택한 글자색/크기/자간·선택 줄 행간 · 테두리와 채우기 보존 · 스크롤 유지');
  await dbl('ellipse-label');await page.keyboard.type('원 안의 글자');
  await page.keyboard.down('Meta');await page.keyboard.press('KeyZ');await page.keyboard.up('Meta');await sleep(100);assert.equal((await shape('ellipse-label')).text,'');
  await page.keyboard.down('Meta');await page.keyboard.press('KeyZ');await page.keyboard.up('Meta');await sleep(100);assert.equal((await shape('ellipse-label')).t,'ellipse');
  await page.keyboard.press('Escape');await dbl('ellipse-label');await page.keyboard.type('원 안의 글자');await page.keyboard.press('Escape');
  assert.equal((await shape('ellipse-label')).frame,'ellipse');assert.equal(await page.$eval('.tbox[data-sid="ellipse-label"]',e=>getComputedStyle(e).borderRadius),'50%');
  await dbl('empty-label');await page.keyboard.press('Escape');await sleep(100);assert.equal((await shape('empty-label')).frame,'rect');assert.equal((await shape('empty-label')).text,'');
  console.log('ok  원 안에도 동일한 편집기 · 글이 없어도 도형 유지');
  // Resize a converted shape with its original corner handles.
  await page.click('.tbox[data-sid="ellipse-label"]');await sleep(100);
  const handles=await page.$$eval('.sh-handle',es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));assert.equal(handles.length,8);
  const before=await shape('ellipse-label');await page.mouse.move(handles[2].x,handles[2].y);await page.mouse.down();await page.mouse.move(handles[2].x+30,handles[2].y+20,{steps:8});await page.mouse.up();await sleep(150);
  assert.ok((await shape('ellipse-label')).bw>before.bw);assert.ok((await shape('ellipse-label')).bh>before.bh);assert.equal((await shape('ellipse-label')).text,before.text);
  await page.click('.drawbar button[title^="복제"]');await sleep(100);
  const copies=await page.evaluate(()=>[...window.__ayunpad.doc().shapes.values()].filter(s=>s.t==='text'&&s.frame==='ellipse'));
  assert.equal(copies.length,2);assert.equal(copies[0].text,copies[1].text);assert.equal(copies[0].stroke,copies[1].stroke);assert.deepEqual(copies[0].doc,copies[1].doc);
  console.log('ok  도형 변환·입력 되돌리기 · 8개 손잡이 크기 조절 · 복제 시 도형과 내용 함께 유지');
  await page.click('.paper-width-options button:last-child');await page.waitForSelector('.fold-live-window');
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));await page.waitForSelector('.print-root .shape-text');
  assert.ok(await page.$('.print-root .shape-text .tb-edit'));
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  const saved=await shape('rect-label');await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.tbox[data-sid="rect-label"]');assert.deepEqual(await shape('rect-label'),saved);
  console.log('ok  한 장 보기·인쇄에 도형과 글 함께 표시 · 새로고침 뒤 내용과 서식 보존');
  await page.click('.paper-width-options button:first-child');await sleep(100);
  await page.keyboard.down('Alt');await page.keyboard.press('KeyD');await page.keyboard.up('Alt');await page.keyboard.press('KeyR');await page.waitForSelector('.shapes-layer.tool-rect');
  const points=await page.$eval('.shapes-layer',e=>{const r=e.getBoundingClientRect(),scale=r.width/e.offsetWidth*96/25.4;return{a:{x:r.x+72*scale,y:r.y+60*scale},b:{x:r.x+94*scale,y:r.y+80*scale}};});
  const ids=await page.evaluate(()=>[...window.__ayunpad.doc().shapes.keys()]);
  await page.mouse.move(points.a.x,points.a.y);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y,{steps:8});await page.mouse.up();await sleep(100);
  const fresh=await page.evaluate(ids=>[...window.__ayunpad.doc().shapes.values()].find(s=>!ids.includes(s.id)),ids);assert.equal(fresh.t,'rect');
  await dbl(fresh.id);await page.keyboard.type('새 도형');assert.equal((await shape(fresh.id)).text,'새 도형');
  await page.screenshot({path:'/tmp/ayunpad-shape-text.png'});
  assert.deepEqual(errors,[]);console.log('ok  마우스로 새 네모 그리기→더블클릭→글 입력 · 실행 오류 없음');
} finally {await browser?.close();server.kill();}
