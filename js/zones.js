'use strict';
// =====================================================
//  區域（地圖）設定：地面、牆、裝飾、怪物、首領、光影、天氣、地圖產生參數
//  要加新地圖：在 ZONES 裡加一段設定即可
//  需要 gfx.js（圖塊常數、mon16 / char16）
// =====================================================

// ---------- 怪物定位（各區域的怪物套用同一組數值，平衡一致） ----------
const ROLES = {
  ghoul:   { hp: 1.0, dmg: 1.0, speed: 2.3, r: 0.32, melee: true, range: 0.9, atkCd: 1.1, exp: 1.0 },   // 普通
  hound:   { hp: 0.7, dmg: 0.7, speed: 4.3, r: 0.3, melee: true, range: 0.9, atkCd: 0.8, exp: 0.9 },    // 快速
  skel:    { hp: 1.3, dmg: 1.1, speed: 2.0, r: 0.32, melee: true, range: 0.95, atkCd: 1.2, exp: 1.2 },  // 耐打
  archer:  { hp: 0.75, dmg: 0.9, speed: 2.4, r: 0.3, melee: false, range: 7, atkCd: 1.6, exp: 1.1 },    // 遠程物理
  cultist: { hp: 0.8, dmg: 1.1, speed: 2.0, r: 0.3, melee: false, range: 6, atkCd: 1.8, exp: 1.2 },     // 遠程魔法
  brute:   { hp: 2.6, dmg: 1.8, speed: 1.7, r: 0.5, melee: true, range: 1.2, atkCd: 1.6, exp: 2.2 },    // 巨型
  boss:    { hp: 16, dmg: 2.4, speed: 2.2, r: 0.6, melee: true, range: 1.7, atkCd: 1.4, exp: 20 },      // 首領
};
// 每群怪物的組成（用定位表示，實際怪物依區域換）
const PACK_ROLES = [
  { w: 5, types: ['ghoul', 'ghoul', 'ghoul', 'ghoul'] },
  { w: 3, types: ['hound', 'hound', 'hound'] },
  { w: 3, types: ['skel', 'skel', 'archer'] },
  { w: 3, types: ['cultist', 'ghoul', 'ghoul'] },
  { w: 2, types: ['brute', 'ghoul', 'ghoul'] },
  { w: 2, types: ['archer', 'archer', 'skel'] },
  { w: 2, types: ['cultist', 'cultist', 'hound'] },
];

