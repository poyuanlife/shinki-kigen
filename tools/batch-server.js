// 圖片批次轉換的本機程式：讓 batch.html 讀取「原圖資料夾」裡的圖，並把轉好的圖存進「輸出資料夾」
// 用法：雙擊「圖片批次轉換.exe」（用 tools/build-exe.js 打包，內含 Node.js，不用另外安裝）
//       node tools/batch-server.js --app　（開發用：開獨立程式視窗，關掉視窗就自動結束）
//       node tools/batch-server.js　　　　（開發用：用瀏覽器分頁開啟）
// 只開放給本機（127.0.0.1），不會連網；只會寫入輸出資料夾和原圖資料夾裡的設定檔。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, execFile, spawn } = require('child_process');
const os = require('os');

// 打包成 exe 時：網頁檔包在 exe 裡面
let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch (e) { sea = null; }
const ROOT = sea ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const EMBED = ['batch.html', 'pixel-core.js', 'sprite-core.js', 'batch-icon.png', 'sprite-generator.html', 'pixel-converter.html', 'tool-nav.js', 'rig-core.js'];
const GROUPS = ['characters', 'monsters', 'scenes'];
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

const inside = (file, dir) => !!dir && (file === dir || file.startsWith(dir + path.sep));
const slash = f => f.split(path.sep).join('/');
function readJson(file) {
  if (!fs.existsSync(file)) return { value: null };
  try { return { value: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }; }
  catch (e) { return { error: `${path.basename(file)} 格式有誤：${e.message}` }; }
}
function images(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && IMG_RE.test(d.name)).map(d => d.name).sort();
}

