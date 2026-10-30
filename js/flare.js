'use strict';
// =====================================================
//  寫實素材（試做）：Flare 的場景、怪物、主角
//  素材來源：Flare（https://flarerpg.org），美術授權 CC-BY-SA 3.0
//  由 tools/flare/build-flare.js 轉成 assets/flare/ 裡的 WebP + JSON
//  系統選單「畫面風格」的「寫實素材」打開時使用；區域設定有 flare 的才換場景和怪物
// =====================================================
const FLARE = { ready: false, tiles: {}, monsters: [], heroes: ['samurai', 'ninja', 'onmyoji'] };
// 遊戲的 8 個方向（下、上、左、右、左下、右下、左上、右上）→ Flare 圖裡的方向（畫面上：0 左、1 左上、2 上、3 右上、4 右、5 右下、6 下、7 左下）
const FLARE_DIR = [6, 2, 0, 4, 7, 5, 1, 3];
// 存檔是 Flare 原圖的 scale 倍；遊戲的格子是 Flare 的 1/3
const flareK = data => (1 / 3) / data.scale;
// 角色照 Flare 的比例只有原本角色的一半大，手機上看不清楚，放大一點
const FLARE_CHAR_K = 1.35;

const flareOn = () => FLARE.ready && typeof MOODCFG !== 'undefined' && MOODCFG.flare;
// 目前區域用的 Flare 場景圖塊（沒有就是 null）
function flareTiles() {
  if (!flareOn()) return null;
  const z = curZone(), T = z.flare && FLARE.tiles[z.flare.tiles];
  return T && ready(T.im) ? T : null;
}

// 讀進 SPEC：每個動作是 { fr: [幀][Flare 方向] = [x, y, 寬, 高, 錨點x, 錨點y], ms, n, once }
function flareSpec(data, file, extra) {
  const anims = {};
  for (const [k, a] of Object.entries(data.anims)) anims[k] = { file, fr: a.fr, ms: a.ms, n: a.fr.length, once: a.once };
  // 身高：站姿第一幀往南的高度（換成遊戲裡的單位）
  const st = data.anims.idle.fr[0][7] || data.anims.idle.fr[0][0];
  const k = flareK(data) * FLARE_CHAR_K / PX;
  return Object.assign({ flare: true, dirs: 8, res: k, anims, h: Math.round(st[3] * k * 0.9) }, extra);
}

