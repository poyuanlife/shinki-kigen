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
  if (!im) { im = IMG[p] = new Image(); im.src = /^(blob|data):/.test(p) ? p : NA + p; }   // blob：照片主角（存在這台裝置上的圖）
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
// 斜向時要用哪張圖：auto 依角度最接近（有緩衝）、side 偏用側面、front 偏用正面 / 背面
let DIR_MODE = (() => { try { return localStorage.getItem('dm_dirmode') || 'auto'; } catch (e) { return 'auto'; } })();
function setDirMode(m) { DIR_MODE = m; try { localStorage.setItem('dm_dirmode', m); } catch (e) { /* 忽略 */ } }
const DIR_CENTER = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];   // 下、上、左、右 的螢幕角度
function pickDir(o, a) {
  if (DIR_MODE === 'side') { const c = Math.cos(a), s = Math.sin(a); return Math.abs(c) >= Math.abs(s) - 0.02 ? (c >= 0 ? 3 : 2) : (s >= 0 ? 0 : 1); }
  if (DIR_MODE === 'front') { const c = Math.cos(a), s = Math.sin(a); return Math.abs(s) >= Math.abs(c) - 0.02 ? (s >= 0 ? 0 : 1) : (c >= 0 ? 3 : 2); }
  const d = dir4(a);
  if (o && o._dir !== undefined && o._dir !== d) {
    // 還在原本方向的 45°+12° 範圍內就不換，避免在斜角附近一直切換
    let diff = Math.abs(a - DIR_CENTER[o._dir]) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < Math.PI / 4 + 0.21) return o._dir;
  }
  if (o) o._dir = d;
  return d;
}
// 8 方向的角色圖（直欄：下、上、左、右、左下、右下、左上、右上）
const DIR8_CENTER = [Math.PI / 2, -Math.PI / 2, Math.PI, 0, Math.PI * 3 / 4, Math.PI / 4, -Math.PI * 3 / 4, -Math.PI / 4];
const DIR8_OF_SECTOR = [3, 5, 0, 4, 2, 6, 1, 7];   // 從右邊開始、順時針每 45° 一格
function pickDir8(o, a) {
  const d = DIR8_OF_SECTOR[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  if (o && o._dir8 !== undefined && o._dir8 !== d) {
    // 還在原本方向的 22.5°+8° 範圍內就不換，避免在兩個方向中間一直切換
    let diff = Math.abs(a - DIR8_CENTER[o._dir8]) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < Math.PI / 8 + 0.14) return o._dir8;
  }
  if (o) o._dir8 = d;
  return d;
}
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
const sep16 = name => {
  const f = a => `Actor/Character/${name}/SeparateAnim/${a}.png`;
  return { ox: 8, oy: 15, h: 15, anims: {
    walk: { file: f('Walk'), cw: 16, ch: 16, n: 4, ms: 130 },
    idle: { file: f('Idle'), cw: 16, ch: 16, n: 1, ms: 1000 },
    attack: { file: f('Attack'), cw: 16, ch: 16, n: 1, ms: 300, once: true },
    dead: { file: f('Dead'), cw: 16, ch: 16, n: 1, ms: 300, once: true, oneDir: true },
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
  // 武士、術士：每個動作一張圖（16×16，直欄 = 方向）
  heroSamurai: sep16('SamuraiRed'),
  heroOnmyoji: sep16('SorcererBlack'),
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
// 動作沒有圖時的替代：跑步 → 走路，其他 → 站姿 → 走路
// sp.res：素材的精細度（0.5 = 素材 1 像素畫成 1 個畫面像素，用在「圖片批次轉換」做的高解析角色）
// a.ox / a.oy：這個動作自己的腳底位置（攻擊、倒下的格子比較大）
// 把一格圖整個染成某個顏色（受傷閃紅用），疊在原本的圖上
const TINT_CV = document.createElement('canvas'), TINT_CTX = TINT_CV.getContext('2d');
function drawTinted(c, im, sx, sy, sw, sh, dx, dy, dw, dh, rgb, alpha) {
  if (TINT_CV.width < sw) TINT_CV.width = sw;
  if (TINT_CV.height < sh) TINT_CV.height = sh;
  const t = TINT_CTX;
  t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, sw, sh);
  t.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
  t.globalCompositeOperation = 'source-atop'; t.fillStyle = `rgb(${rgb})`; t.fillRect(0, 0, sw, sh);
  c.save(); c.globalAlpha = alpha; c.drawImage(TINT_CV, 0, 0, sw, sh, dx, dy, dw, dh); c.restore();
}
// tint：給的話 flash 改成染成這個顏色（例如受傷的紅色），不給是原本的變亮閃白
function drawSpec(c, specName, act, dir, t, x, y, scale = PX, flash = 0, tint = null) {
  const sp = SPEC[specName];
  if (sp.flare) return drawFlareSpec(c, sp, act, dir, t, x, y, scale, flash, tint);
  const a = sp.anims[act] || (act === 'run' && sp.anims.walk) || sp.anims.idle || sp.anims.walk;
  const im = img(a.file);
  if (!ready(im)) return false;
  const k = Math.floor(t * 1000 / a.ms);
  const f = a.once ? Math.min(a.n - 1, Math.max(0, k)) : ((k % a.n) + a.n) % a.n;
  let col, row;
  if (a.strip) { col = f; row = 0; } else { col = a.oneDir ? 0 : dir; row = (a.row || 0) + f; }
  scale *= sp.res || 1;
  const dx = snap(x - (a.ox !== undefined ? a.ox : sp.ox) * scale), dy = snap(y - (a.oy !== undefined ? a.oy : sp.oy) * scale);
  // 只有一格的站姿（例如弓箭手）：上半身每隔一下往下沉 1 素材像素，看起來在呼吸，不會像貼紙一樣僵住
  const breathe = act === 'idle' && a.n === 1 && sp.custom && Math.sin(t * 2.6) > 0;
  const draw = breathe ? () => {
    const cut = Math.round(a.ch * 0.6), sy = row * a.ch, sx = col * a.cw;
    c.drawImage(im, sx, sy + cut, a.cw, a.ch - cut, dx, dy + cut * scale, a.cw * scale, (a.ch - cut) * scale);
    c.drawImage(im, sx, sy, a.cw, cut, dx, snap(dy + scale), a.cw * scale, cut * scale);
  } : () => c.drawImage(im, col * a.cw, row * a.ch, a.cw, a.ch, dx, dy, a.cw * scale, a.ch * scale);
  // 照片主角：平滑縮放（像素畫才要保持銳利）
  if (sp.smooth) { c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }
  draw();
  if (flash > 0 && tint) drawTinted(c, im, col * a.cw, row * a.ch, a.cw, a.ch, dx, dy, a.cw * scale, a.ch * scale, tint, Math.min(1, flash));
  else if (flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, flash); draw(); c.restore(); }
  if (sp.smooth) c.restore();
  return true;
}

// ---------- 主角 ----------
const HERO_SCALE = PX;
const heroSpec = p => flareHeroSpec(p) || (p.spr && SPEC[p.spr] ? p.spr : clsOf(p).spr);
// 角色圖有 8 個方向就從 8 個裡選，不然選 4 個
const specDir = (spec, o, a) => (SPEC[spec].dirs === 8 ? pickDir8(o, a) : pickDir(o, a));
function heroAnim(p) {
  if (p.dead) return ['dead', p.deadT || 0];
  // p0：連續攻擊時從動畫中段（舉弓／舉刀）接著播
  if (p.act && (p.act.stand || !(p.moving > 0.5 && p.act.n === 'shoot'))) {
    const p0 = p.act.p0 || 0;
    return ['attack', (p0 + (1 - p0) * Math.min(1, p.act.t / p.act.dur)) * animLen(heroSpec(p), 'attack')];
  }
  if (p.moving > 0.3) return [p.running ? 'run' : 'walk', p.runT || 0];
  if (p.hurt > 0) return ['hit', 0.12 - p.hurt];
  return ['idle', G.t];
}
function drawHero(c, x, y, p, scale = HERO_SCALE, dirOverride) {
  const [act, t] = heroAnim(p);
  const sa = screenAngle(p.face);
  const dir = dirOverride !== undefined ? dirOverride : specDir(heroSpec(p), p, sa);
  if (!p.dead && !SPEC[heroSpec(p)].flare) { c.fillStyle = 'rgba(0,0,0,0.3)'; ell(c, x, y - scale, 6 * scale, 2.5 * scale); c.fill(); }   // Flare 的圖本身有影子
  if (p.buffs && p.buffs.stim > 0) { c.fillStyle = 'rgba(255,60,60,0.16)'; ell(c, x, y - 8 * scale, 11 * scale, 12 * scale); c.fill(); }
  if (p.buffs && p.buffs.kongou > 0) { c.fillStyle = 'rgba(255,210,90,0.18)'; ell(c, x, y - 8 * scale, 11 * scale, 12 * scale); c.fill(); }
  // 受傷：整個人閃紅，慢慢退掉
  const red = p.redT > 0 ? p.redT / RED_T : 0;
  drawSpec(c, heroSpec(p), act, dir, t, x, y, scale, red * 0.65, red > 0 ? '255,40,40' : null);
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
  if (!SPEC[e.def.spr].flare) { c.fillStyle = 'rgba(0,0,0,0.3)'; ell(c, x, y - 1, w, w * 0.4); c.fill(); }   // Flare 的圖本身有影子
  if (e.rank === 1 || e.rank === 2) {
    c.save(); c.globalAlpha = 0.5 + Math.sin(G.t * 4) * 0.2;
    c.strokeStyle = e.rank === 1 ? '#5b9bff' : '#ffbf3a'; c.lineWidth = 1.5;
    ell(c, x, y - 1, w + 5, (w + 5) * 0.45); c.stroke(); c.restore();
  }
  const [act, t] = enemyAnim(e);
  // 會飛的怪物（蝙蝠、鬼火）上下飄
  const fly = e.def.fly ? Math.sin(G.t * 4 + e.anim) * 3 - 6 : 0;
  drawSpec(c, e.def.spr, act, specDir(e.def.spr, e, screenAngle(e.face)), t, x, y + fly, sc, e.hitFlash > 0 ? 0.8 : 0);
  if (e.stun > 0) {   // 暈眩：頭上轉圈的星星
    const hy = y + fly - enemyH(e) - 4;
    c.fillStyle = '#ffe14a';
    for (let i = 0; i < 3; i++) { const a = G.t * 6 + i * 2.09; star(c, x + Math.cos(a) * 9, hy + Math.sin(a) * 3, 3); c.fill(); }
  }
}

// 屍體：閃白後淡出，搭配煙霧特效
function drawCorpse(c, x, y, k) {
  c.save();
  c.globalAlpha = Math.max(0, 1 - (SPEC[k.spr].flare ? Math.max(0, k.t - 0.6) : k.t) / 0.5);   // Flare 的怪物先播完倒下再淡出
  const dead = SPEC[k.spr].flare && SPEC[k.spr].anims.dead;   // Flare 的怪物有倒下的動作
  drawSpec(c, k.spr, dead ? 'dead' : 'idle', k.dir, dead ? k.t : 0, x, y, k.scale, k.t < 0.15 ? 1 : 0);
  c.restore();
  if (!SPEC[k.spr].flare) drawFx(c, 'smoke', k.t, x, y - 6, PX * (k.big ? 1.6 : 1));
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
  const s = toScreen(b.x, b.y), z = 12, ang = screenAngle(Math.atan2(b.vy, b.vx));
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
  } else if (kind === 'blade') {   // 鎌鼬：新月形的真空刃
    c.translate(s.x, s.y - z); c.rotate(ang); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const k = i ? 1 : 1.4;
      c.globalAlpha = i ? 0.95 : 0.4; c.fillStyle = i ? '#e8fbff' : (b.color || '#8ef');
      c.beginPath(); c.arc(-4 * k, 0, 13 * k, -1.2, 1.2); c.arc(-9 * k, 0, 11 * k, 1.05, -1.05, true); c.closePath(); c.fill();
    }
  } else if (kind === 'fuda') {   // 暗影箭／小惡魔的火彈：發光的能量球，後面拖著尾巴（顏色 = b.color）
    const col = b.color || '#b070ff', pulse = 1 + Math.sin(G.t * 20 + b.x * 3) * 0.12;
    c.translate(snap(s.x), snap(s.y - z)); c.rotate(ang);
    c.globalCompositeOperation = 'lighter';
    const tg = c.createLinearGradient(-22, 0, 0, 0); tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(1, col);
    c.globalAlpha = 0.55; c.fillStyle = tg; ell(c, -10, 0, 13, 3.5); c.fill();   // 尾巴
    c.globalAlpha = 0.5; c.fillStyle = col; ell(c, 0, 0, 8 * pulse, 7 * pulse); c.fill();   // 光暈
    c.globalAlpha = 1; c.fillStyle = '#fff'; ell(c, 1, 0, 2.6, 2.4); c.fill();   // 亮的核心
  } else if (kind === 'arrow') {   // 弓箭手的箭（「圖片批次轉換」做的，箭頭朝右）
    const pr = SPEC[heroSpec(P)] && SPEC[heroSpec(P)].projectile, im = pr && img(pr.file);
    if (im && ready(im)) { c.translate(snap(s.x), snap(s.y - z)); c.rotate(ang); c.drawImage(im, -pr.w / 2, -pr.h / 2, pr.w, pr.h); }
  } else if (kind === 'kunai') {
    const im = img('FX/Projectile/Kunai.png');
    if (ready(im)) { c.translate(s.x, s.y - z); c.rotate(ang); c.drawImage(im, -9, -3, 18, 6.5); }
  }
  c.restore();
}

