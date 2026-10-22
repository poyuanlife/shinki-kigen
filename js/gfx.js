'use strict';
// =====================================================
//  像素風繪圖（Ninja Adventure 素材，CC0）
//  角色、怪物、NPC、地圖圖塊、飛行道具、特效
// =====================================================

const NA = 'assets/na/';
const PX = 2;   // 素材 1 像素 = 邏輯畫面 2 像素（再乘上鏡頭縮放）

// ---------- 載入 ----------
const IMG = {};
function img(p) {
  let im = IMG[p];
  if (!im) { im = IMG[p] = new Image(); im.src = NA + p; }
  return im;
}
const ready = im => im.complete && im.naturalWidth > 0;
// 給 game.js / diag.js 用的小工具（沿用舊名稱）
const Sprites = {
  memoryMB() { let b = 0; for (const im of Object.values(IMG)) if (ready(im)) b += im.naturalWidth * im.naturalHeight * 4; return b / 1048576; },
  warmUp(c) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); for (const im of Object.values(IMG)) if (ready(im)) c.drawImage(im, 0, 0, 1, 1); c.restore(); },
};

// 對齊畫布像素，像素圖才不會模糊或抖動
const snap = v => Math.round(v * DZ) / DZ;

// ---------- 方向 ----------
// 素材每一欄的方向：0 下、1 上、2 左、3 右
function dir4(a) {
  const c = Math.cos(a), s = Math.sin(a);
  if (Math.abs(c) >= Math.abs(s)) return c >= 0 ? 3 : 2;
  return s >= 0 ? 0 : 1;
}

// ---------- 角色規格 ----------
// 每個動作：file 圖檔、cw/ch 每格大小、n 幀數、ms 每幀時間、once 只播一次、
//           row 起始列（同一張圖裡不同動作）、oneDir 只有一個方向、strip 橫向排列的幀（首領）
const ninjaAnim = (f, n, ms, extra) => Object.assign({ file: 'Actor/CharacterAnimated/NinjaGreen/Separate/' + f + '.png', cw: 32, ch: 32, n, ms }, extra);
const char16 = (name, ox = 8, oy = 15) => {
  const file = `Actor/Character/${name}/SpriteSheet.png`;
  return { ox, oy, h: 15, anims: {
    walk: { file, cw: 16, ch: 16, n: 4, ms: 150 },
    idle: { file, cw: 16, ch: 16, n: 1, ms: 1000 },
    attack: { file, cw: 16, ch: 16, n: 1, ms: 300, row: 4 },
  } };
};
const mon16 = (file, h = 14) => ({ ox: 8, oy: 15, h, anims: {
  walk: { file, cw: 16, ch: 16, n: 4, ms: 140 },
  idle: { file, cw: 16, ch: 16, n: 4, ms: 260 },
  attack: { file, cw: 16, ch: 16, n: 4, ms: 70 },
} });

const SPEC = {
  hero: { ox: 16, oy: 24, h: 16, anims: {
    walk: ninjaAnim('Walk', 4, 130), attack: ninjaAnim('Attack', 4, 80, { once: true }),
    idle: ninjaAnim('Idle', 4, 300), hit: ninjaAnim('Hit', 2, 80, { once: true }),
    dead: ninjaAnim('Dead', 2, 250, { once: true, oneDir: true }),
  } },
  slime: mon16('Actor/Monster/Slime/Slime.png', 11),
  bat: mon16('Actor/Monster/BlueBat/SpriteSheet.png', 14),
  flam: mon16('Actor/Monster/Flam/SpriteSheet.png', 14),
  cyclope: mon16('Actor/Monster/Cyclope/SpriteSheet.png', 15),
  skeleton: char16('Skeleton'), ninjared: char16('NinjaRed'), oldman: char16('OldMan'), samurai: char16('Samurai'),
  demon: { ox: 25, oy: 46, h: 44, anims: {
    walk: { file: 'Actor/Boss/DemonCyclop/Walk.png', cw: 50, ch: 50, n: 6, ms: 130, strip: true },
    idle: { file: 'Actor/Boss/DemonCyclop/Idle.png', cw: 50, ch: 50, n: 5, ms: 180, strip: true },
    attack: { file: 'Actor/Boss/DemonCyclop/Hit.png', cw: 50, ch: 50, n: 3, ms: 110, strip: true, once: true },
  } },
};

