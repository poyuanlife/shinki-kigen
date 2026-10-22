// 本機測試伺服器：用 http:// 開遊戲（錯誤訊息才會完整顯示，之後做 PWA 也需要）
// 用法：node tools/serve.js　或雙擊「開始遊戲.bat」
// 只開放給本機（127.0.0.1），區網的其他裝置連不到。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  // 不允許讀取專案資料夾以外的檔案
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('找不到檔案：' + p); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      // 程式碼每次都重新讀（改完重新整理就生效）；圖片可以快取
      'Cache-Control': /\.(png|webp|jpg)$/i.test(file) ? 'max-age=3600' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

let port = 8080;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && port < 8100) { port++; server.listen(port, '127.0.0.1'); }
  else { console.error('伺服器啟動失敗：', e.message); process.exit(1); }
});
server.on('listening', () => {
  const url = `http://localhost:${port}/`;
  console.log(`遊戲伺服器已啟動：${url}`);
  console.log('關閉這個視窗就會停止伺服器。');
  if (process.argv.includes("--no-open")) return;
  if (process.platform === "win32") exec(`start "" "${url}"`);
  else if (process.platform === 'darwin') exec(`open "${url}"`);
});
server.listen(port, '127.0.0.1');
