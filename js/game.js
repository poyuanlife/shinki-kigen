'use strict';
// =====================================================
//  主程式（地圖、戰鬥、技能、掉寶、介面）
// =====================================================

// 45 度等角地圖：每格是寬 64、高 32 的菱形（邏輯像素）
const TW = 64, TH = 32, MAP = 100;
const CAMP = { x: 50.5, y: 50.5, r: 8.5 };
const SAVE_KEY = 'deusmachina_save_v3';   // v3：和風忍者（v1 科技戰士、v2 奇幻遊俠，不相容）
// 每個職業一個存檔欄位；忍者沿用原本的欄位，舊存檔不受影響
const saveKey = cls => (!cls || cls === 'ninja' ? SAVE_KEY : SAVE_KEY + '_' + cls);
const readSave = cls => { try { return JSON.parse(localStorage.getItem(saveKey(cls))); } catch (e) { return null; } };
const $ = id => document.getElementById(id);

// 遊戲自己接住的錯誤：記錄完整訊息與位置，同一個錯誤 10 秒內只記一次
const _errSeen = {};
function reportError(e, where) {
  const msg = (e && e.message) || String(e), key = where + msg, now = performance.now();
  const seen = _errSeen[key] || (_errSeen[key] = { t: -1e9, n: 0 });
  seen.n++;
  if (now - seen.t > 10000) { seen.t = now; Diag.add('程式錯誤', msg, { where: where + (seen.n > 1 ? `（已發生 ${seen.n} 次）` : ''), stack: e && e.stack ? String(e.stack).slice(0, 1500) : '' }); }
  // 出錯時畫布狀態可能停在一半，重設回正常
  try { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } catch (_) { /* 忽略 */ }
}
// 包住事件處理：出錯時記錄，不讓錯誤打斷遊戲
const safe = (fn, where) => function (...a) { try { return fn.apply(this, a); } catch (e) { reportError(e, where); } };

const canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });   // 不透明畫布：合成較快
const lightCv = document.createElement('canvas'), lctx = lightCv.getContext('2d');
// W、H 是「邏輯畫面」大小（世界座標用）；ZOOM = 邏輯 → 螢幕的放大倍率
// RS = 畫質（實際畫布解析度 / 螢幕解析度），DZ = 邏輯 → 畫布像素的倍率
// 光影用 1/4 解析度計算（柔和漸層看不出差別，運算量少 16 倍）
const LIGHT_RES = 0.25;
const QUALITY = [1, 0.75, 0.5], QUALITY_NAME = ['高', '中', '低'];
let qualityIdx = (() => { try { return clamp(+localStorage.getItem('dm_quality') || 0, 0, 2); } catch (e) { return 0; } })();
let W = 0, H = 0, ZOOM = 1, RS = QUALITY[qualityIdx], DZ = 1;
function resize() {
  // 像素圖要用整數倍放大才清晰：每個素材像素 = 2、3、4、5…… 個螢幕像素
  ZOOM = Math.max(2, Math.round(innerHeight / 260)) / PX;
  RS = QUALITY[qualityIdx]; DZ = ZOOM * RS;
  canvas.width = Math.round(innerWidth * RS); canvas.height = Math.round(innerHeight * RS);
  W = innerWidth / ZOOM; H = innerHeight / ZOOM;
  lightCv.width = Math.ceil(W * LIGHT_RES); lightCv.height = Math.ceil(H * LIGHT_RES);
}
function setQuality(i) {
  qualityIdx = clamp(i, 0, QUALITY.length - 1);
  try { localStorage.setItem('dm_quality', qualityIdx); } catch (e) { /* 忽略 */ }
  resize(); invalidateGround();
  if (isMenuOpen()) renderMenu();
}
function cycleQuality() {
  qualityIdx = (qualityIdx + 1) % QUALITY.length;
  try { localStorage.setItem('dm_quality', qualityIdx); } catch (e) { /* 忽略 */ }
  resize(); invalidateGround();
  addLog(`畫質：${QUALITY_NAME[qualityIdx]}（F4 切換）`, '#8cf');
}
addEventListener('resize', resize); resize();

const G = {
  state: 'home', t: 0, enemies: [], bullets: [], ebullets: [], ground: [], parts: [], texts: [], fx: [],
  turrets: [], decals: [], props: [], lights: [], ash: [], corpses: [], cam: { x: 0, y: 0 }, shake: 0,
  mouse: { x: 0, y: 0, down: false, rdown: false, mode: null, repath: 0 }, hover: null, keys: {},
  shopOpen: false, shopStock: [], shopLevel: -1, killsSinceBoss: 0, bossAlive: false, spawnT: 0, saveT: 0,
  labelRects: [], packSeq: 0, uiT: 0, manaMsgT: 0, mapReady: false, showMini: true,
};
let P = null;
G.zone = 'field';
const curZone = () => ZONE_BY_ID[G.zone] || ZONES[0];

// =====================================================
//  地圖
// =====================================================
const N = MAP * MAP;
const M = {
  tile: new Uint8Array(N),   // 0 地面 1 岩壁 2 水池
  floor: new Uint8Array(N),  // 0 草地 1 石板路 2 遺跡地板 3 營地
  wallH: new Uint8Array(N), block: new Uint8Array(N), solid: new Uint8Array(N), ft: new Uint8Array(N),
  seed: new Float32Array(N), col: new Array(N), wcol: new Array(N), deco: new Array(N),
};
const idx = (x, y) => y * MAP + x;
const blocked = (tx, ty) => tx < 0 || ty < 0 || tx >= MAP || ty >= MAP || M.block[ty * MAP + tx] === 1;
const solidAt = (tx, ty) => tx < 0 || ty < 0 || tx >= MAP || ty >= MAP || M.solid[ty * MAP + tx] === 1;
const inCampDist = (x, y) => Math.hypot(x - CAMP.x, y - CAMP.y);

function genMap() {
  const Z = curZone(), Zg = Z.gen;
  applyZoneArt(Z);
  G.mapZone = Z.id;
  const R = mulberry32(Z.seed);
  const ri = (a, b) => Math.floor(a + R() * (b - a + 1));
  M.tile.fill(0); M.floor.fill(0); M.wallH.fill(0); M.block.fill(0); M.solid.fill(0);
  M.deco = new Array(N);
  G.props = [];
  for (let i = 0; i < N; i++) M.seed[i] = R();
  const inCamp = (x, y, r) => inCampDist(x + 0.5, y + 0.5) < r;
  const addDeco = (x, y, type) => { if (x < 0 || y < 0 || x >= MAP || y >= MAP) return; const i = idx(x, y); (M.deco[i] || (M.deco[i] = [])).push(type); };

  // 道路
  const hRoads = [], vRoads = [];
  for (let k = 8; k < MAP - 8; k += ri(14, 19)) hRoads.push(k);
  for (let k = 9; k < MAP - 8; k += ri(14, 19)) vRoads.push(k);
  const paveRoads = () => {
    const pave = (x, y) => { const i = idx(x, y); if (M.floor[i] === 0 && M.tile[i] === 0) M.floor[i] = 1; };
    for (const k of hRoads) for (let x = 0; x < MAP; x++) for (let w = 0; w < 3; w++) pave(x, k + w);
    for (const k of vRoads) for (let y = 0; y < MAP; y++) for (let w = 0; w < 3; w++) pave(k + w, y);
  };

  // 古代遺跡（石板地 + 岩壁）
  for (let k = 0; k < Zg.buildings; k++) {
    const w = ri(5, 11), h = ri(5, 10), x0 = ri(3, MAP - w - 4), y0 = ri(3, MAP - h - 4);
    let ok = true;
    for (let y = y0 - 1; y <= y0 + h && ok; y++) for (let x = x0 - 1; x <= x0 + w; x++) {
      const i = idx(x, y);
      if (M.floor[i] === 2 || M.tile[i] !== 0 || inCamp(x, y, 11)) { ok = false; break; }
    }
    if (!ok) continue;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) M.floor[idx(x, y)] = 2;
    const baseH = ri(1, 4);
    const doors = new Set();
    const sides = [0, 1, 2, 3].sort(() => R() - 0.5).slice(0, 2);
    for (const sd of sides) {
      if (sd < 2) { const yy = sd === 0 ? y0 : y0 + h - 1, xx = x0 + ri(1, w - 3); doors.add(idx(xx, yy)); doors.add(idx(xx + 1, yy)); }
      else { const xx = sd === 2 ? x0 : x0 + w - 1, yy = y0 + ri(1, h - 3); doors.add(idx(xx, yy)); doors.add(idx(xx, yy + 1)); }
    }
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      if (!edge) {   // 內部：竹林之類的區域會長滿（fill），其他區域偶爾有碎石
        if (Zg.fill && R() < Zg.fill) M.tile[idx(x, y)] = 1;
        else if (R() < 0.12) addDeco(x, y, 'stone');
        continue;
      }
      const i = idx(x, y);
      if (doors.has(i)) continue;
      if (R() < Zg.gap) { addDeco(x, y, 'stone'); continue; }
      const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
      M.tile[i] = 1; M.wallH[i] = clamp(baseH * 16 + ri(-12, 14) + (corner ? 18 : 0), 8, 90);
    }
  }
  paveRoads();
  // 水池
  for (let k = 0; k < Zg.pools; k++) {
    const cx = ri(6, MAP - 7), cy = ri(6, MAP - 7);
    if (inCamp(cx, cy, 16)) continue;
    const r = 1.2 + R() * Zg.poolR;
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const i = idx(x, y);
      if (M.tile[i] === 0 && M.floor[i] === 0) M.tile[i] = 2;
    }
  }
  // 邊界
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++)
    if (x < 2 || y < 2 || x >= MAP - 2 || y >= MAP - 2) { const i = idx(x, y); M.tile[i] = 1; M.wallH[i] = 40 + ri(0, 40); }
  // 營地
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++)
    if (inCamp(x, y, 8.2)) { const i = idx(x, y); M.tile[i] = 0; M.floor[i] = 3; M.deco[i] = undefined; }
  // 神龕位置
  const shrineSpots = [[18, 18], [81, 18], [18, 81], [81, 81]];
  for (const [sx, sy] of shrineSpots)
    for (let y = sy - 2; y <= sy + 2; y++) for (let x = sx - 2; x <= sx + 2; x++) { const i = idx(x, y); M.tile[i] = 0; M.floor[i] = 2; M.deco[i] = undefined; }

  for (let i = 0; i < N; i++) { M.block[i] = M.tile[i] !== 0 ? 1 : 0; M.solid[i] = M.tile[i] === 1 ? 1 : 0; }

  const addProp = (type, x, y, blk, extra) => {
    const i = idx(x, y);
    const p = Object.assign({ type, x: x + 0.5, y: y + 0.5, blk, seed: R(), rot: 0, cd: 0 }, extra || {});
    G.props.push(p);
    if (blk) { M.block[i] = 1; M.solid[i] = 1; }
    return p;
  };
  const free = (x, y, campR = 11) => x > 2 && y > 2 && x < MAP - 3 && y < MAP - 3 && M.tile[idx(x, y)] === 0 && !M.block[idx(x, y)] && !inCamp(x, y, campR);

  // 營地物件
  const cx = Math.floor(CAMP.x), cy = Math.floor(CAMP.y);
  addProp('campfire', cx, cy, true);
  addProp('portal', cx + 1, cy + 5, false, { name: '傳送陣' });   // 每個區域都有，可以走上去
  if (Z.hub) {   // 商人、守衛只在青葉之原
    addProp('merchant', cx + 2, cy - 2, true, { name: '行商 源藏', face: 0 });
    addProp('guard', cx - 2, cy + 4, true, { name: '武士 雷電', face: 0 });
    addProp('chest', cx - 4, cy + 1, true);
    addProp('anvil', cx + 4, cy + 1, true);
  }
  addProp('tent', cx - 3, cy - 3, true); M.block[idx(cx - 2, cy - 3)] = 1;
  addProp('flag', cx + 3, cy + 3, true);
  addProp('crate', cx - 3, cy + 2, true);
  for (let a = 0; a < Math.PI * 2; a += 0.11) {
    const deg = (a * 180 / Math.PI) % 90;
    if (deg < 14 || deg > 76) continue; // 四個出入口
    const x = Math.floor(CAMP.x + Math.cos(a) * 7.4), y = Math.floor(CAMP.y + Math.sin(a) * 7.4);
    if (!M.block[idx(x, y)]) addProp('sandbag', x, y, true);
  }
  for (const [sx, sy] of shrineSpots) addProp('shrine', sx, sy, true, { name: '地藏菩薩' });
  const scatter = (type, count, blk, cond) => {
    for (let k = 0, n = 0; k < count * 20 && n < count; k++) {
      const x = ri(3, MAP - 4), y = ri(3, MAP - 4);
      if (free(x, y) && (!cond || cond(x, y))) { addProp(type, x, y, blk); n++; }
    }
  };
  scatter('barrel', Zg.fires, true);
  scatter('crate', Zg.crates, true);
  scatter('tree', Zg.obst, true, (x, y) => M.floor[idx(x, y)] === 0);
  scatter('lamp', Zg.signs, true, (x, y) => M.floor[idx(x, y)] === 1);
  scatter('grave', Zg.rocks, true, (x, y) => M.floor[idx(x, y)] !== 1);
  for (let k = 0; k < 1400; k++) {
    const x = ri(2, MAP - 3), y = ri(2, MAP - 3), i = idx(x, y);
    if (M.tile[i] !== 0 || inCamp(x, y, 9) || M.deco[i]) continue;
    addDeco(x, y, M.floor[i] === 0 ? (R() < 0.93 ? 'plant' : 'bones') : (R() < 0.6 ? 'stone' : 'bones'));
  }

  G.lights = G.props.filter(p => p.type === 'barrel' || p.type === 'campfire' || p.type === 'shrine' || p.type === 'portal');
  buildMinimapBase();
  G.mapReady = true;
}

// =====================================================
//  座標、碰撞、尋路
// =====================================================
// 世界座標 (x, y) ↔ 畫面座標。iso(x, y) = 不含鏡頭的投影座標
const isoX = (x, y) => (x - y) * TW / 2, isoY = (x, y) => (x + y) * TH / 2;
function toScreen(x, y) { return { x: isoX(x, y) - G.cam.x + W / 2, y: isoY(x, y) - G.cam.y + H / 2 }; }
function toWorld(px, py) {
  const a = (px - W / 2 + G.cam.x) / (TW / 2), b = (py - H / 2 + G.cam.y) / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
// 鏡頭對準主角
function camTo(shake = 0) { G.cam.x = isoX(P.x, P.y) + rand(-1, 1) * shake; G.cam.y = isoY(P.x, P.y) - 12 + rand(-1, 1) * shake; }
const mouseWorld = () => toWorld(G.mouse.x, G.mouse.y);
// 世界方向 → 螢幕上的角度
function screenAngle(a) { const c = Math.cos(a), s = Math.sin(a); return Math.atan2((c + s) / 2, c - s); }
// 螢幕方向 (sx, sy) → 世界方向（單位向量）
function screenToWorldDir(sx, sy) { const a = sx / (TW / 2), b = sy / (TH / 2), x = (a + b) / 2, y = (b - a) / 2, d = Math.hypot(x, y) || 1; return [x / d, y / d]; }

function canStand(x, y, r) {
  return !blocked(Math.floor(x - r), Math.floor(y - r)) && !blocked(Math.floor(x + r), Math.floor(y - r)) &&
    !blocked(Math.floor(x - r), Math.floor(y + r)) && !blocked(Math.floor(x + r), Math.floor(y + r));
}
function moveBy(e, dx, dy, avoidCamp) {
  let moved = false;
  const okC = (x, y) => !avoidCamp || inCampDist(x, y) > CAMP.r;
  if (dx && canStand(e.x + dx, e.y, e.r) && okC(e.x + dx, e.y)) { e.x += dx; moved = true; }
  if (dy && canStand(e.x, e.y + dy, e.r) && okC(e.x, e.y + dy)) { e.y += dy; moved = true; }
  return moved;
}
function shotClear(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) { const t = i / n; if (solidAt(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))) return false; }
  return true;
}
function clearLine(ax, ay, bx, by, r) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.2);
  for (let k = 1; k <= n; k++) { const t = k / n; if (!canStand(ax + (bx - ax) * t, ay + (by - ay) * t, r)) return false; }
  return true;
}

const AS = { g: new Float32Array(N), from: new Int32Array(N), stamp: new Uint32Array(N), closed: new Uint32Array(N), cur: 0 };
const DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
function findPath(fx, fy, tx, ty, limit = 4000, r = 0.3) {
  let gx = Math.floor(tx), gy = Math.floor(ty);
  if (blocked(gx, gy)) {
    let best = null, bd = 1e9;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (!blocked(gx + dx, gy + dy)) { const d = Math.hypot(gx + dx + 0.5 - tx, gy + dy + 0.5 - ty); if (d < bd) { bd = d; best = [gx + dx, gy + dy]; } }
    }
    if (!best) return null;
    [gx, gy] = best; tx = gx + 0.5; ty = gy + 0.5;
  }
  const sx = Math.floor(fx), sy = Math.floor(fy);
  if (sx === gx && sy === gy) return [{ x: tx, y: ty }];
  const st = ++AS.cur, start = idx(sx, sy), goal = idx(gx, gy);
  const hx = [], hv = []; // 二元堆積
  const push = (f, v) => {
    hx.push(f); hv.push(v); let i = hx.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hx[p] <= hx[i]) break; [hx[p], hx[i]] = [hx[i], hx[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; }
  };
  const pop = () => {
    const v = hv[0], lf = hx.pop(), lv = hv.pop();
    if (hx.length) {
      hx[0] = lf; hv[0] = lv; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r2 = l + 1; let m = i;
        if (l < hx.length && hx[l] < hx[m]) m = l;
        if (r2 < hx.length && hx[r2] < hx[m]) m = r2;
        if (m === i) break;
        [hx[m], hx[i]] = [hx[i], hx[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m;
      }
    }
    return v;
  };
  const oct = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  AS.g[start] = 0; AS.stamp[start] = st; AS.from[start] = -1;
  push(oct(sx, sy), start);
  let found = false, n = 0, best = start, bestH = 1e9;
  while (hx.length && n++ < limit) {
    const i = pop();
    if (AS.closed[i] === st) continue;
    AS.closed[i] = st;
    if (i === goal) { found = true; break; }
    const x = i % MAP, y = (i / MAP) | 0;
    const h = oct(x, y); if (h < bestH) { bestH = h; best = i; }
    for (const [dx, dy, c] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (blocked(nx, ny)) continue;
      if (dx && dy && (blocked(x + dx, y) || blocked(x, y + dy))) continue;
      const ni = idx(nx, ny);
      if (AS.closed[ni] === st) continue;
      const ng = AS.g[i] + c;
      if (AS.stamp[ni] !== st || ng < AS.g[ni]) { AS.stamp[ni] = st; AS.g[ni] = ng; AS.from[ni] = i; push(ng + oct(nx, ny), ni); }
    }
  }
  const end = found ? goal : best;
  if (end === start) return null;
  const pts = [];
  for (let i = end; i !== start && i !== -1; i = AS.from[i]) pts.push({ x: i % MAP + 0.5, y: ((i / MAP) | 0) + 0.5 });
  pts.reverse();
  if (found) pts[pts.length - 1] = { x: tx, y: ty };
  // 平滑化
  const out = []; let cx = fx, cy = fy, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 10);
    while (j > i && !clearLine(cx, cy, pts[j].x, pts[j].y, r)) j--;
    out.push(pts[j]); cx = pts[j].x; cy = pts[j].y; i = j + 1;
  }
  return out;
}

// =====================================================
//  玩家
// =====================================================
function newPlayer(cls = 'ninja') {
  const C = CLASSES[cls] || CLASSES.ninja;
  const p = Object.assign({
    cls, level: 1, exp: 0, statPts: 0, skillPts: 1, skills: {},
    gold: 100, inv: new Array(40).fill(null), equip: {}, potions: { hp: 5, mp: 3 }, rightSkill: C.first, leftSkill: 'attack', zone: 'field',
  }, C.stats);
  ensureSkillSlots(p);
  p.equip.weapon = genItem(1, 0, 'weapon', C.weapon);
  p.equip.armor = genItem(1, 0, 'armor');
  initTransient(p);
  return p;
}
function initTransient(p) {
  Object.assign(p, {
    x: CAMP.x, y: CAMP.y + 2.2, r: 0.3, path: [], target: null, goal: null, atkCd: 0, face: 0.8, walk: 0, moving: 0,
    muzzle: 0, hurt: 0, buffs: {}, shield: 0, cds: {}, cdMax: {}, shotQ: [], gatT: 0, dead: false, retarget: 0,
    act: null, runT: 0, deadT: 0, senT: 0,
  });
  p.st = calcStats(p); p.hp = p.st.maxHp; p.mp = p.st.maxMp;
}

