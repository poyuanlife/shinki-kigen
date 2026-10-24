// 多方向精靈圖的產生邏輯（sprite-generator.html 和 batch.html 都會用到）
// 需要先載入 pixel-core.js。都是純運算，不碰畫面。
'use strict';

const SLOTS = [
  { id: 'front', label: '正面', sub: '朝下走', req: true },
  { id: 'back', label: '背面', sub: '朝上走', req: true },
  { id: 'side', label: '側面', sub: '朝左或朝右', req: true },
  { id: 'frontStep', label: '正面跨步', sub: '可選' },
  { id: 'backStep', label: '背面跨步', sub: '可選' },
  { id: 'sideStep', label: '側面跨步', sub: '可選' },
  { id: 'frontDiag', label: '斜前方', sub: '可選，沒放會自動產生', diag: true },
  { id: 'backDiag', label: '斜後方', sub: '可選，沒放會自動產生', diag: true },
  { id: 'weapon', label: '武器', sub: '可選，攻擊用。刀：水平、刀柄在左；弓：直立、不畫弦', weapon: true },
  { id: 'ammo', label: '箭', sub: '可選，弓用。水平、箭頭在右', weapon: true },
];
const SIZES = [
  { id: '16x16', label: '16×16　Ninja Adventure（遊戲現有角色）', w: 16, h: 16 },
  { id: '24x32', label: '24×32　小型 RPG 角色', w: 24, h: 32 },
  { id: '32x32', label: '32×32', w: 32, h: 32 },
  { id: '32x48', label: '32×48　八方旅人風角色', w: 32, h: 48 },
  { id: '48x64', label: '48×64　八方旅人風大型角色', w: 48, h: 64 },
  { id: 'custom', label: '自訂' },
];
// 遊戲裡的直欄順序；前 4 欄跟現有角色一樣，斜向放在後面
const DIRS = ['下', '上', '左', '右', '左下', '右下', '左上', '右上'];
const animDefaults = h => ({ lift: Math.max(1, Math.round(h / 10)), bob: Math.max(1, Math.round(h / 32)), stride: Math.max(1, Math.round(h / 10)) });
const SPRITE_DEFAULTS = Object.assign({
  size: '16x16', w: 16, h: 16, sideFacing: 'left', resample: 'mode',
  legRatio: 30, legSplit: 0, ms: 150, guides: true,
  bgMode: 'auto', bgManual: '#ffffff', bgTol: 15, bgFlood: true,
  palette: 'game', colors: 16, limitFixed: true, customPal: '', dither: 'none', ditherStr: 0,
  outline: 'outer', outlineColor: GAME_OUTLINE, outlineN: '4', cleanFloat: true, cleanSpeck: false,
  previewBg: 'grass', fname: 'Hero', exportScale: '4', sheetOrder: 'front,side,back', dirCount: '8', diagSide: 25,
}, animDefaults(16));

