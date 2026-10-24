// 像素圖轉換的共用核心（pixel-converter.html 和 sprite-generator.html 都會用到）
// 都是純運算：輸入 ImageData、輸出 ImageData，不碰畫面。
'use strict';

const hexList = s => s.trim().split(/\s+/).map(h => '#' + h);
const PALETTES = {
  auto: { label: '自動（從圖片取色）' },
  game: { label: '神機紀元遊戲色（43 色）', colors: hexList(`
    141b1b adbc3a e0394c 8f3e56 79b8ce 4e484a 74a334 5f7160 3b3643 ffffff 56864c 548789 f2eaf1 d14b34 fce2ca
    e46d3a 9ba7aa c8966b ef914f f1c471 a8a129 f2ad7d ffad5d ff9554 8d977f abc2bc d78b4a 345a52 ffe18d e75d6d
    e3f1f5 543c52 f38c4c ffcba9 4a5270 965340 d3a2c0 f396a1 cf736d 2e3939 f0e5d1 51614e 323c39`) },
  pico8: { label: 'PICO-8（16 色）', colors: hexList(`
    000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa`) },
  sweetie16: { label: 'Sweetie 16', colors: hexList(`
    1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57`) },
  endesga32: { label: 'Endesga 32', colors: hexList(`
    be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e
    124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569`) },
  nes: { label: 'NES 紅白機', colors: hexList(`
    7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000
    bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888
    f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878
    fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8`) },
  gameboy: { label: 'Game Boy（4 色）', colors: hexList(`0f380f 306230 8bac0f 9bbc0f`) },
  custom: { label: '自訂' },
  none: { label: '不限制顏色' },
};
const GAME_OUTLINE = '#141b1b';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const hex2rgb = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
// 接近人眼感受的顏色距離（redmean）
function cdist(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}
function parseColors(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const gpl = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/);
    if (gpl) { out.push([+gpl[1], +gpl[2], +gpl[3]].map(v => clamp(v, 0, 255))); continue; }
    for (const m of line.matchAll(/#?\b([0-9a-fA-F]{6})\b/g)) out.push(hex2rgb(m[1]));
  }
  return out;
}

function crop(img, x, y, w, h) {
  const out = new ImageData(w, h);
  for (let j = 0; j < h; j++) { const si = ((y + j) * img.width + x) * 4; out.data.set(img.data.subarray(si, si + w * 4), j * w * 4); }
  return out;
}
// 大小不同的圖片放到同樣大小的畫布上（底部置中）
function padTo(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new ImageData(w, h), ox = Math.floor((w - img.width) / 2), oy = h - img.height;
  for (let j = 0; j < img.height; j++) out.data.set(img.data.subarray(j * img.width * 4, (j + 1) * img.width * 4), ((oy + j) * w + ox) * 4);
  return out;
}
// 各幀（大小都是 fw×fh）排成一張大圖
function compose(frames, cols, rows, fw, fh) {
  if (frames.length === 1 && cols === 1 && rows === 1) return frames[0];
  const out = new ImageData(cols * fw, rows * fh);
  frames.forEach((f, i) => {
    const cx = (i % cols) * fw, cy = Math.floor(i / cols) * fh;
    for (let j = 0; j < fh; j++) out.data.set(f.data.subarray(j * fw * 4, (j + 1) * fw * 4), ((cy + j) * out.width + cx) * 4);
  });
  return out;
}

// 1. 亮度／對比／飽和度
function adjust(src, s) {
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  if (!s.bright && !s.contrast && !s.sat) return out;
  const d = out.data, b = s.bright * 1.5, c = Math.pow((s.contrast + 100) / 100, 2), sat = (s.sat + 100) / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = (d[i] - 128) * c + 128 + b, g = (d[i + 1] - 128) * c + 128 + b, bl = (d[i + 2] - 128) * c + 128 + b;
    const gray = 0.299 * r + 0.587 * g + 0.114 * bl;
    d[i] = gray + (r - gray) * sat; d[i + 1] = gray + (g - gray) * sat; d[i + 2] = gray + (bl - gray) * sat;
  }
  return out;
}

// 2. 去背
function removeBg(img, s) {
  const d = img.data, W = img.width, H = img.height, [kr, kg, kb] = hex2rgb(s.bgColor);
  const tol = Math.pow(s.bgTol / 100 * 255, 2) * 3;
  const match = p => { const i = p * 4; if (d[i + 3] === 0) return true;
    const dr = d[i] - kr, dg = d[i + 1] - kg, db = d[i + 2] - kb; return dr * dr + dg * dg + db * db <= tol; };
  if (!s.bgFlood) { for (let p = 0; p < W * H; p++) if (match(p)) d[p * 4 + 3] = 0; return; }
  // 從四邊往內擴散，只清掉相連的背景
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H); let sp = 0;
  const push = p => { if (!seen[p] && match(p)) { seen[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const p = stack[--sp]; d[p * 4 + 3] = 0;
    const x = p % W, y = (p - x) / W;
    if (x > 0) push(p - 1); if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W); if (y < H - 1) push(p + W);
  }
}