// ---------- 術士的召喚物 ----------
// 小惡魔：(x, y) = 地面位置，飛在半空中、拍著蝙蝠翅膀（函式名稱沿用紙鶴時期的）
function drawCrane(c, x, y, t, face) {
  const z = 30 + Math.sin(t * 3) * 3, flap = Math.sin(t * 14) * 5, dir = Math.cos(face) >= 0 ? 1 : -1;
  c.fillStyle = 'rgba(0,0,0,0.25)'; ell(c, x, y - 1, 6, 2.5); c.fill();
  c.save(); c.translate(snap(x), snap(y - z)); c.scale(dir * 1.3, 1.3);
  c.strokeStyle = '#1a0606'; c.lineWidth = 0.8;
  // 翅膀（兩片，上下拍）
  c.fillStyle = '#5a1418';
  for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(-1, -2); c.lineTo(-9, -8 - flap * 0.8 * (sd > 0 ? 1 : 0.7)); c.lineTo(-7, -2); c.lineTo(-11, -1 - flap * 0.3); c.lineTo(-2, 1); c.closePath(); c.fill(); c.stroke(); }
  // 身體、頭、尾巴
  c.fillStyle = '#a8282a'; ell(c, 0, 0, 5, 4); c.fill(); c.stroke();
  ell(c, 4, -4, 3.4, 3.2); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(-4, 2); c.quadraticCurveTo(-9, 6, -10, 3); c.stroke();
  // 角、發光的眼睛
  c.fillStyle = '#e8d8b0'; c.beginPath(); c.moveTo(3, -7); c.lineTo(2.2, -10); c.lineTo(4.4, -7); c.fill(); c.beginPath(); c.moveTo(5.5, -7); c.lineTo(6.6, -10); c.lineTo(7, -6.5); c.fill();
  c.fillStyle = '#ffd040'; c.fillRect(5, -5, 1.6, 1.4);
  c.restore();
  // 身上的火光
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y - z, 0, x, y - z, 14); g.addColorStop(0, 'rgba(255,120,40,0.35)'); g.addColorStop(1, 'rgba(255,60,0,0)');
  c.fillStyle = g; c.fillRect(x - 14, y - z - 14, 28, 28); c.restore();
}
// 魂火：綠色的靈魂火（藍色素材動畫轉成綠色 + 光暈）
function drawFoxfire(c, x, y, t) {
  const z = 18 + Math.sin(t * 5) * 3;
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y - z, 0, x, y - z, 16);
  g.addColorStop(0, 'rgba(200,255,190,0.8)'); g.addColorStop(1, 'rgba(60,220,80,0)');
  c.fillStyle = g; c.fillRect(x - 16, y - z - 16, 32, 32);
  const im = img('FX/Magic/Spirit/SpriteSheetBlue.png');
  if (ready(im)) { const f = Math.floor(t * 12) % 5; c.filter = 'hue-rotate(-100deg) saturate(1.4)'; c.drawImage(im, f * 32, 0, 32, 32, snap(x - 16), snap(y - z - 18), 32, 32); }
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
const T_DESERT = 'Backgrounds/Tilesets/TilesetDesert.png';
const T_DUNGEON = 'Backgrounds/Tilesets/TilesetDungeon.png';
const T_DETAIL = 'Backgrounds/Tilesets/TilesetFloorDetail.png';