// ---------- 新怪物、首領的外觀 ----------
const M_ = (dir, file) => `Actor/Monster/${dir}/${file || 'SpriteSheet'}.png`;
const strip = (file, cw, ch, n, ms, extra) => Object.assign({ file, cw, ch, n, ms, strip: true }, extra);
Object.assign(SPEC, {
  bamboo: mon16(M_('Bamboo')), bambooY: mon16(M_('BambooYellow')), racoon: mon16(M_('Racoon')), kappa: mon16(M_('KappaGreen')),
  mushroom: mon16(M_('Mushroom', 'mushroom'), 12), snake: mon16(M_('Snake', 'Snake'), 10), lizard: mon16(M_('Lizard', 'Lizard')),
  mole: mon16(M_('Mole', 'Mole'), 12), reptile: mon16(M_('Reptile', 'Reptile')), dragonY: mon16(M_('DragonYellow')),
  beast2: mon16(M_('Beast2', 'Beast2')), skullBlue: mon16(M_('SkullBlue')), owl: mon16(M_('Owl', 'Owl')), axolot: mon16(M_('Axolot')),
  eye2: mon16(M_('Eye2', 'Eye2'), 12), spirit2: mon16(M_('Spirit2')), bear: mon16(M_('Bear')), skull: mon16(M_('Skull')),
  spiderRed: mon16(M_('SpiderRed'), 10), mollusc: mon16(M_('Mollusc', 'Mollusc'), 11), eye: mon16(M_('Eye', 'Eye'), 12),
  octopus: mon16(M_('Octopus')), cyclope2: mon16(M_('Cyclope2')), beast: mon16(M_('Beast', 'Beast')), dragon: mon16(M_('Dragon')),
  lantern: mon16(M_('LanternRed')), flam2: mon16(M_('Flam2')), ninjablue: char16('NinjaBlue'),
  // 首領（橫向排列的動畫）
  giantSlime: { ox: 31, oy: 50, h: 40, anims: {
    walk: strip('Actor/Boss/GiantSlime/Jump.png', 62, 52, 13, 70), idle: strip('Actor/Boss/GiantSlime/Idle.png', 62, 52, 5, 160),
    attack: strip('Actor/Boss/GiantSlime/Hit.png', 62, 52, 5, 70, { once: true }) } },
  giantBamboo: { ox: 31, oy: 60, h: 54, anims: {
    walk: strip('Actor/Boss/GiantBamboo/Walk.png', 62, 62, 12, 80), idle: strip('Actor/Boss/GiantBamboo/Idle.png', 62, 62, 6, 150),
    attack: strip('Actor/Boss/GiantBamboo/Attack.png', 62, 62, 5, 70, { once: true }) } },
  tengu: { ox: 41, oy: 78, h: 62, anims: {
    walk: strip('Actor/Boss/TenguRed/Walk.png', 82, 82, 10, 90), idle: strip('Actor/Boss/TenguRed/Idle.png', 82, 82, 6, 150),
    attack: strip('Actor/Boss/TenguRed/Attack.png', 82, 82, 15, 30, { once: true }) } },
  giantSpirit: { ox: 25, oy: 48, h: 42, anims: {
    walk: strip('Actor/Boss/GiantSpirit/Idle.png', 50, 50, 5, 140), idle: strip('Actor/Boss/GiantSpirit/Idle.png', 50, 50, 5, 180),
    attack: strip('Actor/Boss/GiantSpirit/Hit.png', 50, 50, 3, 110, { once: true }) } },
  squid: { ox: 38, oy: 75, h: 60, anims: {
    walk: strip('Actor/Boss/SquidGreen/Walk.png', 76, 79, 4, 140), idle: strip('Actor/Boss/SquidGreen/Idle.png', 76, 79, 4, 180),
    attack: strip('Actor/Boss/SquidGreen/Shoot.png', 76, 79, 5, 80, { once: true }) } },
});