function calcStats(p) {
  const s = { str: p.str, dex: p.dex, vit: p.vit, ene: p.ene, dmgPct: 0, flatDmg: 0, atkSpd: 0, crit: 0, critDmg: 0, hp: 0, mp: 0, def: 0,
    lifeSteal: 0, hpRegen: 0, mpRegen: 0, moveSpd: 0, mf: 0, dr: 0, cdr: 0, allSkills: 0 };
  let itemDef = 0;
  for (const k of EQUIP_SLOTS) {
    const it = p.equip[k]; if (!it) continue;
    if (it.def) itemDef += it.def;
    for (const a of it.affixes) s[a.k] += a.v;
  }
  const lv = id => { const b = p.skills[id] || 0; return b > 0 ? b + s.allSkills : 0; };
  const buffs = p.buffs || {};
  const C = clsOf(p);
  // 別的職業的武器拿在手上也不算（舊存檔或測試時可能發生）
  const w = p.equip.weapon && (weaponCls(p.equip.weapon) || 'ninja') === (p.cls || 'ninja') ? p.equip.weapon : null;
  const wt = w ? WTYPE[w.wkey] : null;
  const base = w ? w.dmg : [1, 3];
  const bless = buffs.bless > 0 ? 0.25 : 0;
  s.melee = wt ? !!wt.melee : C.weapon === 'katana';
  s.dmgMin = base[0] + s.flatDmg; s.dmgMax = base[1] + s.flatDmg;
  s.range = w ? w.range : s.melee ? 1.4 : 5;
  const kiai = buffs.kiai > 0 ? (20 + lv('kiai') * 2) / 100 : 0;
  s.dmgMult = 1 + s.str * 0.01 + s.dmgPct / 100 + lv('overload') * 0.07 + lv('bushido') * 0.06 + kiai + bless;
  s.bulletMult = 1 + lv('pierce') * 0.05;
  s.meleeMult = 1 + lv('kenshin') * 0.06;
  s.pierce = lv('pierce') ? Math.min(80, 15 + lv('pierce') * 4) : 0;
  const stim = buffs.stim > 0 ? (30 + lv('stim') * 3) / 100 : 0;
  s.aps = 2.0 * (w ? w.spd : 1) * (1 + s.atkSpd / 100 + s.dex * 0.003 + stim + lv('kenshin') * 0.015);
  s.critC = Math.min(75, 5 + s.crit + s.dex * 0.05 + lv('precision') + lv('shingan'));
  s.critD = 50 + s.critDmg + (lv('precision') + lv('shingan')) * 8;
  s.lifeSteal += lv('bushido') * 0.5;
  s.maxHp = Math.round((60 + p.level * 4 + s.vit * 4 + s.hp) * (1 + lv('plating') * 0.04 + lv('goutai') * 0.05));
  s.maxMp = Math.round(30 + p.level * 1.5 + s.ene * 2 + s.mp);
  s.defense = Math.round((itemDef + s.def + s.dex * 0.5) * (1 + lv('plating') * 0.12 + lv('goutai') * 0.15) * (1 + bless));
  s.hpReg = 0.5 + p.level * 0.05 + s.hpRegen;
  s.mpReg = 1.2 + s.ene * 0.05 + s.mpRegen + lv('overload') * 0.6;
  s.moveSpeed = 4.0 * (1 + s.moveSpd / 100 + (buffs.stim > 0 ? 0.3 : 0));
  s.drTotal = Math.min(50, s.dr + C.dr);
  if (buffs.kongou > 0) s.drTotal = Math.min(75, s.drTotal + Math.min(45, 25 + lv('kongou')));
  s.cdrTotal = Math.min(50, s.cdr);
  s.lv = lv;
  return s;
}

function setPath(tx, ty) {
  const path = findPath(P.x, P.y, tx, ty);
  P.path = path || [];
}

function rollHit(mult) {
  const s = P.st;
  let d = rand(s.dmgMin, s.dmgMax) * s.dmgMult * mult;
  const crit = Math.random() * 100 < s.critC;
  if (crit) d *= 1 + s.critD / 100;
  return { d: Math.max(1, Math.round(d)), crit };
}
function healP(n) { if (!P.dead) P.hp = Math.min(P.st.maxHp, P.hp + n); }

function fireBullet(src, ang, mult, opt = {}) {
  const sp = opt.speed || 17, range = opt.range || P.st.range;
  const ox = src.x + Math.cos(ang) * 0.45, oy = src.y + Math.sin(ang) * 0.45;
  G.bullets.push({
    x: ox, y: oy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: range / sp,
    mult: mult * P.st.bulletMult, pierce: opt.pierce !== undefined ? opt.pierce : P.st.pierce,
    hit: new Set(), color: opt.color || '#ffe9a0', w: opt.w || 1.6, kind: opt.kind,
  });
  if (src === P) { P.muzzle = 0.06; P.act = { n: 'shoot', t: 0, dur: clamp(1 / P.st.aps, 0.15, 0.4) }; Snd.play(opt.kind === 'blade' ? 'slash' : 'throw'); }
}
// 近戰揮砍：以玩家為中心、朝 ang 的扇形（arc = 角度寬，2π = 一整圈），reach = 距離
function meleeSwing(ang, mult, arc, reach, color = '255,255,255', quiet = false) {
  let n = 0;
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = dist(e, P);
    if (d > reach + e.r) continue;
    if (arc < 6.2 && d > 0.3) {
      let da = Math.abs(Math.atan2(e.y - P.y, e.x - P.x) - ang) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > arc / 2 + Math.atan2(e.r, d)) continue;
    }
    if (!shotClear(P.x, P.y, e.x, e.y)) continue;
    hitEnemy(e, mult * P.st.meleeMult); n++;
  }
  G.fx.push({ type: 'slash', x: P.x, y: P.y, ang, arc, r: reach, t: 0, dur: 0.2, color });
  if (!quiet) { P.act = { n: 'shoot', t: 0, dur: clamp(1 / P.st.aps, 0.15, 0.35) }; Snd.play('slash'); }
  if (n >= 3) G.shake = Math.max(G.shake, 2);
  return n;
}
// 技能 / 攻擊的有效距離：遠程技能有自己的距離，其他用武器距離
const attackReach = id => (SKILLS[id] && SKILLS[id].reach) || P.st.range;
const inReach = (id, e) => dist(P, e) <= attackReach(id) + (P.st.melee && !(SKILLS[id] && SKILLS[id].reach) ? e.r - 0.15 : -0.3);

function basicAttack(tx, ty) {
  const ang = Math.atan2(ty - P.y, tx - P.x);
  P.face = ang;
  const w = P.equip.weapon;
  if (P.st.melee) {
    meleeSwing(ang, 1, w && w.wkey === 'naginata' ? 1.2 : w && w.wkey === 'odachi' ? 2.4 : 1.9, P.st.range);
  } else if (w && w.wkey === 'shotgun') {
    for (let i = 0; i < 4; i++) fireBullet(P, ang + (i - 1.5) * 0.12, 0.4, { speed: rand(14, 17), color: '#ffb060' });
  } else if (w && w.wkey === 'rail') {
    fireBullet(P, ang, 1, { speed: 26, pierce: 100, color: '#9ff', w: 4 });
  } else {
    fireBullet(P, ang + rand(-0.03, 0.03), 1);
  }
  P.atkCd = 1 / P.st.aps;
}

function castSkill(id, w, held) {
  const p = P, s = p.st, sk = SKILLS[id];
  if (p.dead || !sk) return false;
  const lv = s.lv(id);
  if (!lv) { if (!held) addLog(`尚未學習「${sk.name}」（按 K 開啟技能樹）`, '#aaa'); return false; }
  if (sk.type !== 'active') return false;
  if (p.cds[id] > 0) return false;
  if (sk.atk && p.atkCd > 0) return false;
  const mana = Math.round(sk.mana(lv));
  if (p.mp < mana) {
    if (G.t - G.manaMsgT > 1.5) { G.manaMsgT = G.t; floatText(p.x, p.y, '魔力不足', '#6af', 13); }
    return false;
  }
  const ang = Math.atan2(w.y - p.y, w.x - p.x);
  const dTo = Math.min(Math.hypot(w.x - p.x, w.y - p.y), 12);
  switch (id) {
    case 'burst': {
      const n = 3 + Math.floor(lv / 5);
      for (let i = 0; i < n; i++) p.shotQ.push({ t: i * 0.07, ang: ang + rand(-0.04, 0.04), mult: (110 + lv * 12) / 100 });
      p.atkCd = 1 / s.aps * 1.1; p.path = []; p.target = null; p.face = ang;
      break;
    }
    case 'scatter': {
      const n = 7 + Math.floor(lv / 3);
      for (let i = 0; i < n; i++) {
        const a = ang + (i / (n - 1) - 0.5) * 0.9 + rand(-0.03, 0.03);
        fireBullet(p, a, (70 + lv * 9) / 100, { speed: rand(14, 18), range: Math.min(s.range, 6), color: '#ffb060' });
      }
      p.atkCd = 1 / s.aps * 1.35; p.path = []; p.target = null; p.face = ang; G.shake = Math.max(G.shake, 3);
      break;
    }
    case 'gatling': p.buffs.gatling = 2.5 + lv * 0.1; p.gatT = 0; break;
    case 'stim': {
      const c = Math.round(p.hp * 0.1); p.hp -= c; floatText(p.x, p.y, '-' + c, '#f66', 13);
      p.buffs.stim = 6 + lv * 0.5;
      addLog('狂氣爆發！攻擊速度大幅提升！', '#f88');
      break;
    }
    case 'shield': p.shield = shieldAmount(lv, s); p.buffs.shield = 20; break;
    case 'grenade': {
      const d = Math.min(9, dTo);
      G.fx.push({ type: 'grenade', sx: p.x, sy: p.y, x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d, t: 0, dur: 0.45 + d * 0.03, mult: (160 + lv * 22) / 100, r: 2.3 });
      p.face = ang;
      break;
    }
    case 'turret': {
      const max = 1 + Math.floor(lv / 6);
      while (G.turrets.length >= max) G.turrets.shift();
      const d = Math.min(5, dTo);
      let tx = p.x + Math.cos(ang) * d, ty = p.y + Math.sin(ang) * d;
      if (!canStand(tx, ty, 0.3) || !clearLine(p.x, p.y, tx, ty, 0.2)) { tx = p.x + Math.cos(ang) * 0.9; ty = p.y + Math.sin(ang) * 0.9; }
      if (!canStand(tx, ty, 0.3)) { tx = p.x; ty = p.y; }
      G.turrets.push({ x: tx, y: ty, r: 0.3, life: 18, cd: 0.3, mult: (45 + lv * 7) / 100, sang: 0, flash: 0 });
      burst(tx, ty, 10, '#8ef', { sp: 2 });
      break;
    }
    case 'orbital': {
      const tx = p.x + Math.cos(ang) * dTo, ty = p.y + Math.sin(ang) * dTo;
      G.fx.push({ type: 'orbital', x: tx, y: ty, t: 0, delay: 1.0, r: 3.2, mult: (600 + lv * 70) / 100, fired: false });
      break;
    }
    // ---- 武士 ----
    case 'iai': {
      p.face = ang; p.path = []; p.target = null;
      meleeSwing(ang, (130 + lv * 14) / 100, 2.6, s.range + 0.5, '255,200,160');
      p.atkCd = 1 / s.aps * 1.15;
      break;
    }
    case 'tsubame': {
      p.face = ang; p.path = []; p.target = null;
      meleeSwing(ang, (110 + lv * 12) / 100, Math.PI * 2, s.range + 0.7, '255,170,150');
      p.atkCd = 1 / s.aps * 1.3; G.shake = Math.max(G.shake, 3);
      break;
    }
    case 'senjin': p.buffs.senjin = 2.5 + lv * 0.1; p.senT = 0; break;
    case 'kiai': {
      for (const e of G.enemies) if (!e.dead && dist(e, p) < 4.5) { e.stun = Math.max(e.stun || 0, (1 + lv * 0.1) * (e.type === 'boss' ? 0.4 : 1)); aggro(e); }
      p.buffs.kiai = 8;
      G.fx.push({ type: 'ring', x: p.x, y: p.y, t: 0, dur: 0.5, r: 4.5, color: '255,140,90' });
      floatText(p.x, p.y, '喝！', '#ff8a5a', 22, 1.1);
      G.shake = Math.max(G.shake, 6);
      break;
    }
    case 'kongou': p.buffs.kongou = 6 + lv * 0.3; burst(p.x, p.y, 20, '#ffd25a', { sp: 2, z: 30 }); break;
    case 'shippu': {
      // 往前衝，撞到牆就停
      const sx = p.x, sy = p.y, len = Math.min(5, Math.max(2.5, dTo));
      let ex = sx, ey = sy;
      for (let d = 0.2; d <= len + 1e-6; d += 0.2) {
        const nx = sx + Math.cos(ang) * d, ny = sy + Math.sin(ang) * d;
        if (!canStand(nx, ny, p.r)) break;
        ex = nx; ey = ny;
      }
      p.x = ex; p.y = ey; p.path = []; p.target = null; p.face = ang;
      const segL = Math.hypot(ex - sx, ey - sy) || 0.01, mult = (150 + lv * 18) / 100;
      for (const e of G.enemies) {
        if (e.dead) continue;
        const k = clamp(((e.x - sx) * (ex - sx) + (e.y - sy) * (ey - sy)) / (segL * segL), 0, 1);
        if (Math.hypot(e.x - (sx + (ex - sx) * k), e.y - (sy + (ey - sy) * k)) < 0.9 + e.r) hitEnemy(e, mult * s.meleeMult);
      }
      G.fx.push({ type: 'dash', sx, sy, x: ex, y: ey, t: 0, dur: 0.35, face: ang });
      p.act = { n: 'shoot', t: 0, dur: 0.3 }; Snd.play('slash');
      break;
    }
    case 'kamaitachi': {
      fireBullet(p, ang, (100 + lv * 13) / 100, { speed: 13, range: 8, pierce: 100, kind: 'blade', color: '#8ef' });
      p.atkCd = 1 / s.aps * 1.2; p.path = []; p.target = null; p.face = ang;
      break;
    }
    case 'raijin': {
      // 目標處站不下就往回找最近能站的地方
      let tx = p.x, ty = p.y;
      for (let d = Math.min(8, dTo); d > 0; d -= 0.25) {
        const nx = p.x + Math.cos(ang) * d, ny = p.y + Math.sin(ang) * d;
        if (canStand(nx, ny, p.r) && clearLine(p.x, p.y, nx, ny, 0.1)) { tx = nx; ty = ny; break; }
      }
      G.fx.push({ type: 'tele', x: p.x, y: p.y, t: 0 });
      p.x = tx; p.y = ty; p.path = []; p.target = null; p.face = ang;
      explode(tx, ty, 3, (450 + lv * 55) / 100, '120,220,255');
      G.fx.push({ type: 'orbital', x: tx, y: ty, t: 0, delay: 0, r: 3, mult: 0, fired: true });
      G.shake = 14;
      break;
    }
  }
  p.mp -= mana;
  if (['grenade', 'turret', 'orbital', 'shield', 'stim', 'gatling', 'senjin', 'kiai', 'kongou', 'raijin'].includes(id)) { p.act = { n: id === 'grenade' ? 'swing' : 'cast', t: 0, dur: 0.4 }; Snd.play(id === 'grenade' ? 'throw' : id === 'kiai' ? 'crit' : 'magic'); }
  const cd = sk.cd(lv);
  if (cd > 0) { p.cds[id] = cd * (1 - s.cdrTotal / 100); p.cdMax[id] = p.cds[id]; }
  return true;
}

function usePotion(kind) {
  if (P.dead) return;
  if (P.potions[kind] <= 0) { addLog(kind === 'hp' ? '沒有生命藥水了！' : '沒有魔力藥水了！', '#f88'); return; }
  if (kind === 'hp') {
    if (P.hp >= P.st.maxHp) return;
    const n = Math.round(P.st.maxHp * 0.45); healP(n); floatText(P.x, P.y, '+' + n, '#5f5', 14);
  } else {
    if (P.mp >= P.st.maxMp) return;
    const n = Math.round(P.st.maxMp * 0.5); P.mp = Math.min(P.st.maxMp, P.mp + n); floatText(P.x, P.y, '+' + n, '#6af', 14);
  }
  P.potions[kind]--;
  Snd.play('heal');
  burst(P.x, P.y, 12, kind === 'hp' ? '#f55' : '#58f', { sp: 1.5, z: 30 });
}

function gainExp(n) {
  if (P.level >= MAX_LEVEL) return;
  P.exp += n;
  let up = false;
  while (P.level < MAX_LEVEL && P.exp >= expNext(P.level)) {
    P.exp -= expNext(P.level); P.level++; P.statPts += 5; P.skillPts += 1; up = true;
  }
  if (P.level >= MAX_LEVEL) P.exp = 0;
  if (up) {
    P.st = calcStats(P); P.hp = P.st.maxHp; P.mp = P.st.maxMp;
    G.fx.push({ type: 'levelup', x: P.x, y: P.y, t: 0 });
    Snd.play('levelup');
    floatText(P.x, P.y, '等級提升！', '#ffd23f', 22, 1.8);
    addLog(`升到 ${P.level} 級！獲得 5 屬性點、1 技能點。`, '#ffd23f');
    refreshPanels(); saveGame();
  }
}

function hurtPlayer(raw, lvl) {
  const p = P; if (p.dead) return;
  const s = p.st;
  const red = Math.min(0.8, s.defense / (s.defense + 25 + lvl * 12));
  let d = Math.max(1, Math.round(raw * (1 - red) * (1 - s.drTotal / 100) * rand(0.9, 1.1)));
  if (p.shield > 0) {
    const a = Math.min(p.shield, d); p.shield -= a; d -= a;
    if (a > 0) floatText(p.x, p.y, '護盾 -' + a, '#6ef', 12);
    if (p.shield <= 0) delete p.buffs.shield;
  }
  if (d <= 0) return;
  p.hp -= d; p.hurt = 0.12;
  Snd.play('hurt');
  floatText(p.x, p.y, '-' + d, '#ff5a5a', 14);
  if (p.hp <= 0) die();
}
function die() {
  P.dead = true; P.deadT = 0; P.act = null; P.hp = 0; P.path = []; P.target = null; P.goal = null; P.shotQ = []; P.buffs = {}; P.shield = 0;
  const lost = Math.floor(P.gold * 0.1); P.gold -= lost;
  burst(P.x, P.y, 40, '#c33', { sp: 3 });
  $('deathLoss').textContent = `損失了 ${lost} 金幣`;
  $('death').classList.remove('hidden');
  addLog('你已陣亡……', '#f44');
  Snd.stopMusic(); Snd.play('gameover');
}
function respawn() {
  P.dead = false; P.x = CAMP.x; P.y = CAMP.y + 2.2;
  P.st = calcStats(P); P.hp = P.st.maxHp; P.mp = P.st.maxMp;
  for (const e of G.enemies) e.aggro = false;
  G.ebullets = [];
  $('death').classList.add('hidden');
  saveGame();
}
function returnToCamp() {
  if (P.dead) return;
  if (P.cds.town > 0) { addLog(`傳送冷卻中（${Math.ceil(P.cds.town)} 秒）`, '#aaa'); return; }
  G.fx.push({ type: 'tele', x: P.x, y: P.y, t: 0 });
  P.x = CAMP.x; P.y = CAMP.y + 2.2; P.path = []; P.target = null; P.goal = null;
  G.fx.push({ type: 'tele', x: P.x, y: P.y, t: 0 });
  P.cds.town = 8; P.cdMax.town = 8;
  Snd.play('tele');
  addLog('已傳送回營地。', '#8cf');
}

