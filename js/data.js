'use strict';
// =====================================================
//  遊戲資料（物品、詞綴、技能、怪物）
// =====================================================

// ---------- 小工具 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rand(a, b + 1));
const rr = (a, b) => Math.max(1, Math.round(rand(a, Math.max(a, b))));
const choice = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let _uid = 1;
const uid = () => 'i' + Date.now().toString(36) + (_uid++);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 稀有度 ----------
const RARITIES = [
  { name: '普通', color: '#e2e2e2', affix: [0, 0], mult: 1.0, sell: 1 },
  { name: '精良', color: '#5b9bff', affix: [1, 2], mult: 1.15, sell: 3 },
  { name: '傳奇', color: '#ffbf3a', affix: [3, 4], mult: 1.35, sell: 8 },
  { name: '史詩', color: '#c867ff', affix: [5, 6], mult: 1.6, sell: 20 },
];

// ---------- 裝備欄位 ----------
const SLOT_NAMES = { weapon: '武器', helm: '頭盔', armor: '胸甲', gloves: '手套', boots: '靴子', belt: '腰帶', amulet: '項鍊', ring: '戒指' };
const EQUIP_SLOTS = ['amulet', 'helm', 'ring1', 'weapon', 'armor', 'gloves', 'ring2', 'belt', 'boots'];
const slotType = s => (s.startsWith('ring') ? 'ring' : s);

// key 沿用舊名（存檔相容）；shot = 投擲物外觀
const WEAPON_TYPES = [
  { key: 'rifle', names: ['鐵手裏劍', '鋼手裏劍', '風魔手裏劍', '天狗手裏劍'], mult: 1.0, spd: 1.0, range: 7.5 },
  { key: 'smg', names: ['練習苦無', '鍛鐵苦無', '疾風苦無', '影縫苦無'], mult: 0.72, spd: 1.4, range: 6.5 },
  { key: 'shotgun', names: ['撒菱', '鐵撒菱', '毒撒菱', '修羅撒菱'], mult: 1.5, spd: 0.72, range: 5.5 },
  { key: 'gatling', names: ['連射筒', '袖箭筒', '千本筒', '雷神筒'], mult: 0.56, spd: 1.85, range: 7 },
  { key: 'rail', names: ['大型手裏劍', '車輪手裏劍', '鬼神手裏劍', '天叢雲手裏劍'], mult: 2.1, spd: 0.55, range: 10 },
];
const ARMOR_TYPES = {
  helm: { names: ['布頭巾', '鉢金', '鐵兜', '鬼面兜'], f: 0.6 },
  armor: { names: ['忍裝束', '鎖帷子', '胴丸', '大鎧'], f: 1.0 },
  gloves: { names: ['布手甲', '皮手甲', '鐵手甲', '龍鱗手甲'], f: 0.35 },
  boots: { names: ['草鞋', '足袋', '脛當', '天狗下駄'], f: 0.4 },
  belt: { names: ['麻帶', '角帶', '錦帶', '龍皮帶'], f: 0.3 },
  amulet: { names: ['木勾玉', '翡翠勾玉', '御守', '八尺瓊勾玉'], f: 0 },
  ring: { names: ['銅指輪', '銀指輪', '金指輪', '靈玉指輪'], f: 0 },
};
const DROP_SLOTS = [
  ['weapon', 22], ['helm', 11], ['armor', 11], ['gloves', 10], ['boots', 10],
  ['belt', 9], ['amulet', 8], ['ring', 12],
];