// 3. 找出不透明範圍
function bbox(img, thr) {
  const d = img.data, W = img.width, H = img.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] >= thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null; // 整格都是透明的
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function unionBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// 4. 計算放到目標畫布的位置
function geometry(box, s) {
  const ol = s.outline === 'outer' ? 1 : 0;
  if (s.sizeMode === 'scale') {
    const f = Math.max(1, s.scale), pad = ol;
    const dw = Math.max(1, Math.round(box.w / f)), dh = Math.max(1, Math.round(box.h / f));
    return { W: dw + pad * 2, H: dh + pad * 2, rx: box.x, ry: box.y, rw: box.w, rh: box.h, dx: pad, dy: pad, dw, dh };
  }
  const W = clamp(s.w | 0, 1, 512), H = clamp(s.h | 0, 1, 512);
  const p = Math.max(0, Math.min((s.pad | 0) + ol, Math.floor((Math.min(W, H) - 1) / 2)));
  const iw = W - p * 2, ih = H - p * 2;
  let rx = box.x, ry = box.y, rw = box.w, rh = box.h, dw, dh;
  if (s.fit === 'stretch') { dw = iw; dh = ih; }
  else if (s.fit === 'cover') {
    const k = Math.max(iw / rw, ih / rh), cw = iw / k, ch = ih / k;
    rx += (rw - cw) / 2; ry += s.anchor === 'bottom' ? rh - ch : (rh - ch) / 2; rw = cw; rh = ch; dw = iw; dh = ih;
  } else {
    const k = Math.min(iw / rw, ih / rh);
    dw = clamp(Math.round(rw * k), 1, iw); dh = clamp(Math.round(rh * k), 1, ih);
  }
  const dx = p + Math.floor((iw - dw) / 2);
  const dy = s.anchor === 'bottom' ? p + ih - dh : p + Math.floor((ih - dh) / 2);
  return { W, H, rx, ry, rw, rh, dx, dy, dw, dh };
}

// 5. 縮放取色
function resample(src, g, method) {
  const out = new ImageData(g.W, g.H), o = out.data, d = src.data, SW = src.width, SH = src.height;
  const cnt = new Uint32Array(4096), sr = new Float64Array(4096), sg = new Float64Array(4096), sb = new Float64Array(4096);
  const touched = [];
  for (let j = 0; j < g.dh; j++) {
    const fy0 = g.ry + j * g.rh / g.dh, fy1 = g.ry + (j + 1) * g.rh / g.dh;
    const y0 = clamp(Math.round(fy0), 0, SH - 1), y1 = clamp(Math.max(y0 + 1, Math.round(fy1)), y0 + 1, SH);
    for (let i = 0; i < g.dw; i++) {
      const fx0 = g.rx + i * g.rw / g.dw, fx1 = g.rx + (i + 1) * g.rw / g.dw;
      const x0 = clamp(Math.round(fx0), 0, SW - 1), x1 = clamp(Math.max(x0 + 1, Math.round(fx1)), x0 + 1, SW);
      const oi = ((g.dy + j) * g.W + g.dx + i) * 4;
      if (method === 'nearest') {
        const sx = clamp(Math.floor((fx0 + fx1) / 2), 0, SW - 1), sy = clamp(Math.floor((fy0 + fy1) / 2), 0, SH - 1);
        const si = (sy * SW + sx) * 4;
        o[oi] = d[si]; o[oi + 1] = d[si + 1]; o[oi + 2] = d[si + 2]; o[oi + 3] = d[si + 3];
      } else if (method === 'average') {
        let n = 0, sa = 0, r = 0, gg = 0, b = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const si = (y * SW + x) * 4, a = d[si + 3];
          n++; sa += a; r += d[si] * a; gg += d[si + 1] * a; b += d[si + 2] * a;
        }
        if (sa > 0) { o[oi] = r / sa; o[oi + 1] = gg / sa; o[oi + 2] = b / sa; o[oi + 3] = sa / n; }
      } else { // mode：區塊裡出現最多的顏色
        let n = 0, op = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const si = (y * SW + x) * 4; n++;
          if (d[si + 3] < 128) continue;
          op++;
          const key = ((d[si] >> 4) << 8) | ((d[si + 1] >> 4) << 4) | (d[si + 2] >> 4);
          if (!cnt[key]) touched.push(key);
          cnt[key]++; sr[key] += d[si]; sg[key] += d[si + 1]; sb[key] += d[si + 2];
        }
        if (op) {
          let best = touched[0];
          for (const k of touched) if (cnt[k] > cnt[best]) best = k;
          o[oi] = sr[best] / cnt[best]; o[oi + 1] = sg[best] / cnt[best]; o[oi + 2] = sb[best] / cnt[best];
          o[oi + 3] = op / n * 255;
          for (const k of touched) { cnt[k] = 0; sr[k] = sg[k] = sb[k] = 0; }
          touched.length = 0;
        }
      }
    }
  }
  return out;
}

