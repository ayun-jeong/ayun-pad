// 실제 크롬으로 앱을 열어 1단계 완료 기준을 확인한다.
// 사용: npm run build && node scripts/e2e.mjs [스크린샷 경로]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4317;
// E2E_URL을 주면 그 주소(예: 실제 사이트)로 시험하고, 없으면 빌드 결과를 로컬에서 띄운다.
const URL = process.env.E2E_URL ?? `http://localhost:${PORT}/ayun-pad/`;
const shot = process.argv[2];

const server = process.env.E2E_URL ? { kill() {} } : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

const lines = (page) =>
  page.$$eval('.editor > p', (els) =>
    els.map((e) => ({
      d: Number(e.dataset.depth),
      k: e.dataset.kind,
      t: e.textContent,
      bg: (e.getAttribute('style') || '').includes('gradient'),
      red: [...e.querySelectorAll('.a-red')].map((x) => x.textContent).join(''),
      hl: [...e.querySelectorAll('.hl')].map((x) => x.className.match(/hl-[a-z]/)?.[0] ?? '').join(' '),
      pen: [...e.querySelectorAll('[data-pen]')].map((x) => `${x.dataset.pen}:${x.textContent}`).join(' '),
      mhl: [...e.querySelectorAll('[data-hl]')].map((x) => `${x.dataset.hl}:${x.textContent}`).join(' '),
    })),
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await waitServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await sleep(300);

  // 1) 처음 열면 견본 노트가 자동 규칙대로 칠해져 있다
  let L = await lines(page);
  check(L.length === 11, `견본 노트 11줄 (${L.length})`);
  check(L[0].red === '경영학' && L[0].hl === 'hl-r', '대제목 경영학: 빨강 + 빨강 형광펜');
  check(L[1].red === '마케팅' && L[1].hl === 'hl-y' && L[1].bg, '마케팅: 빨강 + 노랑 형광펜 + 가지선');
  check(L[2].red === 'STP 전략' && L[2].hl === 'hl-b', 'STP 전략: 콜론 앞만 빨강 + 파랑 형광펜');
  check(L[8].hl === 'hl-p', '깊이 5 단점: 보라 형광펜');
  check(L[10].red === '' && L[10].hl === '', '보통 줄 면접은…: 검정, 형광펜 없음');

  // 2) 새 노트에 경영학 예시를 키보드만으로 쓴다
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1);
  await page.click('.editor');
  const k = page.keyboard;
  await k.type('경영학');
  await k.press('Enter');
  await k.type('- 마케팅');
  await k.press('Enter');
  await k.press('Tab');
  await k.type('STP 전략: 세분화 -> 표적 -> 포지셔닝');
  await k.press('Enter');
  await k.type('4P 전략: 제품');
  await k.press('Enter');
  await k.down('Shift');
  await k.press('Tab');
  await k.up('Shift');
  await k.type('인사관리');
  await k.press('Enter');
  await k.press('Tab');
  await k.type('모집: 사기<| 비용|>');
  await k.press('Enter');
  await k.type('선발');
  await k.press('Enter');
  await k.press('Tab');
  await k.press('Backspace'); // 꺾쇠 바로 뒤 ⌫ → 보통 줄
  await k.type('면접은 구조화할수록 타당도가 높다');
  await sleep(200);
  L = await lines(page);
  const shape = L.map((l) => `${l.d}${l.k === 'branch' ? 'b' : 'p'}`).join(' ');
  check(shape === '1p 2b 3b 3b 2b 3b 3b 4p', `깊이·꺾쇠 구조 (${shape})`);
  check(L[2]?.t === 'STP 전략: 세분화 → 표적 → 포지셔닝', `-> 가 → 로 바뀜 (${L[2]?.t})`);
  check(L[5]?.t === '모집: 사기↑ 비용↓', `<| |> 가 ↑ ↓ 로 바뀜 (${L[5]?.t})`);
  check(L[0]?.red === '경영학' && L[0]?.hl === 'hl-r', '설정 없이 대제목이 빨강 + 빨강 형광펜');
  check(L[1]?.red === '마케팅' && L[1]?.hl === 'hl-y', '설정 없이 꺾쇠 줄 마케팅이 빨강 + 노랑 형광펜');
  check(L[2]?.red === 'STP 전략' && L[2]?.hl === 'hl-b', '설정 없이 깊이 3이 파랑 형광펜');
  check(L[7]?.red === '' && L[7]?.hl === '', '꺾쇠를 푼 보통 줄은 검정');
  check(L.slice(1, 7).every((l) => l.bg), '꺾쇠 줄마다 빨간 가지선');

  // 3) 펜 단축키: 선택 없이 ⌥R → 빨간 펜을 든 채로 친 글자는 빨강, 한 번 더 ⌥R → 자동 펜
  await k.press('Enter');
  await k.down('Alt');
  await k.press('KeyR');
  await k.up('Alt');
  await k.type('빨간 펜');
  await k.down('Alt');
  await k.press('KeyR');
  await k.up('Alt');
  await k.type(' 자동');
  await sleep(100);
  L = await lines(page);
  check(L[8]?.pen === 'r:빨간 펜', `⌥R 빨간 펜으로 친 글자 (${L[8]?.pen})`);
  check(L[8]?.t === '빨간 펜 자동', `펜을 내려놓은 뒤 글자 (${L[8]?.t})`);

  // 4) ⌥⇧G: 선택 없이 누르면 그 줄 주제어에 초록 형광펜
  await sleep(700); // 되돌리기는 0.5초 넘게 쉰 곳에서 끊긴다(실제로 칠 때처럼)
  const moZip = (await page.$$('.editor > p'))[5];
  await moZip.click();
  await sleep(100);
  const where = await page.evaluate(() => getSelection().anchorNode?.parentElement?.closest('p')?.textContent);
  check(where === '모집: 사기↑ 비용↓', `커서가 모집 줄에 있음 (${where})`);
  await k.down('Alt');
  await k.down('Shift');
  await k.press('KeyG');
  await k.up('Shift');
  await k.up('Alt');
  await sleep(100);
  L = await lines(page);
  check(L[5]?.mhl === 'g:모집', `⌥⇧G 주제어에 초록 형광펜 (${L[5]?.mhl})`);

  // 5) 되돌리기 · 다시 하기
  const meta = (await page.evaluate(() => /Mac/.test(navigator.platform))) ? 'Meta' : 'Control';
  await k.down(meta);
  await k.press('KeyZ');
  await k.up(meta);
  await sleep(100);
  L = await lines(page);
  check(L[5]?.mhl === '', `⌘Z로 형광펜 되돌림 (${L[5]?.mhl} / ${L.map((l) => l.t).join(' | ')})`);
  await k.down(meta);
  await k.down('Shift');
  await k.press('KeyZ');
  await k.up('Shift');
  await k.up(meta);
  await sleep(100);
  L = await lines(page);
  check(L[5]?.mhl === 'g:모집', '⌘⇧Z로 다시 하기');

  // 5-1) 새 노트에서 처음 친 글자를 되돌려도 빈 줄 하나는 남는다
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('가나다');
  await sleep(700);
  await k.down(meta);
  await k.press('KeyZ');
  await k.up(meta);
  await sleep(200);
  const empty = await page.$$eval('.editor > p', (els) => els.map((e) => e.textContent));
  check(empty.length === 1 && empty[0] === '', `새 노트 첫 입력을 되돌리면 빈 줄 하나 (${JSON.stringify(empty)})`);
  await k.type('다시 씀');
  await sleep(100);
  check((await page.$eval('.editor', (e) => e.textContent)) === '다시 씀', '되돌린 뒤에도 바로 이어서 쓸 수 있음');
  // 앞의 노트로 돌아간다
  await page.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '새 노트')?.click());
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length >= 9);
  await sleep(300);

  // 6) 새로고침해도 그대로
  await sleep(600);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await sleep(400);
  const after = await lines(page);
  check(after.length === L.length && after.every((l, i) => l.t === L[i].t && l.d === L[i].d && l.k === L[i].k), `새로고침 뒤 내용 보존 (${after.length}줄)`);

  if (shot) {
    const el = await page.$('.paper');
    await el.screenshot({ path: shot });
  }

  // 7) 2단계: 반쪽 보기 · A4 합침 보기 · 인쇄가 편집 화면과 줄 단위까지 같은지.
  // 200줄을 붙여넣는다(줄 하나 = 한 줄 높이). 촘촘 기본값은 반쪽 81줄 → 3반쪽, A4 2장.
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    v.focus();
    v.pasteText(Array.from({ length: 200 }, (_, i) => `줄 ${i + 1}`).join('\n'));
  });
  await sleep(400);
  check((await page.$$eval('.editor > p', (els) => els.length)) === 200, '200줄 붙여넣기');
  const edit = await page.evaluate(() => {
    const ps = document.querySelectorAll('.editor > p');
    const g = [...document.querySelectorAll('.guide')].map((x) => x.getBoundingClientRect().top);
    return { guides: g.length, gap1: Math.abs(ps[81].getBoundingClientRect().top - g[0]), gap2: Math.abs(ps[162].getBoundingClientRect().top - g[1]) };
  });
  check(edit.guides === 2 && edit.gap1 < 2 && edit.gap2 < 2, `편집 화면 반쪽 경계 점선이 82번째·163번째 줄 바로 위 (${JSON.stringify(edit)})`);

  const alt = async (code) => {
    await k.down('Alt');
    await k.press(code);
    await k.up('Alt');
  };
  await alt('Digit2');
  await page.waitForSelector('.pages.half .phalf');
  await sleep(200);
  const halves = await page.$$eval('.pages.half .phalf', (hs) =>
    hs.map((h) => {
      const win = h.querySelector('.pwin').getBoundingClientRect();
      const vis = [...h.querySelectorAll('.editor > p')]
        .map((p, i) => [i, p.getBoundingClientRect()])
        .filter(([, r]) => r.bottom > win.top + 1 && r.top < win.bottom - 1)
        .map(([i]) => i);
      return [vis[0], vis[vis.length - 1]];
    }),
  );
  check(JSON.stringify(halves) === '[[0,80],[81,161],[162,199]]', `반쪽 보기: 1-1 1~81줄 · 1-2 82~162줄 · 2-1 163~200줄 (${JSON.stringify(halves)})`);

  await alt('Digit3');
  await page.waitForSelector('.pages.a4 .psheet');
  await sleep(200);
  const sheets = await page.$$eval('.pages.a4 .psheet', (s) => s.map((x) => x.querySelectorAll('.phalf:not(.blank)').length));
  check(JSON.stringify(sheets) === '[2,1]', `A4 합침 보기 2장 (${JSON.stringify(sheets)})`);

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  check((await page.$$eval('.print-root .psheet', (s) => s.length)) === 2, '인쇄용 A4 2장');
  const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: false })).toString('latin1');
  const pdfPages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const mb = pdf.match(/\/MediaBox\s*\[\s*([\d.\s]+)\]/)[1].trim().split(/\s+/).map(Number);
  const mm = [((mb[2] - mb[0]) / 72) * 25.4, ((mb[3] - mb[1]) / 72) * 25.4];
  check(pdfPages === 2 && Math.abs(mm[0] - 210) < 0.5 && Math.abs(mm[1] - 297) < 0.5, `PDF A4 2쪽 (${pdfPages}쪽, ${mm.map((x) => x.toFixed(1)).join('×')}mm)`);
  if (shot) fs.writeFileSync(path.join(path.dirname(shot), 'e2e-long.pdf'), Buffer.from(pdf, 'latin1'));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  // 보기 화면에서 줄을 누르면 편집 화면의 그 줄로
  const target = await page.evaluateHandle(() => document.querySelectorAll('.pages.a4 .psheet')[1].querySelectorAll('.editor > p')[169]);
  await target.click();
  await page.waitForFunction(() => !document.querySelector('.pages'));
  await sleep(150);
  const at = await page.evaluate(() => getSelection().anchorNode?.parentElement?.closest('p')?.textContent ?? getSelection().anchorNode?.textContent);
  check(at === '줄 170', `A4 보기에서 누른 줄로 편집 열림 (${at})`);

  // 견본 노트 인쇄(눈으로 보는 용)
  await page.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '견본 · 경영학')?.click());
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 11);
  await sleep(300);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const pdf2 = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  if (shot) fs.writeFileSync(path.join(path.dirname(shot), 'e2e-sample.pdf'), pdf2);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  // 화살표 자동 변환(사용자 추가 요청): <-> <|> <= => <=> 도 바뀐다
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('a<->b c<|>d e<=f g=>h 수요<=>공급 x<-y z->w');
  await sleep(150);
  const arrowsLine = await page.$eval('.editor > p', (e) => e.textContent);
  check(arrowsLine === 'a↔b c↕d e⇐f g⇒h 수요⇔공급 x←y z→w', `<-> <|> <= => <=> → ↔ ↕ ⇐ ⇒ ⇔ (${arrowsLine})`);
  await k.press('Backspace'); // 바로 ⌫는 마지막 글자 지우기(변환 직후가 아니므로)
  await k.type('<=');
  await k.press('Backspace');
  await sleep(100);
  const undone = await page.$eval('.editor > p', (e) => e.textContent);
  check(undone.endsWith('z→<='), `변환 직후 ⌫ → 친 그대로 (${undone.slice(-6)})`);

  check(errors.length === 0, `콘솔 오류 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  await browser.close();
} catch (e) {
  console.log(`FAIL 예외: ${e?.message ?? e}`);
  fails.push(String(e));
} finally {
  server.kill();
}
console.log(fails.length ? `\n${fails.length}개 실패` : '\n전부 통과');
process.exit(fails.length ? 1 : 0);