const ALL = ['weapon', 'helm', 'armor', 'gloves', 'boots', 'belt', 'amulet', 'ring'];
const AFFIXES = {
  dmgPct:   { t: '+{v}% 增強傷害', slots: ['weapon', 'gloves', 'amulet', 'ring'], roll: l => rr(8, 15 + l * 1.2) },
  flatDmg:  { t: '+{v} 附加傷害', slots: ['weapon', 'ring', 'amulet', 'gloves'], roll: l => rr(1 + l * 0.3, 3 + l * 0.9) },
  atkSpd:   { t: '+{v}% 攻擊速度', slots: ['weapon', 'gloves', 'ring'], roll: l => rr(5, 12 + l * 0.12) },
  crit:     { t: '+{v}% 暴擊率', slots: ['weapon', 'helm', 'amulet', 'ring', 'gloves'], roll: l => rr(1, 3 + l * 0.06) },
  critDmg:  { t: '+{v}% 暴擊傷害', slots: ['weapon', 'amulet', 'helm'], roll: l => rr(10, 20 + l * 0.6) },
  hp:       { t: '+{v} 生命值', slots: ['helm', 'armor', 'belt', 'boots', 'amulet', 'ring', 'gloves'], roll: l => rr(5 + l * 1.5, 15 + l * 4) },
  mp:       { t: '+{v} 魔力值', slots: ['helm', 'amulet', 'ring', 'belt'], roll: l => rr(5 + l, 10 + l * 2.5) },
  def:      { t: '+{v} 防禦', slots: ['helm', 'armor', 'gloves', 'boots', 'belt'], roll: l => rr(3 + l, 8 + l * 3) },
  str:      { t: '+{v} 力量', slots: ALL, roll: l => rr(1 + l * 0.08, 3 + l * 0.25) },
  dex:      { t: '+{v} 敏捷', slots: ALL, roll: l => rr(1 + l * 0.08, 3 + l * 0.25) },
  vit:      { t: '+{v} 體力', slots: ALL, roll: l => rr(1 + l * 0.08, 3 + l * 0.25) },
  ene:      { t: '+{v} 精神', slots: ALL, roll: l => rr(1 + l * 0.08, 3 + l * 0.25) },
  lifeSteal:{ t: '{v}% 生命竊取', slots: ['weapon', 'ring', 'gloves', 'amulet'], roll: l => rr(1, 3 + l * 0.04) },
  hpRegen:  { t: '+{v} 生命回復/秒', slots: ['armor', 'helm', 'belt', 'ring', 'amulet'], roll: l => rr(1 + l * 0.1, 2 + l * 0.4) },
  mpRegen:  { t: '+{v} 魔力回復/秒', slots: ['helm', 'amulet', 'ring'], roll: l => rr(1, 2 + l * 0.1) },
  moveSpd:  { t: '+{v}% 移動速度', slots: ['boots'], roll: l => rr(5, 10 + l * 0.1) },
  mf:       { t: '+{v}% 寶物尋找', slots: ['helm', 'amulet', 'ring', 'boots', 'gloves'], roll: l => rr(5, 10 + l * 0.4) },
  dr:       { t: '+{v}% 傷害減免', slots: ['armor', 'helm', 'belt'], roll: l => rr(1, 3 + l * 0.06) },
  cdr:      { t: '-{v}% 技能冷卻', slots: ['helm', 'amulet', 'gloves'], roll: l => rr(3, 6 + l * 0.1) },
  allSkills:{ t: '+{v} 所有技能等級', slots: ['amulet', 'helm', 'weapon'], roll: l => (l >= 40 ? rint(1, 2) : 1), minRarity: 2 },
};

const EPIC_NAMES = ['村正', '正宗', '天狗之羽', '月影', '八咫烏', '風林火山', '櫻吹雪',
  '雷切', '九尾之誓', '百鬼夜行', '朧月夜', '不知火', '鬼燈', '神樂', '天照'];
const LEG_PREFIX = ['烈火', '雷光', '鋼鐵', '疾風', '月讀', '影', '修羅', '鷹眼', '金剛', '不動', '天罰', '曉'];
const FINE_PREFIX = ['上等', '精製', '改良', '名匠'];