// ---------- 自動找出圖裡的人物 ----------
// 去背後，找出「有東西的直欄」連成的區塊，每塊是一個人物；同一塊裡只取最高的那一段（避開下面的文字標籤）
function detectFigures(full, s) {
  const a = cloneImg(full), W = a.width, H = a.height, d = a.data;
  const bgColor = bgColorFor({ bg: autoBg(full) }, s);
  if (bgColor) removeBg(a, { bgColor, bgTol: Math.max(s.bgTol, 10), bgFlood: false });
  const on = (x, y) => d[(y * W + x) * 4 + 3] > 128;
  const runs = (count, len, minCount, maxGap, minLen) => {
    const out = []; let start = -1, last = -1;
    for (let i = 0; i < len; i++) {
      if (count[i] >= minCount) { if (start < 0 || i - last > maxGap) { if (start >= 0) out.push([start, last]); start = i; } last = i; }
    }
    if (start >= 0) out.push([start, last]);
    return out.filter(([s, e]) => e - s + 1 >= minLen);
  };
  const colCnt = new Int32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) colCnt[x]++;
  const cols = runs(colCnt, W, Math.max(1, H * 0.004), Math.round(W * 0.012), Math.round(W * 0.03));
  const m = Math.round(Math.max(W, H) * 0.01) + 2, rects = [];
  for (const [x0, x1] of cols) {
    const rowCnt = new Int32Array(H);
    for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) if (on(x, y)) rowCnt[y]++;
    // 頭和身體之間可能有幾行空白（沒畫脖子），所以要空很多行才算分開
    const bands = runs(rowCnt, H, 1, Math.max(3, Math.round(H * 0.04)), 2);
    if (!bands.length) continue;
    const [y0, y1] = bands.reduce((b, r) => (r[1] - r[0] > b[1] - b[0] ? r : b));
    // 取最高那一段後，重新算這一段的左右範圍
    let lx = x1, rx = x0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (on(x, y)) { if (x < lx) lx = x; if (x > rx) rx = x; }
    const x = Math.max(0, lx - m), y = Math.max(0, y0 - m);
    rects.push({ x, y, w: Math.min(W, rx + m + 1) - x, h: Math.min(H, y1 + m + 1) - y });
  }
  return rects;
}

// 依檔名猜是哪一張
function guessSlot(name) {
  const n = name.toLowerCase(), step = /step|walk|跨步|stride/.test(n);
  let dir = /back|背|up\b|_up/.test(n) ? 'back' : /side|側|left|right/.test(n) ? 'side' : /front|正|down/.test(n) ? 'front' : null;
  if (/diag|斜|3-4|34|three.?quarter/.test(n)) return dir === 'back' ? 'backDiag' : 'frontDiag';
  if (!dir) {
    if (/arrow|箭|矢/.test(n) && !/bow|弓/.test(n)) return 'ammo';
    return /weapon|sword|katana|blade|bow|武器|刀|劍|剣|弓/.test(n) ? 'weapon' : null;
  }
  return step ? dir + 'Step' : dir;
}

// ---------- 產生 ----------
function cloneImg(img) { return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height); }
function mirror(img) {
  const W = img.width, H = img.height, out = new ImageData(W, H), d = img.data, o = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4, oi = (y * W + W - 1 - x) * 4;
    o[oi] = d[si]; o[oi + 1] = d[si + 1]; o[oi + 2] = d[si + 2]; o[oi + 3] = d[si + 3];
  }
  return out;
}

