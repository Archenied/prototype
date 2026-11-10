// 휴대폰(특히 iPhone 홈 화면 앱)용: 인터넷이 없어도 앱 화면이 열리게 앱 파일을 저장해 둔다.
// 인터넷이 되면 항상 새 파일을 먼저 받고(그래서 업데이트가 바로 보임), 안 되면 저장해 둔 파일을 쓴다.
// 날씨·교통 같은 외부 API 요청은 건드리지 않는다 (마지막 데이터는 앱이 따로 저장함).
const CACHE = 'proto-app-v1';
const CORE = ['./', './index.html', './css/app.css', './js/main.js', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './version.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