// ---------- 技能 ----------
// 等級 l 表示「有效等級」（含 +所有技能）
const SKILL_TREES = [
  { name: '投擲術', color: '#ff9f43', skills: ['burst', 'pierce', 'scatter', 'gatling'] },
  { name: '體術', color: '#4fb3ff', skills: ['plating', 'stim', 'shield', 'overload'] },
  { name: '忍法', color: '#7bed6f', skills: ['grenade', 'turret', 'precision', 'orbital'] },
];
const SKILLS = {
  burst: { name: '連投', type: 'active', req: 1, pre: null, icon: '≫',
    mana: l => 2 + l * 0.4, cd: () => 0,
    desc: l => `快速擲出 ${3 + Math.floor(l / 5)} 枚手裏劍，每枚造成 ${110 + l * 12}% 武器傷害。` },
  pierce: { name: '貫通', type: 'passive', req: 6, pre: 'burst', icon: '➤',
    desc: l => `所有投擲物有 ${Math.min(80, 15 + l * 4)}% 機率穿透敵人；投擲傷害 +${l * 5}%。` },
  scatter: { name: '散華', type: 'active', req: 12, pre: 'burst', icon: '✺',
    mana: l => 6 + l * 0.6, cd: () => 0,
    desc: l => `扇形擲出 ${7 + Math.floor(l / 3)} 枚手裏劍，每枚造成 ${70 + l * 9}% 武器傷害。` },
  gatling: { name: '千本嵐', type: 'active', req: 24, pre: 'scatter', icon: '✹',
    mana: l => 18 + l, cd: () => 8,
    desc: l => `${(2.5 + l * 0.1).toFixed(1)} 秒內每秒擲出 15 枚手裏劍，每枚 ${55 + l * 6}% 武器傷害。投擲時可移動。` },

  plating: { name: '鐵甲功', type: 'passive', req: 1, pre: null, icon: '⛨',
    desc: l => `防禦 +${l * 12}%，生命上限 +${l * 4}%。` },
  stim: { name: '狂氣', type: 'active', req: 6, pre: 'plating', icon: '✚',
    mana: () => 0, cd: () => 14,
    desc: l => `消耗 10% 當前生命，${(6 + l * 0.5).toFixed(1)} 秒內攻擊速度 +${30 + l * 3}%、移動速度 +30%。` },
  shield: { name: '結界', type: 'active', req: 12, pre: 'plating', icon: '◈',
    mana: l => 12 + l, cd: () => 12,
    desc: (l, st) => `產生可吸收 ${shieldAmount(l, st)} 點傷害的護盾，持續 20 秒。（隨最大魔力提升）` },
  overload: { name: '鬼神之力', type: 'passive', req: 18, pre: 'stim', icon: '⚡',
    desc: l => `所有傷害 +${l * 7}%，魔力回復 +${(l * 0.6).toFixed(1)}/秒。` },

  grenade: { name: '爆裂符', type: 'active', req: 1, pre: null, icon: '●',
    mana: l => 5 + l * 0.5, cd: () => 0.8,
    desc: l => `擲出爆裂符，對範圍內敵人造成 ${160 + l * 22}% 武器傷害。` },
  turret: { name: '式神', type: 'active', req: 6, pre: 'grenade', icon: '⌖',
    mana: l => 14 + l, cd: () => 2,
    desc: l => `召喚自動攻擊的式神 18 秒，每發 ${45 + l * 7}% 武器傷害，最多同時 ${1 + Math.floor(l / 6)} 座。` },
  precision: { name: '明鏡止水', type: 'passive', req: 12, pre: null, icon: '◎',
    desc: l => `暴擊率 +${l}%，暴擊傷害 +${l * 8}%。` },
  orbital: { name: '雷遁·天雷', type: 'active', req: 24, pre: 'turret', icon: '☄',
    mana: l => 30 + l * 1.5, cd: () => 7,
    desc: l => `召喚天雷，1 秒後對大範圍造成 ${600 + l * 70}% 武器傷害。` },
};
const HOTBAR = ['burst', 'scatter', 'gatling', 'grenade', 'turret', 'orbital', 'stim', 'shield'];
const SKILL_MAX = 20;
function shieldAmount(l, st) { return Math.round(40 + l * 30 + (st ? st.maxMp * 1.5 : 0)); }

// ---------- 怪物 ----------
// spr = 外觀（見 gfx.js 的 SPEC）、scale = 額外放大、fly = 會飛（上下飄）、shot = 遠程攻擊的投擲物
const MONSTERS = {
  ghoul:   { name: '綠史萊姆', hp: 1.0, dmg: 1.0, speed: 2.3, r: 0.32, melee: true, range: 0.9, atkCd: 1.1, exp: 1.0, blood: '#6fd24a', spr: 'slime', scale: 1.1 },
  hound:   { name: '吸血蝙蝠', hp: 0.7, dmg: 0.7, speed: 4.3, r: 0.3, melee: true, range: 0.9, atkCd: 0.8, exp: 0.9, blood: '#7a8fd8', spr: 'bat', fly: true },
  skel:    { name: '骷髏武士', hp: 1.3, dmg: 1.1, speed: 2.0, r: 0.32, melee: true, range: 0.95, atkCd: 1.2, exp: 1.2, blood: '#e8e0c8', spr: 'skeleton' },
  archer:  { name: '赤忍', hp: 0.75, dmg: 0.9, speed: 2.4, r: 0.3, melee: false, range: 7, atkCd: 1.6, exp: 1.1, blood: '#c83030', spr: 'ninjared', shot: 'kunai' },
  cultist: { name: '鬼火', hp: 0.8, dmg: 1.1, speed: 2.0, r: 0.3, melee: false, range: 6, atkCd: 1.8, exp: 1.2, blood: '#ff8a30', spr: 'flam', fly: true, shot: 'fire' },
  brute:   { name: '獨眼鬼', hp: 2.6, dmg: 1.8, speed: 1.7, r: 0.5, melee: true, range: 1.2, atkCd: 1.6, exp: 2.2, blood: '#8a5030', spr: 'cyclope', scale: 1.7 },
  boss:    { name: '鬼王 · 酒吞童子', hp: 16, dmg: 2.4, speed: 2.2, r: 0.6, melee: true, range: 1.7, atkCd: 1.4, exp: 20, blood: '#ff5030', spr: 'demon', scale: 1 },
};
const PACKS = [
  { w: 5, types: ['ghoul', 'ghoul', 'ghoul', 'ghoul'] },
  { w: 3, types: ['hound', 'hound', 'hound'] },
  { w: 3, types: ['skel', 'skel', 'archer'] },
  { w: 3, types: ['cultist', 'ghoul', 'ghoul'] },
  { w: 2, types: ['brute', 'ghoul', 'ghoul'] },
  { w: 2, types: ['archer', 'archer', 'skel'] },
  { w: 2, types: ['cultist', 'cultist', 'hound'] },
];
const UNIQUE_NAMES = ['碎骨', '血染', '腐朽', '瘟疫', '無面', '焚城', '寒霜', '鐵顎'];

