'use strict';
// =====================================================
//  手機觸控操作：虛擬搖桿、攻擊鍵、技能鍵、全螢幕、直向提示
//  網址加上 #touch 可以在電腦上強制開啟（測試用）
// =====================================================

const TOUCH = /[#&?-]touch/.test(location.href) ||
  matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
if (TOUCH) document.documentElement.classList.add('touch');

const TouchUI = (() => {
  const joy = { on: false, x: 0, y: 0, mag: 0, id: null, cx: 0, cy: 0 };
  let atkHeld = false, built = false;
  const R = 52;   // 搖桿可推動的半徑（螢幕像素）

  // 瞄準：射程內（多給一點）最近、沒被擋住的敵人；沒有的話就是面前 4 格
  function aim(maxD) {
    let best = null, bd = maxD || Math.max(9, P.st.range + 1.5);
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = dist(e, P);
      if (d < bd && shotClear(P.x, P.y, e.x, e.y)) { bd = d; best = e; }
    }
    if (best) return { x: best.x, y: best.y, e: best, d: bd };
    return { x: P.x + Math.cos(P.face) * 4, y: P.y + Math.sin(P.face) * 4, e: null };
  }

  // 技能鍵 i 目前的技能（沒學會就當作空的）
  const slotSkill = i => { const id = P.touchSkills[i]; return id && (P.skills[id] || 0) > 0 ? id : null; };
  // 長按（0.45 秒）打開技能清單；回傳 true 代表這次是長按
  const LONG = 450;
  function longPress(el, target) {
    let tm = 0;
    el.addEventListener('pointerdown', () => { el._long = false; clearTimeout(tm); tm = setTimeout(() => { el._long = true; atkHeld = false; el.classList.remove('down'); openSkillPick(target); }, LONG); });
    const stop = () => clearTimeout(tm);
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('pointerleave', stop);
  }

  function build() {
    if (built) return; built = true;
    const ui = document.createElement('div');
    ui.id = 'touchUI'; ui.className = 'ingame hidden';
    ui.innerHTML = `
      <div id="joyZone"><div id="joyBase"><div id="joyKnob"></div></div></div>
      <div id="tActions">
        <button id="tAtk" aria-label="攻擊"><span>攻擊</span></button>
        <button id="tAtkSwap" aria-label="更換攻擊鍵技能">⇄</button>
        <button id="tPick" class="hidden" aria-label="拾取裝備">拾取</button>
        <button id="tRun" aria-label="切換跑步">跑</button>
        ${[0, 1, 2, 3].map(i => `<button class="tSk" id="tSk${i}" data-i="${i}"><span class="tIcon"></span><span class="tName"></span><div class="tCd"></div></button>`).join('')}
      </div>`;
    document.body.appendChild(ui);

    // ---- 搖桿 ----
    const zone = $('joyZone'), base = $('joyBase'), knob = $('joyKnob');
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    zone.addEventListener('pointerdown', e => {
      if (G.paused || G.state !== 'play') return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      Object.assign(joy, { on: true, id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
      move(e);
    });
    const move = e => {
      if (!joy.on || e.pointerId !== joy.id) return;
      let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      // 方向 = 單位向量，力道 = 推動距離 / 半徑（0～1）
      joy.mag = Math.min(1, d / R);
      joy.x = d > 0 ? dx / Math.hypot(dx, dy) : 0;
      joy.y = d > 0 ? dy / Math.hypot(dx, dy) : 0;
      setKnob(dx, dy);
    };
    const end = e => { if (e.pointerId !== joy.id) return; Object.assign(joy, { on: false, x: 0, y: 0, mag: 0, id: null }); setKnob(0, 0); };
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

    // ---- 跑步鍵（切換跑／走）----
    $('tRun').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleRun(); });
    syncRun();

    // ---- 攻擊鍵（按住連續攻擊）----
    const atk = $('tAtk');
    atk.addEventListener('pointerdown', e => { e.preventDefault(); atk.setPointerCapture(e.pointerId); atkHeld = true; atk.classList.add('down'); });
    const atkUp = () => { atkHeld = false; atk.classList.remove('down'); };
    atk.addEventListener('pointerup', atkUp); atk.addEventListener('pointercancel', atkUp);
    // 攻擊鍵要按住連續攻擊，所以不用長按；旁邊的小按鈕用來換技能
    $('tAtkSwap').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); openSkillPick('tL'); });
    // 拾取鍵：附近有裝備時才出現
    $('tPick').addEventListener('pointerdown', e => { e.preventDefault(); if (!G.paused) pickupNearest(); });

    // ---- 技能鍵 ----
    for (let i = 0; i < 4; i++) {
      const b = $('tSk' + i);
      longPress(b, i);   // 長按：換這一格的技能
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (G.paused || P.dead) return;
        const id = slotSkill(i);
        if (!id) { if (learnedActive().length) openSkillPick(i); else addLog('按 技能 學習新技能後，就能放到這裡。', '#aaa'); return; }
        const t = aim();
        if (t.e) P.face = Math.atan2(t.y - P.y, t.x - P.x);
        castSkill(id, t, false);
      });
    }
    // 防止長按跳出選單、雙擊放大
    ui.addEventListener('contextmenu', e => e.preventDefault());
  }

  // 每幀：處理攻擊鍵
  function update() {
    if (!P || P.dead || G.paused || G.state !== 'play') return;
    if (!atkHeld && !(G.held && G.held.space)) return;
    const t = aim();
    if (t.e) {
      if (inReach(validSkill(P.leftSkill), t.e)) {
        P.face = Math.atan2(t.y - P.y, t.x - P.x);
        useSkill(P.leftSkill, t, true);
      } else if (!joy.on && !keyMoveDir()) P.target = t.e;   // 太遠：自動走過去（正在手動移動時不搶方向）
    } else useSkill(P.leftSkill, t, true);
  }

  // 每 0.05 秒：更新技能鍵的圖示、冷卻、魔力
  function hud() {
    if (!built) return;
    $('tPick').classList.toggle('hidden', !nearestItem());
    const L = validSkill(P.leftSkill), atkLabel = L === ATTACK ? '攻擊' : skillInfo(L).name;
    const span = $('tAtk').querySelector('span');
    if (span.textContent !== atkLabel) { span.textContent = atkLabel; span.style.fontSize = atkLabel.length > 2 ? '13px' : ''; }
    for (let i = 0; i < 4; i++) {
      const b = $('tSk' + i), id = slotSkill(i);
      b.classList.toggle('empty', !id);
      if (!id) { b.querySelector('.tIcon').textContent = '＋'; b.querySelector('.tName').textContent = ''; b.querySelector('.tCd').style.height = '0'; continue; }
      const sk = SKILLS[id], tree = ALL_TREES.find(t => t.skills.includes(id));
      const ic = b.querySelector('.tIcon');
      if (ic.textContent !== sk.icon) { ic.textContent = sk.icon; ic.style.color = tree.color; b.querySelector('.tName').textContent = sk.name; }
      const cd = P.cds[id] || 0, mx = P.cdMax[id] || 1;
      b.querySelector('.tCd').style.height = (cd > 0 ? cd / mx * 100 : 0) + '%';
      const lv = P.st.lv(id);
      b.classList.toggle('nomana', lv > 0 && P.mp < Math.round(sk.mana(lv)));
    }
  }

  // ---- 全螢幕 ----
  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    }
  }

  // ---- 直向提示 ----
  let rotateDismissed = false;
  function checkRotate() {
    const el = $('rotateHint');
    if (!el) return;
    el.classList.toggle('hidden', !TOUCH || rotateDismissed || innerWidth >= innerHeight);
  }

  function init() {
    if (!TOUCH) return;
    build();
    // 功能按鈕拿掉電腦按鍵的標示，例如「角色 (C)」→「角色」
    document.querySelectorAll('.hudBtns button').forEach(btn => { const n = btn.firstChild; if (n && n.nodeType === 3) n.textContent = n.textContent.replace(/\s*\(.*?\)/, ''); });
    document.querySelectorAll('.pot small').forEach(el => el.remove());
    // 手機版的操作說明
    const help = document.querySelector('#title .help');
    if (help) help.innerHTML = `<b>手機操作</b>　左下搖桿：移動　｜　「跑」：切換跑步　｜　右下「攻擊」：按住自動攻擊最近的敵人　｜　技能鍵：對最近的敵人施放<br>
      點怪物：攻擊　點道具：撿起　點 NPC：對話　｜　上方按鈕：角色、背包、技能、選單<br>
      <span class="dim">建議橫向遊玩；用瀏覽器選單的「加到主畫面」可以像 App 一樣全螢幕開啟</span>`;
    // 開始遊戲時順便進入全螢幕（Android 有效；iPhone 請用「加到主畫面」）
    for (const id of ['btnNew', 'btnLoad']) $(id).addEventListener('click', goFullscreen);
    const rh = document.createElement('div');
    rh.id = 'rotateHint'; rh.className = 'hidden';
    rh.innerHTML = '<div class="rotIcon">⟳</div><div>請將手機轉成<b>橫向</b>遊玩</div><button class="big" id="rotOk">仍要直向遊玩</button>';
    document.body.appendChild(rh);
    $('rotOk').onclick = () => { rotateDismissed = true; checkRotate(); };
    addEventListener('resize', checkRotate);
    checkRotate();
  }

  // 跑步鍵的亮暗跟著目前狀態
  function syncRun() { const b = document.getElementById('tRun'); if (b) b.classList.toggle('on', !!G.runOn); }

  return { joy, init, update, hud, aim, goFullscreen, syncRun };
})();
