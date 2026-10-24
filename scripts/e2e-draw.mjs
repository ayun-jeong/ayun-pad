// 4단계 시험: / 넣기 메뉴 · 표 · 연표 · 그래프 · 자유 경로 화살표 · 글상자 · 되돌리기 · 줄 따라가기 · 반쪽 밀기 · 인쇄
// 사용: npm run build && node scripts/e2e-draw.mjs [스크린샷 폴더]
import { spawn } from 'node:child_process';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4318;
const URL = process.env.E2E_URL ?? `http://localhost:${PORT}/ayun-pad/`;
const out = process.argv[2];
const server = process.env.E2E_URL ? { kill() {} } : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('preview server did not start');
}

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
  const k = page.keyboard;
  const meta = (await page.evaluate(() => /Mac/.test(navigator.platform))) ? 'Meta' : 'Control';
  const combo = async (mods, code) => {
    for (const m of mods) await k.down(m);
    await k.press(code);
    for (const m of [...mods].reverse()) await k.up(m);
  };
  const shapes = () => page.evaluate(() => Object.values(window.__ayunpad.doc().shapes.toJSON()));

  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('경영학 그림 시험');
  await k.press('Enter');

  // 1) / 메뉴: 초성으로 찾기
  await k.type('/ㅅㅇㄱㄱ');
  await page.waitForSelector('.slash button');
  const first = await page.$eval('.slash button.on b', (e) => e.textContent);
  check(first === '/수요공급', `초성 /ㅅㅇㄱㄱ → 수요공급이 맨 위 (${first})`);
  await k.press('Escape');
  await sleep(50);
  check(!(await page.$('.slash')), 'Esc로 메뉴 닫힘');
  for (let i = 0; i < 5; i++) await k.press('Backspace');

  // 2) 표: /표 2x3 → 2행 3열, 칸에서 Tab으로 다음 칸, 마지막 칸 Tab → 행 추가
  await k.type('/표 2x3');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.editor table');
  const cells = await page.$$eval('.editor table tr', (rs) => rs.map((r) => r.children.length));
  check(JSON.stringify(cells) === '[3,3]', `표 2행 3열 (${JSON.stringify(cells)})`);
  await k.type('구분');
  await k.press('Tab');
  await k.type('장점');
  await k.press('Tab');
  await k.type('단점');
  for (let i = 0; i < 3; i++) await k.press('Tab');
  await k.type('- 꺾쇠');
  await k.press('Tab');
  await sleep(100);
  const rows = await page.$$eval('.editor table tr', (rs) => rs.length);
  check(rows === 3, `마지막 칸에서 Tab → 행 추가 (${rows}행)`);
  const head = await page.$$eval('.editor table th', (c) => c.map((x) => x.textContent).join('|'));
  check(head === '구분|장점|단점', `머리 행 (${head})`);
  const cellBranch = await page.$eval('.editor table tr:nth-child(2) td:nth-child(3) p', (p) => ({ k: p.dataset.kind, red: p.querySelector('.a-red')?.textContent }));
  check(cellBranch.k === 'branch' && cellBranch.red === '꺾쇠', `표 칸 안에서도 '- ' → 꺾쇠 줄 + 자동 빨강 (${JSON.stringify(cellBranch)})`);

  // 3) 표 뒤 줄로 나가서 연표
  const after = await page.evaluateHandle(() => document.querySelector('.editor table').closest('.tableWrapper').nextElementSibling);
  await after.click();
  await k.type('/연표 1950 4 10');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.wg.tl');
  const vals = await page.$$eval('.wg.tl .tl-val .wg-ed', (e) => e.map((x) => x.textContent).join(' '));
  check(vals === '1950 1960 1970 1980 1990', `/연표 1950 4 10 → 1950~1990년 10년 간격 4칸 (${vals})`);
  // 사건 칸 고쳐 쓰기
  await page.click('.wg.tl .tl-lab .wg-ed');
  await k.type('외환위기');
  await k.press('Enter');
  await sleep(100);
  const tlData = await page.evaluate(() => {
    let d = null;
    window.__ayunpad.view().state.doc.forEach((n) => {
      if (n.type.name === 'tl') d = JSON.parse(n.attrs.data);
    });
    return d;
  });
  check(tlData?.labels?.[0] === '외환위기', `연표 사건 칸이 문서에 저장 (${tlData?.labels?.[0]})`);

  // 3-1) /수직선 10 → 0~10 (10등분), /연표 2016 10 → 2016~2026
  let ll = await page.evaluateHandle(() => [...document.querySelectorAll('.editor > p')].pop());
  await ll.click();
  await k.type('/수직선 10');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await sleep(150);
  const nl = await page.$$eval('.wg.tl', (ws) => ws.map((w) => [...w.querySelectorAll('.tl-val .wg-ed')].map((x) => x.textContent).join(',')));
  check(nl.includes('0,1,2,3,4,5,6,7,8,9,10'), `/수직선 10 → 0~10 (${nl[nl.length - 1]})`);
  ll = await page.evaluateHandle(() => [...document.querySelectorAll('.editor > p')].pop());
  await ll.click();
  await k.type('/연표 2016 10');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await sleep(150);
  const ch = await page.$$eval('.wg.tl', (ws) => ws.map((w) => [...w.querySelectorAll('.tl-val .wg-ed')].map((x) => x.textContent)));
  const last = ch[ch.length - 1];
  check(last.length === 11 && last[0] === '2016' && last[10] === '2026', `/연표 2016 10 → 2016~2026년 10칸 (${last.join(',')})`);
  await k.press('Escape');

  // 4) 그래프: 줄 하나 내려가서 /수요공급
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    const { TextSelection } = window.__pm ?? {};
    void TextSelection;
    v.focus();
  });
  const lastLine = await page.evaluateHandle(() => [...document.querySelectorAll('.editor > p')].pop());
  await lastLine.click();
  await k.type('/수요공급');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.wg.graph');
  const labs = await page.$$eval('.wg.graph .gr-lab', (e) => e.map((x) => x.textContent).join(','));
  check(labs.includes('D') && labs.includes('S') && labs.includes('E'), `수요공급 그래프 이름표 (${labs})`);
  const gh = await page.$eval('.wg.graph', (e) => e.offsetHeight / (96 / 25.4));
  const pitch = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.paper')).getPropertyValue('--lh')));
  check(Math.abs(gh - pitch * 12) < 0.2, `그래프 높이 = 12줄 (${gh.toFixed(2)}mm / 줄 ${pitch.toFixed(3)}mm)`);
  await k.type('그래프 아래 줄');

  // 5) 그리기: 자유 경로 화살표 — 시작점, 꺾는 점 하나, 끝점에서 두 번 누르기
  await combo(['Alt'], 'KeyD');
  await page.waitForSelector('.drawbar');
  check(await page.$eval('.shapes-layer', (e) => e.classList.contains('on') && e.classList.contains('tool-arrow')), '⌥D → 그리기(화살표 도구)');
  const box = await page.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, mmW: e.offsetWidth / (96 / 25.4), mmH: e.offsetHeight / (96 / 25.4) };
  });
  const at = (xmm, ymm) => [box.x + (xmm / box.mmW) * box.w, box.y + (ymm / box.mmH) * box.h];
  await page.mouse.click(...at(10, 2));
  await sleep(80);
  await page.mouse.move(...at(40, 2.5));
  await sleep(50);
  const prev = await page.$$eval('.shapes-svg polyline.sh-ui', (e) => e.length);
  check(prev === 1, '첫 점 뒤에 마우스를 따라오는 미리보기 선');
  const headsWhile = await page.$$eval('.shapes-svg polygon', (e) => e.length);
  check(headsWhile === 0, '그리는 중에는 화살촉 없음');
  await page.mouse.click(...at(40, 2));
  await sleep(450);
  await page.mouse.click(...at(40, 12), { count: 2 });
  await sleep(150);
  let S = await shapes();
  const arrow = S.find((s) => s.t === 'path');
  check(S.length === 1 && arrow?.pts.length === 3 && arrow.head === 1, `두 번 눌러 끝: 점 3개(겹친 점 없음) 화살표 (${S.length}개, 점 ${arrow?.pts.length})`);
  const headsAfter = await page.$$eval('.shapes-svg polygon', (e) => e.length);
  check(headsAfter === 1, '완성되면 끝점에 화살촉');
  check(await page.$eval('.shapes-layer', (e) => e.classList.contains('tool-select')), '다 그리면 고르기 도구로');

  // 6) ⌘Z / ⌘⇧Z 가 그림에도
  await combo([meta], 'KeyZ');
  await sleep(100);
  check((await shapes()).length === 0, '⌘Z → 화살표 되돌림');
  await combo([meta, 'Shift'], 'KeyZ');
  await sleep(100);
  check((await shapes()).length === 1, '⌘⇧Z → 다시');

  // 7) 직각 꺾기(H) + 끌어서 한 번에 곧은 화살표
  await k.press('KeyA');
  await k.press('KeyH');
  await page.mouse.move(...at(60, 20));
  await page.mouse.down();
  await page.mouse.move(...at(75, 21), { steps: 6 });
  await page.mouse.move(...at(85, 22), { steps: 6 });
  await page.mouse.up();
  await sleep(150);
  S = await shapes();
  const ortho = S.find((s) => s.t === 'path' && s.o);
  check(!!ortho && ortho.pts.length === 2 && Math.abs(ortho.pts[0].y - ortho.pts[1].y) < 0.01, `직각 모드에서 끌기 → 수평 화살표 (${JSON.stringify(ortho?.pts.map((p) => [p.x.toFixed(1), p.y.toFixed(1)]))})`);
  await k.press('KeyH');

  // 8) 네모(R) 끌기, 글상자(T)
  await k.press('KeyR');
  await page.mouse.move(...at(5, 30));
  await page.mouse.down();
  await page.mouse.move(...at(30, 40), { steps: 5 });
  await page.mouse.up();
  await sleep(100);
  await k.press('KeyT');
  await page.mouse.click(...at(55, 34));
  await page.waitForSelector('.tbox.tedit .tb-edit');
  await k.type('메모 -> ');
  await combo(['Alt'], 'KeyR');
  await k.type('중요');
  await k.press('Escape');
  await sleep(150);
  S = await shapes();
  const tb = S.find((s) => s.t === 'text');
  const tbPen = JSON.stringify(tb?.doc ?? {}).includes('"type":"pen"');
  check(S.some((s) => s.t === 'rect') && tb?.text === '메모 → 중요' && tbPen, `네모 + 글상자: 화살표 변환, 글상자 안에서 ⌥R 빨간 펜 (${tb?.text}, 펜 ${tbPen})`);
  check((await page.$eval('.tbox[data-sid] .pen-r', (e) => e.textContent).catch(() => '')) === '중요', '글상자에 빨간 글자로 보임');

  // 8-1) 꺾임 점 10개짜리 화살표 → 점 하나만 끌어 고치기, 굵기 단계 ]
  await k.press('KeyA');
  const zig = Array.from({ length: 11 }, (_, i) => [8 + i * 7, 46 + (i % 2) * 5]);
  for (const [x, y] of zig.slice(0, -1)) {
    await page.mouse.click(...at(x, y));
    await sleep(420);
  }
  await page.mouse.click(...at(...zig[10]), { count: 2 });
  await sleep(150);
  S = await shapes();
  const z = S.filter((s) => s.t === 'path').sort((a, b) => b.z - a.z)[0];
  check(z?.pts.length === 11, `꺾임 점 10개짜리 화살표 (점 ${z?.pts.length}개)`);
  await k.press('BracketRight');
  await sleep(80);
  check((await shapes()).find((s) => s.id === z.id)?.w === 0.5, '] → 굵기 0.35 → 0.5mm');
  const p5 = [...zig[5]];
  await page.mouse.move(...at(...p5));
  await page.mouse.down();
  await page.mouse.move(...at(p5[0], p5[1] + 8), { steps: 5 });
  await page.mouse.up();
  await sleep(100);
  const z2 = (await shapes()).find((s) => s.id === z.id);
  const movedPts = z2.pts.map((p, i) => Math.hypot(p.x - z.pts[i].x, p.y - z.pts[i].y) > 0.5);
  check(movedPts.filter(Boolean).length === 1 && movedPts[5], `점 하나(6번째)만 끌어서 고침 (${movedPts.map((m) => (m ? 1 : 0)).join('')})`);
  await page.$$eval('.drawbar.has-sel button', (bs) => bs.find((b) => b.textContent === '직각')?.click());
  await sleep(80);
  check((await shapes()).find((s) => s.id === z.id)?.o === true, '막대의 직각 경로 → 그린 화살표를 직선에서 직각으로');
  await k.press('Backspace');
  await sleep(80);

  // 9) 고르고 끌어 옮기기
  await k.press('KeyV');
  const before = (await shapes()).find((s) => s.t === 'rect');
  await page.mouse.move(...at(5, 35));
  await page.mouse.down();
  await page.mouse.move(...at(15, 37), { steps: 5 });
  await page.mouse.up();
  await sleep(100);
  const moved = (await shapes()).find((s) => s.t === 'rect');
  check(Math.abs(moved.a.x - before.a.x - 10) < 0.5, `네모 끌어 옮기기 (x ${before.a.x.toFixed(1)} → ${moved.a.x.toFixed(1)})`);

  // 10) 그리기 끝 → 맨 위에 줄을 끼우면 그림이 한 줄 내려간다
  await k.press('Escape');
  await k.press('Escape');
  await sleep(100);
  check(!(await page.$('.drawbar')), 'Esc → 그리기 끝');
  const y0 = await page.$eval('.shapes-svg g polyline', (e) => e.getAttribute('points'));
  const fb = await (await page.$('.editor > p')).boundingBox();
  await page.mouse.click(fb.x + 2, fb.y + fb.height / 2);
  // 커서를 확실히 첫 줄 맨 앞에(클릭 위치는 시험 대상이 아니다)
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    v.focus();
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atStart(v.state.doc)));
  });
  await k.press('Enter');
  await sleep(250);
  const y1 = await page.$eval('.shapes-svg g polyline', (e) => e.getAttribute('points'));
  const dy = Number(y1.split(' ')[0].split(',')[1]) - Number(y0.split(' ')[0].split(',')[1]);
  check(Math.abs(dy - pitch) < 0.05, `위에 줄을 끼우면 화살표가 한 줄(${pitch.toFixed(2)}mm) 내려감 (${dy.toFixed(3)}mm)`);

  if (out) await (await page.$('.paper')).screenshot({ path: path.join(out, 'e2e-draw.png') });

  // 11) A4 보기 · 인쇄에 그림이 같이 나온다
  await combo(['Alt'], 'Digit3');
  await page.waitForSelector('.pages.a4 .psheet');
  const inA4 = await page.$$eval('.pages .shapes-svg polyline, .pages .tbox', (e) => e.length);
  check(inA4 >= 3, `A4 보기에 그림 · 글상자 (${inA4})`);
  const noUi = await page.$$eval('.pages .sh-ui, .pages .wg-ctl', (e) => e.length);
  check(noUi === 0, '보기 화면에는 손잡이 · 버튼 없음');
  if (out) await (await page.$('.pages')).screenshot({ path: path.join(out, 'e2e-draw-a4.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const printed = await page.$$eval('.print-root .shapes-svg polyline', (e) => e.length);
  check(printed >= 2, `인쇄에도 그림 (${printed})`);
  if (out) {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    (await import('node:fs')).writeFileSync(path.join(out, 'e2e-draw.pdf'), pdf);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await combo(['Alt'], 'Digit1');
  await sleep(200);

  // 12) 새로고침해도 그림 · 위젯 그대로
  await sleep(600);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.wg.graph');
  await sleep(400);
  const kept = await page.evaluate(() => ({
    shapes: Object.keys(window.__ayunpad.doc().shapes.toJSON()).length,
    table: !!document.querySelector('.editor table'),
    tl: document.querySelector('.wg.tl .tl-lab .wg-ed')?.textContent,
    drawn: document.querySelectorAll('.shapes-svg [data-sid]').length + document.querySelectorAll('.tbox').length,
  }));
  check(kept.shapes === 4 && kept.table && kept.tl === '외환위기' && kept.drawn === 4, `새로고침 뒤 보존 (${JSON.stringify(kept)})`);

  // 13) 반쪽 경계에 걸린 그래프는 다음 반쪽 맨 위로
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    v.focus();
    v.pasteText(Array.from({ length: 76 }, (_, i) => `줄 ${i + 1}`).join('\n'));
  });
  await sleep(200);
  await k.press('Enter');
  await k.type('/그래프');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.wg.graph');
  await sleep(300);
  const push = await page.evaluate(() => {
    const g = document.querySelector('.wg.graph');
    const usable = (297 - 2 * 3) * (96 / 25.4);
    return { top: g.offsetTop / usable, margin: parseFloat(g.style.marginTop) || 0 };
  });
  check(Math.abs(push.top - 1) < 0.002 && push.margin > 0, `경계에 걸린 그래프가 다음 반쪽(1-2) 맨 위로 (${push.top.toFixed(4)} 반쪽, 민 높이 ${push.margin.toFixed(1)}px)`);

  // 14) '＋ 넣기' 판: 표 · 수직선(칸 수) · 연표(시작 연도 + 칸) · 그래프 · 도형
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('넣기 시험');
  const openInsert = async () => {
    await page.$$eval('.top .tbtn', (bs) => bs.find((b) => b.textContent.includes('넣기'))?.click());
    await page.waitForSelector('.panel.insert');
  };
  const setNum = async (label, v) => {
    const el = await page.$(`.panel.insert input[aria-label="${label}"]`);
    await el.click({ count: 3 });
    await el.type(String(v));
  };
  const rowBtn = (title, text) =>
    page.$$eval('.panel.insert .ins-row', (rows, [title, text]) => rows.find((r) => r.querySelector('b')?.textContent === title)?.querySelectorAll('button').forEach((b) => b.textContent.includes(text) && b.click()), [title, text]);
  await openInsert();
  await setNum('행', 2);
  await setNum('열', 2);
  await rowBtn('표', '넣기');
  await page.waitForSelector('.editor table');
  const t2 = await page.$$eval('.editor table tr', (rs) => rs.map((r) => r.children.length).join(','));
  check(t2 === '2,2' && !(await page.$('.panel.insert')), `넣기 판 → 2행 2열 표 (${t2})`);
  const toLastLine = async () => (await page.evaluateHandle(() => [...document.querySelectorAll('.editor > p')].pop())).click();
  await toLastLine();
  await openInsert();
  await setNum('칸 수', 5);
  await rowBtn('수직선', '넣기');
  await sleep(150);
  const nl5 = await page.$$eval('.wg.tl', (ws) => [...ws[ws.length - 1].querySelectorAll('.tl-val .wg-ed')].map((x) => x.textContent).join(','));
  check(nl5 === '0,1,2,3,4,5', `넣기 판 수직선 5칸 → 0~5 (${nl5})`);
  await toLastLine();
  await openInsert();
  await setNum('시작 연도', 2020);
  await setNum('칸 수(몇 년)', 3);
  await rowBtn('연표', '넣기');
  await sleep(150);
  const ch3 = await page.$$eval('.wg.tl', (ws) => [...ws[ws.length - 1].querySelectorAll('.tl-val .wg-ed')].map((x) => x.textContent).join(','));
  check(ch3 === '2020,2021,2022,2023', `넣기 판 연표 2020부터 3칸 (${ch3})`);
  await k.press('Escape');
  await toLastLine();
  await openInsert();
  await rowBtn('그래프', 'xy축');
  await sleep(150);
  check((await page.$$eval('.wg.graph', (g) => g.length)) === 1, '넣기 판 → xy축 그래프');
  await toLastLine();
  await openInsert();
  await rowBtn('그림', '네모');
  await sleep(100);
  check(await page.$eval('.shapes-layer', (e) => e.classList.contains('on') && e.classList.contains('tool-rect')), '넣기 판 네모 → 그리기(네모 도구)');
  await k.press('Escape');
  await k.press('Escape');
  await sleep(100);

  // 15) 글상자: 넣기 판에서 한 번 넣기 → 쓰고 나면 바로 글쓰기 / ⌥+클릭 / 누르면 고치기 · 손잡이로 옮기기 · 폭 · 지우기
  const L2 = await page.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
  });
  const mmX = (mm) => L2.x + (mm / L2.mmW) * L2.w;
  const pxPerMm = L2.w / L2.mmW;
  await toLastLine();
  await openInsert();
  await rowBtn('그림', '글상자');
  await sleep(80);
  check(!(await page.$('.drawbar')), '글상자 한 번 넣기에는 도구 막대 없음');
  await page.mouse.click(mmX(60), L2.y + 20 * pxPerMm);
  await page.waitForSelector('.tbox.tedit .tb-edit');
  check(!(await page.$('.shapes-layer.on')), '글상자를 넣자마자 글쓰기 화면(그리기 꺼짐)');
  await k.type('메모 하나');
  await k.press('Escape');
  await sleep(120);
  const boxes = async () => page.evaluate(() => Object.values(window.__ayunpad.doc().shapes.toJSON()).filter((s) => s.t === 'text'));
  let B = await boxes();
  check(B.length === 1 && B[0].text === '메모 하나', `한 번 넣기 글상자 저장 (${B.map((b) => b.text).join('|')})`);
  await page.keyboard.down('Alt');
  await page.mouse.click(mmX(20), L2.y + 30 * pxPerMm);
  await page.keyboard.up('Alt');
  await page.waitForSelector('.tbox.tedit .tb-edit');
  await k.type('둘째');
  await k.press('Escape');
  await sleep(120);
  B = await boxes();
  check(B.length === 2 && B.some((b) => b.text === '둘째'), `⌥+클릭 → 그 자리에 글상자 (${B.map((b) => b.text).join('|')})`);
  const memo = B.find((b) => b.text === '메모 하나');
  await page.click(`.tbox[data-sid="${memo.id}"]`);
  await page.waitForSelector('.tbox.tedit .tb-grip');
  check(true, '글쓰기 화면에서 글상자를 누르면 바로 고치기');
  const grip = await (await page.$('.tbox.tedit .tb-grip')).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 10 * pxPerMm, grip.y + grip.height / 2 + 4 * pxPerMm, { steps: 6 });
  await page.mouse.up();
  await sleep(120);
  const afterMove = (await boxes()).find((b) => b.id === memo.id);
  check(Math.abs(afterMove.a.x - memo.a.x - 10) < 0.6, `손잡이로 끌어 옮기기 (x ${memo.a.x.toFixed(1)} → ${afterMove.a.x.toFixed(1)})`);
  const wh = await (await page.$('.tbox.tedit .tb-width')).boundingBox();
  await page.mouse.move(wh.x + wh.width / 2, wh.y + wh.height / 2);
  await page.mouse.down();
  await page.mouse.move(wh.x + wh.width / 2 - 8 * pxPerMm, wh.y + wh.height / 2, { steps: 5 });
  await page.mouse.up();
  await sleep(120);
  const widened = (await boxes()).find((b) => b.id === memo.id);
  check(widened.bw < afterMove.bw - 6, `오른쪽 끝을 끌어 폭 바꾸기 (${afterMove.bw.toFixed(1)} → ${widened.bw.toFixed(1)}mm)`);
  await page.click('.tbox.tedit .tb-del');
  await sleep(120);
  B = await boxes();
  check(B.length === 1 && !B.some((b) => b.id === memo.id) && !(await page.$('.tbox.tedit')), '× → 글상자 지움');

  // 16) 표 · 그래프 크기: 오른쪽 아래 모서리 손잡이를 끌면 줄어들고 글자도 같이, 다음 줄은 줄 칸에 그대로
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('크기 시험');
  await k.press('Enter');
  await k.type('/표 3x3');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.editor table');
  await k.type('구분');
  await (await page.evaluateHandle(() => document.querySelector('.editor .tblw').nextElementSibling)).click();
  await k.type('/수요공급');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.wg.graph');
  await k.type('아래 줄');
  await sleep(200);
  const font0 = await page.$eval('.editor .tblw th', (e) => parseFloat(getComputedStyle(e).fontSize));
  const shrink = async (sel) => {
    await page.hover(sel);
    await sleep(80);
    const b = await (await page.$(`${sel} .wg-size`)).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x - 200, b.y, { steps: 8 });
    await page.mouse.up();
    await sleep(300);
  };
  await shrink('.editor .tblw');
  await shrink('.editor .wg.graph');
  const sz = await page.evaluate(() => {
    const sc = {};
    window.__ayunpad.view().state.doc.forEach((n) => {
      if (n.attrs.scale !== undefined) sc[n.type.name] = n.attrs.scale;
    });
    const ps = [...document.querySelectorAll('.editor > *')];
    const t0 = ps[0].getBoundingClientRect();
    return { sc, font: parseFloat(getComputedStyle(document.querySelector('.editor .tblw th')).fontSize), rows: (ps[ps.length - 1].getBoundingClientRect().top - t0.top) / t0.height };
  });
  check(sz.sc.table < 0.9 && sz.sc.graph < 0.9, `손잡이로 표 · 그래프 줄이기 (표 ${sz.sc.table}, 그래프 ${sz.sc.graph})`);
  check(sz.font < font0 * 0.9, `표를 줄이면 칸 글자도 작아짐 (${font0.toFixed(1)} → ${sz.font.toFixed(1)}px)`);
  check(Math.abs(sz.rows - Math.round(sz.rows)) < 0.01, `줄인 뒤에도 다음 줄은 줄 칸에 딱 맞음 (${sz.rows.toFixed(3)}줄)`);
  await page.keyboard.down(meta);
  await page.keyboard.press('KeyZ');
  await page.keyboard.up(meta);
  await sleep(150);
  check((await page.evaluate(() => window.__ayunpad.view().state.doc.child(2).attrs.scale)) === 1, '⌘Z → 그래프 크기 되돌림');

  // 17) 하나의 엔진: 글상자도 본문과 똑같이(꺾쇠 · 가지선 · 자동 색 · 기호 메뉴 · 화살표 · Tab)
  const L3 = await page.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
  });
  const px3 = L3.w / L3.mmW;
  await page.keyboard.down('Alt');
  await page.mouse.click(L3.x + 50 * px3, L3.y + 60 * px3);
  await page.keyboard.up('Alt');
  await page.waitForSelector('.tbox.tedit .tb-edit');
  await k.type('경영학');
  await k.press('Enter');
  await k.type('- 마케팅');
  await k.press('Enter');
  await k.type('p=');
  await page.waitForSelector('.mathmenu', { timeout: 2000 }).catch(() => {});
  const boxMenu = !!(await page.$('.mathmenu'));
  await k.press('Tab');
  await k.type(' a->b');
  await k.press('Enter');
  await k.press('Enter');
  await k.press('Enter');
  await k.press('Tab');
  await k.type('하위');
  await sleep(200);
  const inBox = await page.$$eval('.tbox.tedit .tb-edit > p', (ps) =>
    ps.map((p) => ({ k: p.dataset.kind, d: p.dataset.depth, t: p.textContent, red: [...p.querySelectorAll('.a-red')].map((x) => x.textContent).join(''), hl: !!p.querySelector('.hl'), tree: (p.getAttribute('style') || '').includes('gradient') })),
  );
  check(inBox[1]?.k === 'branch' && inBox[1]?.tree && inBox[1]?.red === '마케팅' && inBox[1]?.hl, `글상자에서 '- ' → 꺾쇠 줄 + 빨간 가지선 + 자동 빨강 · 형광펜 (${JSON.stringify(inBox[1])})`);
  check(inBox[0]?.red === '경영학', `글상자 대제목도 자동 빨강 (${inBox[0]?.red})`);
  check(boxMenu && inBox[2]?.t === 'p≤ a→b', `글상자에서도 = 기호 메뉴 · 화살표 변환 (${inBox[2]?.t})`);
  const lastBox = inBox[inBox.length - 1];
  check(lastBox?.k === 'branch' && lastBox?.t === '하위', `글상자에서도 빈 줄 Tab → 꺾쇠 자식 줄 (${JSON.stringify(lastBox)})`);
  await k.press('Escape');
  await sleep(150);
  check((await page.$$eval('.tbox:not(.tedit) .a-red', (e) => e.length)) >= 2, '글상자를 나와도 그대로(정적 글 없이 같은 엔진이 그림)');
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit3');
  await page.keyboard.up('Alt');
  await page.waitForSelector('.pages.a4 .psheet');
  await sleep(150);
  check((await page.$$eval('.pages .tbox .a-red', (e) => e.length)) >= 2, 'A4 보기 · 인쇄에도 글상자 자동 색 · 가지선 그대로');
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Alt');
  await sleep(150);

  // 18) 지우기 · 고치기: 표(막대 · ⌫⌫) · 그래프 · 이미 그린 화살표, 줄여도 꺾쇠 자리 그대로, 빈 곳 두 번 누르기 글상자
  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');
  await k.type('경영학');
  await k.press('Enter');
  await k.type('- 마케팅');
  await k.press('Enter');
  await k.type('/표 2x2');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.editor table');
  const padOf = () => page.$eval('.editor .tblw', (e) => getComputedStyle(e).paddingLeft);
  const pad0 = await padOf();
  await page.hover('.editor .tblw');
  const hb = await (await page.$('.editor .tblw > .wg-size')).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 150, hb.y, { steps: 6 });
  await page.mouse.up();
  await sleep(250);
  const pad1 = await padOf();
  check(pad0 === pad1 && parseFloat(pad0) > 0, `표를 줄여도 들여쓰기 · 가지선 자리는 그대로 (${pad0} → ${pad1})`);
  const tableBtn = (label) => page.$$eval('.editor .tblw .tbl-ctl button', (bs, l) => bs.find((b) => b.textContent === l)?.click(), label);
  await page.hover('.editor .tblw');
  await tableBtn('행＋');
  await tableBtn('열＋');
  await sleep(100);
  const grid = await page.$$eval('.editor table tr', (rs) => rs.map((r) => r.children.length).join(','));
  check(grid === '3,3,3', `표 막대: 행＋ · 열＋ (${grid})`);
  await tableBtn('표 지우기');
  await sleep(120);
  check(!(await page.$('.editor table')), '표 막대: 표 지우기');
  await page.keyboard.down(meta);
  await page.keyboard.press('KeyZ');
  await page.keyboard.up(meta);
  await sleep(150);
  check(!!(await page.$('.editor table')), '⌘Z → 지운 표 되살림');
  // 표 다음 줄 맨 앞에서 ⌫ ⌫ → 표 지우기
  await page.evaluate(() => {
    const v = window.__ayunpad.view();
    let pos = -1;
    v.state.doc.forEach((n, p, i) => {
      if (n.type.name === 'table') pos = p + n.nodeSize + 1;
    });
    v.focus();
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, pos)));
  });
  await k.press('Backspace');
  await sleep(60);
  const selTable = await page.$('.editor .tblw.ProseMirror-selectednode');
  await k.press('Backspace');
  await sleep(100);
  check(!!selTable && !(await page.$('.editor table')), '표 다음 줄 맨 앞 ⌫ → 표 고르기, 한 번 더 ⌫ → 표 지움');
  // 그래프 지우기 단추
  await k.type('/그래프');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.wg.graph');
  await page.hover('.wg.graph');
  await page.$$eval('.wg.graph .wg-ctl button', (bs) => bs.find((b) => b.textContent === '지우기')?.click());
  await sleep(120);
  check(!(await page.$('.wg.graph')), '그래프 지우기 단추');
  // 이미 그린 화살표: 글쓰기 화면에서 눌러 고르기 → 색 · 직각 · 굵기 · 지우기
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyD');
  await page.keyboard.up('Alt');
  await page.waitForSelector('.drawbar');
  await k.press('KeyA'); // 마지막에 쓴 도구(네모)가 아니라 화살표로
  const L4 = await page.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
  });
  const at4 = (x, y) => [L4.x + (x / L4.mmW) * L4.w, L4.y + (y / L4.mmW) * L4.w];
  await page.mouse.click(...at4(20, 40));
  await sleep(420);
  await page.mouse.click(...at4(70, 52), { count: 2 });
  await sleep(150);
  await k.press('Escape');
  await k.press('Escape');
  await sleep(150);
  check(!(await page.$('.drawbar')), '화살표 그리고 글쓰기 화면으로');
  const arrowId = await page.evaluate(() => Object.values(window.__ayunpad.doc().shapes.toJSON()).find((x) => x.t === 'path')?.id);
  await page.mouse.click(...at4(45, 46)); // 화살표 선 위
  await page.waitForSelector('.drawbar.has-sel', { timeout: 3000 }).catch(() => {});
  check(!!(await page.$('.drawbar.has-sel')), '글쓰기 화면에서 화살표를 누르면 그 화살표가 골라짐');
  await page.$$eval('.drawbar .swatches button', (bs) => bs.find((b) => b.getAttribute('aria-label') === '파랑')?.click());
  await page.$$eval('.drawbar button', (bs) => bs.find((b) => b.textContent === '직각')?.click());
  await page.$$eval('.drawbar button', (bs) => bs.find((b) => b.getAttribute('aria-label') === '가늘게')?.click());
  await sleep(120);
  const ed = await page.evaluate((id) => window.__ayunpad.doc().shapes.get(id), arrowId);
  check(ed.c === 'b' && ed.o === true && ed.w < 0.35, `이미 그린 화살표 색 · 직각 · 굵기 바꾸기 (${ed.c}, 직각 ${ed.o}, ${ed.w}mm)`);
  await page.$$eval('.drawbar button', (bs) => bs.find((b) => b.textContent === '지우기')?.click());
  await sleep(120);
  check(!(await page.evaluate((id) => window.__ayunpad.doc().shapes.has(id), arrowId)), '막대의 지우기 → 화살표 지움');
  await k.press('Escape');
  await sleep(100);
  // 종이 빈 곳 두 번 누르기 → 글상자, 위쪽 T 글상자 단추
  const p0 = await (await page.$('.editor > p')).boundingBox();
  await page.mouse.click(p0.x + p0.width - 30, p0.y + p0.height / 2, { count: 2 });
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  check(!!(await page.$('.tbox.tedit .tb-edit')), '종이 빈 곳 두 번 누르기 → 그 자리에 글상자');
  await k.type('빈 곳 글상자');
  await k.press('Escape');
  await sleep(100);
  await page.$$eval('.top .tbtn', (bs) => bs.find((b) => b.textContent.includes('글상자'))?.click());
  await sleep(80);
  await page.mouse.click(...at4(30, 70));
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  await k.type('단추 글상자');
  await k.press('Escape');
  await sleep(120);
  const texts = await page.evaluate(() => Object.values(window.__ayunpad.doc().shapes.toJSON()).filter((x) => x.t === 'text').map((x) => x.text));
  check(texts.includes('빈 곳 글상자') && texts.includes('단추 글상자'), `위쪽 T 글상자 단추로도 (${texts.join(' | ')})`);

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
