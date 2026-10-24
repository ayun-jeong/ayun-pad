// 기호 퀵 메뉴(= + -) · 분수 · 루트 시험
// 사용: npm run build && node scripts/e2e-math.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4331;
const URL = process.env.E2E_URL ?? `http://localhost:${PORT}/ayun-pad/`;
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
  const line = (i = -1) => page.$$eval('.editor > p', (ps, i) => (i < 0 ? ps[ps.length + i] : ps[i])?.textContent ?? '', i);
  const menu = () => page.$$eval('.mathmenu button', (b) => b.map((x) => x.textContent.replace(/\d$/, '').trim()));
  const open = async () => !!(await page.$('.mathmenu'));

  await page.click('.addnote');
  await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await page.click('.editor');

  // 1) = → 메뉴가 커서 바로 위에, ≤ ≥ ≠ 분수 루트
  await k.type('x=');
  await page.waitForSelector('.mathmenu');
  const items = await menu();
  check(items.length === 5 && items[0] === '≤' && items[1] === '≥' && items[2] === '≠', `= 메뉴: ${items.join(' ')}`);
  const pos = await page.evaluate(() => {
    const m = document.querySelector('.mathmenu').getBoundingClientRect();
    const s = getSelection().getRangeAt(0).getBoundingClientRect();
    return { mb: m.bottom, ct: s.top, ml: m.left, cl: s.left };
  });
  check(pos.mb <= pos.ct + 1 && Math.abs(pos.ml - pos.cl) < 60, `메뉴가 커서 바로 위 (메뉴 아래 ${pos.mb.toFixed(0)} ≤ 커서 위 ${pos.ct.toFixed(0)})`);

  // 2) 그냥 계속 치면(숫자 · Space) 메뉴가 닫히고 = 그대로
  await k.type('2');
  await sleep(50);
  check(!(await open()) && (await line()) === 'x=2', `숫자를 치면 = 그대로 (${await line()})`);
  await k.type(' y=');
  await page.waitForSelector('.mathmenu');
  await k.press('Space');
  await sleep(50);
  check(!(await open()) && (await line()) === 'x=2 y= ', `Space → 메뉴 닫히고 = 그대로 (${JSON.stringify(await line())})`);

  // 3) Tab → 첫 칸(≤)으로 바뀜, 들여쓰기는 안 됨
  await k.type('z=');
  await page.waitForSelector('.mathmenu');
  await k.press('Tab');
  await sleep(50);
  const depth = await page.$eval('.editor > p', (p) => p.dataset.depth);
  check((await line()).endsWith('z≤') && depth === '1', `Tab → ≤, 들여쓰기 안 됨 (${await line()}, 깊이 ${depth})`);

  // 4) ↑로 들어가 → → Enter, ↑ 숫자, 누르기
  await k.type(' a=');
  await page.waitForSelector('.mathmenu');
  await k.press('ArrowUp');
  await k.press('ArrowRight');
  await k.press('ArrowRight');
  await k.press('Enter');
  await sleep(50);
  check((await line()).endsWith('a≠'), `↑ → → Enter → ≠ (${await line()})`);
  await k.type(' b=');
  await page.waitForSelector('.mathmenu');
  await k.press('ArrowUp');
  await k.press('Digit2');
  await sleep(50);
  check((await line()).endsWith('b≥'), `↑ 2 → ≥ (${await line()})`);
  await k.type(' c=');
  await page.waitForSelector('.mathmenu');
  await page.$$eval('.mathmenu button', (b) => b[0].click());
  await sleep(50);
  check((await line()).endsWith('c≤'), `메뉴 누르기 → ≤ (${await line()})`);

  // 5) Enter(메뉴에 안 들어갔을 때) → 줄 바꿈, = 그대로
  await k.type(' d=');
  await page.waitForSelector('.mathmenu');
  await k.press('Enter');
  await sleep(80);
  check((await line(0)).endsWith('d=') && (await page.$$eval('.editor > p', (p) => p.length)) === 2, 'Enter → 줄 바꿈, = 그대로');

  // 6) + → ⊕ ±, - → ⊖ ±
  await k.type('p+');
  await page.waitForSelector('.mathmenu');
  const plus = await menu();
  check(plus.join(' ') === '⊕ ±', `+ 메뉴: ${plus.join(' ')}`);
  await k.press('Tab');
  await k.type(' q+');
  await page.waitForSelector('.mathmenu');
  await k.press('ArrowUp');
  await k.press('ArrowRight');
  await k.press('Enter');
  await k.type(' r+1');
  await sleep(50);
  check((await line()) === 'p⊕ q± r+1', `+: Tab → ⊕, ↑ → Enter → ±, 숫자 치면 + 그대로 (${await line()})`);
  await k.type(' s-');
  await page.waitForSelector('.mathmenu');
  const minus = await menu();
  check(minus.join(' ') === '⊖ ±', `- 메뉴: ${minus.join(' ')}`);
  await k.press('Tab');
  await k.type(' t->');
  await sleep(50);
  check((await line()).endsWith('s⊖ t→') && !(await open()), `-: Tab → ⊖, -> 는 그대로 → 화살표 (${await line()})`);

  // 7) 줄 맨 앞 '- ' + 스페이스는 여전히 꺾쇠 줄
  await k.press('Enter');
  await k.type('경제학');
  await k.press('Enter');
  await k.type('- 수요');
  await sleep(80);
  const br = await page.$$eval('.editor > p', (ps) => {
    const p = ps[ps.length - 1];
    return { kind: p.dataset.kind, text: p.textContent };
  });
  check(br.kind === 'branch' && br.text === '수요', `'- ' → 꺾쇠 줄 그대로 (${JSON.stringify(br)})`);

  // 7-1) 줄 맨 앞 - 에는 메뉴가 안 뜬다 · 꺾쇠 줄에서 Enter 뒤 '- '는 글자로 남지 않는다 · ⌥- 로 꺾쇠 ↔ 보통 줄
  const lastP = () =>
    page.$$eval('.editor > p', (ps) => {
      const p = ps[ps.length - 1];
      return { kind: p.dataset.kind, depth: p.dataset.depth, text: p.textContent };
    });
  await k.press('Enter');
  await k.press('Minus');
  await sleep(80);
  check(!(await open()), '줄 맨 앞 - 에는 기호 메뉴가 안 뜸');
  await k.press('Space');
  await k.type('공급');
  await sleep(80);
  let lp = await lastP();
  check(lp.kind === 'branch' && lp.text === '공급', `꺾쇠 줄에서 Enter 뒤 '- ' → 글자로 안 남음 (${JSON.stringify(lp)})`);
  await k.down('Alt');
  await k.press('Minus');
  await k.up('Alt');
  await sleep(80);
  lp = await lastP();
  check(lp.kind === 'plain' && lp.text === '공급', `⌥- → 보통 줄 (${JSON.stringify(lp)})`);
  await k.down('Alt');
  await k.press('Minus');
  await k.up('Alt');
  await sleep(80);
  lp = await lastP();
  check(lp.kind === 'branch' && lp.text === '공급', `⌥- 한 번 더 → 꺾쇠 줄 (${JSON.stringify(lp)})`);
  await k.press('End');
  // 빈 보통 줄에서 Tab → 꺾쇠 자식 줄
  await k.press('Enter');
  await k.press('Enter');
  await k.press('Enter');
  lp = await lastP();
  const before = lp.kind + lp.depth;
  await k.press('Tab');
  await sleep(80);
  lp = await lastP();
  check(before === 'plain1' && lp.kind === 'branch' && lp.depth === '2', `빈 보통 줄에서 Tab → 꺾쇠 자식 줄 (${before} → ${lp.kind}${lp.depth})`);
  // Enter 3번 = 빈 줄 2개(빈 꺾쇠 줄에서 Enter는 줄을 늘리지 않고 한 단계 위로) → ⌫ 3번이면 '공급' 끝
  await k.press('Backspace'); // 꺾쇠 풀기
  await k.press('Backspace'); // 빈 줄 합치기
  await k.press('Backspace'); // '공급' 줄 끝으로
  await sleep(50);
  lp = await lastP();
  check(lp.text === '공급', `빈 줄을 지우고 '공급' 줄로 돌아옴 (${JSON.stringify(lp)})`);
  await k.press('End');

  // 8) 분수: = 뒤에 넣고 분자로, Tab → 분모, Tab → 밖으로. 줄 높이 그대로
  await k.type(' 탄력성 E=');
  await page.waitForSelector('.mathmenu');
  await k.press('ArrowUp');
  await k.press('Digit4');
  await page.waitForFunction(() => document.activeElement?.classList.contains('fr-n'), { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => document.activeElement?.classList.contains('fr-n')), '분수 → 분자 칸에 커서');
  await k.type('ΔQ');
  await k.press('Tab');
  check(await page.evaluate(() => document.activeElement?.classList.contains('fr-d')), 'Tab → 분모 칸');
  await k.type('ΔP');
  await k.press('ArrowUp');
  check(await page.evaluate(() => document.activeElement?.classList.contains('fr-n')), '↑ → 분자 칸');
  await k.press('ArrowDown');
  check(await page.evaluate(() => document.activeElement?.classList.contains('fr-d')), '↓ → 분모 칸');
  await k.press('Tab');
  await sleep(50);
  check(await page.evaluate(() => document.activeElement?.classList.contains('editor')), '분모에서 Tab → 분수 밖 본문으로');
  await k.type(' 크다');
  await sleep(100);
  const frac = await page.evaluate(() => {
    let f = null;
    window.__ayunpad.view().state.doc.descendants((n) => {
      if (n.type.name === 'frac') f = n.attrs;
      return true;
    });
    const ps = [...document.querySelectorAll('.editor > p')];
    const withFrac = ps.find((p) => p.querySelector('.frac'));
    return { f, text: window.__ayunpad.view().state.doc.lastChild.textContent, h: withFrac?.offsetHeight, h0: ps[0].offsetHeight };
  });
  check(frac.f?.n === 'ΔQ' && frac.f?.d === 'ΔP', `분수 저장 (${JSON.stringify(frac.f)})`);
  check(frac.text === '공급 탄력성 E=ΔQ/ΔP 크다', `분수 뒤로 이어 쓰기 (${frac.text})`);
  check(Math.abs(frac.h - frac.h0) < 0.5, `분수가 든 줄도 높이 그대로 (${frac.h}px / 보통 줄 ${frac.h0}px)`);

  // 9) 루트: √[ ] 안에 쓰고 → 로 밖으로
  await k.type(' v=');
  await page.waitForSelector('.mathmenu');
  await k.press('ArrowUp');
  await k.press('Digit5');
  await page.waitForFunction(() => document.activeElement?.classList.contains('sq-in'), { timeout: 3000 }).catch(() => {});
  check(await page.evaluate(() => document.activeElement?.classList.contains('sq-in')), '루트 → 근호 안 칸에 커서');
  await k.type('2gh');
  await k.press('ArrowRight');
  await sleep(50);
  check(await page.evaluate(() => document.activeElement?.classList.contains('editor')), '근호 끝에서 → → 밖으로');
  await k.type(' 속도');
  await sleep(80);
  const sq = await page.evaluate(() => window.__ayunpad.view().state.doc.lastChild.textContent);
  check(sq.endsWith('v=√2gh 속도'), `루트 저장 · 이어 쓰기 (${sq})`);

  // 10) /분수 · 빈 분수에서 ⌫는 분수 지우기
  await k.type(' /분수');
  await page.waitForSelector('.slash button.on');
  await k.press('Enter');
  await page.waitForFunction(() => document.activeElement?.classList.contains('fr-n'), { timeout: 3000 }).catch(() => {});
  const nFrac = () => page.evaluate(() => document.querySelectorAll('.editor .frac').length);
  check((await nFrac()) === 2, '/분수 → 분수 넣기');
  await k.press('Backspace');
  await sleep(80);
  check((await nFrac()) === 1 && (await page.evaluate(() => document.activeElement?.classList.contains('editor'))), '빈 분수에서 ⌫ → 분수 지움');

  // 11) 되돌리기 · A4 보기에도 분수 · 루트
  await sleep(600);
  await k.down(meta);
  await k.press('KeyZ');
  await k.up(meta);
  await sleep(100);
  check((await nFrac()) === 2, '⌘Z → 지운 분수 되살림');
  await k.down('Alt');
  await k.press('Digit3');
  await k.up('Alt');
  await page.waitForSelector('.pages.a4 .psheet');
  const inA4 = await page.$$eval('.pages .frac .fr-n, .pages .sqrt .sq-in', (e) => e.map((x) => x.textContent).filter(Boolean));
  check(inA4.includes('ΔQ') && inA4.includes('2gh'), `A4 보기에 분수 · 루트 (${inA4.join(', ')})`);
  await k.down('Alt');
  await k.press('Digit1');
  await k.up('Alt');
  await sleep(200);

  // 12) 끄면 메뉴 안 뜸
  await k.down('Alt');
  await k.press('KeyT');
  await k.up('Alt');
  await page.waitForSelector('.panel');
  await page.$$eval('.panel label.check', (ls) => ls.find((l) => l.textContent.includes('기호 퀵 메뉴'))?.querySelector('input')?.click());
  await k.press('Escape');
  const last = await page.evaluateHandle(() => [...document.querySelectorAll('.editor > p')].pop());
  await last.click();
  await k.press('End');
  await k.type(' w=');
  await sleep(100);
  check(!(await open()), '설정에서 끄면 = 메뉴 안 뜸');

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