// =====================================================
//  怪物
// =====================================================
function createEnemy(type, x, y, lvl, rank, packId) {
  const d = MONSTERS[type];
  const hm = [1, 2.4, 4, 1][rank], dm = [1, 1.3, 1.5, 1][rank];
  const hp = Math.round(monHp(lvl) * d.hp * hm);
  let name = d.name;
  if (rank === 1) name = '精英 ' + d.name;
  if (rank === 2) name = choice(UNIQUE_NAMES) + ' · ' + d.name;
  return {
    type: d.role, key: type, def: d, name, x, y, r: d.r, lvl, rank, hp, maxHp: hp, dmg: monDmg(lvl) * d.dmg * dm,
    speed: d.speed * (rank ? 1.1 : 1) * rand(0.92, 1.08), atkCd: rand(0.3, 1.2), aggro: false, anim: rand(0, 10),
    hitFlash: 0, atkAnim: 0, atkDur: 0.3, castAnim: 0, face: rand(0, 6.28), mv: false, runT: rand(0, 1), path: null, pathT: 0, directT: 0, direct: false, faceX: 1, novaCd: 4,
    wander: null, wanderT: rand(1, 4), dead: false, packId, homeX: x, homeY: y,
  };
}
function randomSpawnPoint(minD, maxD) {
  for (let k = 0; k < 40; k++) {
    const a = rand(0, Math.PI * 2), d = rand(minD, maxD);
    const x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
    if (x < 3 || y < 3 || x > MAP - 3 || y > MAP - 3) continue;
    if (inCampDist(x, y) < CAMP.r + 5) continue;
    if (canStand(x, y, 0.55)) return { x, y };
  }
  return null;
}
function spawnPack() {
  const pt = randomSpawnPoint(13, 34); if (!pt) return;
  const z = curZone();
  const tot = PACK_ROLES.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * tot, pk = PACK_ROLES[0];
  for (const p of PACK_ROLES) { if ((r -= p.w) <= 0) { pk = p; break; } }
  const types = pk.types.map(role => zoneMonster(z, role));
  for (let i = rint(0, 2); i > 0; i--) types.push(types[types.length - 1]);
  // 等級：至少是區域的建議等級；玩家比較強時跟著玩家，回到低等區域也不會太簡單
  const far = inCampDist(pt.x, pt.y);
  const lvl = clamp(Math.max(z.lvl + Math.floor(far / 12), P.level + rint(-1, 1) + Math.floor(far / 18)), 1, MAX_LEVEL);
  const roll = Math.random(), rank = roll < 0.04 ? 2 : roll < 0.15 ? 1 : 0;
  const pid = ++G.packSeq;
  types.forEach((t, i) => {
    let x = pt.x + rand(-1.5, 1.5), y = pt.y + rand(-1.5, 1.5);
    if (!canStand(x, y, MONSTERS[t].r)) { x = pt.x; y = pt.y; }
    const rk = rank === 2 ? (i === 0 ? 2 : 0) : rank;
    G.enemies.push(createEnemy(t, x, y, lvl, rk, pid));
  });
}
function spawnBoss() {
  const pt = randomSpawnPoint(10, 16); if (!pt) return;
  const z = curZone(), key = zoneMonster(z, 'boss');
  const e = createEnemy(key, pt.x, pt.y, clamp(Math.max(z.lvl + 5, P.level + 2), 1, MAX_LEVEL), 3, ++G.packSeq);
  G.enemies.push(e);
  G.bossAlive = true; G.killsSinceBoss = 0;
  Snd.play('alert');
  addLog(`陰風四起……「${MONSTERS[key].name}」現身了！`, '#ff6a3a');
  G.shake = 12;
}
function aggro(e) {
  if (e.aggro) return;
  e.aggro = true;
  for (const o of G.enemies) if (o.packId === e.packId && !o.aggro && dist(o, e) < 8) o.aggro = true;
}
function hitEnemy(e, mult) {
  if (e.dead) return;
  const h = rollHit(mult);
  const dealt = Math.min(h.d, e.hp);
  e.hp -= h.d; e.hitFlash = 0.1;
  aggro(e);
  if (P.st.lifeSteal > 0) healP(dealt * P.st.lifeSteal / 100);
  floatText(e.x, e.y, String(h.d), h.crit ? '#ffd23f' : '#ffffff', h.crit ? 18 : 13, 0.8, h.crit);
  Snd.play(h.crit ? 'crit' : 'hit');
  burst(e.x, e.y, 3, e.def.blood, { sp: 1.5, z: 22 });
  if (e.hp <= 0) killEnemy(e);
}
function damageArea(x, y, r, mult) {
  for (const e of G.enemies) if (!e.dead && Math.hypot(e.x - x, e.y - y) < r + e.r) hitEnemy(e, mult);
}
function killEnemy(e) {
  e.dead = true;
  Snd.play('kill');
  gainExp(Math.round(monExp(e.lvl) * e.def.exp * [1, 3, 5, 1][e.rank]));
  dropLoot(e);
  burst(e.x, e.y, e.type === 'boss' ? 80 : 12, e.def.blood, { sp: 3, z: 20 });
  if (e.type === 'boss') burst(e.x, e.y, 30, '#ffcc55', { sp: 4, z: 20 });
  G.corpses.push({ x: e.x, y: e.y, spr: e.def.spr, scale: enemyScale(e), dir: pickDir(e, screenAngle(e.face)), t: 0, life: 0.6, big: e.type === 'boss' || e.type === 'brute' });
  if (G.corpses.length > 40) G.corpses.shift();
  G.decals.push({ x: e.x, y: e.y, r: e.type === 'boss' ? 1.6 : 0.6, color: e.def.blood, t: 0, life: 25 });
  G.killsSinceBoss++;
  if (e.type === 'boss') { G.bossAlive = false; addLog(`${e.def.name}已被擊敗！寶物散落一地！`, '#ffd23f'); G.shake = 15; Snd.play('victory'); }
}
function enemyShoot(e, ang, opt = {}) {
  const sp = opt.speed || 7;
  G.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: opt.life || 1.6, dmg: opt.dmg || e.dmg, lvl: e.lvl,
    color: opt.color || '#d050ff', kind: opt.kind || e.def.shot || 'energy' });
  // 只有畫面附近的才出聲
  if (dist(e, P) < 12) Snd.play((opt.kind || e.def.shot) === 'kunai' ? 'throw' : 'fireball', 0.7);
}

function updateEnemies(dt) {
  const pInCamp = inCampDist(P.x, P.y) < CAMP.r;
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.hitFlash -= dt; e.atkAnim -= dt; e.castAnim -= dt; e.atkCd -= dt; e.mv = false;
    if (e.stun > 0) { e.stun -= dt; continue; }   // 暈眩：不動也不攻擊
    const d = dist(e, P);
    if (!e.aggro && !P.dead && !pInCamp && d < 8.5 && shotClear(e.x, e.y, P.x, P.y)) aggro(e);
    if (e.aggro && (P.dead || pInCamp || d > 22)) { e.aggro = false; e.path = null; }
    let mx = 0, my = 0, spd = e.speed;
    if (e.aggro) {
      e.face = Math.atan2(P.y - e.y, P.x - e.x);
      const df = e.def;
      e.directT -= dt;
      if (e.directT <= 0) { e.directT = 0.3; e.direct = clearLine(e.x, e.y, P.x, P.y, e.r * 0.8); }
      const inRange = df.melee ? d <= df.range + P.r : (d <= df.range && shotClear(e.x, e.y, P.x, P.y));
      if (inRange) {
        if (e.atkCd <= 0) {
          e.atkCd = df.atkCd; e.atkDur = e.atkAnim = clamp(animLen(df.spr, 'attack'), 0.25, Math.min(0.6, df.atkCd * 0.8));
          if (df.melee) hurtPlayer(e.dmg, e.lvl);
          else enemyShoot(e, Math.atan2(P.y - e.y, P.x - e.x) + rand(-0.05, 0.05));
        }
        if (!df.melee && d < 3) { mx = (e.x - P.x) / d; my = (e.y - P.y) / d; spd *= 0.6; }
      } else if (e.direct) {
        mx = (P.x - e.x) / d; my = (P.y - e.y) / d;
      } else {
        e.pathT -= dt;
        if (e.pathT <= 0 || !e.path || !e.path.length) { e.pathT = 0.8; e.path = findPath(e.x, e.y, P.x, P.y, 1500, e.r * 0.9); }
        if (e.path && e.path.length) {
          const t = e.path[0], dx = t.x - e.x, dy = t.y - e.y, dd = Math.hypot(dx, dy);
          if (dd < 0.2) e.path.shift(); else { mx = dx / dd; my = dy / dd; }
        }
      }
      if (e.type === 'boss') {
        e.novaCd -= dt;
        if (e.novaCd <= 0) {
          e.novaCd = 4.5; e.castAnim = 0.4;
          for (let i = 0; i < 16; i++) enemyShoot(e, i / 16 * Math.PI * 2 + G.t, { speed: 5.5, life: 2.2, dmg: e.dmg * 0.55, color: '#ff6030', kind: 'fire' });
          G.shake = Math.max(G.shake, 5);
        }
      }
    } else {
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = rand(2, 6);
        const wx = e.homeX + rand(-4, 4), wy = e.homeY + rand(-4, 4);
        e.wander = canStand(wx, wy, e.r) ? { x: wx, y: wy } : null;
      }
      if (e.wander) {
        const dx = e.wander.x - e.x, dy = e.wander.y - e.y, dd = Math.hypot(dx, dy);
        if (dd < 0.2) e.wander = null; else { mx = dx / dd; my = dy / dd; spd *= 0.35; e.face = Math.atan2(dy, dx); }
      }
    }
    if (mx || my) { if (moveBy(e, mx * spd * dt, my * spd * dt, true)) { e.mv = true; e.runT += dt * Math.max(0.6, spd / 2.4); } }
  }
  // 互相推開
  const es = G.enemies;
  for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
    const a = es[i], b = es[j];
    const dx = b.x - a.x, dy = b.y - a.y, rr2 = a.r + b.r;
    if (Math.abs(dx) > rr2 || Math.abs(dy) > rr2) continue;
    const d = Math.hypot(dx, dy) || 0.01;
    if (d < rr2) { const o = (rr2 - d) * 0.5, nx = dx / d * o, ny = dy / d * o; moveBy(a, -nx, -ny, true); moveBy(b, nx, ny, true); }
  }
  G.enemies = es.filter(e => !e.dead);
}

function updateSpawner(dt) {
  G.spawnT -= dt;
  if (G.spawnT > 0) return;
  G.spawnT = 0.8;
  G.enemies = G.enemies.filter(e => e.aggro || e.type === 'boss' || dist(e, P) < 48);
  if (!G.enemies.some(e => e.type === 'boss')) G.bossAlive = false;
  const target = 28 + Math.min(16, Math.floor(P.level / 5));
  if (G.enemies.length < target) spawnPack();
  if (!G.bossAlive && G.killsSinceBoss >= 100) spawnBoss();
}

// =====================================================
//  掉寶
// =====================================================
function dropLoot(e) {
  const mf = P.st.mf;
  let n = 0, bonus = 1, minR = 0;
  if (e.rank === 0) n = Math.random() < 0.2 ? 1 : 0;
  else if (e.rank === 1) { n = rint(1, 2); bonus = 2.5; }
  else if (e.rank === 2) { n = rint(2, 3); bonus = 4; minR = 1; }
  else { n = rint(4, 6); bonus = 6; minR = 2; }
  for (let i = 0; i < n; i++) {
    let r = Math.max(minR, rollRarity(mf, bonus));
    if (e.rank === 3 && i === 0) r = 3;
    // 武器 75% 是自己職業能用的
    spawnGround(e.x, e.y, { item: genItem(e.lvl + rint(0, 2), r, null, null, Math.random() < 0.75 ? P.cls : null) });
  }
  if (Math.random() < 0.4 || e.rank > 0) spawnGround(e.x, e.y, { gold: Math.max(1, Math.round(e.lvl * rand(2, 6) * (1 + e.rank))) });
  if (Math.random() < 0.07) spawnGround(e.x, e.y, { potion: Math.random() < 0.6 ? 'hp' : 'mp' });
}
function spawnGround(x, y, o) {
  const a = rand(0, Math.PI * 2), d = rand(0.2, 1.1);
  let gx = x + Math.cos(a) * d, gy = y + Math.sin(a) * d;
  if (!canStand(gx, gy, 0.1)) { gx = x; gy = y; }
  G.ground.push(Object.assign({ x: gx, y: gy, t: 0 }, o));
  if (o.item && o.item.rarity >= 2) addLog(`掉落：${o.item.name}`, RARITIES[o.item.rarity].color);
}
function pickupItem(g) {
  // 金幣、藥水直接收下（點地上的名稱也會走到這裡）
  if (!g.item) {
    if (g.gold) { P.gold += g.gold; floatText(g.x, g.y, `+${g.gold} 金幣`, '#ffd23f', 12); }
    if (g.potion) { P.potions[g.potion]++; floatText(g.x, g.y, g.potion === 'hp' ? '+生命藥水' : '+魔力藥水', g.potion === 'hp' ? '#f77' : '#7af', 12); }
    G.ground.splice(G.ground.indexOf(g), 1);
    Snd.play('coin');
    return;
  }
  fixInv();
  const i = P.inv.indexOf(null);
  if (i < 0) { addLog('背包已滿！', '#f88'); floatText(P.x, P.y, '背包已滿', '#f88', 13); Snd.play('cancel'); return; }
  P.inv[i] = g.item;
  G.ground.splice(G.ground.indexOf(g), 1);
  addLog(`拾取：${g.item.name}`, RARITIES[g.item.rarity].color);
  Snd.play('pickup');
  if (isOpen('inv')) renderInv();
}

// 拾取鍵（F）：撿起附近最近的裝備；在旁邊就直接撿，遠一點（8 格內）就走過去撿
const PICK_NEAR = 1.6, PICK_FAR = 8;
const nearestItem = (maxD = PICK_FAR) => {
  let best = null, bd = maxD;
  for (const g of G.ground) { if (!g.item) continue; const d = Math.hypot(g.x - P.x, g.y - P.y); if (d < bd) { bd = d; best = g; } }
  return best;
};
function pickupNearest() {
  if (P.dead) return;
  const g = nearestItem();
  if (!g) { floatText(P.x, P.y, '附近沒有裝備', '#aaa', 12); return; }
  if (Math.hypot(g.x - P.x, g.y - P.y) <= PICK_NEAR) { P.goal = null; pickupItem(g); return; }
  P.target = null; P.goal = { kind: 'pickup', ref: g }; setPath(g.x, g.y);
}

// =====================================================
//  互動：商人、神龕
// =====================================================
function doGoal(g) {
  if (g.kind === 'pickup') { if (G.ground.includes(g.ref)) pickupItem(g.ref); }
  else if (g.ref.type === 'merchant') openShop();
  else if (g.ref.type === 'guard') talkGuard(g.ref);
  else if (g.ref.type === 'shrine') useShrine(g.ref);
  else if (g.ref.type === 'portal') openPanel('travel');
}
const TALKABLE = ['merchant', 'guard', 'shrine', 'portal'];
// 營地的武士：每次對話輪流說一句提示
const GUARD_LINES = [
  '旅人，營地裡很安全，妖怪不會追進來。受了傷就回來歇歇吧。',
  '在外面按 T，或打開選單按「回營地」，就能隨時傳送回來。',
  '地上的裝備太多撿不完？電腦按 F，手機按「拾取」，就會撿起附近的裝備。',
  '打倒一百隻妖怪，這一帶的首領就會現身。小心，它會放出一圈火球。',
  '野外的地藏像可以回滿生命和魔力，還會加持一段時間。',
  '營地南邊的傳送陣能帶你去更遠、更危險的地方。',
  '行商源藏那裡可以買藥水，也能把用不到的裝備賣掉換錢。',
];
function talkGuard(g) {
  g.talk = ((g.talk || 0) % GUARD_LINES.length) + 1;
  const name = g.name || '武士';
  showSheet(`<div class="tipName" style="color:#ffd98a">${name}</div><div style="margin-top:6px;line-height:1.6">「${GUARD_LINES[g.talk - 1]}」</div>`, [['再聊聊', () => talkGuard(g)]]);
  Snd.play('ui');
}
function useShrine(s) {
  if (s.cd > 0) { addLog(`地藏的力量正在恢復（${Math.ceil(s.cd)} 秒）`, '#aaa'); return; }
  s.cd = 90;
  Snd.play('shrine');
  P.hp = P.st.maxHp; P.mp = P.st.maxMp;
  P.buffs.bless = 60;
  G.fx.push({ type: 'levelup', x: P.x, y: P.y, t: 0, color: '255,220,120' });
  addLog('地藏加護：生命與魔力全滿，60 秒內傷害 +25%、防禦 +25%。', '#ffd98a');
}
const hpPotPrice = () => 15 + P.level * 3;
const mpPotPrice = () => 12 + P.level * 2;
function openShop() {
  if (G.shopLevel !== P.level || !G.shopStock.length) {
    G.shopLevel = P.level;
    G.shopStock = [];
    for (let i = 0; i < 6; i++) {
      const it = genItem(P.level + rint(0, 2), Math.random() < 0.15 ? 2 : 1, null, null, P.cls);
      it.buyPrice = it.price * 4;
      G.shopStock.push(it);
    }
  }
  G.shopOpen = true;
  openPanel('shop'); openPanel('inv');
}

// =====================================================
//  特效、粒子、文字
// =====================================================
function burst(x, y, n, color, o = {}) {
  const sp = o.sp || 2;
  for (let i = 0; i < n && G.parts.length < 700; i++) {
    const a = rand(0, Math.PI * 2), v = rand(0.3, 1) * sp;
    G.parts.push({ x, y, z: o.z !== undefined ? o.z : 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rand(30, 120), life: rand(0.4, 0.9), max: 0.9, color, size: rand(1.5, 3.2), g: 260 });
  }
}
function floatText(x, y, text, color, size, dur = 0.9, crit = false) {
  G.texts.push({ x: x + rand(-0.2, 0.2), y: y + rand(-0.2, 0.2), z: 50, text, color, size, t: 0, dur, crit });
}
function explode(x, y, r, mult, color = '255,150,50') {
  damageArea(x, y, r, mult);
  Snd.play(color === '120,220,255' ? 'thunder' : 'boom');
  G.fx.push({ type: 'boom', x, y, t: 0, dur: 0.5, r, color });
  burst(x, y, 30, '#ffb347', { sp: 5, z: 5 });
  burst(x, y, 14, '#555', { sp: 3, z: 5 });
  G.decals.push({ x, y, r: r * 0.6, color: '#111', t: 0, life: 20 });
  G.shake = Math.max(G.shake, 6);
}

function updateFx(dt) {
  for (const f of G.fx) {
    f.t += dt;
    if (f.type === 'grenade' && f.t >= f.dur && !f.done) { f.done = true; explode(f.x, f.y, f.r, f.mult); }
    if (f.type === 'orbital' && f.t >= f.delay && !f.fired) { f.fired = true; explode(f.x, f.y, f.r, f.mult, '120,220,255'); G.shake = 14; }
  }
  G.fx = G.fx.filter(f => !(
    (f.type === 'grenade' && f.done) || ((f.type === 'boom' || f.type === 'slash' || f.type === 'dash' || f.type === 'ring') && f.t > f.dur) || (f.type === 'orbital' && f.t > f.delay + 0.6) ||
    (f.type === 'levelup' && f.t > 1.4) || (f.type === 'click' && f.t > 0.4) || (f.type === 'tele' && f.t > 0.8)));

  for (const p of G.parts) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.g * dt;
    if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
  }
  G.parts = G.parts.filter(p => p.life > 0);
  for (const t of G.texts) { t.t += dt; t.z += dt * 45; }
  G.texts = G.texts.filter(t => t.t < t.dur);
  for (const d of G.decals) d.t += dt;
  G.decals = G.decals.filter(d => d.t < d.life);
  if (G.decals.length > 120) G.decals.splice(0, G.decals.length - 120);
  for (const p of G.props) if (p.cd > 0) p.cd -= dt;
  for (const k of G.corpses) k.t += dt;
  G.corpses = G.corpses.filter(k => k.t < k.life);
}

function updateBullets(dt) {
  for (const b of G.bullets) {
    for (let s = 0; s < 2 && b.life > 0; s++) {
      b.x += b.vx * dt / 2; b.y += b.vy * dt / 2;
      if (solidAt(Math.floor(b.x), Math.floor(b.y))) { b.life = 0; burst(b.x, b.y, 3, '#ffd27a', { sp: 2, z: 26 }); break; }
      for (const e of G.enemies) {
        if (e.dead || b.hit.has(e)) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 0.15) {
          b.hit.add(e); hitEnemy(e, b.mult);
          if (Math.random() * 100 >= b.pierce) { b.life = 0; break; }
        }
      }
    }
    b.life -= dt;
  }
  G.bullets = G.bullets.filter(b => b.life > 0);
  for (const b of G.ebullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (solidAt(Math.floor(b.x), Math.floor(b.y))) { b.life = 0; continue; }
    if (!P.dead && Math.hypot(P.x - b.x, P.y - b.y) < 0.4) { b.life = 0; hurtPlayer(b.dmg, b.lvl); burst(P.x, P.y, 6, b.color, { sp: 2, z: 26 }); }
  }
  G.ebullets = G.ebullets.filter(b => b.life > 0);
}