function animLen(spec, act) { const a = SPEC[spec].anims[act]; return a ? a.n * a.ms / 1000 : 0; }

// 畫一個角色：(x, y) = 腳底位置，scale = 邏輯像素倍率
function drawSpec(c, specName, act, dir, t, x, y, scale = PX, flash = 0) {
  const sp = SPEC[specName];
  const a = sp.anims[act] || sp.anims.idle || sp.anims.walk;
  const im = img(a.file);
  if (!ready(im)) return false;
  const k = Math.floor(t * 1000 / a.ms);
  const f = a.once ? Math.min(a.n - 1, Math.max(0, k)) : ((k % a.n) + a.n) % a.n;
  let col, row;
  if (a.strip) { col = f; row = 0; } else { col = a.oneDir ? 0 : dir; row = (a.row || 0) + f; }
  const dx = snap(x - sp.ox * scale), dy = snap(y - sp.oy * scale);
  const draw = () => c.drawImage(im, col * a.cw, row * a.ch, a.cw, a.ch, dx, dy, a.cw * scale, a.ch * scale);
  draw();
  if (flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, flash); draw(); c.restore(); }
  return true;
}

// ---------- 主角 ----------
const HERO_SCALE = PX;
function heroAnim(p) {
  if (p.dead) return ['dead', p.deadT || 0];
  if (p.act && !(p.moving > 0.5 && p.act.n === 'shoot')) return ['attack', p.act.t / p.act.dur * animLen('hero', 'attack')];
  if (p.moving > 0.3) return ['walk', p.runT || 0];
  if (p.hurt > 0) return ['hit', 0.12 - p.hurt];
  return ['idle', G.t];
}
function drawHero(c, x, y, p, scale = HERO_SCALE, dirOverride) {
  const [act, t] = heroAnim(p);
  const dir = dirOverride !== undefined ? dirOverride : dir4(p.face);
  if (!p.dead) { c.fillStyle = 'rgba(0,0,0,0.3)'; ell(c, x, y - scale, 6 * scale, 2.5 * scale); c.fill(); }
  if (p.buffs && p.buffs.stim > 0) { c.fillStyle = 'rgba(255,60,60,0.16)'; ell(c, x, y - 8 * scale, 11 * scale, 12 * scale); c.fill(); }
  drawSpec(c, 'hero', act, dir, t, x, y, scale, p.hurt > 0 ? 0.6 : 0);
  if (p.shield > 0) {
    c.save(); c.globalAlpha = 0.25 + Math.sin(performance.now() / 150) * 0.08;
    c.strokeStyle = '#8fe8a0'; c.lineWidth = 1.5; ell(c, x, y - 8 * scale, 11 * scale, 12 * scale); c.stroke();
    c.fillStyle = 'rgba(120,230,140,0.12)'; c.fill(); c.restore();
  }
}

// ---------- 怪物 ----------
const enemyScale = e => PX * (e.def.scale || 1) * (e.rank === 2 ? 1.2 : e.rank === 1 ? 1.1 : 1);
const enemyH = e => SPEC[e.def.spr].h * enemyScale(e);
const enemyW = e => Math.max(8, SPEC[e.def.spr].h * enemyScale(e) * 0.4);
function enemyAnim(e) {
  if (e.atkAnim > 0 || e.castAnim > 0) {
    const dur = e.atkAnim > 0 ? e.atkDur : 0.4, left = Math.max(e.atkAnim, e.castAnim);
    return ['attack', dur - left];
  }
  if (e.mv) return ['walk', e.runT];
  return ['idle', G.t + e.anim];
}
function drawEnemySprite(c, x, y, e) {
  const sc = enemyScale(e), w = enemyW(e);
  c.fillStyle = 'rgba(0,0,0,0.3)'; ell(c, x, y - 1, w, w * 0.4); c.fill();
  if (e.rank === 1 || e.rank === 2) {
    c.save(); c.globalAlpha = 0.5 + Math.sin(G.t * 4) * 0.2;
    c.strokeStyle = e.rank === 1 ? '#5b9bff' : '#ffbf3a'; c.lineWidth = 1.5;
    ell(c, x, y - 1, w + 5, (w + 5) * 0.45); c.stroke(); c.restore();
  }
  const [act, t] = enemyAnim(e);
  // 會飛的怪物（蝙蝠、鬼火）上下飄
  const fly = e.def.fly ? Math.sin(G.t * 4 + e.anim) * 3 - 6 : 0;
  drawSpec(c, e.def.spr, act, dir4(e.face), t, x, y + fly, sc, e.hitFlash > 0 ? 0.8 : 0);
}

