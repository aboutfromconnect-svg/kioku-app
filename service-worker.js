// Change RELEASE and the HTML marker together for every shell release.
const RELEASE = '0.1.1-safety2';
const CACHE = 'kioku-static-' + RELEASE;
const SCRIPT = './data-safety.js?v=' + RELEASE;
const INTEGRITY = 'sha256-M3ajW9QHkehV4lzJo58vZj5OnRgQQKI84fmq8/hE0Y4=';
const PRECACHE = ['./index.html', SCRIPT, './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch and verify the whole release before touching its cache.
    const responses = await Promise.all(PRECACHE.map(async url => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(new Request(url, { cache: 'no-store', signal: controller.signal, ...(url === SCRIPT ? { integrity: INTEGRITY } : {}) }));
        if (!response.ok || response.redirected) throw new Error('Incomplete kioku release');
        // Drain each body immediately; never leave unread streams holding connections.
        return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
      } finally { clearTimeout(timeout); }
    }));
    const html = await responses[0].clone().text();
    if (!html.includes(`<meta name="kioku-release" content="${RELEASE}">`) ||
        !html.includes(`src="${SCRIPT}" integrity="${INTEGRITY}"`)) throw new Error('Mismatched kioku release');
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map((url, i) => cache.put(url, responses[i])));
    // Deliberately no skipWaiting(): existing tabs keep their current worker.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('kioku-static-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = request.mode === 'navigate' ? './index.html' : PRECACHE.find(item => new URL(item, self.registration.scope).href === url.href);
  if (!key) return;
  // Never refresh HTML independently of its script. A new worker installs a new set.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(key);
    if (cached) return cached;
    // A missing shell is not repaired with potentially incompatible network files.
    return new Response('kiokuのアプリファイルを読み込めません。接続を確認し、アプリを閉じてから開き直してください。日記データの削除は不要です。',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
