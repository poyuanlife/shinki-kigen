'use strict';
// =====================================================
//  技能列（參考暗黑破壞神 II 重製版）
//  - 左鍵技能、右鍵技能：點格子跳出技能清單選擇
//  - 快捷鍵 1～8：清單開著時，滑鼠移到技能上按數字鍵就綁定
//    按快捷鍵 = 切換該手的技能（可在系統選單改成「直接施放」）
//  - 手機：攻擊鍵 = 左鍵技能，4 個技能鍵可各自指定；長按就能換
// =====================================================

const ATTACK = 'attack';   // 普通攻擊（不是技能樹裡的技能，但可以放在左右鍵）
const HAND_NAME = { L: '左鍵', R: '右鍵' };
let HOTKEY_MODE = (() => { try { return localStorage.getItem('dm_hotkey') || 'swap'; } catch (e) { return 'swap'; } })();
function setHotkeyMode(m) { HOTKEY_MODE = m; try { localStorage.setItem('dm_hotkey', m); } catch (e) { /* 忽略 */ } }

// 技能的名稱、圖示、顏色
function skillInfo(id) {
  if (id === ATTACK || !SKILLS[id]) return { name: '普通攻擊', icon: '✦', color: '#e8cf94' };
  const sk = SKILLS[id], tree = ALL_TREES.find(t => t.skills.includes(id));
  return { name: sk.name, icon: sk.icon, color: tree ? tree.color : '#ccc' };
}
// 已學會的主動技能（依技能樹順序）
const learnedActive = () => clsOf(P).trees.flatMap(t => t.skills).filter(id => SKILLS[id].type === 'active' && (P.skills[id] || 0) > 0);
// 沒學會的技能不能用：回到普通攻擊
const validSkill = id => (id === ATTACK || ((P.skills[id] || 0) > 0 && SKILLS[id] && SKILLS[id].type === 'active') ? id : ATTACK);

// 存檔沒有這些欄位時補上預設值
function ensureSkillSlots(p) {
  const C = clsOf(p);
  if (!p.leftSkill) p.leftSkill = ATTACK;
  if (!p.rightSkill) p.rightSkill = C.first;
  if (!Array.isArray(p.hotkeys) || p.hotkeys.length !== 8) p.hotkeys = C.hotbar.map(id => ({ id, hand: 'R' }));
  if (!Array.isArray(p.touchSkills) || p.touchSkills.length !== 4) p.touchSkills = [null, null, null, null];
}

// 使用技能：普通攻擊 / 技能；技能放不出來（冷卻、魔力不足）時改用普通攻擊
// 使用技能：左右鍵是什麼就只放什麼；技能冷卻中或魔力不足時什麼都不做（和暗黑 2 一樣，不會改用普通攻擊）
function useSkill(id, pt, held) {
  id = validSkill(id);
  if (id !== ATTACK) return castSkill(id, pt, held);
  if (P.atkCd > 0) return false;
  P.face = Math.atan2(pt.y - P.y, pt.x - P.x);
  basicAttack(pt.x, pt.y);
  return true;
}

// 按快捷鍵
function pressHotkey(n) {
  const hk = P.hotkeys[n];
  if (!hk || !hk.id) { addLog(`快捷鍵 ${n + 1} 還沒設定：點左右技能格，滑鼠移到技能上按 ${n + 1}`, '#aaa'); return; }
  if (HOTKEY_MODE === 'cast') { useSkill(hk.id, mouseWorld(), false); return; }
  if (hk.id !== ATTACK && !((P.skills[hk.id] || 0) > 0)) { addLog(`尚未學習「${skillInfo(hk.id).name}」`, '#aaa'); return; }
  if (hk.hand === 'L') P.leftSkill = hk.id; else P.rightSkill = hk.id;
  Snd.play('ui');
  renderHotbar();
}