// 屍體：閃白後淡出，搭配煙霧特效
function drawCorpse(c, x, y, k) {
  c.save();
  c.globalAlpha = Math.max(0, 1 - k.t / 0.5);
  drawSpec(c, k.spr, 'idle', k.dir, 0, x, y, k.scale, k.t < 0.15 ? 1 : 0);
  c.restore();
  drawFx(c, 'smoke', k.t, x, y - 6, PX * (k.big ? 1.6 : 1));
}

// ---------- 特效 ----------
const FX = {
  smoke: { file: 'FX/Smoke/Smoke/SpriteSheet.png', cw: 32, ch: 32, n: 6, ms: 80 },
  boom: { file: 'FX/Elemental/Explosion/SpriteSheet.png', cw: 40, ch: 40, n: 9, ms: 55 },
  thunder: { file: 'FX/Elemental/Thunder/SpriteSheet.png', cw: 32, ch: 28, n: 5, ms: 70 },
};
// (x, y) = 特效中心
function drawFx(c, name, t, x, y, scale = PX) {
  const a = FX[name], im = img(a.file);
  if (!ready(im)) return;
  const f = Math.floor(t * 1000 / a.ms);
  if (f < 0 || f >= a.n) return;
  c.drawImage(im, f * a.cw, 0, a.cw, a.ch, snap(x - a.cw * scale / 2), snap(y - a.ch * scale / 2), a.cw * scale, a.ch * scale);
}

// ---------- 飛行道具 ----------
// kind：shuriken 手裏劍（旋轉）、fire 火球、kunai 苦無、energy 能量球
function drawProjectile(c, b, kind) {
  const s = toScreen(b.x, b.y), z = 12, ang = Math.atan2(b.vy, b.vx);
  c.save();
  if (kind === 'shuriken' || !kind) {
    const im = img('FX/Projectile/Shuriken.png');
    if (ready(im)) {
      const f = Math.floor(G.t * 20) % 2;
      c.translate(snap(s.x), snap(s.y - z));
      if (b.color && b.color !== '#ffe9a0') {   // 技能的手裏劍加一點彩色光暈
        c.globalCompositeOperation = 'lighter'; c.fillStyle = b.color; c.globalAlpha = 0.35; ell(c, 0, 0, 8, 8); c.fill();
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      }
      c.drawImage(im, f * 16, 0, 16, 16, -8, -8, 16, 16);
    }
  } else if (kind === 'fire' || kind === 'energy') {
    const im = img(kind === 'fire' ? 'FX/Projectile/Fireball.png' : 'FX/Projectile/EnergyBall.png');
    if (ready(im)) {
      const f = Math.floor(G.t * 12) % 4;
      c.translate(s.x, s.y - z); c.rotate(ang);
      c.drawImage(im, f * 16, 0, 16, 16, -10, -10, 20, 20);
    }
  } else if (kind === 'kunai') {
    const im = img('FX/Projectile/Kunai.png');
    if (ready(im)) { c.translate(s.x, s.y - z); c.rotate(ang); c.drawImage(im, -9, -3, 18, 6.5); }
  }
  c.restore();
}

