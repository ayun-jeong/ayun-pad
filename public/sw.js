// ayun pad 서비스 워커: 앱 화면 · 스크립트 · 글꼴을 담아 두어 인터넷이 없어도 열린다.
// 노트 내용은 IndexedDB에 있고, 서버(Supabase) 통신은 건드리지 않는다.
const VERSION = 'v1';
const SHELL = `ayunpad-shell-${VERSION}`;
const ASSETS = `ayunpad-assets-${VERSION}`;
const scope = self.registration.scope; // https://ayun-jeong.github.io/ayun-pad/

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([scope, `${scope}manifest.webmanifest`])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!k.endsWith(VERSION)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

const isShell = (url) => url.href === scope || url.href === `${scope}index.html` || (url.href.startsWith(scope) && url.pathname === new URL(scope).pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;

  // 앱 화면: 인터넷이 되면 새로 받고, 안 되면 담아 둔 것
  if (req.mode === 'navigate') {
    if (!isShell(url)) return;
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(SHELL)).put(scope, res.clone());
          return res;
        } catch {
          return (await caches.match(scope)) || Response.error();
        }
      })(),
    );
    return;
  }

  // 스크립트 · 스타일 · 글꼴: 담아 둔 걸 먼저 주고 뒤에서 새로 받아 둔다
  const sameApp = url.href.startsWith(scope);
  const font = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'cdn.jsdelivr.net';
  if (!sameApp && !font) return;
  e.respondWith(
    (async () => {
      const c = await caches.open(ASSETS);
      const hit = await c.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })(),
  );
});
