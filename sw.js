// 背景程式（Service Worker）：讓遊戲可以「加到主畫面」安裝成 App
// 策略：一律先從網路抓最新版；抓不到（離線）時才用上次存下來的檔案。
// 這樣更新遊戲後玩家重新整理就能拿到新版，不會卡在舊版本。
const CACHE = 'shinki-kigen-v1';
// 程式檔每次都跟伺服器確認（GitHub Pages 會讓瀏覽器快取 10 分鐘，不確認的話更新後要等很久才拿到新版）
const CODE = /\.(html|js|css|json|webmanifest)$|\/$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    // 開整個網頁（navigate）的請求不能再加設定，改用網址重新抓
    (CODE.test(new URL(req.url).pathname) ? fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }) : fetch(req)).then(res => {
      // 只存完整的回應（音樂的分段下載不存）
      if (res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || Response.error()))
  );
});