// ---------- 地圖圖塊 ----------
const T_FLOOR = 'Backgrounds/Tilesets/TilesetFloor.png';
const T_WATER = 'Backgrounds/Tilesets/TilesetWater.png';
const T_NATURE = 'Backgrounds/Tilesets/TilesetNature.png';
const T_CAMP = 'Backgrounds/Tilesets/tileset_camp.png';
const TILE_PX = 16;
// 畫一塊圖：(col, row) 起點、w×h 格；(x, y) = 左上角（邏輯座標）
function drawCell(c, sheet, col, row, x, y, w = 1, h = 1, scale = PX) {
  const im = img(sheet);
  if (!ready(im)) return false;
  c.drawImage(im, col * TILE_PX, row * TILE_PX, w * TILE_PX, h * TILE_PX, snap(x), snap(y), w * TILE_PX * scale, h * TILE_PX * scale);
  return true;
}
// 物件：(x, y) = 底部中心
function drawObj(c, sheet, col, row, w, h, x, y, scale = PX) {
  return drawCell(c, sheet, col, row, x - w * TILE_PX * scale / 2, y - h * TILE_PX * scale, w, h, scale);
}

// 自動接合：依上(1)、右(2)、下(4)、左(8) 鄰格是否同類，選出對應的邊角圖塊
// 素材排列：3×3 圓角區塊 + 直條 + 橫條 + 單格（相對於起點的欄、列）
const AUTO = { 0: [3, 3], 1: [3, 2], 4: [3, 0], 5: [3, 1], 2: [0, 3], 8: [2, 3], 10: [1, 3], 6: [0, 0], 12: [2, 0], 3: [0, 2], 9: [2, 2], 14: [1, 0], 11: [1, 2], 7: [0, 1], 13: [2, 1], 15: [1, 1] };
const AUTO_SETS = {
  dirt: { sheet: T_FLOOR, col: 0, row: 7, fill: [[1, 8], [1, 8], [1, 8], [0, 11], [1, 11]] },
  water: { sheet: T_WATER, col: 0, row: 6, single: [1, 1] },
};
function drawAuto(c, set, mask, x, y, seed) {
  const s = AUTO_SETS[set];
  if (mask === 15 && s.fill && seed > 0.7) { const f = s.fill[Math.floor(seed * 13) % s.fill.length]; return drawCell(c, s.sheet, f[0], f[1], x, y); }
  const [dc, dr] = mask === 0 && s.single ? s.single : AUTO[mask];
  return drawCell(c, s.sheet, s.col + dc, s.row + dr, x, y);
}
// 草地：大多是素色，少數有小草叢
const GRASS = [[0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [1, 12], [2, 12], [3, 12], [4, 12]];
function drawGrass(c, x, y, seed) { const g = GRASS[Math.floor(seed * GRASS.length)]; return drawCell(c, T_FLOOR, g[0], g[1], x, y); }

// 地面裝飾（花草、小石頭）
const DECO_PLANTS = [[0, 10], [1, 10], [2, 10], [3, 10], [6, 10], [7, 10], [0, 11], [1, 11], [2, 11], [3, 11], [6, 11], [7, 11], [8, 11], [9, 11]];
const DECO_STONES = [[15, 9], [18, 9]];
function decoTile(kind, seed) { const L = kind === 'plant' ? DECO_PLANTS : DECO_STONES; return L[Math.floor(seed * L.length) % L.length]; }

// 樹（當作牆）：2×2 格的樹，(x, y) = 底部中心
const TREES = [[0, 0], [0, 0], [16, 0], [18, 0], [2, 0], [6, 0], [14, 0]];
function drawTree(c, x, y, seed) { const t = TREES[Math.floor(seed * TREES.length)]; return drawObj(c, T_NATURE, t[0], t[1], 2, 2, x, y + 4); }

// 場景物件；回傳 false 代表交給 render.js 的程式繪製
function drawPropSprite(c, x, y, p, t) {
  const pick = L => L[Math.floor(p.seed * L.length) % L.length];
  switch (p.type) {
    case 'rock': { const r = pick([[13, 8, 2, 2], [16, 8, 2, 2]]); return drawObj(c, T_NATURE, r[0], r[1], r[2], r[3], x, y + 8); }
    case 'tree': { const r = pick([[0, 8, 2, 2], [2, 8, 2, 2], [4, 8, 1, 1], [15, 9, 1, 1], [18, 9, 1, 1], [8, 8, 1, 1]]); return drawObj(c, T_NATURE, r[0], r[1], r[2], r[3], x, y + 8); }
    case 'grave': { const r = pick([[16, 8, 2, 2], [18, 9, 1, 1]]); return drawObj(c, T_NATURE, r[0], r[1], r[2], r[3], x, y + 8); }
    case 'lamp': return drawObj(c, T_NATURE, 5, 8, 1, 1, x, y + 8);
    case 'sandbag': return drawObj(c, T_NATURE, pick([1, 2, 6]), 10, 1, 1, x, y + 8);
    case 'crate': return drawObj(c, T_CAMP, 3, pick([5, 6]), 1, 1, x, y + 8);
    case 'chest': return drawObj(c, T_CAMP, pick([4, 5]), 8, 1, 1, x, y + 8);
    case 'anvil': return drawObj(c, T_CAMP, 4, 6, 2, 2, x, y + 8);
    case 'tent': return drawObj(c, T_CAMP, 4, 0, 3, 3, x, y + 12);
    case 'flag': return drawObj(c, T_CAMP, 7, 5, 1, 2, x, y + 8);
    case 'barrel': case 'campfire': {
      drawObj(c, T_CAMP, 10, 3, 2, 2, x, y + 14);
      // 火焰
      c.save(); c.globalCompositeOperation = 'lighter';
      const big = p.type === 'campfire' ? 1 : 0.75;
      for (let i = 0; i < 5; i++) {
        const f = Math.sin(t * 8 + i * 1.7 + p.seed * 9) * 3 * big, h = (11 + Math.sin(t * 6 + i + p.seed) * 3) * big;
        const g = c.createRadialGradient(x + f, y - h * 0.5, 0, x + f, y - h * 0.5, h);
        g.addColorStop(0, 'rgba(255,240,170,0.9)'); g.addColorStop(0.5, 'rgba(255,130,30,0.55)'); g.addColorStop(1, 'rgba(255,40,0,0)');
        c.fillStyle = g; ell(c, x + f, y - h * 0.5, 6 * big, h); c.fill();
      }
      c.restore();
      return true;
    }
    case 'merchant': case 'guard': {
      c.fillStyle = 'rgba(0,0,0,0.3)'; ell(c, x, y - 1, 12, 5); c.fill();
      drawSpec(c, p.type === 'merchant' ? 'oldman' : 'samurai', 'idle', p.face !== undefined ? p.face : 0, t, x, y + 6, PX);
      if (p.type === 'merchant') {
        c.fillStyle = '#ffd34a'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center';
        c.fillText('!', x, y - 34 + Math.sin(t * 4) * 2);
      }
      return true;
    }
  }
  return false;
}

// 地上的金幣與藥水
function drawPickupSprite(c, g, x, y) {
  if (g.gold) { const im = img('Items/Treasure/GoldCoin.png'); if (ready(im)) c.drawImage(im, snap(x - 8), snap(y - 14), 16, 16); return true; }
  if (g.potion) {
    const im = img(g.potion === 'hp' ? 'Items/Potion/LifePot.png' : 'Items/Potion/WaterPot.png');
    if (ready(im)) c.drawImage(im, snap(x - 9), snap(y - 22), 18, 22);
    return true;
  }
  return false;
}

// ---------- 載入全部素材 ----------
function allFiles() {
  const s = new Set();
  for (const sp of Object.values(SPEC)) for (const a of Object.values(sp.anims)) s.add(a.file);
  for (const f of Object.values(FX)) s.add(f.file);
  [T_FLOOR, T_WATER, T_NATURE, T_CAMP, 'FX/Projectile/Shuriken.png', 'FX/Projectile/Fireball.png', 'FX/Projectile/Kunai.png', 'FX/Projectile/EnergyBall.png',
    'Items/Potion/LifePot.png', 'Items/Potion/WaterPot.png', 'Items/Treasure/GoldCoin.png'].forEach(f => s.add(f));
  for (const w of Object.values(WEAPON_ICONS)) s.add(w.file);
  return [...s];
}
function loadGameAssets() {
  return Promise.all(allFiles().map(f => new Promise(res => {
    const im = img(f);
    if (ready(im)) res();
    else { im.addEventListener('load', res); im.addEventListener('error', () => { console.warn('圖片載入失敗', f); res(); }); }
  })));
}
