// ==========================================================================
// TideFinder 서비스워커 - 통신 불량 현장 대비 오프라인 캐시
//
// 전략:
//  - 화면(HTML)          : 네트워크 우선 → 실패하면 저장본 (항상 최신 화면, 끊기면 마지막 화면)
//  - /assets/* (빌드 결과): 저장본 우선 (파일명에 해시가 붙어 내용이 바뀌면 이름도 바뀜)
//  - 해안선·정치망·아이콘 : 저장본 우선 (17MB 해안선을 매번 받지 않음)
//  - /.netlify/functions/*: 저장 안 함 - 조류·기상은 실시간 값이어야 하므로,
//                           오래된 값을 최신처럼 보여주는 일이 없게 항상 네트워크로만 요청
//  - 외부 도메인(카카오맵 등): 손대지 않음
//
// ※ 해안선/정치망 데이터 파일을 교체하면 아래 CACHE_VERSION 숫자를 올려야
//   폰에 저장된 옛 데이터가 새 것으로 바뀐다.
// ==========================================================================
const CACHE_VERSION = 'v6'; // v6: 경북 어항(소형선항만안내) 추가(2026-11-25)
const CACHE_NAME = `tidefinder-${CACHE_VERSION}`;
const CORE_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png'];
const DATA_FILES = ['/coastline-korea.geojson.gz', '/setnet-korea.geojson', '/fishery-pohang.geojson', '/rocks-pohang.geojson', '/land-east-core.geojson', '/harbors-gb.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tidefinder-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 페이지가 첫 방문 때(워커가 제어하기 전) 이미 받아온 파일 목록을 보내오면 저장한다.
// 지금 화면이 쓰지 않는 옛 빌드 파일(/assets/)은 이때 지워서 저장공간이 계속 늘지 않게 한다.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls') return;
  const urls = (event.data.urls || [])
    .map((u) => new URL(u, self.location.origin))
    .filter((u) => u.origin === self.location.origin && !u.pathname.startsWith('/.netlify/'))
    .map((u) => u.pathname + u.search);
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of new Set(urls)) {
      if (await cache.match(url, { ignoreVary: true })) continue;
      try { await cache.add(url); } catch (err) { /* 한 파일 실패는 무시 */ }
    }
    const currentAssets = new Set(urls.filter((u) => u.startsWith('/assets/')));
    if (currentAssets.size > 0) {
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname;
        if (path.startsWith('/assets/') && !currentAssets.has(path)) await cache.delete(req);
      }
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith('/assets/') || DATA_FILES.includes(url.pathname) || CORE_URLS.includes(url.pathname)) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    const path = new URL(req.url).pathname;
    const key = path === '/' || path === '/index.html' ? '/' : path;
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) || (await cache.match('/')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
