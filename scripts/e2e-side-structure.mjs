import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
const url=process.env.E2E_URL??'http://localhost:4370/ayun-pad/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4370','--strictPort'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
  browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:1100});await page.goto(url,{waitUntil:'networkidle0'});
  await page.waitForSelector('.editor');await page.evaluate(async()=>await window.__ayunpad.doc().ready);
  await page.$eval('.addnote',e=>e.click());await page.waitForSelector('.shapes-layer');
  const line=(id,text,depth,side=false)=>({type:'line',attrs:{id,depth,side,kind:'branch'},content:[{type:'text',text}]});
  const seed=async content=>{
    await page.evaluate(content=>{
      const m=window.__ayunpad.doc().shapes;m.clear();m.set('side-test',{id:'side-test',t:'text',a:{l:null,r:0,x:4,y:10},bw:90,c:'k',w:.2,z:0,text:'tree',doc:{type:'doc',content}});
    },content);
    await page.waitForSelector('.tbox[data-sid="side-test"] .ln');await sleep(100);
    if(await page.$('.top .read-btn.on'))await page.click('.top .read-btn');
    await page.$eval('.tbox[data-sid="side-test"] .tb-edit',el=>el.focus({preventScroll:true}));await page.waitForSelector('.tbox.tedit .tb-edit');
  };
  const end=async id=>{
    await page.$eval(`.tbox.tedit .tb-edit [data-id="${id}"]`,el=>{
      el.closest('[contenteditable="true"]').focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);
    });
  };
  const rows=()=>page.evaluate(()=>window.__ayunpad.doc().shapes.get('side-test').doc.content.map(n=>({text:n.content?.map(n=>n.text??'').join('')??'',depth:n.attrs.depth,side:n.attrs.side,id:n.attrs.id})));
  const geometry=()=>page.$$eval('.tbox.tedit .tb-edit .ln',els=>els.map(el=>{
    const box=el.getBoundingClientRect(),r=document.createRange();r.selectNodeContents(el);
    return{y:box.y,bottom:box.bottom,x:r.getBoundingClientRect().x,text:el.textContent};
  }));
  await seed([line('ai','AI 활용–기물용',2),line('wildfire','산불 조기 대응 시스템: 송전철탑과 카메라 영상 분석',3),line('forecast','AI 고독사 예방 서비스: 설명',3)]);
  await end('ai');await page.keyboard.press('Enter');await sleep(250);
  let data=await rows();assert.deepEqual(data.map(n=>[n.text,n.depth,n.side]),[['AI 활용',2,true],['기물용',3,false],['',3,false],['산불 조기 대응 시스템: 송전철탑과 카메라 영상 분석',3,false],['AI 고독사 예방 서비스: 설명',3,false]]);
  let g=await geometry();assert.ok(Math.abs(g[2].y-g[1].bottom)<1,'새 빈 형제가 첫 옆 항목 바로 아래에 배치');
  const blankLayers=()=>page.$$eval('.tbox.tedit .tb-edit .ln',els=>(getComputedStyle(els[2]).backgroundImage.match(/linear-gradient/g)??[]).length);
  const activeLayers=await blankLayers();assert.ok(activeLayers>=2,'Enter 직후 글자가 없는 가지에도 꺾쇠가 즉시 보임');
  await page.keyboard.press('Tab');assert.ok(await blankLayers()>=2,'Tab으로 만든 빈 하위 가지도 보임');
  assert.equal((await rows())[2].depth,4);await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  assert.equal((await rows())[2].depth,3);
  await page.$eval('.tbox.tedit .tb-edit',el=>el.blur());await sleep(100);
  const idleLayers=await page.$$eval('.tbox[data-sid="side-test"] .ln',els=>(getComputedStyle(els[2]).backgroundImage.match(/linear-gradient/g)??[]).length);
  assert.ok(idleLayers<activeLayers,'커서가 벗어나면 빈 꺾쇠만 숨김');
  await page.$eval('.tbox[data-sid="side-test"] .tb-edit',el=>el.focus());await sleep(100);
  assert.equal(await blankLayers(),activeLayers,'다시 입력할 때 빈 가지 표시 복원');
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
  assert.equal(await page.$$eval('.print-root .tbox[data-sid="side-test"] .ln',els=>(getComputedStyle(els[2]).backgroundImage.match(/linear-gradient/g)??[]).length),idleLayers,'입력 중 인쇄해도 빈 꼬리는 제외');
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));

  await page.keyboard.type('새 형제');await sleep(200);g=await geometry();assert.ok(Math.abs(g[1].x-g[2].x)<1,'새 항목 글 시작점이 같은 수직선에 정렬');
  assert.equal((await rows())[3].id,'wildfire');await page.screenshot({path:'/tmp/ayun-pad-side-enter.png'});
  // 이미 분리된 중첩 옆가지의 부모 끝에서 Enter: 하위 트리를 보존한다.
  await page.click('.top .read-btn');await page.click('.top .read-btn');
  await seed([line('a','A',1,true),line('b','B',2,true),line('c','C',3),line('detail','C의 설명',4),line('sibling','기존 형제',3)]);
  await end('a');await page.keyboard.press('Enter');await page.keyboard.type('새 형제');await sleep(200);
  data=await rows();assert.deepEqual(data.map(n=>[n.text,n.depth]),[['A',1],['B',2],['C',3],['C의 설명',4],['새 형제',3],['기존 형제',3]]);
  assert.equal(data[3].id,'detail');
  const saved=await page.evaluate(()=>window.__ayunpad.doc().shapes.get('side-test').doc);
  await page.click('.paper-width-options button:last-child');await page.waitForSelector('.fold-live-window');await page.click('.top .read-btn');
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.tbox[data-sid="side-test"] .ln');
  assert.deepEqual(await page.evaluate(()=>window.__ayunpad.doc().shapes.get('side-test').doc),saved);
  assert.deepEqual(errors,[]);console.log('ok inline side branches with existing children: immediate sibling placement/alignment; nested parent Enter preserves subtrees; A4/read/reload persist');
} finally {await browser?.close();server.kill();}
