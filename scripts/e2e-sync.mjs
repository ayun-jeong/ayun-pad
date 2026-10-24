// 3단계 동기화 시험: 시험용 임시 계정으로 브라우저 두 개(PC · 폰 역할)를 열어 실시간 반영과 오프라인 병합을 확인한다.
// 실제 계정의 노트는 건드리지 않는다. 끝나면 임시 계정을 지우고, 그 계정의 서버 기록은 함께 지워진다(on delete cascade).
// 사용: npm run build && E2E_ENV=<SUPABASE_SERVICE_ROLE_KEY 등이 든 .env 파일> node scripts/e2e-sync.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4320;
const URL = process.env.E2E_URL ?? `http://localhost:${PORT}/ayun-pad/`;
const env = Object.fromEntries(
  fs
    .readFileSync(process.env.E2E_ENV, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')];
    }),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = (path, init = {}) =>
  fetch(`${SB}/auth/v1/admin${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = process.env.E2E_URL ? { kill() {} } : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });

async function link(email) {
  const r = await admin('/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
  const j = await r.json();
  const h = j.hashed_token ?? j.properties?.hashed_token;
  if (!h) throw new Error(`generate_link 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return `${URL}?token_hash=${h}&type=magiclink`;
}

const editorText = (page) => page.$eval('.editor', (e) => e.textContent).catch(() => '');
async function waitText(page, needle, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await editorText(page)).includes(needle)) return true;
    await sleep(200);
  }
  return false;
}

let userId = null;
try {
  for (let i = 0; i < 40 && !process.env.E2E_URL; i++) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {}
    await sleep(250);
  }
  const email = `e2e-${Date.now()}@ayunpad.test`;
  const created = await (await admin('/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) })).json();
  userId = created.id;
  check(!!userId, `시험용 임시 계정 만들기 (${email})`);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  for (const p of [A, B]) await p.setViewport({ width: 1300, height: 900 });
  const errs = [];
  for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', (e) => errs.push(`${n}: ${e}`));

  // A(PC): 로그인 → 새 노트에 쓰기
  await A.goto(await link(email), { waitUntil: 'networkidle0' });
  await A.waitForSelector('.tbtn.sync.synced', { timeout: 15000 });
  check(true, 'A 로그인 · 동기화됨');
  await A.click('.addnote');
  await A.waitForFunction(() => document.querySelectorAll('.editor > p').length === 1 && document.querySelector('.editor').textContent === '');
  await A.click('.editor');
  await A.keyboard.type('동기화 시험 A');
  await sleep(2000);

  // B(폰): 로그인 → A의 목록과 노트를 받는다(B의 손대지 않은 견본은 지워져 두 벌이 되지 않음)
  await B.goto(await link(email), { waitUntil: 'networkidle0' });
  await B.waitForSelector('.tbtn.sync.synced', { timeout: 15000 });
  await B.waitForFunction(() => [...document.querySelectorAll('.note-item .t')].some((e) => e.textContent === '새 노트'), { timeout: 10000 });
  const titles = await B.$$eval('.note-item .t', (els) => els.map((e) => e.textContent));
  check(titles.filter((t) => t === '견본 · 경영학').length === 1 && titles.includes('새 노트'), `B가 A의 목록을 받음, 견본은 한 벌 (${titles.join(', ')})`);
  await B.$$eval('.note-item .t', (els) => els.find((e) => e.textContent === '새 노트')?.click());
  check(await waitText(B, '동기화 시험 A'), 'B에서 A가 쓴 노트 내용이 보임');
  await sleep(500);
  const linesB = await B.$$eval('.editor > p', (ps) => ps.map((p) => p.textContent));
  check(linesB.length === 1, `B에서 연 노트에 빈 줄이 더 생기지 않음 (${JSON.stringify(linesB)})`);

  // 실시간: A가 이어 쓰면 B에 바로
  await A.click('.editor');
  await A.keyboard.press('End');
  const t0 = Date.now();
  await A.keyboard.type(' 실시간');
  const live = await waitText(B, '동기화 시험 A 실시간', 6000);
  check(live, `A가 이어 쓴 글이 B에 실시간으로 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);

  // 오프라인 병합: B를 끊고 양쪽에서 고친 뒤 다시 연결
  await B.setOfflineMode(true);
  await B.click('.editor');
  await B.keyboard.press('End');
  await B.keyboard.type(' 오프라인B');
  await A.keyboard.type(' 온라인A');
  await sleep(2500);
  await B.setOfflineMode(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  const mergedB = (await waitText(B, '오프라인B', 8000)) && (await waitText(B, '온라인A', 8000));
  const mergedA = (await waitText(A, '오프라인B', 8000)) && (await waitText(A, '온라인A', 8000));
  check(mergedA && mergedB, `다시 연결되면 양쪽 수정이 둘 다 남음 (A: ${await editorText(A)} / B: ${await editorText(B)})`);

  // 버전 기록: 지금 저장 → 목록에 생김
  await A.click('.tbtn.sync');
  await A.waitForSelector('.panel');
  await A.$$eval('.panel button', (bs) => bs.find((b) => b.textContent.includes('버전 기록'))?.click());
  await A.waitForSelector('.versions');
  await A.$$eval('.versions button', (bs) => bs.find((b) => b.textContent.includes('지금 저장'))?.click());
  await A.waitForFunction(() => document.querySelectorAll('.vlist button').length >= 1, { timeout: 8000 }).catch(() => {});
  const vcount = await A.$$eval('.vlist button', (b) => b.length);
  check(vcount >= 1, `버전 저장 후 목록에 표시 (${vcount}개)`);
  await A.click('.vlist button');
  await A.waitForSelector('.vpreview pre');
  const pre = await A.$eval('.vpreview pre', (e) => e.textContent);
  check(pre.includes('동기화 시험 A'), `버전 미리보기 (${pre.slice(0, 40)})`);

  check(errs.length === 0, `페이지 오류 없음 ${errs.slice(0, 2).join(' | ')}`);
  await browser.close();
} catch (e) {
  console.error(e);
  fails.push(String(e));
} finally {
  if (userId) {
    const r = await admin(`/users/${userId}`, { method: 'DELETE' });
    console.log(`임시 계정 지움: ${r.status}`);
  }
  server.kill();
}
console.log(fails.length ? `\n${fails.length}개 실패` : '\n전부 통과');
process.exit(fails.length ? 1 : 0);