// ---------- 技能選擇清單 ----------
// target：'L' / 'R'（電腦左右鍵）或 0～3（手機技能鍵）、'tL'（手機攻擊鍵）
let pick = null;
function openSkillPick(target, anchor) {
  closeSkillPick();
  const box = document.createElement('div');
  box.id = 'skillPick';
  const isHand = target === 'L' || target === 'R' || target === 'tL';
  const ids = [...(isHand ? [ATTACK] : []), ...learnedActive()];
  const title = target === 'L' || target === 'tL' ? '左鍵技能（攻擊鍵）' : target === 'R' ? '右鍵技能' : `技能鍵 ${target + 1}`;
  box.innerHTML = `<div class="spTitle">${title}<span class="spClose">×</span></div>` +
    (ids.length ? '' : '<div class="spEmpty">還沒有學會主動技能（按 技能 學習）</div>') +
    `<div class="spList">${ids.map(id => {
      const inf = skillInfo(id), hand = target === 'tL' ? 'L' : target;
      const keys = !TOUCH && (hand === 'L' || hand === 'R') ? P.hotkeys.map((h, i) => (h && h.id === id && h.hand === hand ? i + 1 : 0)).filter(Boolean) : [];
      const cur = target === 'L' || target === 'tL' ? P.leftSkill : target === 'R' ? P.rightSkill : P.touchSkills[target];
      return `<button class="spItem${cur === id ? ' cur' : ''}" data-id="${id}"><span class="spIcon" style="color:${inf.color}">${inf.icon}</span>
        <span class="spName">${inf.name}</span>${keys.length ? `<span class="spKey">${keys.join(' ')}</span>` : ''}</button>`;
    }).join('')}</div>` +
    (!TOUCH && (target === 'L' || target === 'R') ? '<div class="spHint">滑鼠移到技能上按 1～8 設定快捷鍵</div>' : '') +
    (typeof target === 'number' ? '<div class="spList"><button class="spItem" data-id="">（清空這一格）</button></div>' : '');
  document.body.appendChild(box);
  pick = { target, box, hover: null };
  box.querySelector('.spClose').onclick = closeSkillPick;
  box.querySelectorAll('.spItem').forEach(b => {
    // 清單可能已經關掉（例如剛選完），所以都要先檢查 pick
    b.onmouseenter = () => { if (!pick) return; pick.hover = b.dataset.id; if (b.dataset.id && b.dataset.id !== ATTACK) showTip(skillHtml(b.dataset.id)); };
    b.onmouseleave = () => { if (pick) pick.hover = null; hideTip(); };
    b.onclick = () => { if (pick) choose(b.dataset.id); };
  });
  // 電腦版：靠近點的格子；手機版：畫面正中央（CSS）
  if (!TOUCH && anchor) {
    const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.max(6, Math.min(innerWidth - bw - 6, r.left + r.width / 2 - bw / 2)) + 'px';
    box.style.top = Math.max(6, r.top - bh - 8) + 'px';
  }
}
function choose(id) {
  const t = pick.target;
  if (t === 'L' || t === 'tL') P.leftSkill = id || ATTACK;
  else if (t === 'R') P.rightSkill = id || ATTACK;
  else P.touchSkills[t] = id || null;
  Snd.play('ui');
  closeSkillPick();
  renderHotbar();
}
function closeSkillPick() { if (pick) { pick.box.remove(); pick = null; hideTip(); } }
// 清單開著時：數字鍵 = 綁定快捷鍵；Esc = 關閉。回傳 true 代表按鍵已處理
function skillPickKey(k) {
  if (!pick) return false;
  if (k === 'escape') { closeSkillPick(); return true; }
  if (k >= '1' && k <= '8' && pick.hover && (pick.target === 'L' || pick.target === 'R')) {
    const n = +k - 1, id = pick.hover, hand = pick.target;
    for (let i = 0; i < 8; i++) if (P.hotkeys[i] && P.hotkeys[i].id === id && P.hotkeys[i].hand === hand) P.hotkeys[i] = null;   // 同一個技能只綁一個鍵
    P.hotkeys[n] = { id, hand };
    addLog(`快捷鍵 ${k} → ${HAND_NAME[hand]}「${skillInfo(id).name}」`, '#8cf');
    Snd.play('ui');
    const target = pick.target, anchor = $(target === 'L' ? 'slotL' : 'slotR');
    openSkillPick(target, anchor);   // 重畫清單，顯示新的按鍵
    renderHotbar();
    return true;
  }
  return false;
}
addEventListener('pointerdown', e => { if (pick && !pick.box.contains(e.target) && !e.target.closest('#slotL,#slotR,.tSk,#tAtk,#tAtkSwap')) closeSkillPick(); }, true);

