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

  // 한글 조합 뒤 색이 멈춰 있지 않기: 조합 중 표시가 남은 채로 줄 끝에 ':'를 쳐도 바로 빨강
  await k.press('Enter');
  await k.type('테스트 하는 중');
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    const key = v.state.plugins.find((p) => p.key.startsWith('auto$')).spec.key;
    v.dispatch(v.state.tr.setMeta(key, { composing: true })); // 조합 표시가 남은 상황을 흉내
  });
  await k.type(':');
  await sleep(100);
  const colonRed = await page.$$eval('.editor > p', (ps) => [...ps[ps.length - 1].querySelectorAll('.a-red')].map((x) => x.textContent).join(''));
  check(colonRed === '테스트 하는 중', `띄어쓰기 있는 줄도 ':' 앞은 바로 빨강 (${colonRed})`);

  // 옆 가지(⌥Tab): 경영학 ┬─ 마케팅 / ├─ 인사관리 / └─ 재무관리
  const altTab = async () => {
    await k.down('Alt');
    await k.press('Tab');
    await k.up('Alt');
  };
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('경영학');
  await altTab();
  await k.type('마케팅');
  await k.press('Enter');
  await k.type('인사관리');
  await k.press('Enter');
  await k.type('재무관리');
  await sleep(300);
  const geo = () =>
    page.$$eval('.editor > p', (ps) =>
      ps.map((p) => {
        const r = document.createRange();
        r.selectNodeContents(p);
        const rs = [...r.getClientRects()];
        return { t: p.textContent, top: Math.round(p.getBoundingClientRect().top), left: Math.round(rs[0]?.left ?? 0), right: Math.round(rs[rs.length - 1]?.right ?? 0), k: p.dataset.kind };
      }),
    );
  let G = await geo();
  check(G.length === 4 && G[1].top === G[0].top && G[1].left > G[0].right, `첫 옆 가지는 부모 글 바로 옆 같은 줄 (${JSON.stringify(G.slice(0, 2))})`);
  check(Math.abs(G[2].left - G[1].left) <= 1 && Math.abs(G[3].left - G[1].left) <= 1 && G[2].top > G[1].top, `다음 항목은 아래에 같은 x로 정렬 (${G.map((g) => g.left).join(',')})`);
  check(G.slice(1).every((g) => g.k === 'branch'), '옆 가지 항목은 꺾쇠 줄(자동 빨강 · 형광펜)');
  const firstBg = await page.$eval('.editor > p:nth-child(2)', (p) => p.getAttribute('style') ?? '');
  check(firstBg.includes('margin-top') && firstBg.includes('gradient'), '┬─ 가지선이 그려짐');
  // 부모 글이 길어지면 옆 가지도 따라 옮겨진다
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    v.dispatch(v.state.tr.insertText(' 원론', v.state.doc.child(0).nodeSize - 1));
  });
  await sleep(300);
  const G2 = await geo();
  check(G2[1].left > G[1].left + 5 && G2[1].left > G2[0].right && Math.abs(G2[3].left - G2[1].left) <= 1, `부모 글이 길어지면 옆 가지가 따라감 (${G[1].left} → ${G2[1].left})`);
  // ⌥] 를 부모 줄에서 → 아래로, 한 번 더 → 옆으로
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, 2)));
    v.focus();
  });
  await altTab();
  await sleep(300);
  G = await geo();
  check(G[1].top > G[0].top && G[1].left < G2[1].left, `부모 줄에서 ⌥Tab → 자식을 아래로 (${G[1].top} > ${G[0].top})`);
  await altTab();
  await sleep(300);
  G = await geo();
  check(G[1].top === G[0].top, '⌥Tab 한 번 더 → 다시 옆으로');
  // A4 보기에도 같은 모양
  await alt('Digit3');
  await page.waitForSelector('.pages.a4 .psheet');
  await sleep(200);
  const a4 = await page.$$eval('.pages.a4 .psheet .editor > p', (ps) => ps.slice(0, 2).map((p) => Math.round(p.getBoundingClientRect().top)));
  check(a4[0] === a4[1], `A4 보기에서도 첫 옆 가지가 부모와 같은 줄 (${a4.join(',')})`);
  await alt('Digit1');
  await sleep(200);

  // 9) 버그 고친 것들: 펜을 든 채 한글 조합, 위젯 · 칸을 고른 채 Enter, 위젯 옆 ⌫ · Delete, 칸 여러 개에 펜, 위젯 글칸 ⌘⇧Z
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  const cdp = await page.target().createCDPSession();
  const compose = async (steps) => {
    for (const s of steps) {
      await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
      await sleep(50);
    }
    await cdp.send('Input.insertText', { text: steps[steps.length - 1] });
    await sleep(120);
  };
  await alt('KeyR');
  await compose(['ㅎ', '하', '한']);
  await compose(['ㄱ', '그', '글']);
  const ime = await page.evaluate(() => {
    const n = window.__ayunpad.view().state.doc.child(0);
    const marks = [];
    n.forEach((c) => marks.push(c.marks.find((m) => m.type.name === 'pen')?.attrs.c ?? '-'));
    return { text: n.textContent, marks: marks.join('') };
  });
  check(ime.text === '한글' && ime.marks === 'r', `빨간 펜을 든 채 한글 조합이 안 깨짐 (${JSON.stringify(ime)})`);
  await alt('KeyA');
  // 그래프를 고른 채 Enter → 지우지 않고 아래 새 줄
  await k.press('Enter');
  await k.type('/그래프');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.editor .wg.graph');
  const blocks = () => page.evaluate(() => { const o = []; window.__ayunpad.view().state.doc.forEach((n) => o.push(n.type.name)); return o.join(','); });
  const selectNode = (name) =>
    page.evaluate((nm) => {
      const v = window.__ayunpad.view();
      let at = -1;
      v.state.doc.forEach((n, pos) => {
        if (n.type.name === nm && at < 0) at = pos;
      });
      v.focus();
      v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(at))));
      const NS = Object.getPrototypeOf(v.state.selection).constructor;
      return at;
    }, name);
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    let at = -1;
    v.state.doc.forEach((n, pos) => {
      if (n.type.name === 'graph') at = pos;
    });
    v.focus();
    // NodeSelection.create 대신: 위젯 앞 줄 끝에서 Delete 한 번 = 위젯 고르기
    const $end = v.state.doc.resolve(at - 1);
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, $end.pos)));
  });
  await k.press('Delete');
  await sleep(80);
  const selName = await page.evaluate(() => window.__ayunpad.view().state.selection.node?.type.name ?? '');
  check(selName === 'graph' && (await blocks()).includes('graph'), `위젯 앞 줄 끝 Delete → 위젯을 고르기만(안 지움) (${selName})`);
  await k.press('Enter');
  await sleep(80);
  const afterEnter = await blocks();
  check(afterEnter.includes('graph') && /graph,line/.test(afterEnter), `위젯을 고른 채 Enter → 지우지 않고 아래 새 줄 (${afterEnter})`);
  // 그래프 다음 줄 맨 앞 ⌫ → 고르기, 한 번 더 → 지움
  await k.press('Backspace');
  await sleep(60);
  const sel2 = await page.evaluate(() => window.__ayunpad.view().state.selection.node?.type.name ?? '');
  check(sel2 === 'graph' && (await blocks()).includes('graph'), `위젯 다음 줄 맨 앞 ⌫ → 위젯을 고르기만 (${sel2})`);
  await k.press('Backspace');
  await sleep(80);
  check(!(await blocks()).includes('graph'), '한 번 더 ⌫ → 위젯 지움');
  // 표: 칸 여러 개를 고른 채 Enter는 칸을 비우지 않고, 펜은 모든 칸에
  await k.type('/표 2x2');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.editor table');
  for (const t of ['aa', 'bb', 'cc', 'dd']) {
    await k.type(t);
    await k.press('Tab');
  }
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    const cells = [];
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'table_cell' || n.type.name === 'table_header') cells.push(pos);
      return n.type.name !== 'table_cell' && n.type.name !== 'table_header';
    });
    window.__cellRange = [cells[0], cells[cells.length - 1]];
  });
  const cellSelect = () =>
    page.evaluate(() => {
      const v = window.__ayunpad.view();
      const [a, b] = window.__cellRange;
      // 첫 칸에서 마지막 칸까지 끌어 고른 것과 같게(⇧+방향키로 칸 고르기)
      v.focus();
      v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(a + 2))));
    });
  await cellSelect();
  for (let i = 0; i < 4; i++) {
    await k.down('Shift');
    await k.press(i % 2 ? 'ArrowDown' : 'ArrowRight');
    await k.up('Shift');
  }
  await sleep(80);
  const multi = await page.evaluate(() => window.__ayunpad.view().state.selection.ranges.length);
  await k.press('Enter');
  await sleep(80);
  const cellTexts = await page.$$eval('.editor table td, .editor table th', (cs) => cs.map((c) => c.textContent).join(','));
  check(multi > 1 && cellTexts.includes('aa') && cellTexts.includes('dd'), `칸 여러 개를 고른 채 Enter → 칸 내용 그대로 (${multi}칸, ${cellTexts})`);
  await alt('KeyR');
  await sleep(80);
  const redCells = await page.$$eval('.editor table [data-pen="r"]', (e) => e.map((x) => x.textContent).join(','));
  check(redCells.split(',').length >= 2, `칸 여러 개에 ⌥R → 고른 칸 모두 빨강 (${redCells})`);

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
