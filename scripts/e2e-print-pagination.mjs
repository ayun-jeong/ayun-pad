import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {mkdirSync} from 'node:fs';import puppeteer from 'puppeteer-core';
const url=process.env.E2E_URL??'http://localhost:4376/ayun-pad/',server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4376','--strictPort'],{stdio:'ignore'}),sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(200);}
 browser=await puppeteer.launch({executablePath:process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.editor');await page.$eval('.addnote',e=>e.click());await page.waitForSelector('.sheet-src');
 await page.evaluate(()=>{const d=window.__ayunpad.doc(),a=(x,y)=>({l:null,r:0,x,y});d.meta.set('halves',4);for(let i=0;i<4;i++)d.shapes.set(`print-half-${i}`,{id:`print-half-${i}`,t:'text',a:a(8,i*291+15),bw:70,c:'k',w:.2,z:i,text:`HALF ${i+1}`,doc:{type:'doc',content:[{type:'line',attrs:{id:`label-${i}`},content:[{type:'text',text:`HALF ${i+1}`}]}]}});});await page.waitForFunction(()=>document.querySelector('.sheet-src').dataset.halves==='4');
 mkdirSync('/tmp/ayun-pad-print',{recursive:true});
 const pdf=async(name,expected)=>{const file=`/tmp/ayun-pad-print/${name}.pdf`;await page.pdf({path:file,format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});const pages=Number(info.match(/Pages:\s*(\d+)/)[1]);console.log(name,pages);assert.equal(pages,expected,`${name}: actual PDF pages`);return file;};
 await pdf('half-edit',2);
 await page.click('.paper-width-options button:last-child');await page.waitForSelector('.fold-live-window');await pdf('a4-edit',2);
 await page.click('.top .read-btn');await pdf('a4-read',2);
 await page.click('.paper-width-options button:first-child');await pdf('half-read',2);
 // Odd and even counts must share the same pairing rule, with no phantom last sheet.
 for(const n of [1,2,3,5,6]){
  await page.evaluate(n=>{const d=window.__ayunpad.doc(),a=(x,y)=>({l:null,r:0,x,y});d.shapes.clear();d.meta.set('halves',n);for(let i=0;i<n;i++)d.shapes.set(`count-${i}`,{id:`count-${i}`,t:'text',a:a(8,i*291+15),bw:70,c:'k',w:.2,z:i,text:`HALF ${i+1}`});},n);
  await page.waitForFunction(n=>document.querySelector('.sheet-src').dataset.halves===String(n),{},n);
  await pdf(`halves-${n}`,Math.ceil(n/2));
 }
 assert.deepEqual(errors,[]);console.log('ok four note halves print as two physical A4 sheets in half/A4 editing and reading modes');
}finally{await browser?.close();server.kill();}