// ---------- 自動產生斜向圖 ----------
// 把一個角度的圖（只取人物範圍）縮放到高度 Hn，平滑縮放
function normView(view, Hn) {
  const { img, box } = view, w = Math.max(1, Math.round(box.w * Hn / box.h));
  const a = document.createElement('canvas'); a.width = img.width; a.height = img.height; a.getContext('2d').putImageData(img, 0, 0);
  const c = document.createElement('canvas'); c.width = w; c.height = Hn;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(a, box.x, box.y, box.w, box.h, 0, 0, w, Hn);
  return ctx.getImageData(0, 0, w, Hn);
}
// 每一列最左、最右的不透明像素
function rowExtents(img) {
  const W = img.width, H = img.height, d = img.data, rows = [];
  let sx = 0, n = 0;
  for (let y = 0; y < H; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] >= 128) { if (l < 0) l = x; r = x; sx += x; n++; }
    rows.push(l < 0 ? null : { c: (l + r + 1) / 2, a: (r - l + 1) / 2 });
  }
  return { rows, axis: n ? sx / n + 0.5 : W / 2 };
}
// 把角色想成一層層的橢圓柱：寬度來自正面圖、厚度來自側面圖（朝左）。
// 轉 theta 度後，靠正面的地方貼正面圖、靠側面貼側面圖、靠背面貼背面圖。
// theta = 45 → 斜前方（朝左下），135 → 斜後方（朝左上）
function synthDiag(F, S, B, theta, sideW) {
  const H = F.height, ef = rowExtents(F), es = rowExtents(S), eb = rowExtents(B);
  const th = theta * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
  // 側面圖的深度和正面圖的寬度比例（某些列沒有側面資料時用來推估）
  let ra = 0, rb = 0;
  for (let y = 0; y < H; y++) if (ef.rows[y] && es.rows[y]) { ra += ef.rows[y].a; rb += es.rows[y].a; }
  const depthRatio = ra ? rb / ra : 0.6;
  const rows = [];
  let maxHalf = 1;
  for (let y = 0; y < H; y++) {
    const f = ef.rows[y], sd = es.rows[y];
    if (!f && !sd) { rows.push(null); continue; }
    const a = f ? f.a : sd.a / depthRatio, b = sd ? sd.a : f.a * depthRatio;
    const Xc = f ? f.c - ef.axis : 0, Zc = sd ? es.axis - sd.c : 0; // 側面圖左邊是角色前方
    const Xpc = Xc * ct - Zc * st;
    rows.push({ a, b, Xpc, f, sd, bk: eb.rows[y] });
    maxHalf = Math.max(maxHalf, Math.abs(Xpc) + Math.hypot(a * ct, b * st) + 2);
  }
  const OW = Math.ceil(maxHalf) * 2 + 2, OA = OW / 2, out = new ImageData(OW, H), o = out.data;
  const sample = (img, x, y) => {
    x = Math.floor(x); if (x < 0 || x >= img.width) return -1;
    const i = (y * img.width + x) * 4; return img.data[i + 3] >= 128 ? i : -1;
  };
  for (let y = 0; y < H; y++) {
    const R = rows[y]; if (!R) continue;
    const N = Math.max(360, Math.ceil(4 * Math.PI * Math.max(R.a, R.b)));
    const pts = [];
    for (let k = 0; k < N; k++) {
      const t = -Math.PI + 2 * Math.PI * k / N, sn = Math.sin(t), cs = Math.cos(t);
      const X = R.a * sn, Z = R.b * cs;
      pts.push({ sn, cs, xp: X * ct - Z * st, zp: X * st + Z * ct });
    }
    pts.sort((p, q) => p.zp - q.zp); // 由後往前畫，前面的蓋住後面的
    for (const p of pts) {
      // 這個點最接近哪個角度的圖，就用那張圖的顏色
      // sideW 越小，正面／背面圖負責的範圍越大（臉是平的，用側面圖容易出現重複的眼睛）
      const wf = R.f ? p.cs : -9, wb = R.bk ? -p.cs : -9, ws = R.sd ? Math.abs(p.sn) * sideW : -9;
      let src = -1, img = null;
      if (wf >= wb && wf >= ws) { img = F; src = sample(F, R.f.c + R.f.a * p.sn, y); }
      else if (wb >= ws) { img = B; src = sample(B, R.bk.c - R.bk.a * p.sn, y); }
      else { img = S; src = sample(S, R.sd.c - R.sd.a * p.cs, y); }
      if (src < 0) continue;
      const ox = Math.floor(OA + R.Xpc + p.xp); if (ox < 0 || ox >= OW) continue;
      const oi = (y * OW + ox) * 4, d = img.data;
      o[oi] = d[src]; o[oi + 1] = d[src + 1]; o[oi + 2] = d[src + 2]; o[oi + 3] = 255;
    }
  }
  return out;
}
let synthCache = { key: '', views: null };
// ver：圖片版本號，有給才會快取（批次轉換每隻角色都不同，不快取）
function synthViews(views, s, ver) {
  const key = ver == null ? "" : JSON.stringify([ver, s.bgMode, s.bgManual, s.bgTol, s.bgFlood, s.sideFacing, s.diagSide]);
  if (key && synthCache.key === key) return synthCache.views;
  const Hn = clamp(Math.max(views.front.box.h, views.side.box.h), 48, 320);
  const F = normView(views.front, Hn), B = normView(views.back, Hn);
  let S = normView(views.side, Hn);
  if (s.sideFacing === 'right') S = mirror(S); // 計算時統一用朝左的側面
  const res = {};
  for (const [id, th] of [['frontDiag', 45], ['backDiag', 135]]) {
    const img = synthDiag(F, S, B, th, s.diagSide / 50), box = bbox(img, 128);
    if (box) res[id] = { img, box, synth: true };
  }
  if (key) synthCache = { key, views: res };
  return res;
}