function thresholdAlpha(img, thr) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= thr) d[i + 3] = 255; else d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
  }
}

// 6. 減色
function kmeans(pixels, k) {
  // pixels: Map(rgbInt -> 次數)
  const uniq = [...pixels].map(([c, n]) => [(c >> 16) & 255, (c >> 8) & 255, c & 255, n]);
  if (uniq.length <= k) return uniq.map(u => [u[0], u[1], u[2]]);
  // 先用中位切割得到穩定的起始色，再微調
  let boxes = [uniq];
  while (boxes.length < k) {
    let bi = -1, bestRange = 0, ch = 0;
    boxes.forEach((bx, idx) => {
      if (bx.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0; for (const u of bx) { if (u[c] < lo) lo = u[c]; if (u[c] > hi) hi = u[c]; }
        const w = (hi - lo) * Math.sqrt(bx.reduce((a, u) => a + u[3], 0));
        if (w > bestRange) { bestRange = w; bi = idx; ch = c; }
      }
    });
    if (bi < 0) break;
    const bx = boxes[bi].sort((a, b) => a[ch] - b[ch]);
    const total = bx.reduce((a, u) => a + u[3], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < bx.length - 1; i++) { acc += bx[i][3]; if (acc >= total / 2) { cut = i + 1; break; } cut = i + 1; }
    boxes.splice(bi, 1, bx.slice(0, cut), bx.slice(cut));
  }
  let centers = boxes.map(bx => {
    let r = 0, g = 0, b = 0, n = 0; for (const u of bx) { r += u[0] * u[3]; g += u[1] * u[3]; b += u[2] * u[3]; n += u[3]; }
    return [r / n, g / n, b / n];
  });
  for (let it = 0; it < 8; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const u of uniq) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dd = cdist(u[0], u[1], u[2], centers[c][0], centers[c][1], centers[c][2]);
        if (dd < bd) { bd = dd; bi = c; }
      }
      const sm = sums[bi]; sm[0] += u[0] * u[3]; sm[1] += u[1] * u[3]; sm[2] += u[2] * u[3]; sm[3] += u[3];
    }
    centers = centers.map((c, i) => sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c);
  }
  return centers.map(c => c.map(Math.round));
}

function makeNearest(pal) {
  const cache = new Map();
  return (r, g, b) => {
    r = clamp(Math.round(r), 0, 255); g = clamp(Math.round(g), 0, 255); b = clamp(Math.round(b), 0, 255);
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let bd = Infinity; idx = 0;
      for (let i = 0; i < pal.length; i++) { const dd = cdist(r, g, b, pal[i][0], pal[i][1], pal[i][2]); if (dd < bd) { bd = dd; idx = i; } }
      cache.set(key, idx);
    }
    return idx;
  };
}