// ---------- 資料夾設定 ----------
// 記在這台電腦的 %APPDATA%\RPG-batch-tool\folders.json；換電腦時在程式裡重新選一次就好
const CONF_DIR = path.join(process.env.APPDATA || os.homedir(), 'RPG-batch-tool');
const CONF = path.join(CONF_DIR, 'folders.json');
// 原圖資料夾的上一層有 assets（= 遊戲資料夾）就輸出到 assets\custom，否則輸出到原圖資料夾旁的「轉換結果」
function defaultOut(src) {
  const parent = path.dirname(src);
  return fs.existsSync(path.join(parent, 'assets')) ? path.join(parent, 'assets', 'custom') : path.join(parent, '轉換結果');
}
function loadFolders() {
  const c = readJson(CONF).value || {};
  let src = c.src && path.isAbsolute(c.src) ? c.src : null;
  // 還沒選過：exe（或專案）旁邊有 art-src 就直接用
  if (!src && fs.existsSync(path.join(ROOT, 'art-src'))) src = path.join(ROOT, 'art-src');
  const out = c.out && path.isAbsolute(c.out) ? c.out : (src ? defaultOut(src) : null);
  return { src, out, outAuto: !c.out };
}
let F = loadFolders();
function saveFolders(next) {
  const c = readJson(CONF).value || {};
  if (next.src !== undefined) c.src = next.src;
  if (next.out !== undefined) c.out = next.out; // null = 跟著原圖資料夾自動決定
  fs.mkdirSync(CONF_DIR, { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify(c, null, 2));
  F = loadFolders();
}
const folderInfo = () => ({ src: F.src, out: F.out, outAuto: F.outAuto, srcOk: !!F.src && fs.existsSync(F.src) });
const settingsFile = () => path.join(F.src, 'batch-settings.json');

// Windows 的「選擇資料夾」視窗（用內建的 PowerShell 開，不用另外安裝東西）
function pickFolder(title, start) {
  const q = s => "'" + String(s || '').replace(/'/g, "''") + "'";
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = ${q(title)}
$f.ShowNewFolderButton = $true
$start = ${q(start)}
if ($start -and (Test-Path -LiteralPath $start)) { $f.SelectedPath = $start }
$o = New-Object System.Windows.Forms.Form
$o.TopMost = $true
if ($f.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }
$o.Dispose()`;
  return new Promise((ok, fail) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { windowsHide: true, encoding: 'utf8', timeout: 30 * 60 * 1000 },
      (err, stdout) => err ? fail(err) : ok(stdout.trim() || null));
  });
}

// 列出原圖資料夾裡所有要轉換的東西（characters / monsters / scenes 不存在就先建立）
function scan() {
  if (!F.src) return { needFolder: true, groups: {} };
  const SRC = F.src, OUT = F.out;
  for (const g of GROUPS) fs.mkdirSync(path.join(SRC, g), { recursive: true });
  const res = { root: SRC, out: OUT, groups: {} };
  for (const g of GROUPS) {
    const dir = path.join(SRC, g), items = [];
    if (g === 'scenes') {
      for (const f of images(dir)) {
        const name = f.replace(/\.[^.]+$/, ''), cfg = readJson(path.join(dir, name + '.json'));
        items.push({ name, files: [f], dir: g, settings: cfg.value, settingsError: cfg.error,
          done: fs.existsSync(path.join(OUT, g, name + '.png')) });
      }
    } else {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const sub = path.join(dir, d.name), cfg = readJson(path.join(sub, 'settings.json'));
        items.push({ name: d.name, files: images(sub), dir: g + '/' + d.name, settings: cfg.value, settingsError: cfg.error,
          done: fs.existsSync(path.join(OUT, g, d.name, 'Walk.png')) });
      }
    }
    // 圖片直接放在 characters / monsters 裡（沒有放進角色資料夾）也要提醒
    const loose = g === 'scenes' ? [] : images(dir);
    res.groups[g] = { items: items.sort((a, b) => a.name.localeCompare(b.name)), loose };
  }
  return res;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, cb) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => cb(Buffer.concat(chunks)));
}
function sendFile(res, file, p) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { send(res, 404, '找不到檔案：' + p, 'text/plain; charset=utf-8'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

const APP = !!sea || process.argv.includes('--app');
// 開著的視窗：每個網頁有自己的 id，定時 ping；關閉時送 bye。全部關掉才結束程式
const pages = new Map(); // id → 最後一次 ping 的時間
let everSeen = false;

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { send(res, 400, { error: 'bad url' }); return; }
  const p = decodeURIComponent(url.pathname), pid = url.searchParams.get('id');

  if (p === '/api/ping') {
    if (pid) { pages.set(pid, Date.now()); everSeen = true; }
    send(res, 200, { app: 'rpg-batch' });
    return;
  }
  if (p === '/api/bye') { if (pid) pages.delete(pid); send(res, 200, { ok: true }); return; }

  // 資料夾：查詢、用視窗選擇、直接指定路徑
  if (p === '/api/folders' && req.method === 'GET') { send(res, 200, folderInfo()); return; }
  if (p === '/api/pick' && req.method === 'POST') {
    const which = url.searchParams.get('which') === 'out' ? 'out' : 'src';
    const title = which === 'src' ? '選擇「原圖資料夾」（放人物、怪物、場景原圖的地方）' : '選擇「輸出資料夾」（轉好的圖要存在哪裡）';
    pickFolder(title, which === 'src' ? F.src : F.out)
      .then(dir => { if (dir) saveFolders(which === 'src' ? { src: dir } : { out: dir }); send(res, 200, Object.assign({ picked: !!dir }, folderInfo())); })
      .catch(e => { log('選擇資料夾失敗：' + e.message); send(res, 500, { error: '無法開啟選擇資料夾的視窗：' + e.message }); });
    return;
  }
  if (p === '/api/folders' && req.method === 'POST') {
    readBody(req, buf => {
      try {
        const v = JSON.parse(buf.toString('utf8')), next = {};
        for (const k of ['src', 'out']) {
          if (!(k in v)) continue;
          if (v[k] === null && k === 'out') { next.out = null; continue; }
          const dir = String(v[k] || '').trim().replace(/^"(.*)"$/, '$1');
          if (!path.isAbsolute(dir)) throw new Error('請輸入完整路徑，例如 D:\\RPG\\art-src');
          fs.mkdirSync(dir, { recursive: true });
          next[k] = path.resolve(dir);
        }
        saveFolders(next);
        send(res, 200, folderInfo());
      } catch (e) { send(res, 400, { error: e.message }); }
    });
    return;
  }

  // 轉換設定存在原圖資料夾裡（跟著原圖走，電腦重灌也不會不見）
  if (p === '/api/settings') {
    if (!F.src) { send(res, req.method === 'GET' ? 200 : 409, req.method === 'GET' ? {} : { error: '還沒選原圖資料夾' }); return; }
    if (req.method === 'GET') { const r = readJson(settingsFile()); send(res, 200, r.value || {}); return; }
    readBody(req, buf => {
      try {
        const v = JSON.parse(buf.toString('utf8'));
        fs.mkdirSync(F.src, { recursive: true });
        fs.writeFileSync(settingsFile(), JSON.stringify(v, null, 2));
        send(res, 200, { ok: true });
      } catch (e) { send(res, 400, { error: e.message }); }
    });
    return;
  }
  if (p === '/api/scan' && req.method === 'GET') {
    try { send(res, 200, scan()); } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }
  // 存檔：p 是輸出資料夾裡的相對路徑，例如 characters/knight/Walk.png
  if (p === '/api/save' && req.method === 'POST') {
    if (!F.out) { send(res, 409, { error: '還沒選輸出資料夾' }); return; }
    const file = path.resolve(F.out, url.searchParams.get('p') || '');
    if (!inside(file, F.out) || !/\.(png|json)$/i.test(file)) { send(res, 403, { error: '只能存到輸出資料夾' }); return; }
    readBody(req, buf => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
        send(res, 200, { ok: true, path: file });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (p === '/api/open' && req.method === 'POST') {
    const dir = url.searchParams.get('which') === 'out' ? F.out : F.src;
    if (!dir) { send(res, 409, { error: '還沒選資料夾' }); return; }
    fs.mkdirSync(dir, { recursive: true });
    if (process.platform === 'win32') execFile('explorer.exe', [dir]);
    else exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${dir}"`);
    send(res, 200, { ok: true });
    return;
  }

  // 原圖：/src/characters/knight/front.png → 原圖資料夾裡的檔案
  if (p.startsWith('/src/')) {
    if (!F.src) { send(res, 404, 'no folder', 'text/plain'); return; }
    const file = path.resolve(F.src, p.slice(5));
    if (!inside(file, F.src) || !IMG_RE.test(file)) { send(res, 403, 'forbidden', 'text/plain'); return; }
    sendFile(res, file, p);
    return;
  }
  // exe 裡包好的網頁檔
  const m = p.match(/^\/tools\/([\w.-]+)$/);
  if (sea) {
    if (m && EMBED.includes(m[1])) {
      const buf = Buffer.from(sea.getAsset(m[1]));
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(m[1])] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    } else send(res, 404, '找不到檔案：' + p, 'text/plain; charset=utf-8');
    return;
  }
  // 開發時：直接讀專案裡的工具網頁
  const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!inside(file, ROOT) || file === ROOT) { send(res, 403, 'forbidden', 'text/plain'); return; }
  sendFile(res, file, p);
});