// 這張圖要去掉的背景色（null = 不去背）
function bgColorFor(im, s) {
  if (s.bgMode === 'manual') return s.bgManual;
  if (s.bgMode === 'auto' && im.bg.bgOn) return im.bg.bgColor;
  return null;
}

// 把幾張原圖縮成同樣身高的像素圖，並共用調色盤
// images[id] = { data（框選後的圖）, bg（autoBg 的結果） }
// 去背、找出每張圖的人物範圍：views[id] = { img（去背後）, box（人物範圍） }
function prepViews(images, s) {
  let noBgWarned = false;
  const warn = [], views = {};
  for (const sl of SLOTS) {
    const im = images[sl.id]; if (!im) continue;
    const a = cloneImg(im.data); // 框選後的範圍（背景色用整張圖的四個角判斷，比較準）
    const bgColor = bgColorFor(im, s);
    if (bgColor) removeBg(a, { bgColor, bgTol: s.bgTol, bgFlood: s.bgFlood });
    else if (s.bgMode === 'auto' && !im.bg.bgOn && !noBgWarned) { noBgWarned = true; warn.push('沒有偵測到單一的背景色；如果圖片有背景，請在左邊「去背」改成「手動指定背景色」。'); }
    const box = bbox(a, 128);
    if (box) views[sl.id] = { img: a, box };
    else warn.push(`「${sl.label}」去背後什麼都沒剩，請調低容差或關閉自動去背。`);
  }
  if (!views.front) return { warn: ['請先放入正面圖（或按上方「範例圖」試試看）。', ...warn] };
  if (!views.back) { views.back = views.front; warn.push('還沒放背面圖，暫時用正面圖代替。'); }
  if (!views.side) { views.side = views.front; warn.push('還沒放側面圖，暫時用正面圖代替。'); }
  return { views, warn };
}

function buildBase(images, s, ver) {
  const W = clamp(s.w | 0, 8, 256), H = clamp(s.h | 0, 8, 256);
  const ol = s.outline === 'outer' ? 1 : 0, bob = s.bob | 0;
  const innerW = W - ol * 2, innerH = Math.max(4, H - ol * 2 - bob);
  const prep = prepViews(images, s);
  if (!prep.views) return { warn: prep.warn };
  const { views, warn } = prep;
  delete views.weapon; delete views.ammo; // 武器、箭只有骨架模式的攻擊動作會用到
  const synth = {};
  if (s.dirCount === '8') {
    const need = ['frontDiag', 'backDiag'].filter(id => !views[id]);
    if (need.length) {
      const sv = synthViews(views, s, ver);
      for (const id of need) if (sv[id]) { views[id] = sv[id]; synth[id] = true; }
    }
  } else { delete views.frontDiag; delete views.backDiag; }

  // 每張圖縮到一樣高；如果有任何一張太寬，全部一起縮小
  const k = {};
  let fit = 1;
  const mainIds = ['front', 'back', 'side', 'frontDiag', 'backDiag'].filter(id => views[id]);
  for (const id of mainIds) {
    k[id] = innerH / views[id].box.h;
    fit = Math.min(fit, innerW / (views[id].box.w * k[id]));
  }
  for (const id of mainIds) k[id] *= fit;
  // 跨步圖用同方向站姿圖的縮放比例，大小才一致
  for (const id of ['frontStep', 'backStep', 'sideStep']) if (views[id]) k[id] = k[id.replace('Step', '')];

  const sprites = {};
  for (const id in views) {
    const { img, box } = views[id], kk = k[id];
    const dw = clamp(Math.round(box.w * kk), 1, innerW), dh = clamp(Math.round(box.h * kk), 1, innerH);
    const g = { W, H, rx: box.x, ry: box.y, rw: box.w, rh: box.h, dx: ol + Math.floor((innerW - dw) / 2), dy: H - ol - dh, dw, dh };
    const o = resample(img, g, s.resample);
    thresholdAlpha(o, 128);
    sprites[id] = o;
  }
  const uniq = [...new Set(Object.values(sprites))];
  const pal = choosePalette(countColors(uniq), s);
  if (pal) uniq.forEach(o => applyPalette(o, pal, s));
  if (s.cleanFloat || s.cleanSpeck) uniq.forEach(o => cleanup(o, s));
  return { W, H, sprites, pal, warn, synth };
}