// 目前區域的美術設定（換地圖時由 applyZoneArt 換掉，見 zones.js）
// grass：地面 [欄, 列]（重複越多次出現機率越高）；dirt / water：自動接合組的起點；
// walls：擋路格子畫的東西 [圖, 欄, 列, 寬, 高]；obst / rocks：散落的障礙物；plants / stones：地面小裝飾
const ART = {
  grass: [[0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [1, 12], [2, 12], [3, 12], [4, 12]],
  dirt: { sheet: T_FLOOR, col: 0, row: 7, fill: [[0, 11], [1, 11]] },
  water: { sheet: T_WATER, col: 0, row: 6 },
  walls: [[T_NATURE, 0, 0, 2, 2], [T_NATURE, 0, 0, 2, 2], [T_NATURE, 16, 0, 2, 2], [T_NATURE, 18, 0, 2, 2], [T_NATURE, 2, 0, 2, 2], [T_NATURE, 6, 0, 2, 2], [T_NATURE, 14, 0, 2, 2]],
  obst: [[T_NATURE, 0, 8, 2, 2], [T_NATURE, 2, 8, 2, 2], [T_NATURE, 4, 8, 1, 1], [T_NATURE, 15, 9, 1, 1], [T_NATURE, 18, 9, 1, 1], [T_NATURE, 8, 8, 1, 1]],
  rocks: [[T_NATURE, 13, 8, 2, 2], [T_NATURE, 16, 8, 2, 2], [T_NATURE, 18, 9, 1, 1]],
  plants: [[0, 10], [1, 10], [2, 10], [3, 10], [6, 10], [7, 10], [0, 11], [1, 11], [2, 11], [3, 11], [6, 11], [7, 11], [8, 11], [9, 11]].map(([c, r]) => [T_NATURE, c, r]),
  stones: [[T_NATURE, 15, 9], [T_NATURE, 18, 9]],
  fence: [[T_NATURE, 1, 10, 1, 1], [T_NATURE, 2, 10, 1, 1], [T_NATURE, 6, 10, 1, 1]],   // 營地圍籬
};
// 45 度：把正方形圖塊畫成菱形。(X, Y) = 菱形頂點（邏輯座標）
// 變形矩陣把圖塊的橫軸對到螢幕右下、縱軸對到螢幕左下，2:1 等角
function isoCell(c, sheet, col, row, X, Y) {
  const im = img(sheet);
  if (!ready(im)) return false;
  c.save();
  c.translate(X, Y);
  c.transform(2, 1, -2, 1, 0, 0);   // 1 素材像素 → 右下 (2, 1)、左下 (-2, 1)
  c.drawImage(im, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, -0.06, -0.06, 16.12, 16.12);   // 稍微放大，避免接縫
  c.restore();
  return true;
}
function drawAuto(c, set, mask, x, y, seed) {
  const s = ART[set];
  if (mask === 15) {   // 中間：大多是素色，偶爾換成有點綴的變化
    if (s.fill && seed > 0.82) { const f = s.fill[Math.floor(seed * 13) % s.fill.length]; return isoCell(c, s.sheet, f[0], f[1], x, y); }
    return isoCell(c, s.sheet, s.col + 1, s.row + 1, x, y);
  }
  const [dc, dr] = mask === 0 ? [1, 1] : AUTO[mask];   // 單格：用中間那格，比較自然
  return isoCell(c, s.sheet, s.col + dc, s.row + dr, x, y);
}
function drawGrass(c, x, y, seed) { const g = ART.grass[Math.floor(seed * ART.grass.length)]; return isoCell(c, T_FLOOR, g[0], g[1], x, y); }

// 地面裝飾：回傳 [圖, 欄, 列]
function decoTile(kind, seed) { const L = kind === 'plant' ? ART.plants : ART.stones; return L[Math.floor(seed * L.length) % L.length]; }

// 擋路的格子（樹、竹子、岩石、冰塊、石牆……），(x, y) = 格子底部中心
function drawTree(c, x, y, seed) {
  const t = ART.walls[Math.floor(seed * ART.walls.length) % ART.walls.length];
  return drawObj(c, t[0], t[1], t[2], t[3], t[4], x, y + (t[3] > 1 ? 4 : 0));
}
const drawArt = (c, list, seed, x, y) => { const r = list[Math.floor(seed * list.length) % list.length]; return drawObj(c, r[0], r[1], r[2], r[3], r[4], x, y + 8); };

// 場景物件；回傳 false 代表交給 render.js 的程式繪製
// 火焰：幾團會晃動的光
function drawFlames(c, x, y, t, seed, big) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const f = Math.sin(t * 8 + i * 1.7 + seed * 9) * 3 * big, h = (11 + Math.sin(t * 6 + i + seed) * 3) * big;
    const g = c.createRadialGradient(x + f, y - h * 0.5, 0, x + f, y - h * 0.5, h);
    g.addColorStop(0, 'rgba(255,240,170,0.9)'); g.addColorStop(0.5, 'rgba(255,130,30,0.55)'); g.addColorStop(1, 'rgba(255,40,0,0)');
    c.fillStyle = g; ell(c, x + f, y - h * 0.5, 6 * big, h); c.fill();
  }
  c.restore();
}
function drawPropSprite(c, x, y, p, t) {
  if (drawFlareProp(c, x, y, p, t)) return true;   // 寫實素材（flare.js）
  const pick = L => L[Math.floor(p.seed * L.length) % L.length];
  switch (p.type) {
    case 'rock': case 'grave': return drawArt(c, ART.rocks, p.seed, x, y);
    case 'tree': return drawArt(c, ART.obst, p.seed, x, y);
    case 'portal': {   // 傳送陣：旋轉的魔法陣 + 光暈
      const im = img('FX/Magic/Circle/SpriteSheetWhite.png');
      // 深色石台底座：在雪地等亮色地面上也看得清楚
      c.fillStyle = 'rgba(20,30,60,0.75)'; ell(c, x, y - 4, 30, 15); c.fill();
      c.strokeStyle = 'rgba(140,210,255,0.9)'; c.lineWidth = 2; ell(c, x, y - 4, 30, 15); c.stroke();
      c.save(); c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(x, y - 4, 0, x, y - 4, 40);
      g.addColorStop(0, `rgba(120,200,255,${0.35 + Math.sin(t * 3) * 0.1})`); g.addColorStop(1, 'rgba(120,200,255,0)');
      c.fillStyle = g; ell(c, x, y - 4, 40, 26); c.fill();
      if (ready(im)) { const f = Math.floor(t * 8) % 4; c.globalAlpha = 0.9; c.drawImage(im, f * 32, 0, 32, 32, snap(x - 32), snap(y - 36), 64, 64); }
      c.restore();
      return true;
    }
    case 'lamp': return drawObj(c, T_NATURE, 5, 8, 1, 1, x, y + 8);
    case 'sandbag': return drawArt(c, ART.fence, p.seed, x, y);
    case 'crate': return drawObj(c, T_CAMP, 3, pick([5, 6]), 1, 1, x, y + 8);
    case 'chest': return drawObj(c, T_CAMP, pick([4, 5]), 8, 1, 1, x, y + 8);
    case 'anvil': return drawObj(c, T_CAMP, 4, 6, 2, 2, x, y + 8);
    case 'tent': return drawObj(c, T_CAMP, 4, 0, 3, 3, x, y + 12);
    case 'flag': return drawObj(c, T_CAMP, 7, 5, 1, 2, x, y + 8);
    case 'barrel': case 'campfire': {
      drawObj(c, T_CAMP, 10, 3, 2, 2, x, y + 14);
      drawFlames(c, x, y, t, p.seed, p.type === 'campfire' ? 1 : 0.75);
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
  for (const sp of Object.values(SPEC)) { for (const a of Object.values(sp.anims)) s.add(a.file); if (sp.projectile) s.add(sp.projectile.file); }
  for (const f of Object.values(FX)) s.add(f.file);
  [T_FLOOR, T_WATER, T_NATURE, T_CAMP, 'FX/Projectile/Shuriken.png', 'FX/Projectile/Fireball.png', 'FX/Projectile/Kunai.png', 'FX/Projectile/EnergyBall.png',
    'Items/Potion/LifePot.png', 'Items/Potion/WaterPot.png', 'Items/Treasure/GoldCoin.png', 'FX/Magic/Spirit/SpriteSheetBlue.png'].forEach(f => s.add(f));
  for (const w of Object.values(WEAPON_ICONS)) s.add(w.file);
  [T_DESERT, T_DUNGEON, T_DETAIL, 'FX/Magic/Circle/SpriteSheetWhite.png'].forEach(f => s.add(f));
  return [...s];
}
// ---------- 用「圖片批次轉換」做的角色 ----------
// 讀 assets/custom/.../sprite.json，換掉原本的角色圖；讀不到（還沒轉換）就繼續用原本的圖
const CUSTOM_SPECS = [
  { key: 'heroSamurai', dir: 'characters/samurai' },   // 武士：高解析 Q 版武士（有跑步、揮刀、受傷、倒下）
  { key: 'hero', dir: 'characters/archer' },           // 忍者：換成精靈弓箭手的外觀（拉弓射箭，射出去的是箭）
];
function loadCustomSpecs() {
  return Promise.all(CUSTOM_SPECS.map(({ key, dir }) =>
    fetch(`assets/custom/${dir}/sprite.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.anims || !j.anims.walk) return;
      const res = 0.5, anims = {};
      for (const [name, a] of Object.entries(j.anims)) {
        anims[name] = { file: `../custom/${dir}/${a.file}`, cw: a.w, ch: a.h, n: a.frames, ms: a.ms, ox: a.ox, oy: a.oy };
        if (['attack', 'hit', 'dead'].includes(name)) anims[name].once = true;
      }
      const base = j.anims.idle || j.anims.walk;
      SPEC[key] = { ox: base.ox, oy: base.oy, h: Math.round(j.cell[1] * res * 0.9), res, anims, custom: true, dirs: (j.dirs || []).length === 8 ? 8 : 4 };
      // 弓箭手：射出去的箭（箭頭朝右），畫面上 1 素材像素 = 1 畫面像素
      if (j.projectile) SPEC[key].projectile = { file: `../custom/${dir}/${j.projectile.file}`, w: j.projectile.w, h: j.projectile.h };
    }).catch(() => { /* 沒有就用原本的圖 */ })));
}
function loadGameAssets() {
  return loadCustomSpecs().then(() => loadFlare()).then(() => loadAllImages());
}
function loadAllImages() {
  return Promise.all(allFiles().map(f => new Promise(res => {
    const im = img(f);
    if (ready(im)) res();
    else { im.addEventListener('load', res); im.addEventListener('error', () => { console.warn('圖片載入失敗', f); res(); }); }
  })));
}
