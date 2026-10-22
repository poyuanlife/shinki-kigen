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

// key 沿用舊名（存檔相容）；cls = 哪個職業能用；melee = 近戰（range 是揮砍距離）
const WEAPON_TYPES = [
  { key: 'rifle', cls: 'ninja', names: ['鐵手裏劍', '鋼手裏劍', '風魔手裏劍', '天狗手裏劍'], mult: 1.0, spd: 1.0, range: 7.5 },
  { key: 'smg', cls: 'ninja', names: ['練習苦無', '鍛鐵苦無', '疾風苦無', '影縫苦無'], mult: 0.72, spd: 1.4, range: 6.5 },
  { key: 'shotgun', cls: 'ninja', names: ['撒菱', '鐵撒菱', '毒撒菱', '修羅撒菱'], mult: 1.5, spd: 0.72, range: 5.5 },
  { key: 'gatling', cls: 'ninja', names: ['連射筒', '袖箭筒', '千本筒', '雷神筒'], mult: 0.56, spd: 1.85, range: 7 },
  { key: 'rail', cls: 'ninja', names: ['大型手裏劍', '車輪手裏劍', '鬼神手裏劍', '天叢雲手裏劍'], mult: 2.1, spd: 0.55, range: 10 },
  // 武士的刀劍
  { key: 'katana', cls: 'samurai', melee: true, names: ['木刀', '打刀', '名刀', '妖刀'], mult: 1.2, spd: 1.0, range: 1.7 },
  { key: 'tanto', cls: 'samurai', melee: true, names: ['短刀', '脇差', '小太刀', '鬼丸'], mult: 0.85, spd: 1.4, range: 1.45 },
  { key: 'odachi', cls: 'samurai', melee: true, names: ['野太刀', '大太刀', '斬馬刀', '鬼斬大太刀'], mult: 1.85, spd: 0.68, range: 2.0 },
  { key: 'naginata', cls: 'samurai', melee: true, names: ['竹槍', '長槍', '薙刀', '十文字槍'], mult: 1.35, spd: 0.85, range: 2.4 },
];
const WTYPE = Object.fromEntries(WEAPON_TYPES.map(w => [w.key, w]));
const weaponCls = it => (it && it.slot === 'weapon' && WTYPE[it.wkey] ? WTYPE[it.wkey].cls : null);
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

// ---------- 武士技能 ----------
// atk：受攻擊速度限制（跟普通攻擊共用間隔）；reach：施放距離（沒有就用武器距離）
const SAMURAI_TREES = [
  { name: '劍術', color: '#ff6b5b', skills: ['iai', 'kenshin', 'tsubame', 'senjin'] },
  { name: '武道', color: '#4fb3ff', skills: ['goutai', 'kiai', 'kongou', 'bushido'] },
  { name: '奧義', color: '#f5c542', skills: ['shippu', 'kamaitachi', 'shingan', 'raijin'] },
];
Object.assign(SKILLS, {
  iai: { name: '居合斬', type: 'active', req: 1, pre: null, icon: '⚔', atk: true,
    mana: l => 2 + l * 0.4, cd: () => 0,
    desc: l => `拔刀一閃，砍向前方大範圍的敵人，造成 ${130 + l * 14}% 武器傷害。` },
  kenshin: { name: '刀意', type: 'passive', req: 6, pre: 'iai', icon: '⚚',
    desc: l => `近戰斬擊傷害 +${l * 6}%，攻擊速度 +${(l * 1.5).toFixed(1)}%。` },
  tsubame: { name: '燕返', type: 'active', req: 12, pre: 'iai', icon: '↻', atk: true,
    mana: l => 6 + l * 0.6, cd: () => 0,
    desc: l => `迴身斬擊，砍中身邊一圈所有敵人，造成 ${110 + l * 12}% 武器傷害。` },
  senjin: { name: '千刃旋風', type: 'active', req: 24, pre: 'tsubame', icon: '✺',
    mana: l => 18 + l, cd: () => 8,
    desc: l => `${(2.5 + l * 0.1).toFixed(1)} 秒內化為刀刃旋風，每 0.2 秒斬擊周圍敵人，每次 ${50 + l * 6}% 武器傷害。旋風中可移動。` },

  goutai: { name: '剛體', type: 'passive', req: 1, pre: null, icon: '⛨',
    desc: l => `防禦 +${l * 15}%，生命上限 +${l * 5}%。` },
  kiai: { name: '氣合', type: 'active', req: 6, pre: 'goutai', icon: '喝',
    mana: l => 8 + l * 0.5, cd: () => 12,
    desc: l => `大喝一聲，周圍敵人暈眩 ${(1 + l * 0.1).toFixed(1)} 秒；8 秒內傷害 +${20 + l * 2}%。` },
  kongou: { name: '金剛身', type: 'active', req: 12, pre: 'goutai', icon: '◈',
    mana: l => 10 + l, cd: () => 16,
    desc: l => `${(6 + l * 0.3).toFixed(1)} 秒內受到的傷害再減少 ${Math.min(45, 25 + l)}%。` },
  bushido: { name: '武士道', type: 'passive', req: 18, pre: 'kiai', icon: '武',
    desc: l => `所有傷害 +${l * 6}%，生命竊取 +${(l * 0.5).toFixed(1)}%。` },

  shippu: { name: '疾風斬', type: 'active', req: 1, pre: null, icon: '➤', reach: 5,
    mana: l => 4 + l * 0.5, cd: () => 1.2,
    desc: l => `向前衝刺最多 5 格，砍中路上所有敵人，造成 ${150 + l * 18}% 武器傷害。` },
  kamaitachi: { name: '鎌鼬', type: 'active', req: 6, pre: 'shippu', icon: '☾', atk: true, reach: 7,
    mana: l => 5 + l * 0.5, cd: () => 0,
    desc: l => `揮出貫穿敵人的真空刃，飛行 8 格，造成 ${100 + l * 13}% 武器傷害。` },
  shingan: { name: '心眼', type: 'passive', req: 12, pre: null, icon: '◎',
    desc: l => `暴擊率 +${l}%，暴擊傷害 +${l * 8}%。` },
  raijin: { name: '雷神一閃', type: 'active', req: 24, pre: 'kamaitachi', icon: '☇', reach: 8,
    mana: l => 30 + l * 1.5, cd: () => 7,
    desc: l => `化為雷光瞬移到目標處（最遠 8 格），落雷轟擊周圍，造成 ${450 + l * 55}% 武器傷害。` },
});
SKILLS.burst.atk = SKILLS.scatter.atk = true;

