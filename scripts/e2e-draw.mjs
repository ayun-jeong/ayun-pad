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
  await k.type('/연표 1990 10 5');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForSelector('.wg.tl');
  const vals = await page.$$eval('.wg.tl .tl-val .wg-ed', (e) => e.map((x) => x.textContent).join(' '));
  check(vals === '1990 2000 2010 2020 2030', `연표 1990부터 10년씩 5칸 (${vals})`);
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
  await page.waitForSelector('textarea.tedit');
  await k.type('메모 -> 중요');
  await k.press('Escape');
  await sleep(150);
  S = await shapes();
  const tb = S.find((s) => s.t === 'text');
  check(S.some((s) => s.t === 'rect') && tb?.text === '메모 → 중요', `네모 + 글상자(화살표 변환) (${tb?.text})`);

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

  check(errors.length === 0, `콘솔 오류 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  await browser.close();
} catch (e) {
  console.error(e);
  fails.push(String(e));
} finally {
  server.kill();
}
console.log(fails.length ? `\n${fails.length}개 실패` : '\n전부 통과');
process.exit(fails.length ? 1 : 0);
