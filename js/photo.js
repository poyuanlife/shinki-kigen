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

  // ---------- 畫面 ----------
  function build() {
    panel = document.createElement('div');
    panel.id = 'photoPanel'; panel.className = 'hidden';
    panel.innerHTML = `
      <div class="phBox">
        <h2>用照片當主角<span class="close" id="phClose">×</span></h2>
        <div class="phHint">請別人幫你拍<b>三張全身照</b>：正面、側面、背面。<b>手臂稍微張開</b>（離身體約一個拳頭）、<b>雙腳微開</b>、腳要入鏡，背景越單純越好。
          照片只在這台裝置上處理和保存，<b>不會上傳</b>。第一次使用要下載去背工具（約 13 MB）。</div>
        <div class="phSlots">${SLOTS.map(s => `
          <div class="phSlot" data-id="${s.id}">
            <div class="phName">${s.name}<small>${s.tip}</small></div>
            <div class="phImg"><span>還沒拍</span></div>
            <div class="phBtns">
              <label class="phBtn">拍照<input type="file" accept="image/*" capture="environment" hidden></label>
              <label class="phBtn">相簿<input type="file" accept="image/*" hidden></label>
            </div>
          </div>`).join('')}
        </div>
        <div class="phStatus" id="phStatus"></div>
        <div class="phPreview hidden" id="phPreview"></div>
        <div class="phActions">
          <button class="big" id="phMake" disabled>產生角色</button>
          <button class="big hidden" id="phUse">使用這個角色</button>
          <button id="phReset" class="hidden">還原原本的外觀</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    $('phClose').onclick = close;
    panel.addEventListener('pointerdown', e => { if (e.target === panel) close(); });
    for (const el of panel.querySelectorAll('.phSlot')) {
      for (const inp of el.querySelectorAll('input')) inp.addEventListener('change', () => { const f = inp.files[0]; inp.value = ''; if (f) pick(el.dataset.id, f); });
    }
    $('phMake').onclick = make;
    $('phUse').onclick = use;
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
      const r = await w.cutout(file, t => status(t));
      cut[id] = r;
      box.innerHTML = '';
      const im = new Image(); im.src = URL.createObjectURL(r.blob); box.appendChild(im);
      status(r.feetCut ? `${SLOTS.find(s => s.id === id).name}：腳好像沒有完全入鏡，動作可能會怪怪的，建議重拍。` : `${SLOTS.find(s => s.id === id).name}：去背完成。`, r.feetCut);
    } catch (e) {
      box.innerHTML = '<span>失敗</span>';
      status('去背失敗：' + (e && e.message || e), true);
    }
    busy = false;
    $('phMake').disabled = !(cut.front && cut.side && cut.back);
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
      $('phUse').classList.remove('hidden');
    } catch (e) { status('產生失敗：' + (e && e.message || e), true); }
    busy = false; $('phMake').disabled = false;
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
