// 把 Flare 的素材轉成遊戲用的 WebP + JSON（輸出到 assets/flare/）
// 用法：node tools/flare/build-flare.js <Flare 素材資料夾> [只轉哪些，例如 tiles:field monster:goblin hero:samurai]
//   Flare 素材資料夾 = flare-game 的 mods/fantasycore（要有 images、animations、tilesetdefs、engine）
// 會在背景開一個看不到的 Edge 來做裁切、縮小、壓縮（Node 本身沒有處理圖片的功能）
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, 'assets', 'flare'), HERE = __dirname;
const SRC = process.argv[2], only = process.argv.slice(3);
if (!SRC || !fs.existsSync(path.join(SRC, 'images'))) { console.error('請給 Flare 的 mods/fantasycore 資料夾路徑'); process.exit(1); }
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

// 路徑不能跑出指定的資料夾
const inside = (base, rel) => { const p = path.resolve(base, rel); return p.startsWith(path.resolve(base) + path.sep) ? p : null; };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/save') {
    const f = inside(OUT, u.searchParams.get('p') || '');
    if (!f) { res.writeHead(400); res.end(); return; }
    const chunks = [];
    req.on('data', c => chunks.push(c)).on('end', () => {
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.concat(chunks));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  const f = u.pathname.startsWith('/src/') ? inside(SRC, decodeURIComponent(u.pathname.slice(5))) : inside(HERE, decodeURIComponent(u.pathname.slice(1)) || 'flare-pack.html');
  if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port, dbg = 9300 + Math.floor(Math.random() * 600);
  const prof = path.join(require('os').tmpdir(), 'flare-build-' + Date.now());
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--no-first-run', 'about:blank']);
  const done = code => { try { edge.kill(); } catch (e) { /* 已經關了 */ } server.close(); process.exit(code); };
  try {
    let tabs = [];
    for (let i = 0; i < 60 && !tabs.length; i++) { try { tabs = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).filter(t => t.type === 'page'); } catch (e) { /* 還沒好 */ } await sleep(200); }
    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl); let id = 0; const pend = {};
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
    await new Promise(r => { ws.onopen = r; });
    const send = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/flare-pack.html` }); await sleep(1500);
    const r = await send('Runtime.evaluate', { expression: `runAll(${JSON.stringify(only.length ? only : null)})`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    for (const l of r.result.result.value) console.log('✓ ' + l);
    done(0);
  } catch (e) { console.error('失敗：', e.message); done(1); }
});
