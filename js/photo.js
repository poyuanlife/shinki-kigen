'use strict';
// =====================================================
//  用照片當主角：拍正面、側面、背面三張全身照 → 在手機上去背 → 產生走路、跑步、攻擊、受傷、倒下動畫
//  照片只在這台裝置上處理和保存（IndexedDB），不會上傳。
//  去背和產生動作在 tools/photo-hero.html 裡做（用隱藏的 iframe 載入，只有用到時才載入）。
// =====================================================

const PhotoHero = (() => {
  const SLOTS = [
    { id: 'front', name: '正面', tip: '面對鏡頭' },
    { id: 'side', name: '側面', tip: '身體轉 90 度，朝左朝右都可以' },
    { id: 'back', name: '背面', tip: '背對鏡頭' },
  ];
  const cut = {};          // cut[id] = cutout() 的結果
  let frameP = null, made = null, panel = null, busy = false, previewTimer = 0;

  // ---------- 存在這台裝置上（IndexedDB） ----------
  const DB = 'shinki-photo', STORE = 'heroes';
  const db = () => new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
  });
  const dbDo = (mode, fn) => db().then(d => new Promise((ok, fail) => {
    const tx = d.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => ok(req && req.result); tx.onerror = () => fail(tx.error);
  }));
  const load = cls => dbDo('readonly', s => s.get(cls)).catch(() => null);
  const save = (cls, rec) => dbDo('readwrite', s => s.put(rec, cls));
  const remove = cls => dbDo('readwrite', s => s.delete(cls));

  // ---------- 把照片角色套到遊戲 ----------
  const specKey = cls => 'photo_' + cls;
  function buildSpec(cls, rec) {
    const anims = {};
    for (const [id, a] of Object.entries(rec.meta.anims)) {
      anims[id] = { file: URL.createObjectURL(rec.sheets[id]), cw: a.w, ch: a.h, n: a.frames, ms: a.ms, ox: a.ox, oy: a.oy };
      if (['attack', 'hit', 'dead'].includes(id)) anims[id].once = true;
    }
    const base = rec.meta.anims.idle || rec.meta.anims.walk;
    SPEC[specKey(cls)] = { ox: base.ox, oy: base.oy, h: 30, res: rec.meta.res, anims, smooth: true, custom: true, photo: true };
    return Promise.all(Object.values(anims).map(a => new Promise(r => { const im = img(a.file); if (ready(im)) r(); else { im.addEventListener('load', r); im.addEventListener('error', r); } })));
  }
  // 開始遊戲時：這個職業有照片角色，就換上
  async function restore(p) {
    const rec = await load(p.cls);
    if (!rec || P !== p) return;
    await buildSpec(p.cls, rec);
    if (P === p) p.spr = specKey(p.cls);
  }

  // ---------- 拍照範例（簡單的人形剪影） ----------
  const SIL = {
    // 正面：手臂離身體一個拳頭、雙腳微開
    front: '<circle cx="50" cy="24" r="15"/><rect x="45" y="37" width="10" height="8"/><path d="M33 46 Q50 41 67 46 L66 104 Q50 108 34 104 Z"/>' +
      '<path d="M35 50 L16 110" class="lb"/><path d="M65 50 L84 110" class="lb"/><path d="M43 104 L39 200" class="lb"/><path d="M57 104 L61 200" class="lb"/>' +
      '<ellipse cx="37" cy="204" rx="9" ry="4"/><ellipse cx="63" cy="204" rx="9" ry="4"/>',
    // 側面（朝左）：手臂自然垂在身體旁、兩腳一前一後一點點
    side: '<circle cx="50" cy="24" r="15"/><path d="M36 22 L31 28 L37 30 Z"/><rect x="45" y="37" width="10" height="8"/><path d="M38 46 Q52 41 64 47 L62 104 Q50 108 40 104 Z"/>' +
      '<path d="M51 52 L44 112" class="lb"/><path d="M46 104 L42 200" class="lb"/><path d="M56 104 L60 200" class="lb"/>' +
      '<ellipse cx="38" cy="204" rx="10" ry="4"/><ellipse cx="54" cy="204" rx="10" ry="4"/>',
    // 背面：跟正面一樣的姿勢，頭髮畫深一點表示背面
    back: '<circle cx="50" cy="24" r="15"/><path d="M36 20 Q50 2 64 20 L64 32 Q50 40 36 32 Z" class="hair"/><rect x="45" y="37" width="10" height="8"/><path d="M33 46 Q50 41 67 46 L66 104 Q50 108 34 104 Z"/>' +
      '<path d="M35 50 L16 110" class="lb"/><path d="M65 50 L84 110" class="lb"/><path d="M43 104 L39 200" class="lb"/><path d="M57 104 L61 200" class="lb"/>' +
      '<ellipse cx="37" cy="204" rx="9" ry="4"/><ellipse cx="63" cy="204" rx="9" ry="4"/>',
  };
  const exampleHtml = id => `<div class="phEx"><svg viewBox="0 0 100 212" aria-hidden="true">${SIL[id]}</svg><span>範例</span></div>`;

  // ---------- 畫面 ----------
  function build() {
    panel = document.createElement('div');
    panel.id = 'photoPanel'; panel.className = 'hidden';
    panel.innerHTML = `
      <div class="phBox">
        <h2>用照片當主角<span class="close" id="phClose">×</span></h2>
        <div class="phHint">先用手機拍好<b>三張全身照</b>（正面、側面、背面），再從相簿選進來。照片只在這台裝置上處理和保存，<b>不會上傳</b>。第一次使用要下載去背工具（約 13 MB）。</div>
        <details class="phTips" open>
          <summary>拍照範例與注意事項</summary>
          <div class="phTipCols">
            <ul class="ok">
              <li><b>全身入鏡</b>，頭頂到腳底都要拍到，人站在畫面中間</li>
              <li><b>手臂稍微張開</b>，離身體約一個拳頭（像下面的範例）</li>
              <li><b>雙腳微微分開</b>，站直</li>
              <li><b>側面</b>：身體轉 90 度，朝左朝右都可以</li>
              <li>背景單純、光線充足；三張照片穿同一套衣服</li>
              <li>請別人幫忙拍，或用手機的倒數計時自己拍</li>
            </ul>
            <ul class="ng">
              <li>手插口袋、雙手抱胸、手貼著身體</li>
              <li>拿著東西、背著大包包</li>
              <li>坐著、蹲著、腳被東西擋住</li>
              <li>多個人一起入鏡</li>
              <li>太暗、逆光</li>
            </ul>
          </div>
        </details>
        <div class="phSlots">${SLOTS.map(s => `
          <div class="phSlot" data-id="${s.id}">
            <div class="phName">${s.name}<small>${s.tip}</small></div>
            <div class="phImg">${exampleHtml(s.id)}</div>
            <div class="phStr hidden"><span>寬鬆</span><input type="range" min="0" max="100" value="45" aria-label="去背強度"><span>嚴格</span></div>
            <div class="phBtns">
              <label class="phBtn">選擇照片<input type="file" accept="image/*" hidden></label>
            </div>
          </div>`).join('')}
        </div>
        <div class="phStatus" id="phStatus"></div>
        <div class="phPreview hidden" id="phPreview"></div>
        <div class="phDebugOut hidden" id="phDebugOut"></div>
        <div class="phActions">
          <button class="big" id="phMake" disabled>產生角色</button>
          <button class="big hidden" id="phUse">使用這個角色</button>
          <button class="hidden" id="phDebug">儲存檢查用圖片</button>
          <button id="phReset" class="hidden">還原原本的外觀</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    $('phClose').onclick = close;
    panel.addEventListener('pointerdown', e => { if (e.target === panel) close(); });
    for (const el of panel.querySelectorAll('.phSlot')) {
      for (const inp of el.querySelectorAll('input[type=file]')) inp.addEventListener('change', () => { const f = inp.files[0]; inp.value = ''; if (f) pick(el.dataset.id, f); });
      const rng = el.querySelector('.phStr input');
      rng.addEventListener('input', () => { clearTimeout(rng._t); rng._t = setTimeout(() => adjust(el.dataset.id, +rng.value), 200); });
    }
    $('phMake').onclick = make;
    $('phUse').onclick = use;
    $('phDebug').onclick = debugImage;
    $('phReset').onclick = reset;
  }
  const status = (t, warn) => { const s = $('phStatus'); s.textContent = t || ''; s.classList.toggle('warn', !!warn); };

  // 隱藏的幫手頁面（去背、產生動作）
  function helper() {
    if (frameP) return frameP;
    frameP = new Promise((ok, fail) => {
      const f = document.createElement('iframe');
      f.src = 'tools/photo-hero.html'; f.style.display = 'none'; f.setAttribute('aria-hidden', 'true');
      f.onload = () => {
        const w = f.contentWindow, t0 = Date.now();
        const wait = () => w.photoHeroReady ? ok(w) : Date.now() - t0 > 15000 ? fail(new Error('載入失敗')) : setTimeout(wait, 50);
        wait();
      };
      f.onerror = () => fail(new Error('載入失敗'));
      document.body.appendChild(f);
    });
    frameP.catch(() => { frameP = null; });
    return frameP;
  }

  async function pick(id, file) {
    if (busy) return;
    busy = true; made = null; $('phUse').classList.add('hidden'); $('phPreview').classList.add('hidden');
    Diag.mute(20000); // 去背時畫面會卡一下（遊戲是暫停的），不算畫面停頓
    const box = panel.querySelector(`.phSlot[data-id="${id}"] .phImg`);
    box.innerHTML = '<span>處理中…</span>';
    try {
      const w = await helper();
      const slot = panel.querySelector(`.phSlot[data-id="${id}"]`), rng = slot.querySelector('.phStr input');
      const r = await w.cutout(file, t => status(t), +rng.value);
      cut[id] = r; showCut(id, r);
      slot.querySelector('.phStr').classList.remove('hidden');
      status(r.feetCut ? `${SLOTS.find(s => s.id === id).name}：腳好像沒有完全入鏡，動作可能會怪怪的，建議重拍。` : `${SLOTS.find(s => s.id === id).name}：去背完成。`, r.feetCut);
    } catch (e) {
      box.innerHTML = exampleHtml(id);
      status('去背失敗：' + (e && e.message || e), true);
    }
    busy = false;
    $('phMake').disabled = !(cut.front && cut.side && cut.back);
    $('phDebug').classList.toggle('hidden', !(cut.front || cut.side || cut.back));
  }

  // 去背強度調整：用同一張照片重新套門檻（不重新辨識）
  async function adjust(id, strength) {
    if (!cut[id]) return;
    if (busy) { clearTimeout(adjust._t); adjust._t = setTimeout(() => adjust(id, strength), 300); return; }
    busy = true;
    try {
      const w = await helper(), r = await w.recut(cut[id].key, strength);
      cut[id] = r; showCut(id, r);
      // 照片改了，之前產生的角色要重做
      if (made) { made = null; $('phUse').classList.add('hidden'); $('phPreview').classList.add('hidden'); }
      status(SLOTS.find(s => s.id === id).name + '：去背已調整。全部調好後請按「產生角色」。');
    } catch (e) { status((e && e.message) || String(e), true); }
    busy = false;
  }
  function showCut(id, r) {
    const box = panel.querySelector(`.phSlot[data-id="${id}"] .phImg`);
    box.innerHTML = '';
    const im = new Image(); im.src = URL.createObjectURL(r.blob); box.appendChild(im);
  }

  async function make() {
    if (busy || !(cut.front && cut.side && cut.back)) return;
    busy = true; $('phMake').disabled = true;
    Diag.mute(20000);
    try {
      const w = await helper();
      made = await w.makeCharacter({ front: cut.front, side: cut.side, back: cut.back }, t => status(t));
      status(made.warn && made.warn.length ? made.warn.join(' ') : '完成！下面是預覽，滿意的話按「使用這個角色」。');
      showPreview(made);
      $('phUse').classList.remove('hidden'); $('phDebug').classList.remove('hidden');
    } catch (e) { status('產生失敗：' + (e && e.message || e) + '　可以按「儲存檢查用圖片」傳給開發者。', true); }
    busy = false; $('phMake').disabled = false; $('phDebug').classList.remove('hidden');
  }

  // 預覽：每個動作一列、四個方向一起播
  function showPreview(m) {
    const pv = $('phPreview'); pv.classList.remove('hidden'); pv.innerHTML = '';
    clearInterval(previewTimer);
    const rows = [['walk', '走路'], ['run', '跑步'], ['attack', '攻擊']], cvs = [];
    for (const [id, label] of rows) {
      const a = m.meta.anims[id]; if (!a) continue;
      const row = document.createElement('div'); row.className = 'phRow';
      row.innerHTML = `<span>${label}</span>`;
      const im = new Image(); im.src = URL.createObjectURL(m.sheets[id]);
      for (let d = 0; d < 4; d++) {
        const c = document.createElement('canvas'), k = 72 / a.h; c.width = Math.round(a.w * k); c.height = 72;
        row.appendChild(c); cvs.push({ c, im, a, d, k });
      }
      pv.appendChild(row);
    }
    let f = 0;
    previewTimer = setInterval(() => {
      f++;
      for (const v of cvs) {
        if (!v.im.complete) continue;
        const x = v.c.getContext('2d'), fr = f % v.a.frames;
        x.clearRect(0, 0, v.c.width, v.c.height); x.imageSmoothingQuality = 'high';
        x.drawImage(v.im, v.d * v.a.w, fr * v.a.h, v.a.w, v.a.h, 0, 0, v.c.width, v.c.height);
      }
    }, 120);
  }

  // ---------- 檢查用圖片：去背結果 + 偵測到的關節 + 產生的動作，組成一張圖給開發者看 ----------
  // MediaPipe 身體點的連線（肩、手、髖、腳）
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];
  const loadImg = blob => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = URL.createObjectURL(blob); });
  async function debugImage() {
    if (busy) return;
    busy = true; status('製作檢查用圖片中…');
    try {
      const PH = 420, pad = 12, parts = [];
      // 第一列：三張去背照片 + 關節（左＝本人左邊的點畫藍色、右＝紅色）
      const cuts = [];
      for (const s of SLOTS) {
        const c = cut[s.id]; if (!c) continue;
        const im = await loadImg(c.blob), k = PH / im.height, cw = Math.round(im.width * k);
        cuts.push({ s, c, im, k, cw });
      }
      const sheets = [];
      if (made) for (const id of ['walk', 'run', 'attack', 'hit', 'dead']) if (made.sheets[id]) sheets.push({ id, im: await loadImg(made.sheets[id]) });
      const W = Math.max(cuts.reduce((a, v) => a + v.cw + pad, pad), ...sheets.map(v => v.im.width + pad * 2), 600);
      const H = 90 + PH + pad * 2 + sheets.reduce((a, v) => a + v.im.height + 30, 0);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d');
      x.fillStyle = '#20252b'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#fff'; x.font = '15px sans-serif';
      x.fillText('照片主角 檢查用圖片　' + new Date().toLocaleString(), pad, 22);
      x.font = '11px monospace'; x.fillStyle = '#bcd';
      x.fillText(navigator.userAgent.slice(0, 150), pad, 40);
      x.fillText('照片：' + cuts.map(v => `${v.s.name} ${v.c.w}x${v.c.h}${v.c.facing && v.s.id === 'side' ? ' 朝' + (v.c.facing === 'left' ? '左' : '右') : ''}${v.c.feetCut ? ' 腳被切到' : ''}`).join('，'), pad, 56);
      if (made) x.fillText('動作：' + Object.entries(made.meta.anims).map(([k, a]) => `${k} ${a.w}x${a.h}×${a.frames}`).join('，'), pad, 72);
      let cx = pad;
      for (const v of cuts) {
        const y0 = 90;
        x.fillStyle = '#6f9a45'; x.fillRect(cx, y0, v.cw, PH);
        x.drawImage(v.im, cx, y0, v.cw, PH);
        const P = i => v.c.lm && v.c.lm[i] ? [cx + v.c.lm[i].x * v.k, y0 + v.c.lm[i].y * v.k] : null;
        x.lineWidth = 2;
        for (const [a, b] of BONES) {
          const pa = P(a), pb = P(b); if (!pa || !pb) continue;
          x.strokeStyle = a % 2 ? 'rgba(80,160,255,.9)' : 'rgba(255,90,90,.9)'; x.beginPath(); x.moveTo(...pa); x.lineTo(...pb); x.stroke();
        }
        if (v.c.lm) v.c.lm.forEach((p, i) => { if (i < 11 && i !== 0) return; const q = P(i); x.fillStyle = i === 0 ? '#ff0' : i % 2 ? '#5af' : '#f55'; x.fillRect(q[0] - 3, q[1] - 3, 6, 6); });
        x.fillStyle = '#fff'; x.font = '13px sans-serif'; x.fillText(v.s.name, cx + 4, y0 + 16);
        cx += v.cw + pad;
      }
      // 下面：每個動作的精靈圖（直欄 = 下、上、左、右；橫列 = 幀）
      let y = 90 + PH + pad;
      for (const v of sheets) {
        x.fillStyle = '#fff'; x.font = '13px sans-serif'; x.fillText(v.id, pad, y + 14);
        x.fillStyle = '#6f9a45'; x.fillRect(pad, y + 20, v.im.width, v.im.height); x.drawImage(v.im, pad, y + 20);
        y += v.im.height + 30;
      }
      const blob = await new Promise(ok => cv.toBlob(ok, 'image/png'));
      const url = URL.createObjectURL(blob), name = 'photo-hero-check-' + Date.now() + '.png';
      // 下載；iPhone 可能不會自動下載，所以也顯示在畫面上（長按儲存）
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      const out = $('phDebugOut'); out.classList.remove('hidden');
      out.innerHTML = '<div>如果沒有自動下載，<b>長按下面的圖片</b>選「儲存影像」，再傳給開發者。</div>';
      const im = new Image(); im.src = url; out.appendChild(im);
      status('檢查用圖片已產生（' + Math.round(blob.size / 1024) + ' KB）。');
    } catch (e) { status('製作失敗：' + (e && e.message || e), true); }
    busy = false;
  }

  async function use() {
    if (!made || !P) return;
    const rec = { sheets: made.sheets, meta: made.meta, savedAt: Date.now() };
    try { await save(P.cls, rec); } catch (e) { status('存不進這台裝置（瀏覽器可能是無痕模式）：' + (e && e.message || e), true); }
    await buildSpec(P.cls, rec);
    P.spr = specKey(P.cls);
    addLog('已換上照片主角（系統選單可以還原）', '#8cf');
    close();
  }
  async function reset() {
    if (!P) return;
    try { await remove(P.cls); } catch (e) { /* 沒存過就算了 */ }
    if (P.spr === specKey(P.cls)) delete P.spr;
    addLog('已還原原本的外觀', '#8cf');
    close();
  }

  async function open() {
    if (!P || G.state !== 'play') return;
    if (!panel) build();
    panel.classList.remove('hidden');
    G.paused = true; $('paused').classList.remove('hidden');
    status('');
    const has = !!(await load(P.cls)) || P.spr === specKey(P.cls);
    $('phReset').classList.toggle('hidden', !has);
    $('phMake').disabled = busy || !(cut.front && cut.side && cut.back);
    helper().catch(() => {}); // 先在背景載入幫手頁面
  }
  function close() {
    if (!panel) return;
    panel.classList.add('hidden'); clearInterval(previewTimer);
    G.paused = false; $('paused').classList.add('hidden');
  }
  const isOpen = () => !!panel && !panel.classList.contains('hidden');

  return { open, close, isOpen, restore, _test: { cut, make: () => make(), use: () => use(), pickBlob: (id, b) => pick(id, b) } };
})();