// ---------- 區域 ----------
// monsters：每個定位對應的 [名稱, 外觀, 額外設定]
const Z_FLOOR = (c, r) => [[c, r], [c, r], [c, r], [c, r], [c, r], [c, r], [c + 1, r], [c + 2, r], [c + 3, r], [c + 4, r]];
const NT = (c, r, w = 1, h = 1) => [T_NATURE, c, r, w, h];
const ZONES = [
  {
    id: 'field', name: '青葉之原', lvl: 1, hub: true, seed: 20261021, music: 'field',
    desc: '綠意盎然的平原，旅程的起點。',
    art: {},   // 用 gfx.js 的預設
    light: { a: 0.22, rgb: '10,8,24' }, weather: 'pollen',
    // 寫實風格（系統選單「畫面風格」）：畫面調色、環境光、霧、天氣
    mood: { filter: 'saturate(0.62) contrast(1.12) brightness(0.94) sepia(0.2)', light: { a: 0.3, rgb: '24,18,10' }, fog: '205,200,180', fogA: 0.16, weather: 'motes' },
    mm: { grass: [120, 170, 60], path: [170, 110, 70], wall: [40, 90, 40], water: [50, 100, 160], camp: [190, 140, 80] },
    gen: { buildings: 160, fill: 0, gap: 0.22, pools: 12, poolR: 1.6, obst: 70, rocks: 30, fires: 30, crates: 30, signs: 18 },
    monsters: {
      ghoul: ['綠史萊姆', 'slime', { blood: '#6fd24a', scale: 1.1 }], hound: ['吸血蝙蝠', 'bat', { blood: '#7a8fd8', fly: true }],
      skel: ['骷髏武士', 'skeleton', { blood: '#e8e0c8' }], archer: ['赤忍', 'ninjared', { blood: '#c83030', shot: 'kunai' }],
      cultist: ['鬼火', 'flam', { blood: '#ff8a30', fly: true, shot: 'fire' }], brute: ['獨眼鬼', 'cyclope', { blood: '#8a5030', scale: 1.7 }],
      boss: ['史萊姆王', 'giantSlime', { blood: '#6fd24a' }],
    },
  },
  {
    id: 'bamboo', name: '幽篁竹林', lvl: 10, seed: 3141, music: 'field',
    desc: '終年霧氣繚繞的竹林，妖怪潛伏其中。',
    art: {
      grass: Z_FLOOR(11, 12), dirt: { sheet: T_FLOOR, col: 11, row: 7, fill: [[11, 11], [12, 11]] },
      walls: [NT(11, 8, 1, 3), NT(11, 8, 1, 3), NT(11, 8, 1, 3), NT(11, 8, 1, 3), NT(12, 9, 1, 2), NT(12, 9, 1, 2), NT(16, 0, 2, 2), NT(18, 0, 2, 2)],
      obst: [NT(0, 8, 2, 2), NT(2, 8, 2, 2), NT(4, 8), NT(1, 10), NT(2, 10)],
      plants: [[T_NATURE, 0, 10], [T_NATURE, 1, 10], [T_NATURE, 4, 10], [T_NATURE, 5, 10], [T_NATURE, 8, 10], [T_NATURE, 9, 10], ...[0, 1, 2, 3, 4, 6].map(c => [T_DETAIL, c, 2])],
    },
    light: { a: 0.32, rgb: '4,24,10' }, weather: 'leaves',
    // 寫實風格（系統選單「畫面風格」）：畫面調色、環境光、霧、天氣
    mood: { filter: 'saturate(0.58) contrast(1.14) brightness(0.9) sepia(0.12)', light: { a: 0.4, rgb: '6,20,10' }, fog: '170,195,170', fogA: 0.22 },
    mm: { grass: [70, 130, 50], path: [120, 80, 50], wall: [30, 70, 30], water: [50, 100, 160], camp: [150, 110, 70] },
    gen: { buildings: 220, fill: 0.55, gap: 0.3, pools: 6, poolR: 1.4, obst: 50, rocks: 15, fires: 15, crates: 10, signs: 8 },
    monsters: {
      ghoul: ['竹妖', 'bamboo', { blood: '#8fd24a' }], hound: ['狸貓', 'racoon', { blood: '#a07040' }],
      skel: ['河童', 'kappa', { blood: '#4ab070' }], archer: ['青忍', 'ninjablue', { blood: '#3060c8', shot: 'kunai' }],
      cultist: ['毒菇', 'mushroom', { blood: '#d050ff', shot: 'energy' }], brute: ['黃竹妖', 'bambooY', { blood: '#e0d040', scale: 1.7 }],
      boss: ['巨竹妖', 'giantBamboo', { blood: '#8fd24a' }],
    },
  },
  {
    id: 'desert', name: '赤砂荒野', lvl: 20, seed: 2718, music: 'field',
    desc: '烈日下的無盡沙海，只有少數綠洲。',
    art: {
      grass: Z_FLOOR(0, 5), dirt: { sheet: T_FLOOR, col: 0, row: 0, fill: [[0, 4], [1, 4]] }, water: { sheet: T_WATER, col: 0, row: 0 },
      walls: [NT(13, 8, 2, 2), NT(13, 8, 2, 2), NT(13, 8, 2, 2), [T_DESERT, 8, 10, 2, 2], [T_DESERT, 14, 10, 1, 1], [T_DESERT, 14, 11, 1, 1], NT(15, 9)],
      obst: [[T_DESERT, 6, 11, 1, 1], [T_DESERT, 7, 11, 1, 1], [T_DESERT, 8, 9, 1, 1], [T_DESERT, 9, 9, 1, 1], NT(15, 9)],
      rocks: [NT(13, 8, 2, 2), NT(15, 9)],
      plants: [...[4, 5, 6, 7, 8].map(c => [T_DETAIL, c, 0]), ...[16, 17, 19].map(c => [T_DESERT, c, 11])],
      stones: [[T_DETAIL, 15, 0], [T_DETAIL, 11, 0], [T_DESERT, 18, 11]],
      fence: [[T_DESERT, 6, 11, 1, 1], [T_DESERT, 7, 11, 1, 1], [T_DESERT, 14, 10, 1, 1]],
    },
    light: { a: 0.08, rgb: '50,25,0' }, weather: 'sand',
    // 寫實風格（系統選單「畫面風格」）：畫面調色、環境光、霧、天氣
    mood: { filter: 'saturate(0.7) contrast(1.1) brightness(0.95) sepia(0.28)', light: { a: 0.18, rgb: '50,25,0' }, fog: '230,200,150', fogA: 0.14 },
    mm: { grass: [220, 160, 90], path: [240, 200, 150], wall: [150, 90, 50], water: [70, 170, 210], camp: [240, 210, 160] },
    gen: { buildings: 90, fill: 0, gap: 0.45, pools: 5, poolR: 2.4, obst: 60, rocks: 60, fires: 20, crates: 15, signs: 12 },
    monsters: {
      ghoul: ['沙蛇', 'snake', { blood: '#c09040' }], hound: ['沙蜥', 'lizard', { blood: '#c0a050' }],
      skel: ['鑽地鼠', 'mole', { blood: '#a07050' }], archer: ['噴毒蜥', 'reptile', { blood: '#80c040', shot: 'energy' }],
      cultist: ['沙火龍', 'dragonY', { blood: '#ffb040', shot: 'fire' }], brute: ['沙漠巨獸', 'beast2', { blood: '#a06040', scale: 1.7 }],
      boss: ['赤天狗', 'tengu', { blood: '#e04030', scale: 0.9 }],
    },
  },
  {
    id: 'snow', name: '白銀雪原', lvl: 30, seed: 1618, music: 'field',
    desc: '冰封的高原，寒風中傳來詭異的歌聲。',
    art: {
      grass: Z_FLOOR(0, 19), dirt: { sheet: T_FLOOR, col: 0, row: 14, fill: [[0, 18], [1, 18]] }, water: { sheet: T_WATER, col: 13, row: 0 },
      walls: [NT(8, 0, 2, 2), NT(8, 0, 2, 2), NT(10, 0, 2, 2), NT(10, 0, 2, 2), NT(12, 0, 2, 2), [T_DUNGEON, 0, 2, 1, 1], [T_DUNGEON, 1, 2, 1, 1]],
      obst: [NT(0, 12, 2, 2), NT(2, 12, 2, 2), NT(4, 12), NT(5, 12), NT(10, 12)],
      rocks: [NT(0, 12, 2, 2), NT(2, 12, 2, 2), NT(4, 12)],
      plants: [0, 1, 2, 3, 4, 5, 6, 7].map(c => [T_DETAIL, c, 3]),
      stones: [NT(4, 12), NT(5, 12)],
      fence: [NT(4, 12), NT(5, 12), NT(10, 12)],
    },
    light: { a: 0.16, rgb: '10,24,60' }, weather: 'snow',
    // 寫實風格（系統選單「畫面風格」）：畫面調色、環境光、霧、天氣
    mood: { filter: 'saturate(0.55) contrast(1.1) brightness(0.96) sepia(0.06)', light: { a: 0.24, rgb: '10,24,60' }, fog: '225,235,250', fogA: 0.22 },
    mm: { grass: [225, 230, 240], path: [190, 195, 210], wall: [90, 130, 150], water: [150, 210, 240], camp: [200, 200, 215] },
    gen: { buildings: 110, fill: 0, gap: 0.3, pools: 26, poolR: 2.2, obst: 40, rocks: 50, fires: 25, crates: 12, signs: 10 },
    monsters: {
      ghoul: ['冰骷髏', 'skullBlue', { blood: '#a0d8ff' }], hound: ['雪梟', 'owl', { blood: '#e0e0f0', fly: true }],
      skel: ['冰螈', 'axolot', { blood: '#80c0ff' }], archer: ['冰眼', 'eye2', { blood: '#a0c0ff', shot: 'energy' }],
      cultist: ['雪靈', 'spirit2', { blood: '#c0e0ff', fly: true, shot: 'energy' }], brute: ['雪熊', 'bear', { blood: '#c08060', scale: 1.7 }],
      boss: ['雪女', 'giantSpirit', { blood: '#c0e0ff', scale: 1.3, fly: true }],
    },
  },
  {
    id: 'dungeon', name: '幽冥地城', lvl: 40, seed: 4669, music: 'field',
    desc: '深埋地底的古老迷宮，伸手不見五指。',
    art: {
      grass: Z_FLOOR(11, 19), dirt: { sheet: T_FLOOR, col: 11, row: 14, fill: [[11, 18], [12, 18]] }, water: { sheet: T_WATER, col: 13, row: 6 },
      walls: [[T_DUNGEON, 8, 3, 1, 1], [T_DUNGEON, 8, 3, 1, 1], [T_DUNGEON, 8, 3, 1, 1], [T_DUNGEON, 8, 3, 1, 1], [T_DUNGEON, 8, 3, 1, 1], NT(16, 8, 2, 2)],
      obst: [[T_DUNGEON, 2, 2, 1, 1], [T_DUNGEON, 3, 2, 1, 1], [T_DUNGEON, 4, 2, 1, 1], [T_DUNGEON, 6, 2, 1, 1], [T_DUNGEON, 2, 1, 1, 1], [T_DUNGEON, 3, 1, 1, 1], [T_DUNGEON, 3, 3, 1, 1], [T_DUNGEON, 4, 3, 1, 1]],
      rocks: [NT(16, 8, 2, 2), [T_DUNGEON, 7, 3, 1, 1], NT(18, 9)],
      plants: [[T_DETAIL, 13, 0], [T_DETAIL, 14, 0], [T_DETAIL, 15, 0], [T_DETAIL, 4, 0]],
      stones: [[T_DETAIL, 15, 0], NT(18, 9)],
      fence: [[T_DUNGEON, 8, 3, 1, 1], [T_DUNGEON, 7, 3, 1, 1]],
    },
    light: { a: 0.6, rgb: '4,4,14' }, weather: 'dust',
    // 寫實風格（系統選單「畫面風格」）：畫面調色、環境光、霧、天氣
    mood: { filter: 'saturate(0.55) contrast(1.16) brightness(0.92) sepia(0.15)', light: { a: 0.66, rgb: '6,4,10' }, fog: '120,115,130', fogA: 0.16 },
    mm: { grass: [130, 115, 100], path: [90, 70, 55], wall: [70, 75, 80], water: [140, 70, 160], camp: [170, 140, 100] },
    gen: { buildings: 260, fill: 0, gap: 0.12, pools: 8, poolR: 1.4, obst: 50, rocks: 30, fires: 40, crates: 20, signs: 0 },
    monsters: {
      ghoul: ['骷髏頭', 'skull', { blood: '#e8e0c8' }], hound: ['赤蜘蛛', 'spiderRed', { blood: '#c03030' }],
      skel: ['地蟲', 'mollusc', { blood: '#a0a060' }], archer: ['魔眼', 'eye', { blood: '#d05050', shot: 'energy' }],
      cultist: ['墨章', 'octopus', { blood: '#6040a0', shot: 'energy' }], brute: ['藍獨眼鬼', 'cyclope2', { blood: '#4060a0', scale: 1.7 }],
      boss: ['深淵章魚', 'squid', { blood: '#60c060', scale: 0.9 }],
    },
  },
  {
    id: 'castle', name: '鬼王之城', lvl: 50, seed: 6662, music: 'boss',
    desc: '鬼王 · 酒吞童子的居城，瘴氣與毒沼遍布。',
    art: {
      grass: Z_FLOOR(11, 19), dirt: { sheet: T_FLOOR, col: 11, row: 14, fill: [[11, 18], [12, 18]] }, water: { sheet: T_WATER, col: 13, row: 6 },
      walls: [NT(4, 0, 2, 2), NT(4, 0, 2, 2), NT(4, 0, 2, 2), NT(16, 8, 2, 2), [T_DUNGEON, 8, 3, 1, 1], [T_DUNGEON, 8, 3, 1, 1]],
      obst: [[T_DUNGEON, 3, 3, 1, 1], [T_DUNGEON, 4, 3, 1, 1], [T_DUNGEON, 5, 3, 1, 1], NT(4, 9), [T_DUNGEON, 2, 2, 1, 1]],
      rocks: [NT(16, 8, 2, 2), [T_DUNGEON, 8, 3, 1, 1], NT(18, 9)],
      plants: [[T_DETAIL, 0, 0], [T_DETAIL, 1, 0], [T_DETAIL, 13, 0], [T_DETAIL, 14, 0], [T_DETAIL, 5, 0], [T_DETAIL, 6, 0]],
      stones: [[T_DETAIL, 15, 0], [T_DETAIL, 13, 0]],
      fence: [[T_DUNGEON, 8, 3, 1, 1], [T_DUNGEON, 3, 3, 1, 1], [T_DUNGEON, 4, 3, 1, 1]],
    },
    light: { a: 0.45, rgb: '50,0,4' }, weather: 'embers',
    // 寫實風格（系統選單「畫面風格」）：畫面調色、環境光、霧、天氣
    mood: { filter: 'saturate(0.68) contrast(1.16) brightness(0.9) sepia(0.2)', light: { a: 0.52, rgb: '40,4,6' }, fog: '140,90,80', fogA: 0.16 },
    mm: { grass: [130, 110, 95], path: [90, 65, 50], wall: [60, 45, 40], water: [140, 60, 150], camp: [170, 120, 90] },
    gen: { buildings: 200, fill: 0, gap: 0.2, pools: 18, poolR: 1.8, obst: 50, rocks: 40, fires: 35, crates: 10, signs: 0 },
    monsters: {
      ghoul: ['魔犬', 'beast', { blood: '#8a3020' }], hound: ['小火龍', 'dragon', { blood: '#ff6030' }],
      skel: ['骷髏武士', 'skeleton', { blood: '#e8e0c8' }], archer: ['提燈鬼', 'lantern', { blood: '#ff8030', fly: true, shot: 'fire' }],
      cultist: ['藍鬼火', 'flam2', { blood: '#60a0ff', fly: true, shot: 'energy' }], brute: ['赤鬼', 'cyclope', { blood: '#8a5030', scale: 1.8 }],
      boss: ['鬼王 · 酒吞童子', 'demon', { blood: '#ff5030' }],
    },
  },
];
const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));

// ---------- 由區域設定產生怪物表 ----------
// MONSTERS[鍵] = 定位數值 + 名稱、外觀等；鍵 = 區域_定位，例如 desert_brute
const MONSTERS = {};
for (const z of ZONES) {
  for (const [role, [name, spr, extra]] of Object.entries(z.monsters)) {
    MONSTERS[z.id + '_' + role] = Object.assign({ role, name, spr }, ROLES[role], extra);
  }
}
const zoneMonster = (z, role) => z.id + '_' + role;

// 換區域時套用美術設定（沒寫的項目用青葉之原的預設）
const ART_DEFAULT = Object.assign({}, ART);
function applyZoneArt(z) {
  for (const k of Object.keys(ART_DEFAULT)) ART[k] = (z.art && z.art[k]) || ART_DEFAULT[k];
}