// ---------- 啟動 ----------
// 找 Edge 或 Chrome，用「應用程式模式」開成獨立視窗（沒有網址列和分頁）
function findBrowser() {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const rels = ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'];
  for (const r of rels) for (const b of pf) { const f = path.join(b, r); if (fs.existsSync(f)) return f; }
  return null;
}
// 記錄檔：沒有黑色視窗看不到訊息，出問題時看 %TEMP%\rpg-batch.log
const LOG = path.join(os.tmpdir(), 'rpg-batch.log');
const log = msg => { try { fs.appendFileSync(LOG, `[${new Date().toLocaleString()}] ${msg}\n`); } catch (e) { /* 略過 */ } };
process.on('uncaughtException', e => { log('錯誤：' + (e.stack || e)); process.exit(1); });
function openWindow(page) {
  if (APP && process.platform === 'win32') {
    const exe = findBrowser();
    log('開啟視窗：' + (exe || '找不到 Edge/Chrome，改用預設瀏覽器') + ' ' + page);
    if (exe) {
      const prof = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'RPG-batch-tool');
      const child = spawn(exe, ['--app=' + page, '--window-size=1300,900', '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check'],
        { detached: true, stdio: 'ignore' });
      child.on('error', e => { log('開啟視窗失敗：' + e.message); exec(`start "" "${page}"`); });
      // 程式視窗是獨立的 Edge；它結束 = 視窗關了，程式跟著結束。
      // （很快就結束的話，是交給了已經開著的視窗，不算關閉）
      const t0 = Date.now();
      child.on('exit', () => { if (Date.now() - t0 > 4000) { log('程式視窗已關閉，結束'); setTimeout(() => process.exit(0), 500); } });
      child.unref();
      return;
    }
  }
  if (process.platform === 'win32') exec(`start "" "${page}"`);
  else if (process.platform === 'darwin') exec(`open "${page}"`);
}
// 程式模式：視窗關掉（網頁不再連線）就自動結束，不會一直留在背景
function watchClose() {
  const start = Date.now();
  let lastCheck = start, emptySince = 0;
  setInterval(() => {
    const now = Date.now();
    // 電腦剛從睡眠醒來：所有視窗重新計時
    if (now - lastCheck > 15000) for (const id of pages.keys()) pages.set(id, now);
    lastCheck = now;
    // 視窗被強制關閉、沒送 bye：太久沒 ping 就當作關了（縮小時瀏覽器會放慢計時，所以給寬一點）
    for (const [id, t] of pages) if (now - t > 150000) pages.delete(id);
    if (!everSeen) { if (now - start > 180000) { log('視窗一直沒有連上，結束'); process.exit(0); } return; }
    if (pages.size) { emptySince = 0; return; }
    if (!emptySince) emptySince = now;
    else if (now - emptySince > 5000) process.exit(0); // 等 5 秒：只是重新整理的話，新頁面會馬上連回來
  }, 1000);
}
// 已經有一個在跑：直接開視窗連過去，不再開第二個（設定才會共用）
function pingExisting(port) {
  return new Promise(ok => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 800 }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => ok(d.includes('rpg-batch')));
    });
    req.on('error', () => ok(false)); req.on('timeout', () => { req.destroy(); ok(false); });
  });
}

let port = 8090;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && port < 8110) { port++; server.listen(port, '127.0.0.1'); }
  else { console.error('伺服器啟動失敗：', e.message); process.exit(1); }
});
server.on('listening', () => {
  const page = `http://localhost:${port}/tools/batch.html`;
  console.log(`批次轉換已啟動：${page}`);
  console.log('原圖資料夾：' + (F.src || '（還沒選）'));
  console.log('輸出資料夾：' + (F.out || '（還沒選）'));
  if (APP) watchClose(); else console.log('用完關閉這個視窗即可。');
  if (!process.argv.includes('--no-open')) openWindow(page);
});
pingExisting(8090).then(running => {
  if (running) { openWindow('http://localhost:8090/tools/batch.html'); setTimeout(() => process.exit(0), 1500); }
  else server.listen(port, '127.0.0.1');
});