// ---------- 快捷列（電腦版）：[左鍵技能] [1～8] [右鍵技能] ----------
function renderSkillBar() {
  const hb = $('hotbar'); hb.innerHTML = '';
  const big = (hand, id) => {
    const inf = skillInfo(id), d = document.createElement('div');
    d.className = 'hk big'; d.id = 'slot' + hand; d.dataset.id = id;
    d.innerHTML = `<span class="hkKey">${HAND_NAME[hand]}</span><span class="hkIcon" style="color:${inf.color}">${inf.icon}</span><div class="cdMask"></div>`;
    d.onclick = () => (pick && pick.target === hand ? closeSkillPick() : openSkillPick(hand, d));
    d.onmouseenter = () => { if (!pick) showTip(id === ATTACK ? '<div class="tipName">普通攻擊</div><div class="dim">擲出武器攻擊</div><div class="dim" style="margin-top:6px">點一下更換技能</div>' : skillHtml(id) + '<div class="dim" style="margin-top:6px">點一下更換技能</div>'); };
    d.onmouseleave = hideTip;
    return d;
  };
  hb.appendChild(big('L', validSkill(P.leftSkill)));   // 沒學會的技能顯示成普通攻擊，但不改設定（學會後自動生效）
  for (let i = 0; i < 8; i++) {
    const hk = P.hotkeys[i], d = document.createElement('div');
    const ok = hk && (hk.id === ATTACK || (P.skills[hk.id] || 0) > 0);
    const on = hk && validSkill(hk.hand === 'L' ? P.leftSkill : P.rightSkill) === hk.id;
    d.className = 'hk' + (ok ? '' : ' off') + (on ? ' sel' : '');
    d.dataset.id = hk ? hk.id : '';
    const inf = hk ? skillInfo(hk.id) : null;
    d.innerHTML = `<span class="hkKey">${i + 1}</span>${inf ? `<span class="hkIcon" style="color:${inf.color}">${inf.icon}</span><span class="hkHand">${hk.hand}</span>` : ''}<div class="cdMask"></div>`;
    d.onclick = () => pressHotkey(i);
    d.onmouseenter = () => { if (hk && hk.id !== ATTACK) showTip(skillHtml(hk.id) + `<div class="dim" style="margin-top:6px">按 ${i + 1}：${HOTKEY_MODE === 'swap' ? '切換為' + HAND_NAME[hk.hand] + '技能' : '直接施放'}</div>`); };
    d.onmouseleave = hideTip;
    hb.appendChild(d);
  }
  hb.appendChild(big('R', validSkill(P.rightSkill)));
}
// 每 0.05 秒更新冷卻與魔力不足
function updateSkillBarHUD() {
  for (const el of document.querySelectorAll('#hotbar .hk')) {
    const id = el.dataset.id, mask = el.querySelector('.cdMask');
    if (!id || id === ATTACK || !SKILLS[id]) { mask.style.height = '0'; el.classList.remove('nomana'); continue; }
    const cd = P.cds[id] || 0, mx = P.cdMax[id] || 1;
    mask.style.height = (cd > 0 ? cd / mx * 100 : 0) + '%';
    const lv = P.st.lv(id);
    el.classList.toggle('nomana', lv > 0 && P.mp < Math.round(SKILLS[id].mana(lv)));
  }
}
