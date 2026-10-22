'use strict';
// =====================================================
//  診斷回報：記錄錯誤、畫面停頓、顯示卡重置、異常結束
//  按 F2 開啟報告，可複製或下載給開發者
//  （放在所有程式之前載入，才抓得到載入時的錯誤）
// =====================================================

const Diag = (() => {
  const KEY = 'dm_diag_log', BEAT = 'dm_diag_beat', MAX = 60;
  let log = [];
  try { log = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { log = []; }
  // 遊戲裡會設定這個函式，回傳當下狀態（FPS、記憶體、位置……）
  let snapshotFn = null;

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX))); } catch (e) { /* 空間不足就算了 */ } };
  function snap() { try { return snapshotFn ? snapshotFn() : null; } catch (e) { return { snapshotError: String(e) }; } }

  function add(type, msg, extra) {
    const entry = { time: new Date().toLocaleString('zh-TW', { hour12: false }), type, msg: String(msg).slice(0, 500) };
    if (extra) Object.assign(entry, extra);
    const s = snap(); if (s) entry.state = s;
    log.push(entry); if (log.length > MAX) log = log.slice(-MAX);
    save();
    if (type !== '資訊') toast(`${type}：${entry.msg.slice(0, 60)}　（按 F2 查看報告）`);
    return entry;
  }

  // ---- 自動攔截 ----
  addEventListener('error', e => {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) { add('載入失敗', e.target.src || e.target.href); return; }
    add('程式錯誤', e.message, { where: `${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}`, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1500) : '' });
  }, true);
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    add('程式錯誤', r && r.message ? r.message : String(r), { stack: r && r.stack ? String(r.stack).slice(0, 1500) : '' });
  });

  // 畫面停頓：requestAnimationFrame 兩次之間隔太久（分頁在背景時不算）
  let lastFrame = 0, hidden = document.visibilityState !== 'visible', muteUntil = 0;
  document.addEventListener('visibilitychange', () => { hidden = document.visibilityState !== 'visible'; lastFrame = 0; });
  function watch(now) {
    if (lastFrame && !hidden) {
      const gap = now - lastFrame;
      if (gap > 1000 && now > muteUntil) add('畫面停頓', `畫面停住了 ${(gap / 1000).toFixed(1)} 秒`, { gapMs: Math.round(gap) });
    }
    lastFrame = now;
    requestAnimationFrame(watch);
  }
  requestAnimationFrame(watch);

  // 心跳：每 2 秒記下「還在執行」與目前狀態；正常關閉時清掉。
  // 下次打開若還留著，代表上次是當機、崩潰或被強制關閉。
  try {
    const prev = JSON.parse(localStorage.getItem(BEAT) || 'null');
    if (prev && prev.alive) {
      log.push({ time: new Date().toLocaleString('zh-TW', { hour12: false }), type: '異常結束',
        msg: `上次遊戲沒有正常結束（最後一次回報在 ${prev.time}），可能是當機、瀏覽器崩潰或記憶體不足`, state: prev.state });
      save();
      setTimeout(() => toast('上次遊戲沒有正常結束，已記錄到報告（按 F2 查看）'), 800);
    }
  } catch (e) { /* 忽略 */ }
  setInterval(() => {
    try { localStorage.setItem(BEAT, JSON.stringify({ alive: true, time: new Date().toLocaleString('zh-TW', { hour12: false }), state: snap() })); } catch (e) { /* 忽略 */ }
  }, 2000);
  addEventListener('pagehide', () => { try { localStorage.setItem(BEAT, JSON.stringify({ alive: false })); } catch (e) { /* 忽略 */ } });

  // ---- 環境資訊 ----
  function gpuName() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return '無法取得（不支援 WebGL）';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return name;
    } catch (e) { return '無法取得'; }
  }
  function envInfo() {
    const n = navigator;
    return [
      `瀏覽器：${n.userAgent}`,
      `顯示卡：${gpuName()}`,
      `螢幕：${screen.width}×${screen.height}，視窗 ${innerWidth}×${innerHeight}，像素比 ${devicePixelRatio}`,
      `CPU 核心：${n.hardwareConcurrency || '?'}，記憶體：${n.deviceMemory ? n.deviceMemory + ' GB 以上' : '?'}`,
      performance.memory ? `JS 記憶體：已用 ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB / 上限 ${(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : '',
    ].filter(Boolean).join('\n');
  }

  function reportText() {
    const lines = ['===== 神機紀元 診斷報告 =====', `產生時間：${new Date().toLocaleString('zh-TW', { hour12: false })}`, envInfo(), ''];
    const now = snap(); if (now) lines.push('目前狀態：' + JSON.stringify(now), '');
    if (!log.length) lines.push('（沒有任何紀錄）');
    log.forEach((e, i) => {
      lines.push(`#${i + 1} [${e.time}] ${e.type}：${e.msg}`);
      if (e.where) lines.push(`   位置：${e.where}`);
      if (e.stack) lines.push('   ' + e.stack.split('\n').slice(0, 6).join('\n   '));
      if (e.state) lines.push('   狀態：' + JSON.stringify(e.state));
    });
    return lines.join('\n');
  }

  // ---- 介面：提示與報告視窗 ----
  let toastEl = null, toastTimer = 0;
  function toast(text) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;right:16px;bottom:150px;z-index:9999;max-width:420px;padding:10px 14px;border-radius:6px;' +
        'background:rgba(60,10,10,.92);border:1px solid #a33;color:#fdd;font:13px/1.5 "Microsoft JhengHei",sans-serif;cursor:pointer;';
      toastEl.onclick = open;
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text; toastEl.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 7000);
  }

  let panel = null;
  function open() {
    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;inset:6% 8%;z-index:10000;display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:8px;' +
        'background:#16130f;border:1px solid #6b5a3a;color:#e8dcc4;font:13px "Microsoft JhengHei",sans-serif;box-shadow:0 10px 40px #000;';
      panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
          <b style="font-size:16px;color:#d9a441;flex:1">診斷報告（F2 關閉）</b>
          <button data-a="copy">複製</button><button data-a="dl">下載 .txt</button><button data-a="clear">清除紀錄</button><button data-a="close">關閉</button>
        </div>
        <div style="color:#9a8b70">遇到錯誤或當機時，把這份報告貼給開發者就能幫助除錯。報告只包含遊戲狀態與電腦環境，不含個人資料。</div>
        <textarea readonly style="flex:1;width:100%;box-sizing:border-box;background:#0d0b09;color:#d8ccb4;border:1px solid #3e3427;font:12px/1.5 Consolas,monospace;padding:8px;resize:none"></textarea>`;
      panel.querySelectorAll('button').forEach(b => { b.style.cssText = 'background:#2a241c;color:#e8dcc4;border:1px solid #6b5a3a;border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit'; });
      panel.addEventListener('click', e => {
        const a = e.target.dataset && e.target.dataset.a; if (!a) return;
        const ta = panel.querySelector('textarea');
        if (a === 'copy') {
          ta.select();
          (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(
            () => { e.target.textContent = '已複製！'; }, () => { document.execCommand('copy'); e.target.textContent = '已複製！'; });
          setTimeout(() => { e.target.textContent = '複製'; }, 1500);
        } else if (a === 'dl') {
          const url = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }));
          const link = document.createElement('a'); link.href = url; link.download = `診斷報告_${Date.now()}.txt`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else if (a === 'clear') { if (confirm('清除所有診斷紀錄？')) { log = []; save(); ta.value = reportText(); } }
        else if (a === 'close') close();
      });
      document.body.appendChild(panel);
    }
    panel.querySelector('textarea').value = reportText();
    panel.style.display = 'flex';
  }
  function close() { if (panel) panel.style.display = 'none'; }
  function toggle() { if (panel && panel.style.display !== 'none') close(); else open(); }
  addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); toggle(); } });

  // 一段時間內不記錄畫面停頓（例如載入地圖時）
  const mute = ms => { muteUntil = performance.now() + ms; };
  return { add, open, toggle, reportText, mute, setSnapshot: fn => { snapshotFn = fn; } };
})();