// ---------- 數值曲線 ----------
const MAX_LEVEL = 99;
const expNext = L => Math.floor(40 + 25 * L * L * (1 + L / 50));
const monHp = L => 30 + L * 12 + L * L * 1.4;
const monDmg = L => 3 + L * 1.2 + L * L * 0.035;
const monExp = L => 10 + L * 4 + L * L * 0.6;

// ---------- 物品產生 ----------
function weightedSlot() {
  const total = DROP_SLOTS.reduce((s, d) => s + d[1], 0);
  let r = Math.random() * total;
  for (const [s, w] of DROP_SLOTS) { if ((r -= w) <= 0) return s; }
  return 'weapon';
}
function tierOf(ilvl) { return ilvl < 18 ? 0 : ilvl < 40 ? 1 : ilvl < 70 ? 2 : 3; }

function genItem(ilvl, rarity, slot, wkey) {
  ilvl = clamp(Math.round(ilvl), 1, 99);
  slot = slot || weightedSlot();
  const R = RARITIES[rarity];
  const tier = tierOf(ilvl);
  const it = { id: uid(), slot, rarity, ilvl, req: Math.max(1, ilvl - 3), affixes: [] };
  if (slot === 'weapon') {
    const wt = WEAPON_TYPES.find(w => w.key === wkey) || choice(WEAPON_TYPES);
    it.wkey = wt.key;
    it.base = wt.names[tier];
    const avg = (6 + ilvl * 2.4) * wt.mult * R.mult;
    it.dmg = [Math.max(1, Math.round(avg * 0.7)), Math.max(2, Math.round(avg * 1.3))];
    it.spd = wt.spd;
    it.range = wt.range;
  } else {
    const at = ARMOR_TYPES[slot];
    it.base = at.names[tier];
    if (at.f > 0) it.def = Math.max(1, Math.round((2 + ilvl * 1.6) * at.f * R.mult));
  }
  // 詞綴
  const n = rint(R.affix[0], R.affix[1]);
  const pool = Object.keys(AFFIXES).filter(k => AFFIXES[k].slots.includes(slot) && (AFFIXES[k].minRarity || 0) <= rarity);
  for (let i = 0; i < n && pool.length; i++) {
    const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    let v = AFFIXES[k].roll(ilvl);
    if (rarity === 3 && k !== 'allSkills') v = Math.round(v * 1.25);
    it.affixes.push({ k, v });
  }
  // 名稱
  if (rarity === 3) it.name = `《${choice(EPIC_NAMES)}》${it.base}`;
  else if (rarity === 2) it.name = `${choice(LEG_PREFIX)}${it.base}`;
  else if (rarity === 1) it.name = `${choice(FINE_PREFIX)}${it.base}`;
  else it.name = it.base;
  it.price = Math.round((10 + ilvl * 3) * R.sell);
  return it;
}

function rollRarity(mf, bonus) {
  const m = (1 + mf / 100) * bonus;
  const r = Math.random();
  if (r < 0.008 * m) return 3;
  if (r < 0.05 * m) return 2;
  if (r < 0.26 * Math.sqrt(m)) return 1;
  return 0;
}
