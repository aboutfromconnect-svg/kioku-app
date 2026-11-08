// Change RELEASE and the HTML marker together for every shell release.
const RELEASE = '0.2-ui3';
const CACHE = 'kioku-static-' + RELEASE;
const SCRIPT = './data-safety.js?v=' + RELEASE;
const ENVIRONMENT = './environment.js?v=' + RELEASE;
const UPDATES = './updates.js?v=' + RELEASE;
const UPDATES_INTEGRITY = 'sha256-xQebf/qdTRX5jPZcinorJRyRt5cTmoWUe416RQjQ7jo=';
const ENVIRONMENT_INTEGRITY = 'sha256-RkjEfRlvwUTy/OE8YnYEo1Wbxos+qO+3MbrUFcFd59w=';
const INTEGRITY = 'sha256-NFa0p80Qt/jV35oNta5mkYYhKkAJegJZs4Fs33G7t0A=';
const PRECACHE = ['./index.html', SCRIPT, ENVIRONMENT, UPDATES, './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch and verify the whole release before touching its cache.
    const responses = await Promise.all(PRECACHE.map(async url => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const integrity=url===SCRIPT?INTEGRITY:url===ENVIRONMENT?ENVIRONMENT_INTEGRITY:url===UPDATES?UPDATES_INTEGRITY:null;
        const response = await fetch(new Request(url, { cache: 'no-store', signal: controller.signal, ...(integrity ? {integrity} : {}) }));
        if (!response.ok || response.redirected) throw new Error('Incomplete kioku release');
        // Drain each body immediately; never leave unread streams holding connections.
        return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
      } finally { clearTimeout(timeout); }
    }));
    const html = await responses[0].clone().text();
    if (!html.includes(`<meta name="kioku-release" content="${RELEASE}">`) ||
        !html.includes(`src="${SCRIPT}" integrity="${INTEGRITY}"`) || !html.includes(`src="${ENVIRONMENT}" integrity="${ENVIRONMENT_INTEGRITY}"`) || !html.includes(`src="${UPDATES}" integrity="${UPDATES_INTEGRITY}"`)) throw new Error('Mismatched kioku release');
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map((url, i) => cache.put(url, responses[i])));
    // Legacy pages cannot send an activation message. Activate the verified worker,
    // but NEVER navigate/reload clients or delete the assets their loaded code uses.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Retain previous release caches for open legacy pages. No IndexedDB operations.
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='KIOKU_VERSION')event.ports[0]?.postMessage({release:RELEASE});
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = request.mode === 'navigate' ? './index.html' : PRECACHE.find(item => new URL(item, self.registration.scope).href === url.href);
  if (!key) {
    // Version-pinned scripts requested by a still-open old page remain available.
    const base=new URL('./',self.registration.scope);
    if(url.pathname.startsWith(base.pathname)&&/\/(data-safety|environment|updates)\.js$/.test(url.pathname))
      event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
    return;
  }
  // Never refresh HTML independently of its script. A new worker installs a new set.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(key);
    if (cached) return cached;
    // A missing shell is not repaired with potentially incompatible network files.
    return new Response('kiokuのアプリファイルを読み込めません。接続を確認し、アプリを閉じてから開き直してください。日記データの削除は不要です。',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