// 腳的位置：最下面 legRatio% 是腳，用腳部像素的重心分左右
function legInfo(img, s) {
  const b = bbox(img, 1); if (!b) return null;
  const legH = Math.max(1, Math.round(b.h * s.legRatio / 100));
  const legTop = b.y + b.h - legH, legBottom = b.y + b.h - 1, W = img.width, d = img.data;
  let sx = 0, n = 0;
  for (let y = legTop; y <= legBottom; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { sx += x; n++; }
  const cx = n ? sx / n : b.x + b.w / 2;
  return { legTop, legBottom, legH, splitX: Math.round(cx + 0.5 + s.legSplit) };
}

function painter(W, H) {
  const out = new ImageData(W, H), o = out.data;
  return {
    out,
    put(x, y, r, g, b) {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4; o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = 255;
    },
  };
}

// 正面／背面：抬起一隻腳（side = 'L' 左、'R' 右、'N' 都不抬），身體往上 bob
function liftFrame(img, L, side, lift, bob) {
  const W = img.width, H = img.height, d = img.data, p = painter(W, H);
  for (let y = L.legTop; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (!d[i + 3]) continue;
    const lifted = side === 'L' ? x < L.splitX : side === 'R' ? x >= L.splitX : false;
    const dy = lifted ? -lift : 0;
    p.put(x, y + dy, d[i], d[i + 1], d[i + 2]);
    // 身體往上移了，腳要往上拉長補滿空隙
    const gap = bob + dy;
    if (y === L.legTop) for (let k = 1; k <= gap; k++) p.put(x, y + dy - k, d[i], d[i + 1], d[i + 2]);
  }
  for (let y = 0; y < L.legTop; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (d[i + 3]) p.put(x, y - bob, d[i], d[i + 1], d[i + 2]);
  }
  return p.out;
}

// 側面：前腳、後腳往相反方向斜著錯開（後腳顏色比較暗）
function strideFrame(img, L, dir, amount, dark) {
  const W = img.width, H = img.height, d = img.data, p = painter(W, H);
  const shift = (y, sign) => Math.round(sign * amount * (y - L.legTop + 1) / L.legH);
  for (const pass of [{ sign: -dir, far: true }, { sign: dir, far: false }]) {
    for (let y = L.legTop; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (!d[i + 3]) continue;
      const [r, g, b] = pass.far ? dark(d[i], d[i + 1], d[i + 2]) : [d[i], d[i + 1], d[i + 2]];
      p.put(x + shift(y, pass.sign), y, r, g, b);
    }
  }
  for (let y = 0; y < L.legTop; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (d[i + 3]) p.put(x, y, d[i], d[i + 1], d[i + 2]);
  }
  return p.out;
}

// 只把腳的部分左右翻轉（用跨步圖做出另一隻腳在前的那一幀）
function mirrorLegs(img, L) {
  const W = img.width, H = img.height, d = img.data, p = painter(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (!d[i + 3]) continue;
    p.put(y >= L.legTop ? 2 * L.splitX - 1 - x : x, y, d[i], d[i + 1], d[i + 2]);
  }
  return p.out;
}

function makeDarken(pal) {
  const near = pal ? makeNearest(pal) : null;
  return (r, g, b) => {
    const dr = r * 0.68, dg = g * 0.68, db = b * 0.72;
    if (!near) return [dr | 0, dg | 0, db | 0];
    const c = pal[near(dr, dg, db)];
    // 調色盤裡找不到更暗的顏色時，至少不要比原本亮
    return (c[0] + c[1] + c[2] <= r + g + b) ? c : [dr | 0, dg | 0, db | 0];
  };
}

function walkFront(img, step, s) {
  const L = legInfo(img, s); if (!L) return [img, img, img, img];
  if (step) { const Ls = legInfo(step, s) || L; return [img, step, img, mirrorLegs(step, Ls)]; }
  return [img, liftFrame(img, L, 'L', s.lift, s.bob), img, liftFrame(img, L, 'R', s.lift, s.bob)];
}
function walkSide(img, step, s, dark) {
  const L = legInfo(img, s); if (!L) return [img, img, img, img];
  const pass = liftFrame(img, L, 'N', 0, s.bob);
  if (step) { const Ls = legInfo(step, s) || L; return [step, pass, mirrorLegs(step, Ls), pass]; }
  return [strideFrame(img, L, 1, s.stride, dark), pass, strideFrame(img, L, -1, s.stride, dark), pass];
}

// 產生整套精靈圖：Walk（4 幀 × 每個方向）和 Idle（每個方向 1 幀）
function generateSprite(images, s, ver) {
  const base = buildBase(images, s, ver);
  if (!base.sprites) return { warn: base.warn };
  const sp = base.sprites, dark = makeDarken(base.pal);
  const front = walkFront(sp.front, sp.frontStep, s);
  const back = walkFront(sp.back, sp.backStep, s);
  const side = walkSide(sp.side, sp.sideStep, s, dark);
  const sideM = side.map(mirror), sideIdleM = mirror(sp.side);
  const left = s.sideFacing === 'left' ? side : sideM, right = s.sideFacing === 'left' ? sideM : side;
  const dirs = [front, back, left, right];
  const idleRaw = [sp.front, sp.back, s.sideFacing === 'left' ? sp.side : sideIdleM, s.sideFacing === 'left' ? sideIdleM : sp.side];
  if (s.dirCount === '8') {
    // 自動產生的斜向圖一律朝左；自己放的斜向圖跟側面圖同方向
    for (const id of ['frontDiag', 'backDiag']) {
      const img = sp[id] || (id === 'frontDiag' ? sp.front : sp.back);
      const w = walkFront(img, null, s), facesLeft = base.synth[id] || s.sideFacing === 'left';
      dirs.push(facesLeft ? w : w.map(mirror), facesLeft ? w.map(mirror) : w);
      idleRaw.push(facesLeft ? img : mirror(img), facesLeft ? mirror(img) : img);
    }
  }
  const finish = f => { const c = cloneImg(f); if (s.outline !== 'none') outline(c, s); return c; };
  const walk = dirs.map(fr => fr.map(finish));       // walk[方向][幀]
  const idle = idleRaw.map(finish);
  const cols = walk.length, order = [];
  for (let f = 0; f < 4; f++) for (let d = 0; d < cols; d++) order.push(walk[d][f]);
  return {
    W: base.W, H: base.H, walk, idle, base, cols, warn: base.warn,
    walkSheet: compose(order, cols, 4, base.W, base.H),
    idleSheet: compose(idle, cols, 1, base.W, base.H),
  };
}