function loadFlare() {
  const get = p => fetch('assets/flare/' + p, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const jobs = [];
  for (const z of ZONES) {
    if (!z.flare) continue;
    const name = z.flare.tiles;
    if (name && !FLARE.tiles[name]) {
      FLARE.tiles[name] = {};
      jobs.push(get(`${name}/tiles.json`).then(d => { if (d) Object.assign(FLARE.tiles[name], d, { im: img(`../flare/${name}/${d.img}`) }); else delete FLARE.tiles[name]; }));
    }
    for (const m of Object.values(z.flare.monsters || {})) {
      const key = m.spr, file = key.replace(/^f_/, '');
      if (FLARE.monsters.includes(key)) continue;
      FLARE.monsters.push(key);
      jobs.push(get(`monsters/${file}.json`).then(d => { if (d) SPEC[key] = flareSpec(d, `../flare/monsters/${d.img}`); }));
    }
  }
  for (const c of FLARE.heroes) {
    jobs.push(get(`heroes/${c}.json`).then(d => {
      if (!d) return;
      // 弓箭手射出去的箭沿用原本角色圖的箭
      const base = SPEC[(CLASSES[c] || {}).spr];
      SPEC['f_hero_' + c] = flareSpec(d, `../flare/heroes/${d.img}`, base && base.projectile ? { projectile: base.projectile } : {});
    }));
  }
  return Promise.all(jobs).then(() => {
    FLARE.ready = true;
    applyFlareMonsters();
    // 圖也先載入（loadAllImages 只載 allFiles 列出的）
    return Promise.all([...Object.values(FLARE.tiles).map(T => T.im), ...Object.values(SPEC).filter(s => s.flare).map(s => img(Object.values(s.anims)[0].file))]
      .map(im => new Promise(res => { if (ready(im)) res(); else { im.addEventListener('load', res); im.addEventListener('error', res); } })));
  });
}

// 怪物：打開寫實素材時，把區域的怪物換成 Flare 版（名字、外觀、大小）；關掉時換回來
function applyFlareMonsters() {
  const on = flareOn();
  for (const z of ZONES) {
    if (!z.flare || !z.flare.monsters) continue;
    for (const [role, alt] of Object.entries(z.flare.monsters)) {
      const def = MONSTERS[zoneMonster(z, role)];
      if (!def || !SPEC[alt.spr]) continue;
      if (!def._orig) def._orig = Object.fromEntries(Object.keys(alt).map(k => [k, def[k]]));
      Object.assign(def, on ? alt : def._orig);
    }
  }
}

// 主角：寫實素材打開時用 Flare 的人物（照片主角除外）
function flareHeroSpec(p) {
  if (!flareOn() || p.spr) return null;
  const k = 'f_hero_' + p.cls;
  return SPEC[k] ? k : null;
}

// 畫 Flare 的一幀（drawSpec 會轉過來）
function drawFlareSpec(c, sp, act, dir, t, x, y, scale, flash, tint) {
  const a = sp.anims[act] || (act === 'run' && sp.anims.walk) || sp.anims.idle || sp.anims.walk;
  const im = img(a.file);
  if (!ready(im)) return false;
  const k = Math.floor(t * 1000 / a.ms);
  const f = a.once ? Math.min(a.n - 1, Math.max(0, k)) : ((k % a.n) + a.n) % a.n;
  const r = a.fr[f][FLARE_DIR[dir] !== undefined ? FLARE_DIR[dir] : 7];
  if (!r) return true;
  const s = scale * sp.res, dx = x - r[4] * s, dy = y - r[5] * s, dw = r[2] * s, dh = r[3] * s;
  c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(im, r[0], r[1], r[2], r[3], dx, dy, dw, dh);
  if (flash > 0 && tint) drawTinted(c, im, r[0], r[1], r[2], r[3], dx, dy, dw, dh, tint, Math.min(1, flash));
  else if (flash > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, flash); c.drawImage(im, r[0], r[1], r[2], r[3], dx, dy, dw, dh); }
  c.restore();
  return true;
}

// 畫一塊場景圖塊：(cx, cy) = 格子中心，k = 再放大幾倍
function drawFlareTile(c, T, kind, seed, cx, cy, k = 1, center = false) {
  const L = T.t[kind]; if (!L || !L.length) return false;
  const r = L[Math.floor(seed * L.length) % L.length], s = flareK(T) * k;
  const ox = center ? r[2] / 2 : r[4], oy = center ? r[3] / 2 : r[5];
  c.drawImage(T.im, r[0], r[1], r[2], r[3], cx - ox * s, cy - oy * s, r[2] * s, r[3] * s);
  return true;
}

// 地上物件換成 Flare 的圖；回傳 true = 畫好了
const FLARE_PROP = { tree: 'tree', grave: 'rock', rock: 'rock', crate: 'crate', chest: 'chest', anvil: 'anvil', tent: 'tent', sandbag: 'fence', lamp: 'lamp', campfire: 'campfire', portal: 'portal' };
function drawFlareProp(c, x, y, p, t) {
  const T = flareTiles(), kind = FLARE_PROP[p.type];
  if (!T || !kind) return false;
  c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  drawFlareTile(c, T, kind, p.seed, x, y, kind === 'tree' ? 0.9 : kind === 'portal' ? 0.85 : 1);
  c.restore();
  if (kind === 'portal') {   // 傳送陣：上面加一層會呼吸的藍光
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(x, y - 4, 0, x, y - 4, 40);
    g.addColorStop(0, `rgba(120,200,255,${0.3 + Math.sin(t * 3) * 0.1})`); g.addColorStop(1, 'rgba(120,200,255,0)');
    c.fillStyle = g; ell(c, x, y - 4, 40, 22); c.fill(); c.restore();
  }
  if (kind === 'campfire') drawFlames(c, x, y - 4, t, p.seed, 1);
  return true;
}
// 森林邊緣、遺跡的牆（地圖上 tile = 1 的格子）
function drawFlareWall(c, x, y, seed) {
  const T = flareTiles(); if (!T) return false;
  c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  drawFlareTile(c, T, 'wall', seed, x, y, 0.85);
  c.restore();
  return true;
}