function countColors(imgs) {
  const counts = new Map();
  for (const img of imgs) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) {
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}
function choosePalette(counts, s) {
  if (s.palette === 'none' || !counts.size) return null;
  if (s.palette === 'auto') return kmeans(counts, s.colors);
  let pal = s.palette === 'custom' ? parseColors(s.customPal) : PALETTES[s.palette].colors.map(hex2rgb);
  if (!pal.length) return null;
  if (s.limitFixed && pal.length > s.colors) {
    const near = makeNearest(pal), usage = new Array(pal.length).fill(0);
    for (const [c, n] of counts) usage[near((c >> 16) & 255, (c >> 8) & 255, c & 255)] += n;
    pal = pal.map((c, i) => [c, usage[i]]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, s.colors).map(x => x[0]);
  }
  return pal;
}

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function applyPalette(img, pal, s) {
  const d = img.data, W = img.width, H = img.height, near = makeNearest(pal);
  const set = (i, idx) => { d[i] = pal[idx][0]; d[i + 1] = pal[idx][1]; d[i + 2] = pal[idx][2]; };
  if (s.dither === 'fs') {
    const buf = new Float32Array(W * H * 3), k = s.ditherStr / 100;
    for (let p = 0; p < W * H; p++) { buf[p * 3] = d[p * 4]; buf[p * 3 + 1] = d[p * 4 + 1]; buf[p * 3 + 2] = d[p * 4 + 2]; }
    const spread = (x, y, er, eg, eb, f) => {
      if (x < 0 || x >= W || y >= H) return; const p = y * W + x; if (!d[p * 4 + 3]) return;
      buf[p * 3] += er * f; buf[p * 3 + 1] += eg * f; buf[p * 3 + 2] += eb * f;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; if (!d[p * 4 + 3]) continue;
      const r = buf[p * 3], g = buf[p * 3 + 1], b = buf[p * 3 + 2], idx = near(r, g, b);
      set(p * 4, idx);
      const er = (r - pal[idx][0]) * k, eg = (g - pal[idx][1]) * k, eb = (b - pal[idx][2]) * k;
      spread(x + 1, y, er, eg, eb, 7 / 16); spread(x - 1, y + 1, er, eg, eb, 3 / 16);
      spread(x, y + 1, er, eg, eb, 5 / 16); spread(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
    return;
  }
  const amt = s.dither === 'bayer' ? s.ditherStr / 100 * 64 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (!d[i + 3]) continue;
    const off = amt ? ((BAYER[y & 3][x & 3] + 0.5) / 16 - 0.5) * amt : 0;
    set(i, near(d[i] + off, d[i + 1] + off, d[i + 2] + off));
  }
}

// 7. 清除雜點
function cleanup(img, s) {
  const d = img.data, W = img.width, H = img.height, src = new Uint8ClampedArray(d);
  const op = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[(y * W + x) * 4 + 3] > 0;
  const col = (x, y) => { const i = (y * W + x) * 4; return (src[i] << 16) | (src[i + 1] << 8) | src[i + 2]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!op(x, y)) continue;
    const i = (y * W + x) * 4;
    if (s.cleanFloat) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && op(x + dx, y + dy)) n++;
      if (!n) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
    }
    if (s.cleanSpeck) {
      if (!(op(x - 1, y) && op(x + 1, y) && op(x, y - 1) && op(x, y + 1))) continue;
      const me = col(x, y);
      if (col(x - 1, y) === me || col(x + 1, y) === me || col(x, y - 1) === me || col(x, y + 1) === me) continue;
      const tally = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && op(x + dx, y + dy)) {
        const c = col(x + dx, y + dy); tally.set(c, (tally.get(c) || 0) + 1);
      }
      let best = me, bn = 0; for (const [c, n] of tally) if (n > bn) { bn = n; best = c; }
      d[i] = (best >> 16) & 255; d[i + 1] = (best >> 8) & 255; d[i + 2] = best & 255;
    }
  }
}

// 8. 外框
function outline(img, s) {
  const d = img.data, W = img.width, H = img.height, src = new Uint8ClampedArray(d), [r, g, b] = hex2rgb(s.outlineColor);
  const dirs = s.outlineN === '8' ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const op = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[(y * W + x) * 4 + 3] > 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const me = op(x, y);
    if (s.outline === 'outer' ? me : !me) continue;
    let hit = false;
    for (const [dx, dy] of dirs) if (op(x + dx, y + dy) !== me) { hit = true; break; }
    if (!hit) continue;
    const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
}

function imageToData(img, max) {
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w, h));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
function loadBlob(blob, cb, onErr) {
  const url = URL.createObjectURL(blob), img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); cb(img); };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    if (onErr) onErr(); else alert('無法讀取這個檔案，請確認是圖片（PNG、JPG、WebP、GIF）。');
  };
  img.src = url;
}

// 四個角大多同色 → 當作背景色並自動開啟去背
function autoBg(data) {
  // 沿著四邊取點；JPG 的白底會有些微雜訊，所以用「大部分點的顏色接近」來判斷，不要求完全相同
  const d = data.data, W = data.width, H = data.height, pts = [], N = 16;
  for (let i = 0; i < N; i++) {
    const x = Math.round(i * (W - 1) / (N - 1)), y = Math.round(i * (H - 1) / (N - 1));
    pts.push(x, (H - 1) * W + x, y * W, y * W + W - 1);
  }
  const opaque = pts.filter(p => d[p * 4 + 3] >= 250);
  if (opaque.length < pts.length / 2) return { bgOn: false }; // 本來就是透明背景
  const med = [0, 1, 2].map(c => { const v = opaque.map(p => d[p * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const close = opaque.filter(p => Math.max(...[0, 1, 2].map(c => Math.abs(d[p * 4 + c] - med[c]))) <= 30).length;
  return { bgColor: rgb2hex(med[0], med[1], med[2]), bgOn: close >= pts.length * 0.6 };
}
