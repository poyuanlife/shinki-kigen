// 把「圖片批次轉換」打包成單一 exe（內含 Node.js，之後電腦沒裝 Node.js 也能用）
// 用法：node tools/build-exe.js
// 產出：遊戲資料夾裡的「圖片批次轉換.exe」。改過 batch.html 等工具檔之後，要重新執行這個打包。
// 使用 Node.js 內建的「單一執行檔」功能（SEA）；打包工具 postject、rcedit 只裝在 tools/.exe-build 裡，不影響遊戲。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TOOLS = __dirname;
const BUILD = path.join(TOOLS, '.exe-build');
const OUT = path.join(ROOT, '圖片批次轉換.exe');
// 要包進 exe 的網頁檔（跟 batch-server.js 的 EMBED 清單一致）
const ASSETS = ['batch.html', 'pixel-core.js', 'sprite-core.js', 'batch-icon.png', 'sprite-generator.html', 'pixel-converter.html', 'tool-nav.js', 'rig-core.js'];
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const step = msg => console.log('▶ ' + msg);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, Object.assign({ stdio: 'inherit', shell: process.platform === 'win32' }, opt));

(async () => {
  if (process.platform !== 'win32') throw new Error('這個打包只支援 Windows');
  fs.mkdirSync(BUILD, { recursive: true });

  // 1. 打包工具（只裝一次）
  if (!fs.existsSync(path.join(BUILD, 'node_modules', 'postject')) || !fs.existsSync(path.join(BUILD, 'node_modules', 'rcedit'))) {
    step('下載打包工具（postject、rcedit）');
    if (!fs.existsSync(path.join(BUILD, 'package.json'))) fs.writeFileSync(path.join(BUILD, 'package.json'), '{ "private": true }\n');
    run(npmCmd, ['install', '--no-audit', '--no-fund', 'postject@1.0.0-alpha.6', 'rcedit@4'], { cwd: BUILD });
  }

  // 2. 把伺服器程式和網頁檔做成 SEA 資料
  step('準備程式內容');
  const cfg = {
    main: path.join(TOOLS, 'batch-server.js'),
    output: path.join(BUILD, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    assets: Object.fromEntries(ASSETS.map(a => [a, path.join(TOOLS, a)])),
  };
  for (const a of ASSETS) if (!fs.existsSync(cfg.assets[a])) throw new Error('找不到 ' + a);
  fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(cfg, null, 2));
  run(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')], { shell: false });

  // 3. 複製 node.exe，換圖示和檔案資訊
  step('複製 Node.js 執行環境、設定圖示');
  const tmp = path.join(BUILD, 'app.exe');
  fs.copyFileSync(process.execPath, tmp);
  const rcedit = require(path.join(BUILD, 'node_modules', 'rcedit'));
  await rcedit(tmp, {
    icon: path.join(TOOLS, 'batch-icon.ico'),
    'file-version': '1.0.0', 'product-version': '1.0.0',
    'version-string': { FileDescription: '圖片批次轉換', ProductName: '神機紀元 圖片批次轉換', OriginalFilename: '圖片批次轉換.exe', CompanyName: '', LegalCopyright: '' },
  });

  // 4. 把程式內容注入 exe
  step('注入程式內容');
  run(process.execPath, [path.join(BUILD, 'node_modules', 'postject', 'dist', 'cli.js'), tmp, 'NODE_SEA_BLOB', cfg.output, '--sentinel-fuse', FUSE], { shell: false });

  // 5. 改成「視窗程式」：執行時不會跳出黑色命令視窗
  step('設定成不顯示黑色視窗');
  const buf = fs.readFileSync(tmp);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('exe 格式不對');
  buf.writeUInt16LE(2, pe + 24 + 68); // Subsystem：2 = Windows GUI
  fs.writeFileSync(tmp, buf);

  // 6. 放到遊戲資料夾
  try { fs.copyFileSync(tmp, OUT); }
  catch (e) { throw new Error('無法覆蓋「圖片批次轉換.exe」，可能正在執行中。請關掉程式視窗，等幾秒再打包一次。'); }
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(0);
  console.log(`\n完成：${OUT}（${mb} MB）`);
})().catch(e => { console.error('\n打包失敗：' + e.message); process.exit(1); });