// ---------- 職業 ----------
// spr：角色圖（gfx.js 的 SPEC）；stats：初始屬性；dr：天生的傷害減免 %
const CLASSES = {
  ninja: { name: '忍者', flag: '綠忍', sub: '青葉之里的影 · 綠忍', spr: 'hero', glow: '120,200,90',
    desc: '來去無影的暗器高手。以投擲術、體術與忍法，在遠處殲滅妖怪。',
    trees: SKILL_TREES, hotbar: HOTBAR, first: 'burst', weapon: 'rifle', stats: { str: 20, dex: 15, vit: 20, ene: 10 }, dr: 0 },
  samurai: { name: '武士', flag: '赤武者', sub: '流浪的劍客 · 赤武者', spr: 'heroSamurai', glow: '230,90,70',
    desc: '一刀斬盡群妖的劍豪。貼身揮刀橫掃成群敵人，身披重甲，天生減傷 10%。',
    trees: SAMURAI_TREES, hotbar: ['iai', 'tsubame', 'senjin', 'shippu', 'kamaitachi', 'raijin', 'kiai', 'kongou'],
    first: 'iai', weapon: 'katana', stats: { str: 25, dex: 15, vit: 25, ene: 5 }, dr: 10 },
};
const CLASS_IDS = Object.keys(CLASSES);
const ALL_TREES = CLASS_IDS.flatMap(c => CLASSES[c].trees);
const clsOf = p => CLASSES[(p && p.cls) || 'ninja'] || CLASSES.ninja;
function shieldAmount(l, st) { return Math.round(40 + l * 30 + (st ? st.maxMp * 1.5 : 0)); }

// ---------- 怪物 ----------
// 怪物表（MONSTERS）與怪物群組成改由 zones.js 依區域產生
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

// cls：掉武器時只從這個職業的武器挑（不給就全部隨機）
function genItem(ilvl, rarity, slot, wkey, cls) {
  ilvl = clamp(Math.round(ilvl), 1, 99);
  slot = slot || weightedSlot();
  const R = RARITIES[rarity];
  const tier = tierOf(ilvl);
  const it = { id: uid(), slot, rarity, ilvl, req: Math.max(1, ilvl - 3), affixes: [] };
  if (slot === 'weapon') {
    const pool = cls ? WEAPON_TYPES.filter(w => w.cls === cls) : WEAPON_TYPES;
    const wt = WTYPE[wkey] || choice(pool.length ? pool : WEAPON_TYPES);
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
