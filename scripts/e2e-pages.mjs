// 글상자로 쓰기 · 반쪽(페이지) 시험: 종이에 바로 쓰기는 기본으로 꺼짐(빈 종이를 누르면 그 자리에 글상자),
// 예전 본문 글은 두 번 눌러 글상자로, A4 · 반쪽 보기에서 반쪽 ◀ ▶ · ＋ 빈 반쪽 · × 빈 반쪽 지우기 · 글상자 하나씩 끌어 옮기기.
// 사용: npm run build && node scripts/e2e-pages.mjs
import { spawn } from 'node:child_process';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4327;
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
  const combo = async (mods, code) => {
    for (const m of mods) await k.down(m);
    await k.press(code);
    for (const m of [...mods].reverse()) await k.up(m);
  };
  const boxes = () => page.evaluate(() => Object.values(window.__ayunpad.doc().shapes.toJSON()).filter((s) => s.t === 'text').map((s) => ({ id: s.id, text: s.text, y: s.a.y, x: s.a.x })));
  const bodyText = () => page.evaluate(() => window.__ayunpad.view().state.doc.textContent);
  const usable = await page.evaluate(() => 297 - 2 * 3); // 기본 위아래 여백 3mm
  const layer = async () =>
    page.$eval('.shapes-layer', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, mmW: e.offsetWidth / (96 / 25.4) };
    });
  const newNote = async () => {
    await page.click('.addnote');
    await page.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
    await sleep(150);
  };

  // 1) 기본: 종이에 바로 쓰지 않음 — 빈 종이를 누르면 그 자리에 글상자
  await newNote();
  check(
    (await page.$eval('.app', (e) => e.classList.contains('paper-off'))) && (await page.$eval('.editor', (e) => e.getAttribute('contenteditable'))) === 'false',
    '기본은 종이에 바로 쓰기 끔(본문에 커서가 안 들어감)',
  );
  let L = await layer();
  let ppm = L.w / L.mmW;
  let P = (x, y) => [L.x + x * ppm, L.y + y * ppm];
  await page.mouse.click(...P(20, 30));
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  check(!!(await page.$('.tbox.tedit .tb-edit')), '빈 종이를 누르면 그 자리에 글상자(바로 쓰기)');
  await k.type('첫 글상자');
  await sleep(100);
  await page.mouse.click(...P(60, 80));
  await sleep(200);
  let B = await boxes();
  check(B.length === 1 && B[0].text === '첫 글상자' && !(await page.$('.tbox.tedit')) && (await bodyText()) === '', `고치던 중 빈 곳 누르기 → 끝내기만(새 글상자 없음), 본문은 비어 있음 (${B.map((b) => b.text).join('|')})`);
  await page.mouse.click(...P(60, 80));
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  await k.type('둘째');
  await k.press('Escape');
  await sleep(200);
  await page.mouse.click(...P(30, 120));
  await sleep(150);
  await page.mouse.click(...P(70, 125)); // 쓰지 않고 나온 글상자는 저절로 사라짐
  await sleep(200);
  await k.press('Escape');
  await sleep(150);
  B = await boxes();
  check(B.length === 2 && B.some((b) => b.text === '둘째'), `다시 누르면 새 글상자, 쓰지 않고 나오면 사라짐 (${B.length}개)`);

  // 2) A4 보기: 반쪽마다 단추(종이 위 제목 줄에 늘 보임), ＋ 빈 반쪽, ◀ 자리 바꾸기(그 반쪽 글상자가 같이), × 빈 반쪽 지우기.
  //    단추는 진짜 마우스로 누른다(ElementHandle.click). 끌기는 반쪽 통째가 아니라 글상자 하나만.
  await combo(['Alt'], 'Digit3');
  await page.waitForSelector('.pages.a4 .pctl[data-half="0"]');
  const acts = async () =>
    page.$$eval('.pages .pctl[data-half]', (cs) => cs.sort((a, b) => a.dataset.half - b.dataset.half).map((c) => [...c.querySelectorAll('button')].map((b) => b.dataset.act + (b.disabled ? '-' : '')).join(',')));
  const press = async (half, act) => {
    const b = await page.$(`.pages .pctl[data-half="${half}"] button[data-act="${act}"]`);
    if (!b) throw new Error(`단추 없음 ${half} ${act}`);
    await b.click();
    await sleep(250); // 기다리지 않고 바로 다시 그린다(예전엔 150ms 뒤)
  };
  check(
    await page.$eval('.pages .pctl[data-half="0"]', (c) => {
      const r = c.getBoundingClientRect();
      const h = document.querySelector('.pages .phalf[data-half="0"]').getBoundingClientRect();
      return getComputedStyle(c).opacity === '1' && r.bottom <= h.top + 1;
    }),
    '단추는 마우스를 안 올려도 보이고, 종이 위(글을 가리지 않는 자리)에 있음',
  );
  check((await acts()).join('|') === 'prev-,next-,add', `A4 보기: 반쪽에 ◀ ▶ ＋ 단추 (${(await acts()).join('|')})`);
  const y0 = (await boxes()).map((b) => b.y).sort((a, b) => a - b);
  await press(0, 'add');
  check((await acts()).join('|') === 'prev-,next,add|prev,next-,add,del', `＋ → 뒤에 빈 반쪽(1-2), 빈 반쪽에는 × (${(await acts()).join('|')})`);
  check(!!(await page.$('.pages .phalf[data-half="1"].pflash')), '＋ 뒤 새 반쪽이 잠깐 표시됨');
  await press(1, 'prev');
  const y1 = (await boxes()).map((b) => b.y).sort((a, b) => a - b);
  check(y1.every((y, i) => Math.abs(y - y0[i] - usable) < 0.2), `◀ → 1-2와 1-1 자리 바꾸기: 글상자가 반쪽 높이만큼 오른쪽(다음) 반쪽으로 (${y0.map((v) => v.toFixed(0))} → ${y1.map((v) => v.toFixed(0))})`);
  check((await acts())[0].includes('del'), '이제 1-1이 빈 반쪽(×)');
  // 글상자 하나 끌어 옮기기: 1-2의 '첫 글상자'를 1-1 같은 자리로(다른 글상자는 그대로)
  const first = (await boxes()).find((b) => b.text === '첫 글상자');
  const other = (await boxes()).find((b) => b.text !== '첫 글상자');
  const tb = await (await page.$(`.pages .phalf[data-half="1"] .tbox[data-sid="${first.id}"]`)).boundingBox();
  const w1 = await (await page.$('.pages .phalf[data-half="1"] .pwin')).boundingBox();
  const w0 = await (await page.$('.pages .phalf[data-half="0"] .pwin')).boundingBox();
  check(
    (await page.$eval(`.pages .phalf[data-half="1"] .tbox[data-sid="${first.id}"]`, (e) => getComputedStyle(e).cursor)) === 'grab',
    '보기 화면 글상자 위 커서 = 끌기',
  );
  const gx = tb.x + 8;
  const gy = tb.y + tb.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx - (w1.x - w0.x) + 40, gy + 60, { steps: 12 });
  const mid = await page.$eval(`.pages .phalf[data-half="0"] .tbox[data-sid="${first.id}"]`, (e) => e.style.transform);
  await page.mouse.up();
  await sleep(300);
  const ppmA4 = w0.width / (await page.$eval('.pages .phalf[data-half="0"] .pwin', (e) => e.offsetWidth / (96 / 25.4)));
  let mb = await boxes();
  const f2 = mb.find((b) => b.id === first.id);
  const o2 = mb.find((b) => b.id === other.id);
  check(!!mid && mid.includes('translate'), `끄는 동안 놓일 자리(다른 반쪽)에 글상자가 따라 보임 (${mid})`);
  check(Math.abs(f2.y - (first.y - usable + 60 / ppmA4)) < 0.6 && Math.abs(f2.x - (first.x + 40 / ppmA4)) < 0.6, `글상자를 끌어 1-2 → 1-1로, 놓은 자리 그대로 (y ${first.y.toFixed(1)} → ${f2.y.toFixed(1)}, x ${first.x.toFixed(1)} → ${f2.x.toFixed(1)})`);
  check(Math.abs(o2.y - other.y) < 0.05 && Math.abs(o2.x - other.x) < 0.05, '다른 글상자는 그대로(반쪽 통째로 안 옮겨짐)');
  check(!!(await page.$('.pages.a4')), '끌어 놓아도 보기 화면 그대로(편집 화면으로 안 넘어감)');
  // 빈 자리를 끌면 아무것도 안 옮겨짐(반쪽 통째 끌기 없음)
  const before = JSON.stringify(await boxes());
  await page.mouse.move(w0.x + w0.width / 2, w0.y + w0.height - 40);
  await page.mouse.down();
  await page.mouse.move(w1.x + w1.width / 2, w1.y + w1.height - 40, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check(JSON.stringify(await boxes()) === before, '빈 종이를 끌면 아무것도 안 옮겨짐');
  // 이제 1-2(오른쪽)를 '둘째'만 남은 반쪽으로: 둘째도 1-1로 끌어 오면 1-2가 빈 반쪽 → × 로 지움
  const tb2 = await (await page.$(`.pages .phalf[data-half="1"] .tbox[data-sid="${other.id}"]`)).boundingBox();
  await page.mouse.move(tb2.x + 6, tb2.y + tb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb2.x + 6 - (w1.x - w0.x), tb2.y + tb2.height / 2, { steps: 10 });
  await page.mouse.up();
  await sleep(300);
  check((await acts()).join('|') === 'prev-,next,add|prev,next-,add,del', `둘 다 1-1로 옮기면 1-2는 빈 반쪽(×) (${(await acts()).join('|')})`);
  await press(1, 'del');
  check((await acts()).length === 1 && (await boxes()).length === 2, `빈 반쪽 × → 지움 (${(await acts()).length}반쪽)`);
  // ⌘Z 한 번이면 지운 반쪽도 돌아옴(반쪽 수도 같은 되돌리기 칸)
  await sleep(600);
  await press(0, 'add');
  check((await acts()).length === 2, '＋ → 2반쪽');
  await combo(['Meta'], 'KeyZ');
  await sleep(300);
  check((await acts()).length === 1, `⌘Z → ＋로 넣은 빈 반쪽도 되돌아감 (${(await acts()).length}반쪽)`);
  // 글상자를 두 번 누르면 편집 화면에서 그 글상자를 바로 고치기
  const tb3 = await (await page.$(`.pages .phalf[data-half="0"] .tbox[data-sid="${first.id}"]`)).boundingBox();
  await page.mouse.click(tb3.x + 6, tb3.y + tb3.height / 2, { count: 2 });
  await page.waitForSelector(`.tbox.tedit[data-sid="${first.id}"]`, { timeout: 3000 }).catch(() => {});
  check(!(await page.$('.pages')) && !!(await page.$(`.tbox.tedit[data-sid="${first.id}"]`)), '보기 화면에서 글상자 두 번 누르기 → 편집 화면에서 그 글상자 고치기');
  await k.press('Escape');
  await sleep(200);

  // 2-1) 넘친 글상자 · 경계 바로 아래 글상자 · 본문 글을 바꾼 글상자(반쪽 맨 위보다 0.2mm 위)
  await newNote();
  const put = (id, x, y, text) =>
    page.evaluate(
      (id, x, y, text) => {
        const d = window.__ayunpad.doc();
        d.ydoc.transact(() => d.shapes.set(id, { id, t: 'text', a: { l: null, r: 0, x, y }, bw: 60, text, c: 'k', w: 0.2, z: d.shapes.size + 1 }));
      },
      id,
      x,
      y,
      text,
    );
  const pitch = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.paper')).getPropertyValue('--lh')));
  await put('ov', 10, usable - pitch * 1.5, '넘침1\n넘침2\n넘침3'); // 1-1 아래에서 1-2로 넘친 글상자
  await sleep(300);
  await combo(['Alt'], 'Digit3');
  await page.waitForSelector('.pages.a4 .pctl[data-half="0"]');
  await sleep(200);
  check((await acts()).join('|') === 'prev-,next,add|prev,next-,add', `1-1에서 넘쳐 1-2에 걸친 글상자: 1-2는 빈 반쪽이 아님(× 없음) (${(await acts()).join('|')})`);
  await press(1, 'add');
  check((await acts()).join('|') === 'prev-,next,add|prev,next,add|prev,next-,add,del', `＋ → 새 반쪽(2-1)에 × (${(await acts()).join('|')})`);
  await press(2, 'del');
  check((await acts()).length === 2, `새로 생긴 반쪽 × → 바로 없어짐 (${(await acts()).length}반쪽)`);
  await combo(['Alt'], 'Digit1');
  await sleep(200);
  await newNote();
  await put('edge', 10, usable - pitch + 0.8, '경계'); // 아래 끝이 경계를 0.8mm 넘음(새 반쪽으로 치지 않음)
  await put('conv', 10, usable * 2 - 0.2, '바꾼 글상자'); // 2-1 맨 위(본문 글을 바꾼 자리)
  await sleep(300);
  const edHalves = await page.$$eval('.half-no', (e) => e.length);
  await combo(['Alt'], 'Digit3');
  await page.waitForSelector('.pages.a4 .pctl[data-half="0"]');
  await sleep(200);
  const pvHalves = await page.$$eval('.pages .phalf[data-half]', (e) => e.length);
  check(edHalves === 3 && pvHalves === 3 && (await acts()).length === 3, `반쪽 수가 편집 화면 · 보기 화면 · 단추 모두 같음 (${edHalves} · ${pvHalves} · ${(await acts()).length})`);
  check((await acts())[1].includes('del'), `1-2는 빈 반쪽(×) — 경계를 살짝 넘은 글상자는 1-2를 차지하지 않음 (${(await acts()).join('|')})`);
  await press(2, 'prev');
  mb = await boxes();
  check(Math.abs(mb.find((b) => b.text === '바꾼 글상자').y - (usable - 0.2)) < 0.2 && Math.abs(mb.find((b) => b.text === '경계').y - (usable - pitch + 0.8)) < 0.05, `반쪽 맨 위보다 0.2mm 위 글상자는 그 반쪽 것: ◀ 하면 같이 옮겨짐 (${mb.map((b) => b.text + ' ' + b.y.toFixed(1)).join(', ')})`);
  await press(2, 'del');
  check((await acts()).length === 2, `빈 끝 반쪽 × → 지움 (${(await acts()).length}반쪽)`);
  await combo(['Alt'], 'Digit1');
  await sleep(300);

  // 3) 예전 본문 글: 두 번 누르면 그 반쪽 글이 같은 자리의 글상자로(바로 고치기)
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '1'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await newNote();
  await page.click('.editor');
  await k.type('예전 본문 글');
  await k.press('Enter');
  await k.type('둘째 줄');
  await sleep(300);
  const lineTop = await page.$eval('.editor > p', (e) => {
    const L = document.querySelector('.shapes-layer').getBoundingClientRect();
    return (e.getBoundingClientRect().top - L.top) / (L.width / (document.querySelector('.shapes-layer').offsetWidth / (96 / 25.4)));
  });
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '0'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await sleep(300);
  const p0 = await (await page.$('.editor > p')).boundingBox();
  await page.mouse.click(p0.x + 15, p0.y + p0.height / 2);
  await sleep(150);
  check((await boxes()).length === 0, '예전 본문 글 위 한 번 누르기는 글상자를 만들지 않음');
  await page.mouse.click(p0.x + 15, p0.y + p0.height / 2, { count: 2 });
  await page.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  B = await boxes();
  const tbTop = await page.$eval('.tbox .tb-edit > p', (e) => {
    const L = document.querySelector('.shapes-layer').getBoundingClientRect();
    return (e.getBoundingClientRect().top - L.top) / (L.width / (document.querySelector('.shapes-layer').offsetWidth / (96 / 25.4)));
  });
  check(B.length === 1 && B[0].text === '예전 본문 글\n둘째 줄' && (await bodyText()) === '' && !!(await page.$('.tbox.tedit')), `두 번 누르면 그 반쪽 본문 글이 글상자로(바로 고치기) (${JSON.stringify(B.map((b) => b.text))})`);
  check(Math.abs(tbTop - lineTop) < 0.3, `같은 자리에 (본문 ${lineTop.toFixed(2)}mm → 글상자 ${tbTop.toFixed(2)}mm)`);
  await k.press('Escape');
  await sleep(150);

  // 4) 본문 글이 남은 노트에서 반쪽 옮기기 → 먼저 글상자로 바꾸고 옮김
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '1'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await newNote();
  await page.click('.editor');
  await k.type('옮길 본문');
  await sleep(300);
  await page.evaluate(() => localStorage.setItem('ayunpad-paper', '0'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.editor > p');
  await combo(['Alt'], 'Digit3');
  await page.waitForSelector('.pages.a4 .pctl[data-half="0"]');
  await press(0, 'add');
  await press(1, 'prev');
  B = await boxes();
  check(B.length === 1 && B[0].text === '옮길 본문' && Math.abs(B[0].y - usable) < 1 && (await bodyText()) === '', `본문 글이 남은 반쪽을 옮기면 글상자로 바뀌어 같이 옮겨짐 (${JSON.stringify(B.map((b) => [b.text, b.y.toFixed(1)]))})`);
  await combo(['Alt'], 'Digit1');
  await sleep(300);

  // 5) ⋯ 메뉴: 종이에 바로 쓰기 켜고 끄기
  await page.click('.more-btn');
  await page.waitForSelector('.menu.more');
  await page.$$eval('.menu.more button[role="menuitem"]', (bs) => bs.find((b) => b.textContent.startsWith('종이에 바로 쓰기 켜기')).click());
  await sleep(200);
  check((await page.$eval('.editor', (e) => e.getAttribute('contenteditable'))) === 'true' && !(await page.$('.app.paper-off')), '⋯ › 종이에 바로 쓰기 켜기 → 본문에 바로 쓰기');
  await page.click('.more-btn');
  await page.waitForSelector('.menu.more');
  await page.$$eval('.menu.more button[role="menuitem"]', (bs) => bs.find((b) => b.textContent.startsWith('종이에 바로 쓰기 끄기')).click());
  await sleep(200);
  check((await page.$eval('.editor', (e) => e.getAttribute('contenteditable'))) === 'false', '다시 끄기');

  // 6) ＋ 넣기(쓰던 글상자 없음): 넣을 곳을 누르면 그 자리 새 글상자에 표
  await newNote();
  await page.click('.top button[title^="표 · 수직선"]');
  await page.waitForSelector('.panel.insert');
  await page.$$eval('.panel.insert .ins-row button.primary', (bs) => bs[0].click());
  await sleep(200);
  L = await layer();
  ppm = L.w / L.mmW;
  P = (x, y) => [L.x + x * ppm, L.y + y * ppm];
  await page.mouse.click(...P(10, 40));
  await page.waitForSelector('.tbox.tedit table', { timeout: 3000 }).catch(() => {});
  check(!!(await page.$('.tbox.tedit table')) && (await bodyText()) === '', '쓰던 글상자가 없으면 ＋ 넣기 › 표 → 누른 자리 새 글상자에 표(본문엔 안 들어감)');
  await k.type('칸');
  await k.press('Escape');
  await sleep(200);

  // 6-1) 커서가 아무 데도 없을 때 다른 앱 글을 ⌘V → 보이는 자리에 새 글상자(본문엔 안 들어감)
  await browser.defaultBrowserContext().overridePermissions(new globalThis.URL(URL).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await page.evaluate(() => navigator.clipboard.writeText('붙인 글'));
  await page.evaluate(() => document.activeElement?.blur?.());
  const nb = (await boxes()).length;
  await k.down('Meta');
  await k.press('KeyV', { commands: ['Paste'] });
  await k.up('Meta');
  await sleep(300);
  check((await boxes()).some((b) => b.text === '붙인 글') && (await boxes()).length === nb + 1 && !(await bodyText()).includes('붙인 글'), '커서 없이 ⌘V → 붙인 글은 새 글상자로');
  await k.press('Escape');
  await sleep(150);

  // 7) 읽기 모드에서는 빈 종이를 눌러도 글상자 안 생김
  const n0 = (await boxes()).length;
  await combo(['Alt'], 'KeyL');
  await sleep(150);
  await page.mouse.click(...P(50, 150));
  await sleep(200);
  check((await boxes()).length === n0 && !(await page.$('.tbox.tedit')), '읽기 모드: 빈 종이를 눌러도 글상자 안 생김');
  await combo(['Alt'], 'KeyL');
  await sleep(150);
  check(errors.length === 0, `콘솔 오류 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);

  // 8) 폰(고치기 모드): 빈 종이를 톡 누르면 그 자리에 글상자
  const ctx = await browser.createBrowserContext();
  const mp = await ctx.newPage();
  await mp.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('ayunpad-read', '0');
    } catch {}
  });
  await mp.emulate(KnownDevices['iPhone 13']);
  await mp.goto(URL, { waitUntil: 'networkidle0' });
  await mp.waitForSelector('.editor > p');
  await mp.click('.addnote').catch(() => {});
  await mp.evaluate(() => document.querySelector('.addnote')?.click());
  await mp.waitForFunction(() => document.querySelector('.editor')?.textContent === '', { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await mp.evaluate(() => document.querySelector('.side-backdrop')?.click());
  await sleep(200);
  const ml = await mp.$eval('.shapes-layer', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width };
  });
  await mp.touchscreen.tap(ml.x + ml.w * 0.4, ml.y + 120);
  await mp.waitForSelector('.tbox.tedit .tb-edit', { timeout: 3000 }).catch(() => {});
  check(!!(await mp.$('.tbox.tedit .tb-edit')), '폰: 빈 종이를 톡 누르면 그 자리에 글상자');
  await ctx.close();
  await browser.close();
} catch (e) {
  console.log(`FAIL 예외: ${e?.message ?? e}`);
  fails.push(String(e));
} finally {
  server.kill();
}
console.log(fails.length ? `\n${fails.length}개 실패` : '\n전부 통과');
process.exit(fails.length ? 1 : 0);