function updateTurrets(dt) {
  for (const t of G.turrets) {
    t.life -= dt; t.cd -= dt; t.flash -= dt;
    let best = null, bd = 7.5;
    for (const e of G.enemies) { const d = dist(e, t); if (d < bd && shotClear(t.x, t.y, e.x, e.y)) { bd = d; best = e; } }
    if (best) {
      const ang = Math.atan2(best.y - t.y, best.x - t.x);
      t.sang = screenAngle(ang);
      if (t.cd <= 0) { t.cd = 0.33; t.flash = 0.06; fireBullet(t, ang + rand(-0.04, 0.04), t.mult, { color: '#8ff', w: 2 }); }
    }
  }
  G.turrets = G.turrets.filter(t => t.life > 0);
}

// =====================================================
//  主更新
// =====================================================
function updatePlayer(dt) {
  const p = P;
  for (const k in p.buffs) { p.buffs[k] -= dt; if (p.buffs[k] <= 0) { delete p.buffs[k]; if (k === 'shield') p.shield = 0; } }
  for (const k in p.cds) { p.cds[k] -= dt; if (p.cds[k] <= 0) delete p.cds[k]; }
  p.st = calcStats(p);
  const s = p.st;
  if (p.act) { p.act.t += dt; if (p.act.t >= p.act.dur) p.act = null; }
  if (p.dead) { p.deadT += dt; return; }
  p.hp = Math.min(s.maxHp, p.hp + s.hpReg * dt);
  p.mp = Math.min(s.maxMp, p.mp + s.mpReg * dt);
  p.atkCd -= dt; p.muzzle -= dt; p.hurt -= dt;

  for (let i = p.shotQ.length - 1; i >= 0; i--) {
    const q = p.shotQ[i]; q.t -= dt;
    if (q.t <= 0) { fireBullet(p, q.ang, q.mult); p.shotQ.splice(i, 1); }
  }
  if (p.buffs.gatling > 0) {
    p.gatT -= dt;
    while (p.gatT <= 0) {
      p.gatT += 1 / 15;
      const m = TOUCH ? TouchUI.aim() : mouseWorld(), ang = Math.atan2(m.y - p.y, m.x - p.x);
      p.face = ang;
      fireBullet(p, ang + rand(-0.09, 0.09), (55 + s.lv('gatling') * 6) / 100);
    }
  }
  if (p.buffs.senjin > 0) {   // 千刃旋風：每 0.2 秒砍一圈
    p.senT -= dt;
    while (p.senT <= 0) {
      p.senT += 0.2;
      meleeSwing(G.t * 9, (50 + s.lv('senjin') * 6) / 100, Math.PI * 2, 2.3, '255,150,130', true);
      Snd.play('slash', 0.6);
    }
  }

  const m = G.mouse;
  if (m.down && G.keys.shift) {
    p.path = []; p.target = null; p.goal = null;
    const w = mouseWorld();
    p.face = Math.atan2(w.y - p.y, w.x - p.x);
    useSkill(p.leftSkill, w, true);
  } else if (m.down && m.mode === 'move') {
    m.repath -= dt;
    if (m.repath <= 0) { m.repath = 0.15; const w = mouseWorld(); setPath(w.x, w.y); }
  } else if (m.down && m.mode === 'attack' && G.hover && G.hover.kind === 'enemy') {
    p.target = G.hover.ref;
  }
  if (m.rdown) useSkill(p.rightSkill, mouseWorld(), true);

  if (p.target) {
    const t = p.target;
    if (t.dead || !G.enemies.includes(t)) p.target = null;
    else {
      if (inReach(validSkill(p.leftSkill), t) && shotClear(p.x, p.y, t.x, t.y)) {
        p.path = [];
        p.face = Math.atan2(t.y - p.y, t.x - p.x);
        useSkill(p.leftSkill, t, true);
      } else {
        p.retarget -= dt;
        if (p.retarget <= 0 || !p.path.length) { p.retarget = 0.3; setPath(t.x, t.y); }
      }
    }
  }
  if (p.goal) {
    const g = p.goal, ref = g.ref;
    if (g.kind === 'pickup' && !G.ground.includes(ref)) p.goal = null;
    else if (Math.hypot(ref.x - p.x, ref.y - p.y) < (g.kind === 'pickup' ? 0.9 : 1.9)) { p.path = []; p.goal = null; doGoal(g); }
    else if (!p.path.length) p.goal = null;
  }

  const joy = TouchUI.joy, kv = keyMoveDir();
  const moveIn = kv ? { x: kv[0], y: kv[1], mag: 1 } : (joy.on && joy.mag > 0.15 ? joy : null);
  if (moveIn) {
    p.path = []; p.goal = null; p.target = null;
    const step = s.moveSpeed * dt * Math.min(1, moveIn.mag * 1.25);
    const [jx, jy] = screenToWorldDir(moveIn.x, moveIn.y);
    moveBy(p, jx * step, jy * step);
    if (!(p.buffs.gatling > 0) && !(p.act && p.act.n === 'shoot')) p.face = Math.atan2(jy, jx);
    p.moving = Math.min(1, p.moving + dt * 8);
    p.walk += dt * 11 * (s.moveSpeed / 4);
    p.runT += dt * (s.moveSpeed / 4);
  } else if (p.path.length) {
    const t = p.path[0], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy), step = s.moveSpeed * dt;
    if (d <= step) { moveBy(p, dx, dy); p.path.shift(); }
    else if (!moveBy(p, dx / d * step, dy / d * step)) p.path = [];
    if (!(p.buffs.gatling > 0)) p.face = Math.atan2(dy, dx);
    p.moving = Math.min(1, p.moving + dt * 8);
    p.walk += dt * 11 * (s.moveSpeed / 4);
    p.runT += dt * (s.moveSpeed / 4);
  } else p.moving = Math.max(0, p.moving - dt * 8);

  // 自動拾取金幣與藥劑
  for (let i = G.ground.length - 1; i >= 0; i--) {
    const g = G.ground[i];
    if (g.item || g.t < 0.4 || Math.hypot(g.x - p.x, g.y - p.y) > 0.8) continue;
    if (g.gold) { p.gold += g.gold; floatText(g.x, g.y, `+${g.gold} 金幣`, '#ffd23f', 12); }
    if (g.potion) { p.potions[g.potion]++; floatText(g.x, g.y, g.potion === 'hp' ? '+生命藥水' : '+魔力藥水', g.potion === 'hp' ? '#f77' : '#7af', 12); }
    Snd.play('coin');
    G.ground.splice(i, 1);
  }
  if (G.shopOpen) {
    const mer = G.props.find(q => q.type === 'merchant');
    if (!mer || dist(p, mer) > 4) { G.shopOpen = false; closePanel('shop'); }
  }
}

function update(dt) {
  G.t += dt;
  G.musicT = (G.musicT || 0) - dt;
  if (G.musicT <= 0 && !P.dead) {
    G.musicT = 0.5;
    const bossFight = G.enemies.some(e => e.type === 'boss' && e.aggro && dist(e, P) < 16);
    Snd.music(bossFight ? 'boss' : inCampDist(P.x, P.y) < CAMP.r + 1 ? 'camp' : curZone().music);
  }
  updatePlayer(dt);
  TouchUI.update(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateTurrets(dt);
  updateFx(dt);
  updateSpawner(dt);
  for (const g of G.ground) g.t += dt;
  G.shake = Math.max(0, G.shake - dt * 30);
  camTo(G.shake);
  computeHover();
  G.saveT += dt;
  if (G.saveT > 30) { G.saveT = 0; saveGame(); }
}

// =====================================================
//  滑鼠指向
// =====================================================
function computeHover() {
  const mx = G.mouse.x, my = G.mouse.y;
  let h = null;
  for (let i = G.labelRects.length - 1; i >= 0; i--) {
    const r = G.labelRects[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h && G.ground.includes(r.g)) { h = { kind: 'item', ref: r.g }; break; }
  }
  if (!h) {
    let best = null, bd = -1e9;
    for (const e of G.enemies) {
      const s = toScreen(e.x, e.y);
      if (Math.abs(mx - s.x) < enemyW(e) + 4 && my < s.y + 8 && my > s.y - enemyH(e) - 4 && e.x + e.y > bd) { bd = e.x + e.y; best = e; }
    }
    if (best) h = { kind: 'enemy', ref: best };
  }
  if (!h) {
    for (const p of G.props) {
      if (!TALKABLE.includes(p.type)) continue;
      // 手指比滑鼠粗：手機上點擊範圍放大
      const big = TOUCH ? 1.5 : 1, s = toScreen(p.x, p.y), hw = (p.type === 'shrine' ? 26 : 16) * big, hh = (p.type === 'shrine' ? 70 : 40) * big;
      if (Math.abs(mx - s.x) < hw && my < s.y + 8 && my > s.y - hh) { h = { kind: 'prop', ref: p }; break; }
    }
  }
  G.hover = h;
  const cur = !h ? 'default' : h.kind === 'enemy' ? 'crosshair' : 'pointer';
  if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
}

// =====================================================
//  繪製
// =====================================================

// (cx, cy) = 圖塊中心
// (cx, cy) = 格子中心
function drawDeco(c, x, y, cx, cy, list) {
  const sd = M.seed[idx(x, y)];
  for (const d of list) {
    if (d === 'plant' || d === 'stone') {
      const [sheet, col, row] = decoTile(d, (sd * 7.3) % 1);
      drawCell(c, sheet, col, row, cx - 16 + (sd - 0.5) * 8, cy - 16 + ((sd * 3.7) % 1 - 0.5) * 8);
      continue;
    }
    if (d === 'bones') {
      c.strokeStyle = '#e8e0c8'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - 6, cy + 2); c.lineTo(cx + 5, cy - 2); c.moveTo(cx - 3, cy - 3); c.lineTo(cx + 2, cy + 4); c.stroke();
      c.fillStyle = '#f0ead8'; ell(c, cx + 7, cy + 1, 3, 2.5); c.fill();
    }
  }
}

// ---------- 地板捲動緩衝 ----------
// 地板（圖塊 + 花草）畫在一張比螢幕大一圈的圖上，每幀只貼這一張。
// 鏡頭移出範圍時，把舊內容平移過去，只補畫新露出來的那一條邊，
// 記憶體固定、每次只畫少量圖塊，不會卡頓。
const GB_MARGIN = 200;
const gbuf = { cv: document.createElement('canvas'), tmp: document.createElement('canvas'), bx: 0, by: 0, bw: 0, bh: 0, dz: 0, valid: false, shifts: 0 };
function invalidateGround() { gbuf.valid = false; }

// 在 c 上（已設好座標轉換）畫出投影座標矩形 (rx, ry, rw, rh) 內的地板；回傳圖是否都載完
// 在 c 上（已設好座標轉換）畫出 (rx, ry, rw, rh) 範圍內的地板；回傳圖是否都載完
// 在 c 上（已設好座標轉換，單位 = 投影座標）畫出 (rx, ry, rw, rh) 範圍內的地板；回傳圖是否都載完
function paintGround(c, rx, ry, rw, rh) {
  c.save();
  c.imageSmoothingEnabled = false;
  c.beginPath(); c.rect(rx, ry, rw, rh); c.clip();
  // 範圍四角換回世界座標，找出要畫的格子
  const inv = (X, Y) => { const a = X / (TW / 2), b = Y / (TH / 2); return [(a + b) / 2, (b - a) / 2]; };
  const cs = [inv(rx - TW, ry - TH * 3), inv(rx + rw + TW, ry - TH * 3), inv(rx - TW, ry + rh + TH), inv(rx + rw + TW, ry + rh + TH)];
  const x0 = Math.max(0, Math.floor(Math.min(...cs.map(p => p[0])))), x1 = Math.min(MAP - 1, Math.ceil(Math.max(...cs.map(p => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...cs.map(p => p[1])))), y1 = Math.min(MAP - 1, Math.ceil(Math.max(...cs.map(p => p[1]))));
  const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP && y < MAP;
  const isDirt = (x, y) => inMap(x, y) && M.floor[idx(x, y)] !== 0 && M.tile[idx(x, y)] !== 2;
  const isWater = (x, y) => inMap(x, y) && M.tile[idx(x, y)] === 2;
  const mask = (f, x, y) => (f(x, y - 1) ? 1 : 0) | (f(x + 1, y) ? 2 : 0) | (f(x, y + 1) ? 4 : 0) | (f(x - 1, y) ? 8 : 0);
  const near = (X, Y, up) => X > rx - TW && X < rx + rw + TW && Y > ry - up && Y < ry + rh + TH;
  let ok = true;
  // 依 x + y 由後往前畫
  for (let sum = x0 + y0; sum <= x1 + y1; sum++) for (let x = x0; x <= x1; x++) {
    const y = sum - x;
    if (y < y0 || y > y1) continue;
    const i = idx(x, y), X = isoX(x, y), Y = isoY(x, y), sd = M.seed[i];
    if (!near(X, Y, TH)) continue;
    ok = drawGrass(c, X, Y, sd) && ok;
    if (M.tile[i] === 2) ok = drawAuto(c, 'water', mask(isWater, x, y), X, Y, sd) && ok;
    else if (isDirt(x, y)) ok = drawAuto(c, 'dirt', mask(isDirt, x, y), X, Y, sd) && ok;
  }
  for (let sum = x0 + y0; sum <= x1 + y1; sum++) for (let x = x0; x <= x1; x++) {
    const y = sum - x;
    if (y < y0 || y > y1) continue;
    const i = idx(x, y);
    if (!M.deco[i] || M.tile[i] !== 0) continue;
    const X = isoX(x + 0.5, y + 0.5), Y = isoY(x + 0.5, y + 0.5);
    if (near(X, Y, 50)) drawDeco(c, x, y, X, Y, M.deco[i]);
  }
  c.restore();
  return ok;
}
const gctx = cv => { const c = cv.getContext('2d'); c.setTransform(DZ, 0, 0, DZ, -gbuf.bx * DZ, -gbuf.by * DZ); return c; };

function fullRebuild(viewX, viewY) {
  const bw = W + GB_MARGIN * 2, bh = H + GB_MARGIN * 2;
  const cw = Math.ceil(bw * DZ), chh = Math.ceil(bh * DZ);
  for (const cv of [gbuf.cv, gbuf.tmp]) if (cv.width !== cw || cv.height !== chh) { cv.width = cw; cv.height = chh; }
  Object.assign(gbuf, { bx: viewX - GB_MARGIN, by: viewY - GB_MARGIN, bw, bh, dz: DZ });
  const c = gbuf.cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cw, chh);
  gbuf.valid = paintGround(gctx(gbuf.cv), gbuf.bx, gbuf.by, bw, bh);
}

function shiftGround(viewX, viewY) {
  // 平移量取整數像素，舊內容才能無縫接上
  const dxp = Math.round((viewX - GB_MARGIN - gbuf.bx) * DZ), dyp = Math.round((viewY - GB_MARGIN - gbuf.by) * DZ);
  const cw = gbuf.cv.width, chh = gbuf.cv.height;
  if (Math.abs(dxp) >= cw * 0.6 || Math.abs(dyp) >= chh * 0.6) { fullRebuild(viewX, viewY); return; }   // 跳太遠（傳送）就整張重畫
  const t = gbuf.tmp.getContext('2d');
  t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, cw, chh);
  t.drawImage(gbuf.cv, -dxp, -dyp);
  [gbuf.cv, gbuf.tmp] = [gbuf.tmp, gbuf.cv];
  gbuf.bx += dxp / DZ; gbuf.by += dyp / DZ; gbuf.shifts++;
  const c = gctx(gbuf.cv), dx = dxp / DZ, dy = dyp / DZ, e = 1 / DZ;   // e = 多補 1 像素避免縫隙
  const { bx, by, bw, bh } = gbuf;
  let ok = true;
  if (dx > 0) ok = paintGround(c, bx + bw - dx - e, by, dx + e, bh) && ok;
  if (dx < 0) ok = paintGround(c, bx, by, -dx + e, bh) && ok;
  if (dy > 0) ok = paintGround(c, bx, by + bh - dy - e, bw, dy + e) && ok;
  if (dy < 0) ok = paintGround(c, bx, by, bw, -dy + e) && ok;
  if (!ok) gbuf.valid = false;
}

function drawGround() {
  const viewX = G.cam.x - W / 2, viewY = G.cam.y - H / 2;
  if (!gbuf.valid || gbuf.dz !== DZ || gbuf.bw !== W + GB_MARGIN * 2 || gbuf.bh !== H + GB_MARGIN * 2) fullRebuild(viewX, viewY);
  else if (viewX < gbuf.bx || viewY < gbuf.by || viewX + W > gbuf.bx + gbuf.bw || viewY + H > gbuf.by + gbuf.bh) shiftGround(viewX, viewY);
  // 對齊整數像素、不做內插：等於單純複製，最快
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(gbuf.cv, Math.round((gbuf.bx - viewX) * DZ), Math.round((gbuf.by - viewY) * DZ));
  ctx.restore();
}

// 顯示卡重置（記憶體不足等）時，瀏覽器會清掉畫布內容；恢復後全部重畫
canvas.addEventListener('contextlost', () => Diag.add('顯示卡重置', '畫布內容被瀏覽器清除（通常是顯示記憶體不足或顯示卡驅動重啟）'));
canvas.addEventListener('contextrestored', () => { invalidateGround(); Diag.add('資訊', '畫布已恢復'); });

// 岩壁：用岩柱圖塊；擋住玩家時變半透明
// 樹林（擋路的格子）；擋住玩家時變半透明
// 擋路的格子；擋住玩家時變半透明
function drawWall(x, y, ps) {
  const s = toScreen(x + 0.5, y + 0.5);
  let alpha = 1;
  if (x + y + 1 > P.x + P.y && Math.abs(s.x - ps.x) < 44 && ps.y < s.y + 4 && ps.y > s.y - 72) alpha = 0.45;
  ctx.globalAlpha = alpha;
  drawTree(ctx, s.x, s.y + 6, M.seed[idx(x, y)]);
  ctx.globalAlpha = 1;
}

function drawGroundItem(g) {
  const s = toScreen(g.x, g.y);
  const z = g.t < 0.4 ? Math.sin(g.t / 0.4 * Math.PI) * 26 : 0;
  ctx.save(); ctx.translate(s.x, s.y - z);
  if (g.item) {
    const col = RARITIES[g.item.rarity].color;
    if (g.item.rarity >= 2) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createLinearGradient(0, 0, 0, -140);
      gr.addColorStop(0, col + 'aa'); gr.addColorStop(1, col + '00');
      ctx.fillStyle = gr; ctx.fillRect(-5 - Math.sin(G.t * 3) * 1.5, -140, 10 + Math.sin(G.t * 3) * 3, 140);
      ctx.restore();
    }
    ctx.rotate(-0.45);
    ctx.fillStyle = '#20232b'; ctx.fillRect(-10, -3, 20, 6);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(-10, -3, 20, 6);
  } else drawPickupSprite(ctx, g, 0, 0);
  ctx.restore();
}

// 分段計時（F3 顯示），找出哪一段最花時間
const PROF = { update: 0, ground: 0, world: 0, fx: 0, light: 0, ui: 0 };
let _pt = 0;
function prof(k) { const n = performance.now(); if (k) PROF[k] += (n - _pt - PROF[k]) * 0.05; _pt = n; }

function render() {
  prof();
  ctx.setTransform(DZ, 0, 0, DZ, 0, 0);
  ctx.imageSmoothingEnabled = false;   // 像素圖：放大不要模糊
  ctx.fillStyle = '#1d2b14'; ctx.fillRect(0, 0, W, H);
  const ps = toScreen(P.x, P.y);
  const cs = [toWorld(0, -120), toWorld(W, -120), toWorld(0, H + 260), toWorld(W, H + 260)];
  const minX = Math.max(0, Math.floor(Math.min(...cs.map(c => c.x))) - 1), maxX = Math.min(MAP - 1, Math.ceil(Math.max(...cs.map(c => c.x))) + 1);
  const minY = Math.max(0, Math.floor(Math.min(...cs.map(c => c.y))) - 1), maxY = Math.min(MAP - 1, Math.ceil(Math.max(...cs.map(c => c.y))) + 1);

  const draws = [];
  drawGround();
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (M.tile[idx(x, y)] !== 1) continue;
    const s = toScreen(x, y);
    if (s.x + TW < -40 || s.x - TW > W + 40 || s.y > H + 60 || s.y + 120 < 0) continue;
    draws.push({ d: x + y + 1, f: () => drawWall(x, y, ps) });
  }
  prof('ground');
  for (const d of G.decals) {
    const s = toScreen(d.x, d.y);
    ctx.globalAlpha = Math.min(0.6, (d.life - d.t) / 5) * 0.8;
    ctx.fillStyle = d.color; ell(ctx, s.x, s.y, d.r * TW / 2, d.r * TH / 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const g of G.ground) drawGroundItem(g);

  // 點擊標記
  for (const f of G.fx) if (f.type === 'click') {
    const s = toScreen(f.x, f.y), k = 1 - f.t / 0.4;
    ctx.strokeStyle = `rgba(120,255,140,${k})`; ctx.lineWidth = 2; ell(ctx, s.x, s.y, 12 * k + 4, 6 * k + 2); ctx.stroke();
  }
  // 地面範圍提示
  for (const f of G.fx) if (f.type === 'orbital' && !f.fired) {
    const s = toScreen(f.x, f.y), k = f.t / f.delay;
    ctx.strokeStyle = `rgba(255,60,60,${0.5 + k * 0.5})`; ctx.lineWidth = 2;
    ell(ctx, s.x, s.y, f.r * TW / 2 * k, f.r * TH / 2 * k); ctx.stroke();
    ell(ctx, s.x, s.y, f.r * TW / 2, f.r * TH / 2); ctx.stroke();
  }

  for (const p of G.props) {
    const s = toScreen(p.x, p.y);
    if (s.x < -80 || s.x > W + 80 || s.y < -60 || s.y > H + 120) continue;
    draws.push({ d: p.x + p.y, f: () => { if (!drawPropSprite(ctx, s.x, s.y, p, G.t)) drawProp(ctx, s.x, s.y, p, G.t); } });
  }
  for (const k of G.corpses) {
    const s = toScreen(k.x, k.y);
    if (s.x < -100 || s.x > W + 100 || s.y < -40 || s.y > H + 200) continue;
    draws.push({ d: k.x + k.y - 0.6, f: () => drawCorpse(ctx, s.x, s.y, k) });
  }
  const hov = G.hover && G.hover.kind === 'enemy' ? G.hover.ref : null;
  for (const e of G.enemies) {
    const s = toScreen(e.x, e.y);
    if (s.x < -100 || s.x > W + 100 || s.y < -40 || s.y > H + 200) continue;
    draws.push({ d: e.x + e.y, f: () => {
      if (e === hov || e === P.target) { ctx.strokeStyle = 'rgba(255,60,60,0.8)'; ctx.lineWidth = 1.5; ell(ctx, s.x, s.y, enemyW(e) + 4, (enemyW(e) + 4) / 2.2); ctx.stroke(); }
      drawEnemySprite(ctx, s.x, s.y, e);
    } });
  }
  for (const t of G.turrets) { const s = toScreen(t.x, t.y); draws.push({ d: t.x + t.y, f: () => drawTurret(ctx, s.x, s.y, t, G.t) }); }
  draws.push({ d: P.x + P.y, f: () => drawHero(ctx, ps.x, ps.y, P) });
  for (const b of G.bullets) draws.push({ d: b.x + b.y, f: () => drawProjectile(ctx, b, b.kind || 'shuriken') });
  for (const b of G.ebullets) draws.push({ d: b.x + b.y, f: () => {
    if (b.kind) { drawProjectile(ctx, b, b.kind); return; }
    const s = toScreen(b.x, b.y);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(s.x, s.y - 24, 0, s.x, s.y - 24, 12);
    g.addColorStop(0, '#fff'); g.addColorStop(0.3, b.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(s.x - 12, s.y - 36, 24, 24); ctx.restore();
  } });
  draws.sort((a, b) => a.d - b.d);
  for (const d of draws) d.f();
  prof('world');

  drawEffects();

  // 粒子
  for (const p of G.parts) {
    const s = toScreen(p.x, p.y);
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    ctx.fillStyle = p.color; ctx.fillRect(s.x - p.size / 2, s.y - p.z - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  prof('fx');

  drawLighting(ps);
  drawAsh();
  prof('light');
  drawOverlayTexts(hov);
  drawMinimap();
  prof('ui');
  if (G.showFps) {
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const p = PROF, f = v => v.toFixed(1);
    const lines = [
      `FPS ${G.fps.toFixed(0)}　每幀 ${f(G.frameMs)} ms　圖片 ${Sprites.memoryMB().toFixed(0)} MB　畫質 ${QUALITY_NAME[qualityIdx]}（F4）`,
      `邏輯 ${f(p.update)}　地板 ${f(p.ground)}　角色 ${f(p.world)}　特效 ${f(p.fx)}　光影 ${f(p.light)}　介面 ${f(p.ui)}　最慢一幀 ${(G.worstShow || 0).toFixed(0)} ms`,
    ];
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(8, 8, w, 40);
    ctx.fillStyle = G.fps >= 50 ? '#7f7' : G.fps >= 30 ? '#ff7' : '#f77'; ctx.fillText(lines[0], 14, 12);
    ctx.fillStyle = '#ccc'; ctx.fillText(lines[1], 14, 30);
  }
}


function drawEffects() {
  for (const f of G.fx) {
    if (f.type === 'grenade') {
      const k = Math.min(1, f.t / f.dur), x = f.sx + (f.x - f.sx) * k, y = f.sy + (f.y - f.sy) * k;
      const s = toScreen(x, y), z = 28 + Math.sin(k * Math.PI) * 70;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ell(ctx, s.x, s.y, 5, 2.5); ctx.fill();
      ctx.fillStyle = '#3d4a2a'; ell(ctx, s.x, s.y - z, 4.5, 4.5); ctx.fill();
      ctx.fillStyle = Math.sin(G.t * 40) > 0 ? '#f33' : '#600'; ctx.fillRect(s.x - 1, s.y - z - 5, 2, 2);
    } else if (f.type === 'boom') {
      const s = toScreen(f.x, f.y), k = f.t / f.dur;
      drawFx(ctx, 'boom', f.t, s.x, s.y - 12, f.r * 1.4);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const rx = f.r * TW / 2 * (0.4 + k * 0.7), ry = rx / 2;
      const g = ctx.createRadialGradient(s.x, s.y - 10, 0, s.x, s.y - 10, rx);
      g.addColorStop(0, `rgba(255,255,220,${1 - k})`); g.addColorStop(0.35, `rgba(${f.color},${0.8 * (1 - k)})`); g.addColorStop(1, `rgba(${f.color},0)`);
      ctx.fillStyle = g; ell(ctx, s.x, s.y - 10, rx, ry * 1.4); ctx.fill();
      ctx.strokeStyle = `rgba(${f.color},${1 - k})`; ctx.lineWidth = 3; ell(ctx, s.x, s.y, rx * 1.1, ry * 1.1); ctx.stroke();
      ctx.restore();
    } else if (f.type === 'orbital') {
      const s = toScreen(f.x, f.y);
      if (f.fired) { drawFx(ctx, 'thunder', f.t - f.delay, s.x, s.y - 40, 3.5); drawFx(ctx, 'boom', f.t - f.delay, s.x, s.y - 12, f.r * 1.4); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (!f.fired) {
        ctx.strokeStyle = `rgba(255,80,80,${0.3 + Math.random() * 0.3})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, s.y); ctx.stroke();
      } else {
        const k = (f.t - f.delay) / 0.6, w = 46 * (1 - k);
        const g = ctx.createLinearGradient(s.x - w, 0, s.x + w, 0);
        g.addColorStop(0, 'rgba(80,180,255,0)'); g.addColorStop(0.5, `rgba(220,250,255,${1 - k})`); g.addColorStop(1, 'rgba(80,180,255,0)');
        ctx.fillStyle = g; ctx.fillRect(s.x - w, 0, w * 2, s.y);
      }
      ctx.restore();
    } else if (f.type === 'slash') {
      // 刀光：沿著扇形畫一道新月，從起點掃到終點後淡出
      const k = f.t / f.dur, full = f.arc >= 6.2, a0 = full ? f.ang : f.ang - f.arc / 2;
      const sweep = full ? Math.PI * 2 : f.arc, head = Math.min(1, k * 2.2), tail = Math.max(0, k * 2.2 - 1.2);
      const pt = (a, r) => { const s = toScreen(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r); return [s.x, s.y - 14]; };
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const n = 14, ri = f.r * 0.45, ro = f.r;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const [x, y] = pt(a0 + sweep * (tail + (head - tail) * i / n), ro); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      for (let i = n; i >= 0; i--) { const a = a0 + sweep * (tail + (head - tail) * i / n); const [x, y] = pt(a, ro - (ro - ri) * Math.sin(Math.PI * i / n)); ctx.lineTo(x, y); }
      ctx.closePath();
      ctx.fillStyle = `rgba(${f.color},${0.35 * (1 - k)})`; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const [x, y] = pt(a0 + sweep * (tail + (head - tail) * i / n), ro); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = `rgba(255,255,255,${0.95 * (1 - k)})`; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    } else if (f.type === 'dash') {
      // 疾風斬：沿路留下殘影 + 一道白光
      const k = f.t / f.dur, a = toScreen(f.sx, f.sy), b = toScreen(f.x, f.y);
      ctx.save();
      for (let i = 1; i <= 3; i++) {
        const q = i / 4;
        ctx.globalAlpha = 0.35 * (1 - k) * q;
        drawHero(ctx, a.x + (b.x - a.x) * q, a.y + (b.y - a.y) * q, { cls: P.cls, face: f.face, buffs: {}, moving: 1, runT: q, act: null });
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,230,200,${0.9 * (1 - k)})`; ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 14); ctx.lineTo(b.x, b.y - 14); ctx.stroke();
      ctx.restore();
    } else if (f.type === 'ring') {
      const s = toScreen(f.x, f.y), k = f.t / f.dur, rx = f.r * TW / 2 * (0.2 + k * 0.8);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${f.color},${1 - k})`; ctx.lineWidth = 5 * (1 - k) + 1;
      ell(ctx, s.x, s.y, rx, rx / 2); ctx.stroke();
      ell(ctx, s.x, s.y, rx * 0.7, rx * 0.35); ctx.stroke();
      ctx.restore();
    } else if (f.type === 'levelup' || f.type === 'tele') {
      const s = toScreen(f.x, f.y), dur = f.type === 'levelup' ? 1.4 : 0.8, k = f.t / dur;
      const col = f.type === 'tele' ? '120,200,255' : (f.color || '255,210,80');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, s.y, 0, s.y - 160);
      g.addColorStop(0, `rgba(${col},${0.6 * (1 - k)})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(s.x - 26, s.y - 160, 52, 160);
      for (let i = 0; i < 3; i++) {
        const kk = (k + i * 0.2) % 1;
        ctx.strokeStyle = `rgba(${col},${1 - kk})`; ctx.lineWidth = 2;
        ell(ctx, s.x, s.y - kk * 40, 20 + kk * 30, (20 + kk * 30) / 2); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

let vignette = null;
function drawLighting(ps) {
  const K = LIGHT_RES, lw = lightCv.width, lh = lightCv.height;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, lw, lh);
  const ZL = curZone().light;
  lctx.fillStyle = `rgba(${ZL.rgb},${ZL.a})`; lctx.fillRect(0, 0, lw, lh);
  lctx.globalCompositeOperation = 'destination-out';
  lctx.setTransform(K, 0, 0, K, 0, 0);   // 下面用邏輯座標畫，自動縮成低解析度
  const L = (x, y, rad, a) => {
    if (x < -rad || x > W + rad || y < -rad || y > H + rad) return;
    const g = lctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g; lctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  L(ps.x, ps.y - 20, 420, 0.9);
  if (P.muzzle > 0) L(ps.x, ps.y - 30, 160, 0.6);
  const glows = [];
  for (const l of G.lights) {
    const s = toScreen(l.x, l.y);
    if (l.type === 'shrine') { if (l.cd <= 0) { L(s.x, s.y - 40, 200, 0.8); glows.push([s.x, s.y - 40, 120, '255,200,90', 0.18]); } continue; }
    const fl = 1 + Math.sin(G.t * 11 + l.seed * 20) * 0.06 + Math.sin(G.t * 7.3 + l.seed * 5) * 0.05;
    const big = l.type === 'campfire';
    L(s.x, s.y - 20, (big ? 300 : 170) * fl, 0.9);
    glows.push([s.x, s.y - 20, (big ? 160 : 90) * fl, '255,130,40', 0.22]);
  }
  for (const f of G.fx) {
    if (f.type === 'boom') { const s = toScreen(f.x, f.y); L(s.x, s.y, 260 * (1 - f.t / f.dur), 1); }
    if (f.type === 'orbital' && f.fired) { const s = toScreen(f.x, f.y); L(s.x, s.y, 320, 1); }
    if (f.type === 'levelup') { const s = toScreen(f.x, f.y); L(s.x, s.y - 40, 260, 0.8); }
  }
  for (const b of G.ebullets) { const s = toScreen(b.x, b.y); L(s.x, s.y - 24, 70, 0.5); }
  for (const g of G.ground) if (g.item && g.item.rarity >= 2) { const s = toScreen(g.x, g.y); L(s.x, s.y - 20, 80, 0.5); }
  // 暗角也疊進同一張低解析度圖，最後只要貼一次
  if (!vignette || vignette.width !== lw || vignette.height !== lh) {
    vignette = document.createElement('canvas'); vignette.width = lw; vignette.height = lh;
    const vc = vignette.getContext('2d');
    const v = vc.createRadialGradient(lw / 2, lh / 2, Math.min(lw, lh) * 0.35, lw / 2, lh / 2, Math.max(lw, lh) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
    vc.fillStyle = v; vc.fillRect(0, 0, lw, lh);
  }
  lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.globalCompositeOperation = 'source-over';
  lctx.drawImage(vignette, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lightCv, 0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, r, c, a] of glows) {
    if (x < -r || x > W + r || y < -r || y > H + r) continue;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

// 飄浮的花粉與螢火蟲
// 天氣粒子：花粉、落葉、風沙、雪、塵埃、火星（依區域）
const WEATHER = {
  pollen: { n: 45, init: () => ({ vx: rand(-6, 6), vy: rand(-8, -2), s: rand(0.8, 1.8), fly: Math.random() < 0.35 }), color: a => a.fly ? `rgba(210,255,120,${0.35 + Math.sin(G.t * 3 + a.ph) * 0.35})` : 'rgba(255,240,200,0.3)', glow: true },
  leaves: { n: 30, init: () => ({ vx: rand(-14, -4), vy: rand(10, 22), s: rand(1.4, 2.4) }), color: a => (a.ph > 3 ? 'rgba(120,190,80,0.75)' : 'rgba(170,210,90,0.7)'), rect: true },
  sand: { n: 60, init: () => ({ vx: rand(40, 80), vy: rand(-4, 4), s: rand(0.6, 1.3) }), color: () => 'rgba(240,200,140,0.45)' },
  snow: { n: 90, init: () => ({ vx: rand(-8, 4), vy: rand(14, 30), s: rand(0.8, 2) }), color: () => 'rgba(255,255,255,0.8)' },
  dust: { n: 25, init: () => ({ vx: rand(-3, 3), vy: rand(-3, 3), s: rand(0.6, 1.2) }), color: a => `rgba(200,200,220,${0.15 + Math.sin(G.t * 2 + a.ph) * 0.1})` },
  embers: { n: 50, init: () => ({ vx: rand(-6, 6), vy: rand(-26, -10), s: rand(0.7, 1.6) }), color: a => `rgba(255,${110 + (a.ph * 20 | 0)},40,${0.5 + Math.sin(G.t * 5 + a.ph) * 0.3})`, glow: true },
};
function drawAsh() {
  const Wd = WEATHER[curZone().weather] || WEATHER.pollen;
  if (G.ashKind !== curZone().weather) { G.ash = []; G.ashKind = curZone().weather; }
  if (G.ash.length < Wd.n) G.ash.push(Object.assign({ x: Math.random() * W, y: Math.random() * H, ph: rand(0, 6) }, Wd.init()));
  ctx.save(); if (Wd.glow) ctx.globalCompositeOperation = 'lighter';
  for (const a of G.ash) {
    a.x += a.vx * 0.016 + Math.sin(G.t * 0.8 + a.ph) * 0.25; a.y += a.vy * 0.016;
    if (a.y < -5) { a.y = H + 5; a.x = Math.random() * W; }
    if (a.y > H + 5) { a.y = -5; a.x = Math.random() * W; }
    if (a.x > W + 5) a.x = -5; else if (a.x < -5) a.x = W + 5;
    ctx.fillStyle = Wd.color(a);
    if (Wd.rect) ctx.fillRect(a.x, a.y, a.s * 1.6, a.s * 0.8); else { ell(ctx, a.x, a.y, a.s, a.s); ctx.fill(); }
  }
  ctx.restore();
}

function drawOverlayTexts(hov) {
  const k = 1 / ZOOM;   // 讓文字在螢幕上維持固定大小
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // 怪物血條
  for (const e of G.enemies) {
    if (e.hp >= e.maxHp && e !== hov) continue;
    const s = toScreen(e.x, e.y), y = s.y - enemyH(e) - 4, w = e.type === 'boss' ? 50 : 26;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(s.x - w / 2 - 0.5, y - 0.5, w + 1, 3.5);
    ctx.fillStyle = e.rank === 0 ? '#c22' : e.rank === 1 ? '#3a7bff' : e.rank === 2 ? '#e8a020' : '#ff4a1a';
    ctx.fillRect(s.x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), 2.5);
  }
  // NPC 名稱
  ctx.font = `bold ${13 * k}px "Microsoft JhengHei", sans-serif`;
  for (const p of G.props) {
    if (!p.name) continue;
    const s = toScreen(p.x, p.y);
    if (s.x < -50 || s.x > W + 50 || s.y < -50 || s.y > H + 100) continue;
    const y = s.y - (p.type === 'shrine' ? 80 : 44);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; const tw = ctx.measureText(p.name).width + 10 * k; ctx.fillRect(s.x - tw / 2, y - 9 * k, tw, 18 * k);
    ctx.fillStyle = p.type === 'shrine' ? (p.cd > 0 ? '#887' : '#ffd98a') : p.type === 'portal' ? '#8cf' : '#9f9'; ctx.fillText(p.name, s.x, y);
  }
  // 地上物品標籤
  ctx.font = `${12 * k}px "Microsoft JhengHei", sans-serif`;
  const rects = [];
  const vis = [];
  for (const g of G.ground) {
    const s = toScreen(g.x, g.y);
    if (s.x < -100 || s.x > W + 100 || s.y < -50 || s.y > H + 50) continue;
    vis.push({ g, s });
  }
  vis.sort((a, b) => b.s.y - a.s.y);
  const hovItem = G.hover && G.hover.kind === 'item' ? G.hover.ref : null;
  for (const { g, s } of vis) {
    const text = g.item ? g.item.name : g.gold ? `${g.gold} 金幣` : g.potion === 'hp' ? '生命藥水' : '魔力藥水';
    const color = g.item ? RARITIES[g.item.rarity].color : g.gold ? '#ffd23f' : g.potion === 'hp' ? '#f77' : '#7af';
    const w = ctx.measureText(text).width + 10 * k, h = 16 * k;
    let x = s.x - w / 2, y = s.y - 22;
    for (let guard = 0; guard < 30; guard++) {
      const hit = rects.find(r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
      if (!hit) break;
      y = hit.y - h - 2 * k;
    }
    rects.push({ x, y, w, h, g });
    ctx.fillStyle = g === hovItem ? 'rgba(50,60,100,0.92)' : 'rgba(0,0,0,0.72)';
    ctx.fillRect(x, y, w, h);
    if (g.item && g.item.rarity >= 2) { ctx.strokeStyle = color; ctx.lineWidth = k; ctx.strokeRect(x + k / 2, y + k / 2, w - k, h - k); }
    ctx.fillStyle = color; ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  }
  G.labelRects = rects;
  // 浮動數字
  for (const t of G.texts) {
    const s = toScreen(t.x, t.y), k = t.t / t.dur;
    ctx.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
    const sz = t.crit ? t.size * (1 + Math.max(0, 0.3 - t.t) * 2) : t.size;
    ctx.font = `bold ${(sz * k * 1.15).toFixed(1)}px "Microsoft JhengHei", sans-serif`;
    ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const tz = t.z * 0.75;
    ctx.strokeText(t.text, s.x, s.y - tz); ctx.fillStyle = t.color; ctx.fillText(t.text, s.x, s.y - tz);
  }
  ctx.globalAlpha = 1;
}

// ---------- 小地圖 ----------
const mmBase = document.createElement('canvas');
function buildMinimapBase() {
  mmBase.width = MAP; mmBase.height = MAP;
  const c = mmBase.getContext('2d'), img = c.createImageData(MAP, MAP);
  for (let i = 0; i < N; i++) {
    const C = curZone().mm;
    let [r, g, b] = C.grass, a = 200;
    if (M.tile[i] === 1) [r, g, b] = C.wall;
    else if (M.tile[i] === 2) [r, g, b] = C.water;
    else if (M.floor[i] === 1 || M.floor[i] === 2) [r, g, b] = C.path;
    else if (M.floor[i] === 3) [r, g, b] = C.camp;
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  c.putImageData(img, 0, 0);
}
const mm = $('minimap'), mmc = mm.getContext('2d');
function drawMinimap() {
  if (!G.showMini) return;
  const k = Math.min(mm.width / 2, mm.height - 4) / MAP;
  mmc.setTransform(1, 0, 0, 1, 0, 0);
  mmc.clearRect(0, 0, mm.width, mm.height);
  mmc.setTransform(k, k / 2, -k, k / 2, mm.width / 2, 2);
  mmc.imageSmoothingEnabled = false;
  mmc.globalAlpha = 0.85; mmc.drawImage(mmBase, 0, 0); mmc.globalAlpha = 1;
  mmc.fillStyle = '#ffd23f'; mmc.fillRect(CAMP.x - 1.5, CAMP.y - 1.5, 3, 3);
  for (const p of G.props) if (p.type === 'shrine') { mmc.fillStyle = p.cd > 0 ? '#665' : '#ffcf6a'; mmc.fillRect(p.x - 1, p.y - 1, 2.5, 2.5); }
  for (const e of G.enemies) { mmc.fillStyle = e.type === 'boss' ? '#ff6a00' : e.rank === 2 ? '#fc3' : e.rank === 1 ? '#59f' : '#e33'; const s = e.type === 'boss' ? 3 : 1.2; mmc.fillRect(e.x - s / 2, e.y - s / 2, s, s); }
  for (const g of G.ground) if (g.item && g.item.rarity >= 2) { mmc.fillStyle = RARITIES[g.item.rarity].color; mmc.fillRect(g.x - 0.6, g.y - 0.6, 1.2, 1.2); }
  mmc.fillStyle = '#fff'; mmc.fillRect(P.x - 1.2, P.y - 1.2, 2.4, 2.4);
  mmc.setTransform(1, 0, 0, 1, 0, 0);
}

// =====================================================
//  介面 (DOM)
// =====================================================
function addLog(text, color = '#ddd') {
  const box = $('log'), d = document.createElement('div');
  d.textContent = text; d.style.color = color;
  box.appendChild(d);
  while (box.children.length > 7) box.removeChild(box.firstChild);
  setTimeout(() => d.classList.add('fade'), 6000);
  setTimeout(() => d.remove(), 7000);
}
const PANELS = { char: 'panelChar', inv: 'panelInv', skill: 'panelSkill', shop: 'panelShop', travel: 'panelTravel' };
const LEFT = ['char', 'skill', 'shop'];
const isOpen = k => !$(PANELS[k]).classList.contains('hidden');
// 手機一次只開一個視窗；例外：商店和背包一起開（左右各半），才能買賣
const panelPair = (a, b) => (a === 'shop' && b === 'inv') || (a === 'inv' && b === 'shop');
function openPanel(k) {
  if (TOUCH) { for (const o in PANELS) if (o !== k && !panelPair(o, k)) closePanel(o); }
  else if (LEFT.includes(k)) for (const o of LEFT) if (o !== k) closePanel(o);
  $(PANELS[k]).classList.remove('hidden');
  renderPanel(k);
  layoutDuo();
}
function closePanel(k) { $(PANELS[k]).classList.add('hidden'); if (k === 'shop') G.shopOpen = false; hideTip(); layoutDuo(); }
function layoutDuo() { document.documentElement.classList.toggle('duo', TOUCH && isOpen('shop') && isOpen('inv')); }
function togglePanel(k) { isOpen(k) ? closePanel(k) : openPanel(k); }
function renderPanel(k) { ({ char: renderChar, inv: renderInv, skill: renderSkills, shop: renderShop, travel: renderTravel })[k](); }

// ---------- 傳送陣：選擇要去的區域 ----------
function renderTravel() {
  $('travelList').innerHTML = ZONES.map(z => {
    const cur = z.id === G.zone, weak = P.level < z.lvl;
    return `<button class="zoneBtn${cur ? ' cur' : ''}" data-z="${z.id}">
      <b>${z.name}</b><span class="${weak ? 'warn' : ''}">建議等級 ${z.lvl}+${cur ? '（目前所在）' : ''}</span><small>${z.desc}</small></button>`;
  }).join('');
  $('travelList').querySelectorAll('button').forEach(b => { b.onclick = () => travelTo(b.dataset.z); });
}
function travelTo(id) {
  closePanel('travel');
  if (!ZONE_BY_ID[id] || id === G.zone || P.dead) return;
  for (const k in PANELS) closePanel(k);
  G.zone = id; P.zone = id;
  genMap();
  Object.assign(G, { enemies: [], bullets: [], ebullets: [], ground: [], parts: [], texts: [], fx: [], turrets: [], decals: [], corpses: [], killsSinceBoss: 0, bossAlive: false });
  P.x = CAMP.x; P.y = CAMP.y + 2.2; P.path = []; P.target = null; P.goal = null;
  camTo();
  invalidateGround();
  for (let i = 0; i < 10; i++) spawnPack();
  const z = curZone();
  $('zoneName').textContent = z.name;
  G.fx.push({ type: 'tele', x: P.x, y: P.y, t: 0 });
  Snd.play('tele');
  addLog(`傳送到「${z.name}」（建議等級 ${z.lvl}+）`, '#8cf');
  if (P.level < z.lvl) addLog('這裡的妖怪比你強很多，小心！', '#f88');
  saveGame();
}
function refreshPanels() { for (const k in PANELS) if (isOpen(k)) renderPanel(k); renderHotbar(); }

// ---------- 提示框 ----------
const tip = $('tooltip');
function showTip(html) { tip.innerHTML = html; tip.classList.remove('hidden'); placeTip(); }
function hideTip() { tip.classList.add('hidden'); tip.classList.remove('sheet', 'wide'); }
function placeTip() {
  if (tip.classList.contains('hidden') || tip.classList.contains('sheet')) return;
  const r = tip.getBoundingClientRect();
  const mx = G.mouse.x * ZOOM, my = G.mouse.y * ZOOM;   // 提示框用螢幕座標
  let x = mx + 18, y = my + 18;
  if (x + r.width > innerWidth - 6) x = mx - r.width - 18;
  if (y + r.height > innerHeight - 6) y = innerHeight - r.height - 6;
  tip.style.left = Math.max(6, x) + 'px'; tip.style.top = Math.max(6, y) + 'px';
}
function itemHtml(it, head, priceLabel) {
  const R = RARITIES[it.rarity];
  let h = head ? `<div class="tipHead">${head}</div>` : '';
  h += `<div class="tipName" style="color:${R.color}">${it.name}</div>`;
  h += `<div class="tipSub">${R.name} · ${SLOT_NAMES[it.slot]} · 物品等級 ${it.ilvl}</div>`;
  if (it.dmg) h += `<div>傷害：<b>${it.dmg[0]} - ${it.dmg[1]}</b></div><div>攻擊速度：${it.spd.toFixed(2)}　${WTYPE[it.wkey] && WTYPE[it.wkey].melee ? '攻擊距離' : '射程'}：${it.range}</div>`;
  if (it.def) h += `<div>防禦：<b>${it.def}</b></div>`;
  const wc = weaponCls(it);
  if (wc) h += `<div style="color:${canUse(it) ? '#bbb' : '#ff5555'}">${CLASSES[wc].name}專用</div>`;
  h += `<div style="color:${P.level >= it.req ? '#bbb' : '#ff5555'}">需要等級：${it.req}</div>`;
  for (const a of it.affixes) h += `<div class="aff">${AFFIXES[a.k].t.replace('{v}', a.v)}</div>`;
  h += `<div class="tipPrice">${priceLabel || '售價'}：${it.buyPrice && priceLabel ? it.buyPrice : it.price} 金幣</div>`;
  return h;
}
function compareHtml(it) {
  const slots = it.slot === 'ring' ? ['ring1', 'ring2'] : [it.slot];
  let h = '';
  for (const s of slots) if (P.equip[s]) h += `<div class="tipSep"></div>` + itemHtml(P.equip[s], '目前裝備');
  return h;
}

// 手機版的道具說明框：說明 + 可以做的動作
function showItemSheet(it, where, key) {
  const acts = [];
  if (where === 'shop') acts.push(['購買', () => buyItem(key)]);
  else if (where === 'inv') {
    if (G.shopOpen) acts.push(['出售', () => sellItem(key)]);
    else if (it.slot === 'ring' && P.equip.ring1 && P.equip.ring2) acts.push(['換掉中間那只', () => equipItem(key, 'ring1')], ['換掉右邊那只', () => equipItem(key, 'ring2')]);
    else acts.push(['裝備', () => equipItem(key)]);
    acts.push(['丟棄', () => dropItem(where, key)]);
  } else { acts.push(['卸下', () => unequip(key)]); acts.push(['丟棄', () => dropItem(where, key)]); }
  const main = itemHtml(it, where === 'shop' ? '商品' : where === 'equip' ? '目前裝備' : '背包物品', where === 'shop' ? '購買價格' : null);
  const olds = where === 'equip' ? [] : (it.slot === 'ring' ? ['ring1', 'ring2'] : [it.slot]).map(s => P.equip[s]).filter(Boolean);
  if (!olds.length) { showSheet(main, acts); return; }
  // 手機是橫的：左邊這件、右邊目前穿的，並排比較；底下列出差異
  const cols = [main, ...olds.map(o => itemHtml(o, '目前裝備') + diffHtml(it, o))];
  showSheet(`<div class="cmpRow">${cols.map(c => `<div class="cmpCol">${c}</div>`).join('')}</div>`, acts);
  tip.classList.add('wide');
}
// 換上 it 之後，跟 old 相比的變化（綠色變好、紅色變差）
function diffHtml(it, old) {
  const rows = [], add = (name, d, unit = '') => { if (d) rows.push(`<div style="color:${d > 0 ? '#6f6' : '#f66'}">${name} ${d > 0 ? '+' : ''}${d}${unit}</div>`); };
  if (it.dmg && old.dmg) add('平均傷害', Math.round((it.dmg[0] + it.dmg[1]) / 2 - (old.dmg[0] + old.dmg[1]) / 2));
  add('防禦', (it.def || 0) - (old.def || 0));
  const sum = x => { const m = {}; for (const a of x.affixes) m[a.k] = (m[a.k] || 0) + a.v; return m; };
  const a = sum(it), b = sum(old);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (a[k] || 0) - (b[k] || 0);
    if (!d) continue;
    const t = AFFIXES[k].t, label = k === 'cdr' ? '冷卻縮減' : t.replace(/^[+-]?\{v\}%?\s*/, '');
    add(label, d, t.includes('{v}%') ? '%' : '');
  }
  return `<div class="tipSep"></div><div class="tipHead">換上左邊這件的變化</div>` + (rows.length ? `<div class="diff">${rows.join('')}</div>` : '<div class="dim">沒有差別</div>');
}
// 說明框 + 按鈕；按鈕按下後執行動作並關閉
function showSheet(html, acts) {
  tip.classList.remove('wide');
  tip.innerHTML = html + '<div class="sheetBtns">' + acts.map((a, i) => `<button data-i="${i}">${a[0]}</button>`).join('') + '<button data-i="x">關閉</button></div>';
  tip.classList.add('sheet'); tip.classList.remove('hidden');
  tip.querySelectorAll('.sheetBtns button').forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); hideTip(); const a = acts[+b.dataset.i]; if (a && a[1]) a[1](); };
  });
}

// ---------- 背包 ----------
function bindItem(el, it, where, key) {
  if (TOUCH) {
    el.addEventListener('click', ev => { ev.preventDefault(); if (it) showItemSheet(it, where, key); });
    return;
  }
  el.addEventListener('mouseenter', () => {
    if (!it) return;
    showTip(itemHtml(it, null, where === 'shop' ? '購買價格' : null) + (where !== 'equip' ? compareHtml(it) : ''));
  });
  el.addEventListener('mouseleave', hideTip);
  const act = ev => {
    ev.preventDefault();
    if (!it) return;
    hideTip();
    if (where === 'shop') buyItem(key);
    else if (ev.shiftKey) dropItem(where, key);
    else if (where === 'inv' && G.shopOpen) sellItem(key);
    else if (where === 'inv') equipItem(key);
    else unequip(key);
  };
  el.addEventListener('click', act);
  el.addEventListener('contextmenu', act);
}
function slotEl(it) {
  const d = document.createElement('div');
  d.className = 'slot';
  if (it) {
    d.style.borderColor = RARITIES[it.rarity].color;
    d.style.boxShadow = it.rarity >= 2 ? `inset 0 0 12px ${RARITIES[it.rarity].color}66` : '';
    if (it.slot === 'weapon') {
      // 武器：直接顯示素材圖，稀有度光暈畫在格子背景
      const w = WEAPON_ICONS[it.wkey] || WEAPON_ICONS.rifle;
      d.style.background = `radial-gradient(circle, ${RARITIES[it.rarity].color}44, rgba(0,0,0,0.5) 70%)`;
      d.innerHTML = `<img class="pix wpn" src="${NA + w.file}"${w.crop ? ' style="object-fit:cover;object-position:left center"' : ''}>`;
    } else d.innerHTML = `<img src="${itemIcon(it)}">`;
    if (it.req > P.level || !canUse(it)) d.classList.add('cant');
  }
  return d;
}
function renderInv() {
  const eq = $('equipGrid'); eq.innerHTML = '';
  for (const k of EQUIP_SLOTS) {
    const it = P.equip[k], d = slotEl(it);
    d.style.gridArea = k;
    if (!it) d.innerHTML = `<span class="slotLabel">${SLOT_NAMES[slotType(k)]}</span>`;
    bindItem(d, it, 'equip', k);
    eq.appendChild(d);
  }
  const inv = $('invGrid'); inv.innerHTML = '';
  P.inv.forEach((it, i) => { const d = slotEl(it); bindItem(d, it, 'inv', i); inv.appendChild(d); });
  $('goldText').textContent = P.gold.toLocaleString();
}
// 背包裡壞掉的格子（undefined）一律當成空格
function fixInv() { for (let i = 0; i < P.inv.length; i++) if (!P.inv[i]) P.inv[i] = null; }
// 武器只有對應的職業能用；其他裝備大家都能穿
const canUse = it => { const c = weaponCls(it); return !c || c === (P.cls || 'ninja'); };
// ringSlot：兩只戒指都戴著時，指定要換掉哪一只（不給就換第一只）
function equipItem(i, ringSlot) {
  const it = P.inv[i];
  if (!canUse(it)) { addLog(`${it.name}是${CLASSES[weaponCls(it)].name}專用的武器。`, '#f88'); Snd.play('cancel'); return; }
  if (it.req > P.level) { addLog(`等級不足，需要 ${it.req} 級。`, '#f88'); return; }
  let slot = it.slot;
  if (slot === 'ring') slot = ringSlot || (!P.equip.ring1 ? 'ring1' : !P.equip.ring2 ? 'ring2' : 'ring1');
  const old = P.equip[slot];
  P.equip[slot] = it; P.inv[i] = old || null;
  afterGearChange();
}
function unequip(slot) {
  fixInv();
  const i = P.inv.indexOf(null);
  if (i < 0) { addLog('背包已滿！', '#f88'); return; }
  P.inv[i] = P.equip[slot]; delete P.equip[slot];
  afterGearChange();
}
function dropItem(where, key) {
  const it = where === 'inv' ? P.inv[key] : P.equip[key];
  if (where === 'inv') P.inv[key] = null; else delete P.equip[key];
  G.ground.push({ x: P.x + rand(-0.3, 0.3), y: P.y + rand(-0.3, 0.3), t: 0, item: it });
  afterGearChange();
}
function sellItem(i) {
  const it = P.inv[i];
  P.gold += it.price; P.inv[i] = null;
  Snd.play('coin');
  addLog(`出售 ${it.name}，獲得 ${it.price} 金幣`, '#ffd23f');
  afterGearChange();
}
function afterGearChange() {
  P.st = calcStats(P);
  P.hp = Math.min(P.hp, P.st.maxHp); P.mp = Math.min(P.mp, P.st.maxMp);
  refreshPanels();
}

// ---------- 商店 ----------
function renderShop() {
  $('pHp').textContent = hpPotPrice(); $('pMp').textContent = mpPotPrice();
  const g = $('shopStock'); g.innerHTML = '';
  G.shopStock.forEach((it, i) => { const d = slotEl(it); bindItem(d, it, 'shop', i); g.appendChild(d); });
  $('shopGold').textContent = P.gold.toLocaleString();
}
function buyItem(i) {
  const it = G.shopStock[i];
  if (P.gold < it.buyPrice) { addLog('金幣不足！', '#f88'); Snd.play('cancel'); return; }
  fixInv();
  const slot = P.inv.indexOf(null);
  if (slot < 0) { addLog('背包已滿！', '#f88'); return; }
  P.gold -= it.buyPrice; P.inv[slot] = it; G.shopStock.splice(i, 1);
  Snd.play('coin');
  addLog(`購買 ${it.name}`, RARITIES[it.rarity].color);
  refreshPanels();
}
function buyPotion(kind, n) {
  const price = kind === 'hp' ? hpPotPrice() : mpPotPrice();
  let bought = 0;
  while (bought < n && P.gold >= price) { P.gold -= price; P.potions[kind]++; bought++; }
  if (!bought) { addLog('金幣不足！', '#f88'); Snd.play('cancel'); } else Snd.play('coin');
  refreshPanels();
}
function sellAllCommon() {
  let n = 0, g = 0;
  P.inv.forEach((it, i) => { if (it && it.rarity === 0) { g += it.price; n++; P.inv[i] = null; } });
  P.gold += g;
  addLog(n ? `出售 ${n} 件普通物品，獲得 ${g} 金幣` : '背包中沒有普通物品', '#ffd23f');
  refreshPanels();
}

// ---------- 角色 ----------
const STAT_INFO = { str: ['力量', '每點 +1% 傷害'], dex: ['敏捷', '每點 +0.3% 攻速、+0.05% 暴擊、+0.5 防禦'], vit: ['體力', '每點 +4 生命'], ene: ['精神', '每點 +2 魔力、+0.05 魔力回復'] };
function renderChar() {
  const s = P.st, need = expNext(P.level);
  const red = Math.round(Math.min(0.8, s.defense / (s.defense + 25 + P.level * 12)) * 100);
  const C = clsOf(P);
  let h = `<div class="charHead"><div><div class="cName">${C.name}</div><div class="cSub">${C.sub}</div></div><div class="cLv">Lv ${P.level}</div></div>`;
  h += `<div class="cExp">經驗值 ${P.level >= MAX_LEVEL ? '已達最高等級' : `${Math.floor(P.exp).toLocaleString()} / ${need.toLocaleString()}`}</div>`;
  h += `<div class="cPts">剩餘屬性點：<b>${P.statPts}</b>${P.statPts ? '　<span class="dim">(Shift+點擊 一次加 10 點)</span>' : ''}</div>`;
  for (const k of ['str', 'dex', 'vit', 'ene']) {
    const bonus = s[k] - P[k];
    h += `<div class="statRow" title="${STAT_INFO[k][1]}"><span class="sl">${STAT_INFO[k][0]}</span><span class="sv">${s[k]}${bonus ? ` <i>(+${bonus})</i>` : ''}</span>
      <button class="plus" data-stat="${k}" ${P.statPts ? '' : 'disabled'}>+</button><span class="sd">${STAT_INFO[k][1]}</span></div>`;
  }
  const dm = s.dmgMult;
  const rows = [
    ['傷害', `${Math.round(s.dmgMin * dm)} - ${Math.round(s.dmgMax * dm)}`],
    ['攻擊速度', `${s.aps.toFixed(2)} 擊/秒`],
    ['暴擊率', `${s.critC.toFixed(1)}%`], ['暴擊傷害', `+${s.critD}%`],
    ['生命', `${Math.ceil(P.hp)} / ${s.maxHp}`], ['魔力', `${Math.floor(P.mp)} / ${s.maxMp}`],
    ['防禦', `${s.defense}（約減傷 ${red}%）`], ['傷害減免', `${s.drTotal}%`],
    ['生命回復', `${s.hpReg.toFixed(1)}/秒`], ['魔力回復', `${s.mpReg.toFixed(1)}/秒`],
    ['生命竊取', `${s.lifeSteal}%`], ['移動速度', `${Math.round(s.moveSpeed / 4 * 100)}%`],
    ['寶物尋找', `+${s.mf}%`], ['技能冷卻', `-${s.cdrTotal}%`], ['所有技能', `+${s.allSkills}`], ['金幣', P.gold.toLocaleString()],
  ];
  h += `<div class="cGrid">` + rows.map(r => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('') + `</div>`;
  $('charBody').innerHTML = h;
}
$('charBody').addEventListener('click', e => {
  const b = e.target.closest('button[data-stat]'); if (!b || !P.statPts) return;
  const n = Math.min(P.statPts, e.shiftKey ? 10 : 1);
  P[b.dataset.stat] += n; P.statPts -= n;
  afterGearChange();
});

// ---------- 技能 ----------
function skillReqOk(id) {
  const sk = SKILLS[id];
  return P.level >= sk.req && (!sk.pre || (P.skills[sk.pre] || 0) > 0);
}
function skillHtml(id) {
  const sk = SKILLS[id], base = P.skills[id] || 0, lv = P.st.lv(id);
  let h = `<div class="tipName" style="color:#ffd98a">${sk.name}</div><div class="tipSub">${sk.type === 'active' ? '主動技能' : '被動技能'} · 需要等級 ${sk.req}${sk.pre ? ` · 前置：${SKILLS[sk.pre].name}` : ''}</div>`;
  if (sk.type === 'active') {
    const l = Math.max(1, lv);
    h += `<div class="dim">魔力消耗：${Math.round(sk.mana(l))}${sk.cd(l) ? `　冷卻：${sk.cd(l)} 秒` : ''}</div>`;
  }
  if (lv > 0) h += `<div class="tipSep"></div><div>目前等級 ${lv}${lv !== base ? `（基礎 ${base}）` : ''}：</div><div class="aff">${sk.desc(lv, P.st)}</div>`;
  if (base < SKILL_MAX) h += `<div class="tipSep"></div><div>下一級 ${lv + 1}：</div><div class="aff2">${sk.desc(lv + 1, P.st)}</div>`;
  if (sk.type === 'active' && lv > 0) h += `<div class="dim" style="margin-top:6px">點擊下方快捷列設為右鍵技能，或按數字鍵施放。</div>`;
  return h;
}
function renderSkills() {
  $('skillPts').textContent = P.skillPts;
  const box = $('skillTrees'); box.innerHTML = '';
  for (const tree of clsOf(P).trees) {
    const col = document.createElement('div'); col.className = 'tree';
    col.innerHTML = `<div class="treeName" style="color:${tree.color}">${tree.name}</div>`;
    for (const id of tree.skills) {
      const sk = SKILLS[id], base = P.skills[id] || 0, ok = skillReqOk(id);
      const d = document.createElement('div');
      d.className = 'skill' + (base ? ' learned' : '') + (ok ? '' : ' locked') + (ok && P.skillPts && base < SKILL_MAX ? ' can' : '');
      d.innerHTML = `<div class="sIcon" style="border-color:${tree.color};color:${tree.color}">${sk.icon}</div>
        <div class="sInfo"><div class="sName">${sk.name}</div><div class="sMeta">${sk.type === 'active' ? '主動' : '被動'} · 需 Lv${sk.req}</div></div>
        <div class="sLv">${base}<small>/${SKILL_MAX}</small></div>`;
      if (TOUCH) {
        // 手機：點一下先看說明，再決定要不要學
        d.addEventListener('click', () => {
          const can = P.skillPts && ok && base < SKILL_MAX;
          showSheet(skillHtml(id), can ? [['學習（+1）', () => learnSkill(id)]] : []);
        });
      } else {
        d.addEventListener('mouseenter', () => showTip(skillHtml(id)));
        d.addEventListener('mouseleave', hideTip);
        d.addEventListener('click', () => learnSkill(id));
      }
      col.appendChild(d);
    }
    box.appendChild(col);
  }
}
// 投入一點技能點
function learnSkill(id) {
  const sk = SKILLS[id], base = P.skills[id] || 0, ok = skillReqOk(id);
  if (!P.skillPts) { addLog('沒有技能點了。', '#aaa'); return; }
  if (!ok) { addLog(`需要等級 ${sk.req}${sk.pre ? ` 並學會「${SKILLS[sk.pre].name}」` : ''}`, '#f88'); return; }
  if (base >= SKILL_MAX) return;
  P.skills[id] = base + 1; P.skillPts--;
  if (sk.type === 'active' && validSkill(P.rightSkill) === ATTACK && P.rightSkill !== ATTACK) P.rightSkill = id;
  if (sk.type === 'active' && !P.touchSkills.includes(id)) { const e = P.touchSkills.indexOf(null); if (e >= 0) P.touchSkills[e] = id; }
  P.st = calcStats(P);
  refreshPanels();
  if (!TOUCH) showTip(skillHtml(id));
}

// ---------- 快捷列 / HUD ----------
function renderHotbar() { if (P) renderSkillBar(); }
let _targetKey = '';
function updateHUD() {
  const s = P.st;
  if (TOUCH) TouchUI.hud();
  $('hpFill').style.height = (Math.max(0, P.hp) / s.maxHp * 100) + '%';
  $('mpFill').style.height = (P.mp / s.maxMp * 100) + '%';
  $('hpText').textContent = `${Math.ceil(Math.max(0, P.hp))}/${s.maxHp}`;
  $('mpText').textContent = `${Math.floor(P.mp)}/${s.maxMp}`;
  $('shieldRing').style.opacity = P.shield > 0 ? 1 : 0;
  const need = expNext(P.level);
  $('expFill').style.width = (P.level >= MAX_LEVEL ? 100 : P.exp / need * 100) + '%';
  $('expText').textContent = P.level >= MAX_LEVEL ? `Lv ${P.level}（最高等級）` : `Lv ${P.level}　經驗 ${Math.floor(P.exp).toLocaleString()} / ${need.toLocaleString()}（${(P.exp / need * 100).toFixed(1)}%）`;
  $('potHp').textContent = P.potions.hp; $('potMp').textContent = P.potions.mp;
  $('ptsBadge').classList.toggle('hidden', !P.statPts);
  $('skBadge').classList.toggle('hidden', !P.skillPts);
  updateSkillBarHUD();
  const b = [];
  if (P.buffs.stim) b.push(`<span style="color:#f88">狂氣 ${P.buffs.stim.toFixed(0)}s</span>`);
  if (P.buffs.shield) b.push(`<span style="color:#6ef">護盾 ${Math.ceil(P.shield)}</span>`);
  if (P.buffs.bless) b.push(`<span style="color:#ffd98a">地藏加護 ${P.buffs.bless.toFixed(0)}s</span>`);
  if (P.buffs.gatling) b.push(`<span style="color:#ff9f43">千本嵐 ${P.buffs.gatling.toFixed(1)}s</span>`);
  if (P.buffs.senjin) b.push(`<span style="color:#ff8a7a">千刃旋風 ${P.buffs.senjin.toFixed(1)}s</span>`);
  if (P.buffs.kiai) b.push(`<span style="color:#ff9a6a">氣合 ${P.buffs.kiai.toFixed(0)}s</span>`);
  if (P.buffs.kongou) b.push(`<span style="color:#ffd25a">金剛身 ${P.buffs.kongou.toFixed(0)}s</span>`);
  if (P.cds.town) b.push(`<span style="color:#8cf">傳送冷卻 ${P.cds.town.toFixed(0)}s</span>`);
  $('buffs').innerHTML = b.join('');
  // 目標資訊
  const e = G.hover && G.hover.kind === 'enemy' ? G.hover.ref : (G.enemies.find(x => x.type === 'boss' && x.aggro) || null);
  const key = e ? e.name + Math.ceil(e.hp) : '';
  if (key !== _targetKey) {
    _targetKey = key;
    const tb = $('targetBar');
    if (!e) tb.classList.add('hidden');
    else {
      tb.classList.remove('hidden');
      $('targetName').textContent = e.name;
      $('targetName').style.color = ['#eee', '#7fb0ff', '#ffbf3a', '#ff6a3a'][e.rank];
      $('targetHp').style.width = (Math.max(0, e.hp) / e.maxHp * 100) + '%';
      $('targetInfo').textContent = `等級 ${e.lvl}　${Math.max(0, Math.ceil(e.hp)).toLocaleString()} / ${e.maxHp.toLocaleString()}`;
    }
  }
}

// =====================================================
//  輸入
// =====================================================
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', safe(e => {
  if (G.state !== 'play' || P.dead || G.paused) return;
  G.keys.shift = e.shiftKey;
  G.mouse.x = e.clientX / ZOOM; G.mouse.y = e.clientY / ZOOM; computeHover();
  if (e.button === 0) {
    G.mouse.down = true;
    const h = G.hover;
    P.goal = null;
    if (e.shiftKey) { G.mouse.mode = 'shoot'; return; }
    if (h && h.kind === 'enemy') { G.mouse.mode = 'attack'; P.target = h.ref; }
    else if (h && h.kind === 'item') { G.mouse.mode = null; P.target = null; P.goal = { kind: 'pickup', ref: h.ref }; setPath(h.ref.x, h.ref.y); }
    else if (h && h.kind === 'prop') { G.mouse.mode = null; P.target = null; P.goal = { kind: 'interact', ref: h.ref }; setPath(h.ref.x, h.ref.y); if (dist(P, h.ref) < 1.9) { P.goal = null; doGoal({ kind: 'interact', ref: h.ref }); } }
    else {
      G.mouse.mode = 'move'; G.mouse.repath = 0.15; P.target = null;
      const w = mouseWorld(); setPath(w.x, w.y);
      G.fx.push({ type: 'click', x: w.x, y: w.y, t: 0 });
    }
  } else if (e.button === 2) {
    G.mouse.rdown = true;
    useSkill(P.rightSkill, mouseWorld(), false);
  }
}, '滑鼠點擊'));
addEventListener('mouseup', e => { if (e.button === 0) { G.mouse.down = false; G.mouse.mode = null; } if (e.button === 2) G.mouse.rdown = false; });
addEventListener('mousemove', e => { G.mouse.x = e.clientX / ZOOM; G.mouse.y = e.clientY / ZOOM; placeTip(); });
// 鍵盤移動：WASD / 方向鍵，回傳畫面方向（單位向量），沒按就回傳 null
const MOVE_KEYS = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
G.held = {};
function keyMoveDir() {
  if (G.paused || G.state !== 'play') return null;
  let x = 0, y = 0;
  for (const k in MOVE_KEYS) if (G.held[k]) { x += MOVE_KEYS[k][0]; y += MOVE_KEYS[k][1]; }
  if (!x && !y) return null;
  const d = Math.hypot(x, y); return [x / d, y / d];
}
const keyName = e => (e.key === ' ' ? 'space' : e.key.toLowerCase());
addEventListener('blur', () => { G.mouse.down = false; G.mouse.rdown = false; G.keys.shift = false; G.held = {}; });
addEventListener('keyup', e => { G.keys.shift = e.shiftKey; G.held[keyName(e)] = false; });
addEventListener('keydown', safe(e => {
  G.keys.shift = e.shiftKey;
  if (G.state !== 'play') return;
  const k = keyName(e);
  if (G.paused && k !== 'escape') return;   // 選單開著（暫停）時只接受 Esc
  if (skillPickKey(k)) { e.preventDefault(); return; }   // 技能清單開著：數字鍵 = 設定快捷鍵
  if (MOVE_KEYS[k] || k === 'space') { e.preventDefault(); G.held[k] = true; return; }
  if (e.key === 'Tab') { e.preventDefault(); G.showMini = !G.showMini; mm.classList.toggle('hidden', !G.showMini); return; }
  if (e.key === 'F3') { e.preventDefault(); G.showFps = !G.showFps; return; }
  if (e.key === 'F4') { e.preventDefault(); cycleQuality(); return; }
  if (e.key === 'F9') { e.preventDefault(); if (P.level < MAX_LEVEL) gainExp(expNext(P.level) - P.exp); return; }
  if (e.key === 'F10') { e.preventDefault(); spawnGround(P.x, P.y, { item: genItem(P.level, 3) }); spawnGround(P.x, P.y, { item: genItem(P.level, 2) }); return; }
  if (e.key === 'F8') { e.preventDefault(); G.killsSinceBoss = 999; addLog('（測試）即將召喚首領……', '#888'); return; }
  if (e.repeat && 'cik'.includes(k)) return;
  if (k >= '1' && k <= '8') { if (!e.repeat) pressHotkey(+k - 1); return; }
  switch (k) {
    case 'f': if (!e.repeat || G.t - (G.pickT || 0) > 0.2) { G.pickT = G.t; pickupNearest(); } break;
    case 'q': usePotion('hp'); break;
    case 'e': usePotion('mp'); break;
    case 'c': togglePanel('char'); break;
    case 'i': case 'b': togglePanel('inv'); break;
    case 'k': togglePanel('skill'); break;
    case 't': returnToCamp(); break;
    case 'm': G.showMini = !G.showMini; mm.classList.toggle('hidden', !G.showMini); break;
    case 'escape': {
      if (isMenuOpen()) { closeMenu(); break; }
      let any = false;
      for (const p in PANELS) if (isOpen(p)) { closePanel(p); any = true; }
      if (!any) openMenu();
      break;
    }
    case 'n': addLog(Snd.toggleMusic() ? '音樂：開（N 切換）' : '音樂：關（N 切換）', '#8cf'); break;
    case 'v': addLog(Snd.toggleSfx() ? '音效：開（V 切換）' : '音效：關（V 切換）', '#8cf'); break;
  }
}, '鍵盤'));
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => togglePanel(b.dataset.open)));
document.querySelectorAll('.panel .close').forEach(b => b.addEventListener('click', () => closePanel(b.dataset.close)));
$('buyHp1').onclick = () => buyPotion('hp', 1); $('buyHp5').onclick = () => buyPotion('hp', 5);
$('buyMp1').onclick = () => buyPotion('mp', 1); $('buyMp5').onclick = () => buyPotion('mp', 5);
$('sellCommon').onclick = sellAllCommon;
$('respawnBtn').onclick = respawn;
$('potHpBtn').onclick = () => usePotion('hp');
$('potMpBtn').onclick = () => usePotion('mp');

// =====================================================
//  存檔
// =====================================================
// 回傳 true = 成功；'test' = 測試模式不存檔；false = 失敗（例如瀏覽器不允許儲存）
function saveGame() {
  if (!P) return false;
  if (G.testMode) return 'test';
  const keys = ['cls', 'level', 'exp', 'str', 'dex', 'vit', 'ene', 'statPts', 'skillPts', 'skills', 'gold', 'inv', 'equip', 'potions', 'rightSkill', 'leftSkill', 'hotkeys', 'touchSkills', 'zone'];
  const d = { v: 1, savedAt: Date.now() };
  for (const k of keys) d[k] = P[k];
  try { localStorage.setItem(saveKey(P.cls), JSON.stringify(d)); G.lastSave = d.savedAt; return true; } catch (e) { return false; }
}
function loadGame(cls) {
  try {
    const raw = localStorage.getItem(saveKey(cls));
    if (!raw) return null;
    const d = JSON.parse(raw), p = newPlayer(cls);
    d.cls = cls;
    for (const k in d) if (k !== 'v' && k !== 'savedAt') p[k] = d[k];
    p.inv = p.inv.map(x => x || null);
    ensureSkillSlots(p);
    while (p.inv.length < 40) p.inv.push(null);
    p.inv.length = 40;
    initTransient(p);
    return p;
  } catch (e) { return null; }
}
addEventListener('beforeunload', () => { if (G.state === 'play') saveGame(); });

// =====================================================
//  系統選單：音量、畫質、儲存、離開
// =====================================================
const isMenuOpen = () => !$('panelMenu').classList.contains('hidden');
function openMenu() {
  if (G.state !== 'play') return;
  closeSkillPick();
  hideTip();
  $('panelMenu').classList.remove('hidden');
  G.paused = true; $('paused').classList.remove('hidden');
  G.mouse.down = false; G.mouse.rdown = false;
  renderMenu();
}
function closeMenu() {
  $('panelMenu').classList.add('hidden');
  G.paused = false; $('paused').classList.add('hidden');
}
function renderMenu() {
  const c = Snd.cfg;
  $('optMusicOn').checked = c.music; $('optSfxOn').checked = c.sfx;
  $('optMusic').value = Math.round(c.musicVol * 100); $('optSfx').value = Math.round(c.sfxVol * 100);
  $('optMusicVal').textContent = $('optMusic').value + '%'; $('optSfxVal').textContent = $('optSfx').value + '%';
  $('optMusic').disabled = !c.music; $('optSfx').disabled = !c.sfx;
  document.querySelectorAll('#optQuality button').forEach(b => b.classList.toggle('on', +b.dataset.q === qualityIdx));
  document.querySelectorAll('#optDir button').forEach(b => b.classList.toggle('on', b.dataset.d === DIR_MODE));
  document.querySelectorAll('#optHotkey button').forEach(b => b.classList.toggle('on', b.dataset.h === HOTKEY_MODE));
  $('saveInfo').textContent = G.testMode ? '（測試模式：不會存檔）' : G.lastSave ? `上次存檔：${fmtTime(G.lastSave)}` : '';
}
$('menuBtn').onclick = () => (isMenuOpen() ? closeMenu() : openMenu());
$('btnFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else TouchUI.goFullscreen(); };
if (!document.documentElement.requestFullscreen) $('btnFull').classList.add('hidden');
$('menuClose').onclick = closeMenu;
$('optMusic').oninput = e => { Snd.setVolume('music', e.target.value / 100); $('optMusicVal').textContent = e.target.value + '%'; };
$('optSfx').oninput = e => { Snd.setVolume('sfx', e.target.value / 100); $('optSfxVal').textContent = e.target.value + '%'; };
$('optSfx').onchange = () => Snd.play('coin');   // 放開滑桿時播一聲，讓玩家聽聽看音量
$('optMusicOn').onchange = e => { Snd.setEnabled('music', e.target.checked); renderMenu(); };
$('optSfxOn').onchange = e => { Snd.setEnabled('sfx', e.target.checked); renderMenu(); if (e.target.checked) Snd.play('ui'); };
document.querySelectorAll('#optQuality button').forEach(b => { b.onclick = () => { setQuality(+b.dataset.q); Snd.play('ui'); }; });
document.querySelectorAll('#optHotkey button').forEach(b => { b.onclick = () => { setHotkeyMode(b.dataset.h); renderMenu(); renderHotbar(); Snd.play('ui'); }; });
document.querySelectorAll('#optDir button').forEach(b => { b.onclick = () => { setDirMode(b.dataset.d); P && (P._dir = undefined); for (const e of G.enemies) e._dir = undefined; renderMenu(); Snd.play('ui'); }; });
$('btnCamp').onclick = () => { closeMenu(); returnToCamp(); };
$('btnSave').onclick = () => {
  const r = saveGame();
  if (r === true) { addLog('遊戲已儲存。', '#9f9'); Snd.play('ui'); }
  else if (r === 'test') addLog('測試模式不會存檔。', '#aaa');
  else { addLog('存檔失敗：瀏覽器不允許儲存資料（可能是無痕模式）。', '#f88'); Snd.play('cancel'); }
  renderMenu();
};
$('btnQuit').onclick = () => {
  const r = saveGame();
  if (r === false && !confirm('存檔失敗，確定要離開嗎？（進度會遺失）')) return;
  quitToTitle();
};
// 回到標題畫面
function quitToTitle() {
  closeMenu();
  for (const p in PANELS) closePanel(p);
  hideTip();
  $('death').classList.add('hidden');
  $('targetBar').classList.add('hidden');
  document.querySelectorAll('.ingame').forEach(e => e.classList.add('hidden'));
  G.state = 'title';
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  $('title').classList.remove('hidden');
  refreshTitle();
  Snd.music('title');
}

// =====================================================
//  標題畫面 / 開始
// =====================================================
let assetsReady = null;
function loadAssets() {
  if (!assetsReady) assetsReady = loadGameAssets(DZ);
  return assetsReady;
}
async function startGame(p) {
  if (typeof Home !== 'undefined' && Home.active) Home.skip();
  const btns = [$('btnNew'), $('btnLoad')];
  btns.forEach(b => { b.disabled = true; b.dataset.label = b.textContent; });
  $('btnNew').textContent = '載入素材中…';
  await loadAssets();
  $('btnNew').textContent = '準備地圖中…';
  await new Promise(r => setTimeout(r, 30));   // 讓「準備地圖中」的文字先顯示出來
  Diag.mute(4000);   // 準備階段本來就會花一點時間，不算畫面停頓
  P = p;
  G.zone = ZONE_BY_ID[p.zone] ? p.zone : 'field'; P.zone = G.zone;
  if (!G.mapReady || G.mapZone !== G.zone) genMap();
  $('zoneName').textContent = curZone().name;
  Object.assign(G, { enemies: [], bullets: [], ebullets: [], ground: [], parts: [], texts: [], fx: [], turrets: [], decals: [], corpses: [], killsSinceBoss: 0, bossAlive: false, shopStock: [], shopLevel: -1 });
  for (const pr of G.props) pr.cd = 0;
  for (let i = 0; i < 10; i++) spawnPack();
  // 暖機：標題畫面還蓋著時，先把地板組好、所有圖各畫一次、整個畫面畫一次，
  // 進入遊戲後第一幀就不會停頓
  camTo();
  fullRebuild(G.cam.x - W / 2, G.cam.y - H / 2);
  Sprites.warmUp(ctx);
  try { update(0); render(); } catch (e) { reportError(e, '暖機'); }
  btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.label; });
  G.state = 'play';
  $('title').classList.add('hidden');
  document.querySelectorAll('.ingame').forEach(e => e.classList.remove('hidden'));
  renderHotbar();
  addLog(`歡迎來到${curZone().name}。`, '#ffd98a');
  addLog(TOUCH ? '左下搖桿移動，按住「攻擊」自動攻擊；長按攻擊鍵或技能鍵可以換技能。' : 'WASD 或左鍵移動，空白鍵 / 左鍵用左鍵技能，右鍵用右鍵技能；點快捷列兩側的格子可以換技能。', '#ccc');
  saveGame();
}
// 標題畫面：點角色卡選職業，每個職業各有自己的存檔
G.pickCls = (() => { try { return CLASSES[localStorage.getItem('dm_cls')] ? localStorage.getItem('dm_cls') : 'ninja'; } catch (e) { return 'ninja'; } })();
function pickClass(cls) {
  G.pickCls = cls;
  try { localStorage.setItem('dm_cls', cls); } catch (e) { /* 忽略 */ }
  document.querySelectorAll('.card.pick').forEach(c => c.classList.toggle('active', c.dataset.cls === cls));
  refreshTitle();
}
document.querySelectorAll('.card.pick').forEach(c => c.addEventListener('click', () => { if (G.pickCls !== c.dataset.cls) { pickClass(c.dataset.cls); Snd.play('ui'); } }));
$('btnNew').onclick = () => {
  const C = CLASSES[G.pickCls];
  if (readSave(G.pickCls) && !confirm(`建立新的${C.name}會覆蓋目前的${C.name}存檔，確定嗎？`)) return;
  startGame(newPlayer(G.pickCls));
};
$('btnLoad').onclick = () => { const p = loadGame(G.pickCls); if (p) startGame(p); };
TouchUI.init();
Snd.music('title');
const fmtTime = t => new Date(t).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function refreshTitle() {
  const C = CLASSES[G.pickCls], p = readSave(G.pickCls);
  const b = $('btnLoad');
  b.classList.toggle('hidden', !p);
  if (p) b.textContent = `繼續遊戲（${C.name} Lv ${p.level}${p.savedAt ? '，' + fmtTime(p.savedAt) : ''}）`;
  if (!$('btnNew').disabled) $('btnNew').textContent = `建立新角色（${C.name}）`;
}
pickClass(G.pickCls);
const portraits = [...document.querySelectorAll('.card.pick')].map(card => ({
  cv: card.querySelector('canvas'), cls: card.dataset.cls, hero: { cls: card.dataset.cls, equip: {}, face: Math.PI / 2, buffs: {}, moving: 0 },
}));
function drawPortrait(t) {
  G.t = t;
  for (const pt of portraits) {
    const c = pt.cv.getContext('2d'), C = CLASSES[pt.cls], on = pt.cls === G.pickCls;
    c.clearRect(0, 0, 200, 240);
    const g = c.createRadialGradient(100, 150, 10, 100, 150, 110);
    g.addColorStop(0, `rgba(${C.glow},${on ? 0.35 : 0.15})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 200, 240);
    // 選中的角色：輪流面向下、右、上、左，偶爾出手；沒選中的站著不動
    const dir = on ? [0, 3, 1, 2][Math.floor(t / 1.6) % 4] : 0;
    const acting = on && (t % 3.2) > 2.6;
    pt.hero.act = acting ? { n: 'shoot', t: (t % 3.2) - 2.6, dur: 0.6 } : null;
    c.imageSmoothingEnabled = false;
    drawHero(c, 100, 220, pt.hero, 8, dir);
  }
}

// =====================================================
//  主迴圈
// =====================================================
let last = performance.now();
G.fps = 60; G.frameMs = 0;
function frame(now) {
  requestAnimationFrame(frame);   // 先排好下一幀：就算這一幀出錯，遊戲也不會停住
  try { frameBody(now); } catch (e) { reportError(e, '主迴圈'); }
}
function frameBody(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw); last = now;
  if (raw > 0) G.fps += (1 / raw - G.fps) * 0.05;
  // 最近 5 秒最慢的一幀（抓瞬間停頓）
  G.worstT = (G.worstT || 0) - raw;
  if (G.worstT <= 0) { G.worstShow = G.worstNow || 0; G.worstNow = 0; G.worstT = 5; }
  G.worstNow = Math.max(G.worstNow || 0, raw * 1000);
  // 連續 5 秒 FPS 太低就自動降一級畫質（最多降兩次，可按 F4 調回）
  if (G.state === 'play' && document.visibilityState === 'visible') {
    G.slowT = G.fps < 25 ? (G.slowT || 0) + raw : 0;
    if (G.slowT > 5 && qualityIdx < 2 && (G.autoQ || 0) < 2) { G.slowT = 0; G.autoQ = (G.autoQ || 0) + 1; G.fps = 40; cycleQuality(); addLog('偵測到畫面不順，已自動降低畫質。', '#fc6'); }
  }
  if (G.state === 'play') {
    const t0 = performance.now();
    if (!G.paused) update(dt);
    PROF.update += (performance.now() - t0 - PROF.update) * 0.05;
    render();
    G.frameMs += (performance.now() - t0 - G.frameMs) * 0.05;
    G.uiT -= dt;
    if (G.uiT <= 0) { G.uiT = 0.05; updateHUD(); if (isOpen('char')) { G.charT = (G.charT || 0) - 1; if (G.charT <= 0) { G.charT = 10; renderChar(); } } }
  } else if (G.state === 'title') drawPortrait(now / 1000);
  else if (G.state === 'home' && typeof Home !== 'undefined') Home.draw(now / 1000);
}

requestAnimationFrame(frame);

// 在標題畫面就先在背景載入素材；網址加上 #play 可直接開始新遊戲（測試用，不會覆蓋存檔）
loadAssets();
if (location.hash.startsWith('#play')) {
  G.testMode = true; G.showFps = true;
  startGame(newPlayer(/samurai/.test(location.hash) ? 'samurai' : 'ninja')).then(() => {
    const zm = location.hash.match(/zone-(\w+)/);
    if (zm) travelTo(zm[1]);
    if (location.hash.includes('travel')) { openPanel('travel'); return; }   // 測試：傳送面板
    if (location.hash.includes('uitest')) {   // 介面測試：每個按鈕、格子都點一次、滑鼠移過一次
      P.level = 13; for (const id in SKILLS) P.skills[id] = 2; P.skillPts = 5; P.statPts = 5; P.st = calcStats(P);
      for (let i = 0; i < 12; i++) P.inv[i] = genItem(10, i % 4, i < 5 ? 'weapon' : null, ['rifle', 'smg', 'shotgun', 'gatling', 'rail'][i % 5]);
      renderHotbar();
      const n0 = Diag.reportText().split('程式錯誤').length;
      const poke = sel => { for (const el of document.querySelectorAll(sel)) { if (el.closest('#btnQuit,#respawnBtn') || el.id === 'btnQuit') continue; for (const ev of ['mouseenter', 'mouseleave']) el.dispatchEvent(new MouseEvent(ev)); } };
      const clickAll = sel => { for (const el of [...document.querySelectorAll(sel)]) { if (el.id === 'btnQuit' || el.closest('.zoneBtn')) continue; el.dispatchEvent(new MouseEvent('mouseenter')); el.click(); } };
      poke('#hotbar .hk'); clickAll('#hotbar .hk');
      for (const k of ['char', 'inv', 'skill', 'travel']) { openPanel(k); poke('#' + PANELS[k] + ' .slot, #' + PANELS[k] + ' .skill, #' + PANELS[k] + ' button'); clickAll('#' + PANELS[k] + ' .skill, #' + PANELS[k] + ' .plus'); closePanel(k); }
      openPanel('inv'); clickAll('#invGrid .slot'); clickAll('#equipGrid .slot'); closePanel('inv');
      openSkillPick('L', $('slotL')); poke('#skillPick .spItem'); clickAll('#skillPick .spItem');
      openSkillPick('R', $('slotR')); pick.hover = 'scatter'; skillPickKey('3'); closeSkillPick();
      openMenu(); clickAll('#optQuality button, #optDir button, #optHotkey button, #btnSave'); closeMenu();
      const txt = Diag.reportText(), n1 = txt.split('程式錯誤').length;
      console.log('UITEST 新增錯誤 ' + (n1 - n0));
      for (const line of txt.split(String.fromCharCode(10)).filter(l => /程式錯誤|位置|at /.test(l)).slice(-12)) console.log('UITEST ' + line);
      return;
    }
    if (location.hash.includes('stress')) {   // 壓力測試：連續跑很多幀，各種操作都做一遍，記下所有錯誤
      const errs = {}; let frames = 0;
      const tryDo = (name, fn) => { try { fn(); } catch (e) { const k = name + '：' + e.message; if (!errs[k]) errs[k] = (e.stack || '').split(String.fromCharCode(10)).slice(0, 4).join(' | '); } };
      P.level = 13; for (const id in SKILLS) P.skills[id] = 3; P.statPts = 20; P.skillPts = 5; P.st = calcStats(P);
      const acts = Object.keys(SKILLS).filter(id => SKILLS[id].type === 'active');
      for (let f = 0; f < 4000; f++) {
        frames++;
        if (P.dead) tryDo('復活', respawn);
        if (f % 600 === 1) tryDo('首領', () => { G.killsSinceBoss = 999; });
        if (f % 400 === 5) tryDo('傳送', () => travelTo(f % 800 === 5 ? 'field' : 'bamboo'));
        G.held.space = f % 200 < 150;
        if (f % 37 === 0) tryDo('技能', () => { P.leftSkill = acts[(f / 37 | 0) % acts.length]; P.rightSkill = acts[(f / 37 + 3 | 0) % acts.length]; useSkill(P.rightSkill, TouchUI.aim(), false); });
        if (f % 53 === 0) tryDo('快捷鍵', () => pressHotkey((f / 53 | 0) % 8));
        if (f % 90 === 0) tryDo('藥水', () => { usePotion('hp'); usePotion('mp'); });
        if (f % 120 === 0) tryDo('拾取', () => { for (const g of [...G.ground]) pickupItem(g); });
        if (f % 250 === 0) tryDo('視窗', () => { for (const k of ['char', 'inv', 'skill', 'travel']) { openPanel(k); renderPanel(k); closePanel(k); } openSkillPick('L', $('slotL')); closeSkillPick(); openMenu(); renderMenu(); closeMenu(); });
        if (f % 300 === 0) tryDo('裝備', () => { const i = P.inv.findIndex(x => x && x.req <= P.level); if (i >= 0) equipItem(i); });
        if (f % 700 === 0) tryDo('回營', () => { P.cds.town = 0; returnToCamp(); });
        if (f % 160 === 0) tryDo('走動', () => { P.x = clamp(P.x + rand(-6, 6), 4, MAP - 4); P.y = clamp(P.y + rand(-6, 6), 4, MAP - 4); if (!canStand(P.x, P.y, P.r)) { P.x = CAMP.x; P.y = CAMP.y + 2.2; } });
        tryDo('更新', () => update(1 / 60));
        tryDo('畫面', () => { render(); updateHUD(); });
      }
      G.held.space = false;
      console.log('STRESS ' + frames + ' 幀，等級 ' + P.level + '，區域 ' + G.zone + '，錯誤 ' + Object.keys(errs).length + ' 種');
      for (const k in errs) console.log('STRESSERR ' + k + ' @ ' + errs[k]);
      return;
    }
    if (location.hash.includes('leftcheck')) {   // 測試：左鍵設成爆裂符時不應出現普通攻擊
      P.level = 30; P.skills = { grenade: 5 }; P.leftSkill = 'grenade'; P.st = calcStats(P); P.mp = P.st.maxMp = 9999;
      P.x = 30.5; P.y = 30.5;
      for (let y = 22; y < 40; y++) for (let x = 22; x < 40; x++) { M.block[idx(x, y)] = 0; M.solid[idx(x, y)] = 0; }
      G.enemies = G.enemies.slice(0, 2); for (const e of G.enemies) { e.x = P.x + 3; e.y = P.y + 1; e.hp = e.maxHp = 1e9; }
      let basic = 0; const ba = basicAttack; basicAttack = (...q) => { basic++; return ba(...q); };
      G.held.space = true;
      for (let f = 0; f < 120; f++) { update(1 / 60); render(); }
      G.held.space = false; basicAttack = ba;
      console.log('LEFTCHECK 爆裂符 ' + G.fx.filter(x => x.type === 'grenade' || x.type === 'boom').length + ' 個特效，普通攻擊 ' + basic + ' 次，冷卻 ' + (P.cds.grenade || 0).toFixed(2));
      return;
    }
    if (location.hash.includes('skills')) {   // 測試：技能列與技能清單
      P.level = 30; P.skills = { burst: 3, scatter: 2, grenade: 2, turret: 1, stim: 1, orbital: 1 };
      P.touchSkills = ['grenade', 'scatter', null, null]; P.st = calcStats(P); P.mp = P.st.maxMp;
      renderHotbar();
      if (TOUCH) openSkillPick(2); else { openSkillPick('R', $('slotR')); pick.hover = 'orbital'; skillPickKey('6'); }
      return;
    }
    if (location.hash.includes('keys')) {   // 測試鍵盤：按住 D + S + 空白鍵 1.5 秒
      // 清出一塊空地，避免被營地物件擋住
      P.x = 30.5; P.y = 30.5;
      for (let y = 22; y < 40; y++) for (let x = 22; x < 40; x++) { M.block[idx(x, y)] = 0; M.solid[idx(x, y)] = 0; }
      const s0 = { x: isoX(P.x, P.y), y: isoY(P.x, P.y) };
      for (const key of ['d', 's', ' ']) dispatchEvent(new KeyboardEvent('keydown', { key }));
      // 直接跑 90 幀（1.5 秒），不用等計時器
      // 怪物先清掉一半，留幾隻在附近讓空白鍵有目標
      G.enemies = G.enemies.slice(0, 3); for (const [i, e] of G.enemies.entries()) { e.x = P.x + 3 + i; e.y = P.y + 3; e.aggro = false; }
      let thrown = 0; const fb = fireBullet; fireBullet = (...a) => { thrown++; return fb(...a); };
      for (let f = 0; f < 90; f++) { update(1 / 60); render(); }
      fireBullet = fb;
      { try {
        for (const key of ['d', 's', ' ']) dispatchEvent(new KeyboardEvent('keyup', { key }));
        const s1 = { x: isoX(P.x, P.y), y: isoY(P.x, P.y) };
        const msg = `鍵盤測試：畫面位移 (${(s1.x - s0.x).toFixed(0)}, ${(s1.y - s0.y).toFixed(0)}) px，擲出 ${thrown} 枚，主角面向 ${pickDir(P, screenAngle(P.face))}`;
        console.log('KEYTEST ' + msg); Diag.add('資訊', msg);
        Diag.open();
      } catch (err) { console.log('KEYTEST err ' + err.stack); } }
      return;
    }
    if (location.hash.includes('pickup')) {   // 測試拾取：金幣、藥水、裝備各撿一次
      P.inv[0] = undefined;   // 模擬舊 bug 留下的壞格子
      for (const o of [{ gold: 50 }, { potion: 'hp' }, { item: genItem(5, 2) }]) { spawnGround(P.x, P.y, o); pickupItem(G.ground[G.ground.length - 1]); }
      Diag.add('資訊', `拾取測試完成：金幣 ${P.gold}、生命藥水 ${P.potions.hp}、背包第一格 ${P.inv[0] ? P.inv[0].name : '空'}、地上剩 ${G.ground.length} 個`);
      Diag.open(); return;
    }
    if (location.hash.includes('inv')) {   // 測試：背包與道具說明框
      const wk = ['rifle', 'smg', 'shotgun', 'gatling', 'rail'];
      for (let i = 0; i < 10; i++) P.inv[i] = i < 5 ? genItem(8, i % 4, 'weapon', wk[i]) : genItem(8, i % 4);
      openPanel('inv');
      if (location.hash.includes('sheet')) showItemSheet(P.inv[2], 'inv', 2);
      return;
    }
    if (location.hash.includes('menu')) { openMenu(); return; }   // 測試：打開系統選單
    if (location.hash.includes('quit')) { openMenu(); $('btnQuit').click(); return; }   // 測試：離開遊戲回到標題
    if (location.hash.includes('audio')) {   // 測試音訊：模擬一次按鍵啟動聲音，2 秒後把狀態寫進報告
      dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      let tries = 0;
      const iv = setInterval(() => {
        const st = Snd.status();
        if (!st.音效已載入.startsWith('20') && ++tries < 40) return;
        clearInterval(iv); Snd.play('coin');
        Diag.add('資訊', '音訊測試：' + JSON.stringify(Snd.status())); Diag.open();
      }, 100);
      return;
    }
    if (location.hash.includes('diag')) { Diag.add('資訊', '測試紀錄'); Diag.open(); return; }   // 測試：打開診斷報告
    if (location.hash.includes('walk')) {   // 測試捲動：直接連跑 60 幀快速移動，檢查地板接縫
      for (let k = 0; k < 60; k++) { P.x += 0.35; P.y += 0.12; update(1 / 60); render(); }
      return;
    }
    if (!location.hash.includes('fight')) return;
    // 測試戰鬥：把主角移到營地外，每種怪物各叫一隻
    P.x = CAMP.x + 14; P.y = CAMP.y + 0.5; P.level = 20; P.skills = { burst: 5, scatter: 3, grenade: 3 };
    for (const k of ['weapon', 'armor', 'helm', 'gloves', 'boots', 'belt']) P.equip[k] = genItem(50, 2, k, 'rail');
    P.st = calcStats(P); P.hp = P.st.maxHp;
    G.enemies = [];
    Object.keys(curZone().monsters).map(role => zoneMonster(curZone(), role)).forEach((t, i) => {
      const a = i / 7 * Math.PI * 2;
      const e = createEnemy(t, P.x + Math.cos(a) * 3.2, P.y + Math.sin(a) * 3.2, 5, t.endsWith('_boss') ? 3 : i % 3, 900 + i);
      e.aggro = true; G.enemies.push(e);
    });
    P.target = G.enemies[0];
  });
}

// 診斷報告用的狀態快照（F2）
Diag.setSnapshot(() => {
  const o = { 畫面: G.state, FPS: Math.round(G.fps), 每幀ms: +G.frameMs.toFixed(1), 最慢一幀ms: Math.round(G.worstShow || 0),
    區域: G.zone, 圖片MB: Math.round(Sprites.memoryMB()), 畫質: QUALITY_NAME[qualityIdx], 縮放: +ZOOM.toFixed(2), 地板平移: gbuf.shifts };
  o.分段ms = Object.fromEntries(Object.entries(PROF).map(([k, v]) => [k, +v.toFixed(1)]));
  o.音訊 = Snd.status();
  if (P) Object.assign(o, { 等級: P.level, 位置: [+P.x.toFixed(1), +P.y.toFixed(1)], 生命: Math.round(P.hp), 怪物: G.enemies.length, 屍體: G.corpses.length, 粒子: G.parts.length, 箭矢: G.bullets.length + G.ebullets.length });
  return o;
});

