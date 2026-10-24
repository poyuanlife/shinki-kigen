// 骨架動畫（第一階段）：概念同《歧路旅人》用 Photoshop「操控彎曲」擺姿勢的做法。
// 1. 在高解析度的原圖上放關節點（頭、肩、肘、手、腰、膝、腳）
// 2. 依關節把手、腳切成「上段／下段」零件，身體被手腳擋住的地方自動補色
// 3. 每一幀用旋轉／平移擺出走路姿勢（在高解析度上做，線條才不會破）
// 4. 再交給原本的像素化流程（縮小、減色、外框）
// 需要先載入 pixel-core.js 和 sprite-core.js。
'use strict';

const RIG_HN = 360; // 計算用的人物高度（像素）
const RIG_JOINTS = {
  front: ['head', 'neck', 'pelvis', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR'],
  side: ['head', 'neck', 'pelvis', 'shoulder', 'elbow', 'hand', 'hip', 'knee', 'foot'],
};
const RIG_JOINT_LABELS = {
  head: '頭頂', neck: '脖子', pelvis: '腰', shoulder: '肩', elbow: '手肘', hand: '手', hip: '髖', knee: '膝', foot: '腳',
  shoulderL: '左肩', elbowL: '左肘', handL: '左手', shoulderR: '右肩', elbowR: '右肘', handR: '右手',
  hipL: '左髖', kneeL: '左膝', footL: '左腳', hipR: '右髖', kneeR: '右膝', footR: '右腳',
};
// 手腳：[根部, 中間關節, 末端]（「左、右」是畫面上的左右）
const RIG_LIMBS = {
  front: { legL: ['hipL', 'kneeL', 'footL'], legR: ['hipR', 'kneeR', 'footR'], armL: ['shoulderL', 'elbowL', 'handL'], armR: ['shoulderR', 'elbowR', 'handR'] },
  side: { leg: ['hip', 'knee', 'foot'], arm: ['shoulder', 'elbow', 'hand'] },
};
const RIG_BONES = { // 畫骨架線用
  front: [['head', 'neck'], ['neck', 'pelvis'], ['neck', 'shoulderL'], ['neck', 'shoulderR'], ['pelvis', 'hipL'], ['pelvis', 'hipR'],
    ['shoulderL', 'elbowL'], ['elbowL', 'handL'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
    ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR']],
  side: [['head', 'neck'], ['neck', 'pelvis'], ['neck', 'shoulder'], ['pelvis', 'hip'], ['shoulder', 'elbow'], ['elbow', 'hand'], ['hip', 'knee'], ['knee', 'foot']],
};
const RIG_DEFAULTS = { animMode: 'rig', rigFrames: '4', rigLeg: 16, rigKnee: 30, rigArm: 20, rigLift: 14, rigBob: 1, rigLegW: 100, rigArmW: 100,
  chibiOn: false, chibiHeads: 3.25, chibiHead: 140, chibiLegs: 45, chibiWidth: 110,
  idleFrames: '1', actRun: true, runFrames: '6', runLeg: 34, runKnee: 70, runArm: 30, runLean: 10, runBob: 3,
  actAtk: true, atkFrames: '6', weaponType: 'auto', bowLen: 60, arrowLen: 55, weaponLen: 50, weaponGrip: 12, weaponFlip: false, atkTrail: true, actHit: true, actDead: true };
const rigKind = id => id === 'side' ? 'side' : 'front';

// ---------- 自動找關節 ----------
// 依一般人體比例（約 7 頭身）抓高度，再從輪廓找左右位置。不準的話在畫面上拖曳修正。
function rigAutoJoints(work, kind) {
  const W = work.width, H = work.height, d = work.data;
  const runsAt = fy => {
    const y = clamp(Math.round(fy * (H - 1)), 0, H - 1), out = [], minLen = Math.max(2, H * 0.012);
    let s = -1;
    for (let x = 0; x <= W; x++) {
      const o = x < W && d[(y * W + x) * 4 + 3] >= 128;
      if (o && s < 0) s = x;
      if (!o && s >= 0) { if (x - s >= minLen) out.push([s, x - 1]); s = -1; }
    }
    return out;
  };
  const ext = fy => { const r = runsAt(fy); return r.length ? [r[0][0], r[r.length - 1][1]] : [W * 0.3, W * 0.7]; };
  const ctr = fy => { const [l, r] = ext(fy); return (l + r) / 2; };
  const mid = r => (r[0] + r[1]) / 2;
  // 脖子：頭和肩膀之間最窄的那一列（Q 版頭大、脖子低；一般比例頭小、脖子高，都找得到）
  let neckF = 0.16, best = Infinity;
  for (let y = Math.round(H * 0.1); y <= Math.round(H * 0.48); y++) {
    let w = 0;
    for (const dy of [-1, 0, 1]) { const [l, r] = ext((y + dy) / H); w += r - l; }
    if (w < best) { best = w; neckF = y / H; }
  }
  // 脖子以下的身體長度 B，其他關節依身體的比例放（比例取自一般人體，Q 版也適用）
  const B = 1 - neckF, at = f => neckF + B * f;
  const J = {}, P = (x, fy) => ({ x, y: fy * H });
  J.head = P(ctr(0.02), 0.01); J.neck = P(ctr(neckF), neckF); J.pelvis = P(ctr(at(0.405)), at(0.405));
  if (kind === 'side') {
    J.shoulder = P(ctr(at(0.08)), at(0.08)); J.elbow = P(J.shoulder.x, at(0.24)); J.hand = P(J.shoulder.x, at(0.405));
    J.hip = P(J.pelvis.x, at(0.44)); J.knee = P(ctr(at(0.69)), at(0.69)); J.foot = P(ctr(at(0.94)), at(0.95));
  } else {
    const [l, r] = ext(at(0.07)), cx = (l + r) / 2, hw = (r - l) / 2;
    J.shoulderL = P(cx - hw * 0.6, at(0.07)); J.shoulderR = P(cx + hw * 0.6, at(0.07));
    // 手：在手的高度找最外側的一段（太細的是刀鞘、繩子，跳過），手的中心在外緣往內半個手寬
    const hy = at(0.405), hr = runsAt(hy).filter(rn => rn[1] - rn[0] + 1 >= H * 0.035), aw = H * 0.03;
    const hL = hr.length ? hr[0][0] + aw : l + hw * 0.15, hR = hr.length ? hr[hr.length - 1][1] - aw : r - hw * 0.15;
    J.handL = P(hL, hy); J.handR = P(hR, hy);
    J.elbowL = P((J.shoulderL.x + hL) / 2 - H * 0.01, at(0.24)); J.elbowR = P((J.shoulderR.x + hR) / 2 + H * 0.01, at(0.24));
    // 兩隻腳：取那一列最寬的兩段
    const two = fy => {
      const rr = runsAt(fy).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2).sort((a, b) => a[0] - b[0]);
      if (rr.length === 2) return [mid(rr[0]), mid(rr[1])];
      const [a, b] = ext(fy); return [a + (b - a) * 0.27, a + (b - a) * 0.73];
    };
    const ky = at(0.69), fy = at(0.94), kn = two(ky), ft = two(fy);
    J.kneeL = P(kn[0], ky); J.kneeR = P(kn[1], ky); J.footL = P(ft[0], at(0.95)); J.footR = P(ft[1], at(0.95));
    J.hipL = P(J.pelvis.x * 0.4 + kn[0] * 0.6, at(0.44)); J.hipR = P(J.pelvis.x * 0.4 + kn[1] * 0.6, at(0.44));
  }
  const n = {};
  for (const k in J) n[k] = { x: J[k].x / H, y: J[k].y / H };
  return n;
}
// 手腳粗細（半徑，像素）：從輪廓量
function rigAutoRadii(work, J, kind) {
  const W = work.width, H = work.height, d = work.data;
  const runAround = (x, y) => {
    x = clamp(Math.round(x), 0, W - 1); y = clamp(Math.round(y), 0, H - 1);
    const op = xx => d[(y * W + xx) * 4 + 3] >= 128;
    if (!op(x)) return 0;
    let l = x, r = x;
    while (l > 0 && op(l - 1)) l--;
    while (r < W - 1 && op(r + 1)) r++;
    return r - l + 1;
  };
  let leg, arm;
  if (kind === 'side') {
    leg = runAround(J.knee.x, J.knee.y) / 2 * 1.1;
    arm = H * 0.055;
  } else {
    leg = (runAround(J.kneeL.x, J.kneeL.y) + runAround(J.kneeR.x, J.kneeR.y)) / 4 * 1.15;
    const a = [runAround(J.handL.x, J.handL.y), runAround(J.handR.x, J.handR.y)].filter(v => v > 0 && v < H * 0.2);
    arm = a.length ? Math.max(...a) / 2 * 1.3 : H * 0.05;
  }
  return { leg: clamp(leg || H * 0.07, H * 0.035, H * 0.13), arm: clamp(arm, H * 0.03, H * 0.08) };
}

// ---------- Q 版頭身（像《歧路旅人》的 3～3.5 頭身） ----------
// 用關節把人物分成三段：頭（頭頂～脖子）、身體（脖子～腰）、腿（腰～腳底）。
// 頭放大，身體和腿縮短到指定的頭身比；手臂在身體那段裡，會跟著身體一起縮。
// 回傳新的圖（高度一樣是 RIG_HN）和換算後的關節。
function rigReproportion(work, Jn, s) {
  const W = work.width, H = work.height;
  const neckY = Jn.neck.y * H, pelvisY = Jn.pelvis.y * H, cx = Jn.neck.x * H;
  const h0 = Math.max(H * 0.05, neckY), torso0 = Math.max(1, pelvisY - neckY), legs0 = Math.max(1, H - pelvisY);
  const hs = s.chibiHead / 100, bw = s.chibiWidth / 100, legShare = s.chibiLegs / 100;
  const head1 = h0 * hs, total1 = head1 * Math.max(1.5, s.chibiHeads), body1 = Math.max(H * 0.05, total1 - head1);
  const ts = body1 * (1 - legShare) / torso0, ls = body1 * legShare / legs0;
  const f = H / total1, W2 = Math.ceil(W * Math.max(hs, bw) * f) + 4, cx2 = W2 / 2;
  // 原圖座標 → 新圖座標
  const mapY = y => y < neckY ? head1 - (neckY - y) * hs : y < pelvisY ? head1 + (y - neckY) * ts : head1 + torso0 * ts + (y - pelvisY) * ls;
  const map = (x, y) => ({ x: cx2 + (x - cx) * (y < neckY ? hs : bw) * f, y: mapY(y) * f });
  const src = toCanvas(work), c = document.createElement('canvas'); c.width = W2; c.height = H;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  const ov = H * 0.03; // 頭往下多畫一點，跟身體接起來不會有縫
  // 頭先畫，身體蓋在上面（脖子旁邊露出來的是放大後的頭髮）
  ctx.drawImage(src, 0, 0, W, neckY + ov, cx2 - cx * hs * f, (head1 - neckY * hs) * f, W * hs * f, (neckY + ov) * hs * f);
  ctx.drawImage(src, 0, neckY, W, torso0 + 1, cx2 - cx * bw * f, head1 * f, W * bw * f, (torso0 + 1) * ts * f);
  ctx.drawImage(src, 0, pelvisY, W, legs0, cx2 - cx * bw * f, (head1 + torso0 * ts) * f, W * bw * f, legs0 * ls * f);
  const out = {};
  for (const k in Jn) { const p = map(Jn[k].x * H, Jn[k].y * H); out[k] = { x: p.x / H, y: p.y / H }; }
  return { work: ctx.getImageData(0, 0, W2, H), joints: out };
}

// ---------- 切零件 ----------
function distSeg(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
  const t = L2 ? clamp(((px - a.x) * vx + (py - a.y) * vy) / L2, 0, 1) : 0;
  const dx = px - a.x - vx * t, dy = py - a.y - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}
const toCanvas = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); return c; };

// 被擋住或挖掉的地方，用周圍的顏色慢慢往內補
function inpaint(img, mask) {
  const W = img.width, H = img.height, d = img.data;
  let todo = [];
  for (let p = 0; p < W * H; p++) if (mask[p]) todo.push(p);
  for (let it = 0; it < 400 && todo.length; it++) {
    const done = [], rest = [];
    for (const p of todo) {
      const x = p % W, y = (p - x) / W;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (mask[q] || d[q * 4 + 3] < 128) continue;
        r += d[q * 4]; g += d[q * 4 + 1]; b += d[q * 4 + 2]; n++;
      }
      if (n) done.push([p, r / n, g / n, b / n]); else rest.push(p);
    }
    if (!done.length) break;
    for (const [p, r, g, b] of done) { d[p * 4] = r; d[p * 4 + 1] = g; d[p * 4 + 2] = b; d[p * 4 + 3] = 255; mask[p] = 0; }
    todo = rest;
  }
  for (const p of todo) d[p * 4 + 3] = 0;
}

// 建立骨架：J 是像素座標，R 是手腳半徑
// opt.fillArmTorso：側面時，手臂擋住的軀幹（肩到腰）一律補色（照片用：真人手臂常貼在身體後半部）
// opt.allLegs：髖部以下全部分給腿（照片用：寬褲管超出腿的寬度時，抬腳會在原地留下一截，看起來像多一條腿）
// 側面的關節有 hip2、knee2、foot2（遠的那條腿）時，兩條腿分開切；沒有的話遠的腿用近的腿複製、畫暗
function rigBuild(work, kind, J, R, opt = {}) {
  const W = work.width, H = work.height, d = work.data;
  const chains = kind === 'side' && J.knee2 ? { leg: RIG_LIMBS.side.leg, legB: ['hip2', 'knee2', 'foot2'], arm: RIG_LIMBS.side.arm } : RIG_LIMBS[kind];
  const limbs = Object.entries(chains);
  const parts = []; // [{ limb, seg: 'U'|'D' }]
  for (const [name] of limbs) parts.push({ limb: name, seg: 'U' }, { limb: name, seg: 'D' });
  const labels = new Int8Array(W * H).fill(-1); // -1 透明、0 身體、1.. 零件
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (d[p * 4 + 3] < 128) continue;
    let best = 0, bestD = Infinity;
    limbs.forEach(([name, [r0, m, e]], li) => {
      const isLeg = name.startsWith('leg'), rad = isLeg ? R.leg : R.arm;
      if (y < J[r0].y - rad * (isLeg ? 0.3 : 1)) return; // 腳不往上吃到身體、手不往上吃到頭
      const end = { x: J[e].x + (J[e].x - J[m].x) * 0.2, y: J[e].y + (J[e].y - J[m].y) * 0.2 };
      const du = distSeg(x, y, J[r0], J[m]), dl = distSeg(x, y, J[m], end), dd = Math.min(du, dl);
      if (dd <= rad && dd < bestD) { bestD = dd; best = 1 + li * 2 + (du <= dl ? 0 : 1); }
    });
    labels[p] = best;
  }
  if (opt.allLegs) {
    const legs = limbs.map((l, i) => [l, i]).filter(([[n]]) => n.startsWith('leg')), arms = limbs.map((l, i) => [l, i]).filter(([[n]]) => n.startsWith('arm'));
    const hipY = Math.min(...legs.map(([[, c]]) => J[c[0]].y)) + R.leg * 0.3;
    for (let y = Math.max(0, Math.ceil(hipY)); y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; if (labels[p] !== 0) continue;
      // 垂在大腿旁的手先給手
      let nearArm = false;
      for (const [[, [, m, e]]] of arms) if (distSeg(x, y, J[m], J[e]) < R.arm * 1.6) nearArm = true;
      if (nearArm) continue;
      let bd = Infinity, bl = 0;
      for (const [[, [r0, m, e]], li] of legs) {
        const du = distSeg(x, y, J[r0], J[m]), dl = distSeg(x, y, J[m], J[e]);
        if (Math.min(du, dl) < bd) { bd = Math.min(du, dl); bl = 1 + li * 2 + (du <= dl ? 0 : 1); }
      }
      labels[p] = bl;
    }
  }
  // 手指、鞋底等超出手腳寬度的邊緣：跟身體沒連在一起的碎塊，歸給最近的手腳（不然手腳動了它們會留在原地）
  {
    const reach = new Uint8Array(W * H), stack = [];
    const seed = pt => {
      const x0 = Math.round(pt.x), y0 = Math.round(pt.y);
      for (let r = 0; r < H * 0.08; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx, y = y0 + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const p = y * W + x; if (labels[p] === 0) { stack.push(p); reach[p] = 1; return; }
      }
    };
    seed(J.neck); seed(J.pelvis);
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p - x) / W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
        if (q >= 0 && !reach[q] && labels[q] === 0) { reach[q] = 1; stack.push(q); }
    }
    // 只處理小碎塊（手指、鞋底）；大塊的（例如刀鞘）還是留在身體上
    const maxPiece = H * H * 0.004;
    for (let p0 = 0; p0 < W * H; p0++) {
      if (labels[p0] !== 0 || reach[p0]) continue;
      const piece = [p0]; reach[p0] = 1;
      for (let i = 0; i < piece.length; i++) {
        const p = piece[i], x = p % W, y = (p - x) / W;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
          if (q >= 0 && !reach[q] && labels[q] === 0) { reach[q] = 1; piece.push(q); }
      }
      if (piece.length > maxPiece) continue;
      let sx = 0, sy = 0; for (const p of piece) { sx += p % W; sy += Math.floor(p / W); }
      const x = sx / piece.length, y = sy / piece.length;
      let bestD = Infinity, bl = 0;
      limbs.forEach(([, [r0, m, e]], li) => {
        const du = distSeg(x, y, J[r0], J[m]), dl = distSeg(x, y, J[m], J[e]);
        if (Math.min(du, dl) < bestD) { bestD = Math.min(du, dl); bl = 1 + li * 2 + (du <= dl ? 0 : 1); }
      });
      for (const p of piece) labels[p] = bl;
    }
  }
  // 身體：手腳拿掉後，左右都還有身體的地方（被手擋住的軀幹）補色，其他變透明
  const base = new ImageData(new Uint8ClampedArray(d), W, H), bd = base.data, fill = new Uint8Array(W * H);
  const reach = kind === 'side' ? H * 0.2 : H * 0.06;
  // 照片：大腿最上面一段也留在身體上，腳擺動時從它下面滑過，髖部才不會破洞
  const legTop = opt.allLegs ? Math.min(...limbs.filter(([n]) => n.startsWith('leg')).map(([, c]) => J[c[0]].y)) + R.leg : -1;
  for (let y = 0; y < H; y++) {
    const left = new Float32Array(W), right = new Float32Array(W);
    let last = -1e9;
    for (let x = 0; x < W; x++) { if (labels[y * W + x] === 0) last = x; left[x] = x - last; }
    last = 1e9;
    for (let x = W - 1; x >= 0; x--) { if (labels[y * W + x] === 0) last = x; right[x] = last - x; }
    for (let x = 0; x < W; x++) {
      const p = y * W + x; if (labels[p] <= 0) continue;
      const armTorso = opt.fillArmTorso && kind === 'side' && limbs[(labels[p] - 1) >> 1][0].startsWith('arm') && y >= J.shoulder.y && y <= J.pelvis.y;
      if (y < legTop && limbs[(labels[p] - 1) >> 1][0].startsWith('leg')) continue; // 保留原本的像素
      if ((left[x] <= reach && right[x] <= reach) || armTorso) fill[p] = 1; else bd[p * 4 + 3] = 0;
    }
  }
  inpaint(base, fill);
  // 每個零件一張圖；上下段在關節附近互相多留一點，彎曲時才不會有縫
  const partImgs = parts.map((pt, i) => {
    const id = i + 1, sib = pt.seg === 'U' ? id + 1 : id - 1, chain = chains[pt.limb];
    const jm = J[chain[1]], rad = pt.limb.startsWith('leg') ? R.leg : R.arm;
    const out = new ImageData(W, H), o = out.data;
    for (let p = 0; p < W * H; p++) {
      const l = labels[p];
      if (l !== id && !(l === sib && Math.hypot(p % W - jm.x, Math.floor(p / W) - jm.y) < rad * 0.9)) continue;
      o[p * 4] = d[p * 4]; o[p * 4 + 1] = d[p * 4 + 1]; o[p * 4 + 2] = d[p * 4 + 2]; o[p * 4 + 3] = d[p * 4 + 3];
    }
    return toCanvas(out);
  });
  const limbLen = name => { const [a, b, c] = chains[name]; return Math.hypot(J[b].x - J[a].x, J[b].y - J[a].y) + Math.hypot(J[c].x - J[b].x, J[c].y - J[b].y); };
  return { kind, W, H, J, R, labels, parts, base: toCanvas(base), partImgs, limbLen, chains, farLeg: chains.legB ? 'legB' : null };
}

// ---------- 擺姿勢 ----------
// 一個姿勢 = { up（身體往上幾像素）, lean（身體前後傾，弧度）, limbs: { 名稱: { a1, a2, dy, ldy, sy, weapon } } }
// 名稱後面加 Far 的是側面「遠的那隻」手或腳（同一個零件、畫暗一點、畫在身體後面）
const rigRad = v => v * Math.PI / 180;

// 走路、跑步共用：g = { leg, knee, arm, elbow（度）, lift, bob（%）, lean（度） }
function rigGaitPose(rig, phase, g) {
  const sn = Math.sin(phase), cs = Math.cos(phase), H = rig.H;
  const B = (g.bob / 100) * H * Math.abs(sn);
  const P = { up: 0, lean: 0, limbs: {} };
  if (rig.kind === 'side') {
    const L = rig.limbLen('leg'), A = rigRad(g.leg), K = rigRad(g.knee), AA = rigRad(g.arm), E = rigRad(g.elbow);
    // 往後移動的那隻腳踩在地上（支撐腳），身體高度跟著支撐腳的角度走
    const leg = ph => ({ a1: A * Math.cos(ph), bend: K * Math.max(0, -Math.sin(ph)), stance: Math.sin(ph) >= 0 });
    const near = leg(phase), far = leg(phase + Math.PI), st = near.stance ? near : far;
    const cosS = Math.cos(st.a1);
    P.up = B - L * (1 - cosS);
    P.lean = -rigRad(g.lean); // 朝左的角色：負的 = 往前傾
    const sy = 1 + B / (L * cosS);
    P.limbs.leg = { a1: near.a1, a2: -near.bend, sy: near.stance ? sy : 1 };
    P.limbs.legFar = { a1: far.a1, a2: -far.bend, sy: far.stance ? sy : 1 };
    // 手跟同一邊的腳反方向擺；手肘往前彎
    const arm = sign => { const a = sign * AA * cs; return { a1: a, a2: E + Math.max(0, a) * 0.6 }; };
    P.limbs.arm = arm(-1); P.limbs.armFar = arm(1);
  } else {
    // 正面／背面：輪流抬腳（膝蓋往前＝看起來變短），手小幅往外擺
    P.up = B;
    const lift = (g.lift / 100) * rig.limbLen('legL'), AA = rigRad(g.arm) * 0.3;
    for (const [name, amt] of [['legL', Math.max(0, sn)], ['legR', Math.max(0, -sn)]]) {
      const L = rig.limbLen(name), l = lift * amt;
      P.limbs[name] = l > 0.5 ? { dy: -l * 0.45, ldy: -l * 0.55 } : { sy: 1 + B / L };
    }
    P.limbs.armL = { a1: AA * Math.max(0, -sn) }; P.limbs.armR = { a1: -AA * Math.max(0, sn) };
  }
  return P;
}
const rigWalkGait = s => ({ leg: s.rigLeg, knee: s.rigKnee, arm: s.rigArm, elbow: 8, lift: s.rigLift, bob: s.rigBob, lean: 0 });
const rigRunGait = s => ({ leg: s.runLeg, knee: s.runKnee, arm: s.runArm, elbow: 55, lift: s.rigLift * 2.2, bob: s.runBob, lean: s.runLean });

// 待機呼吸：身體微微上下，手稍微張開
function rigIdlePose(rig, phase) {
  const b = (1 - Math.cos(phase)) / 2, up = rig.H * 0.012 * b, P = { up, lean: 0, limbs: {} };
  const legs = rig.kind === 'side' ? ['leg', 'legFar'] : ['legL', 'legR'];
  for (const n of legs) P.limbs[n] = { sy: 1 + up / rig.limbLen(n.replace('Far', '')) };
  if (rig.kind === 'side') { P.limbs.arm = { a1: rigRad(3) * b }; P.limbs.armFar = { a1: -rigRad(3) * b }; }
  else { P.limbs.armL = { a1: rigRad(3) * b }; P.limbs.armR = { a1: -rigRad(3) * b }; }
  return P;
}

// 揮刀攻擊的關鍵姿勢（t：0～1），中間的幀自動內插
// arm：[上臂角度, 手肘角度]；w：刀的方向（度，0 = 指向右、90 = 指向下）；up：身體高度（%）；lean：前後傾（度）
const RIG_ATK_KEYS = {
  // 側面（朝左）：拿刀的是靠近畫面的手，遠的手一起握（雙手持刀）
  side: [
    { t: 0, lean: 0, up: 0, arm: [35, 40], w: -150, legN: 6, legF: -6, trail: 0 },     // 架刀
    { t: 0.3, lean: 7, up: 0.5, arm: [165, 15], w: -60, legN: 10, legF: -8, trail: 0 }, // 舉刀過頭
    { t: 0.5, lean: -14, up: -1.5, arm: [95, 0], w: -185, legN: 22, legF: -18, trail: 1 }, // 揮下
    { t: 0.65, lean: -16, up: -2, arm: [40, -10], w: -240, legN: 22, legF: -18, trail: 1 }, // 收刀到底
    { t: 0.82, lean: -9, up: -1, arm: [35, 20], w: -210, legN: 16, legF: -12, trail: 0 },
    { t: 1, lean: 0, up: 0, arm: [35, 40], w: -150, legN: 6, legF: -6, trail: 0 },
  ],
  // 正面：拿刀的是畫面左邊的手（角色的右手）；背面左右相反
  front: [
    { t: 0, up: 0, arm: [10, -10], other: [5, 0], w: 115, trail: 0 },     // 架刀：刀斜放在外側
    { t: 0.3, up: 0.8, arm: [150, 10], other: [10, 0], w: 210, trail: 0 }, // 從左邊舉過頭
    { t: 0.5, up: -1.5, arm: [-35, -20], other: [8, 0], w: 420, trail: 1 }, // 從上面揮到右下
    { t: 0.65, up: -2, arm: [-45, -10], other: [8, 0], w: 440, trail: 1 },
    { t: 0.82, up: -1, arm: [-25, -10], other: [5, 0], w: 430, trail: 0 },
    { t: 1, up: 0, arm: [10, -10], other: [5, 0], w: 475, trail: 0 },     // = 115 + 360，回到架刀
  ],
};
function rigLerpKeys(keys, t) {
  t = ((t % 1) + 1) % 1;
  let i = 0; while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1], u = (t - a.t) / (b.t - a.t), e = u * u * (3 - 2 * u); // 頭尾放慢
  const mix = (x, y) => Array.isArray(x) ? x.map((v, j) => v + (y[j] - v) * e) : x + (y - x) * e;
  const out = {};
  for (const k in a) if (k !== 't') out[k] = mix(a[k], b[k]);
  return out;
}
function rigAttackPose(rig, t, dt, view, trailOn) {
  const k = rigLerpKeys(RIG_ATK_KEYS[rig.kind], t), prev = rigLerpKeys(RIG_ATK_KEYS[rig.kind], t - dt), H = rig.H;
  const trail = trailOn && k.trail > 0.5;
  const P = { up: (k.up / 100) * H, lean: 0, limbs: {} };
  if (rig.kind === 'side') {
    P.lean = rigRad(k.lean || 0);
    // 兩腳前後站開，身體跟著往下，腳底才會貼地
    const L = rig.limbLen('leg'), aN = rigRad(k.legN), aF = rigRad(k.legF);
    P.up -= L * (1 - Math.cos(Math.max(Math.abs(aN), Math.abs(aF))));
    const sy = a => (L + P.up) / (L * Math.cos(a));
    P.limbs.leg = { a1: aN, sy: sy(aN) }; P.limbs.legFar = { a1: aF, sy: sy(aF) };
    const a1 = rigRad(k.arm[0]), a2 = rigRad(k.arm[1]);
    P.limbs.arm = { a1, a2, weapon: { angle: rigRad(k.w), trailFrom: trail ? rigRad(prev.w) : null } };
    P.limbs.armFar = { a1: a1 - rigRad(6), a2 };
  } else {
    const back = view === 'back', sg = back ? -1 : 1, wa = d => rigRad(back ? 180 - d : d);
    const held = back ? 'armR' : 'armL', other = back ? 'armL' : 'armR', angle = wa(k.w);
    // 背面看時，刀在身體前面的時候會被身體擋住
    P.limbs[held] = { a1: sg * rigRad(k.arm[0]), a2: sg * rigRad(k.arm[1]),
      weapon: { angle, trailFrom: trail ? wa(prev.w) : null, behind: back && Math.sin(angle) > -0.3 } };
    P.limbs[other] = { a1: -sg * rigRad(k.other[0]), a2: -sg * rigRad(k.other[1]) };
    for (const n of ['legL', 'legR']) P.limbs[n] = { sy: 1 + P.up / rig.limbLen(n) };
  }
  return P;
}

// 受傷：被打到往後仰、手往外甩，然後慢慢恢復（a = 1 → 0）
function rigHurtPose(rig, a) {
  const P = { up: 0, lean: 0, limbs: {} };
  if (rig.kind === 'side') {
    P.lean = rigRad(16) * a; // 正的 = 往後仰
    const L = rig.limbLen('leg'), al = rigRad(10) * a;
    P.up = -L * (1 - Math.cos(al));
    P.limbs.leg = { a1: al }; P.limbs.legFar = { a1: -al };
    P.limbs.arm = { a1: -rigRad(35) * a, a2: rigRad(20) * a }; P.limbs.armFar = { a1: rigRad(30) * a, a2: rigRad(20) * a };
  } else {
    P.up = -rig.H * 0.02 * a;
    for (const n of ['legL', 'legR']) P.limbs[n] = { sy: 1 + P.up / rig.limbLen(n) };
    P.limbs.armL = { a1: rigRad(30) * a, a2: rigRad(15) * a }; P.limbs.armR = { a1: -rigRad(30) * a, a2: -rigRad(15) * a };
  }
  return P;
}
// 倒下：受傷 → 膝蓋一軟 → 往後倒 → 躺在地上。fall = 整個人轉幾度（0～90）
function rigDeadPose(rig, f, n) {
  const t = n > 1 ? f / (n - 1) : 1;
  if (t < 0.25) return rigHurtPose(rig, 1);
  const P = { up: 0, lean: 0, limbs: {}, fall: 0 };
  const sink = t < 0.6 ? (t - 0.25) / 0.35 : 1;
  if (rig.kind === 'side') {
    P.lean = -rigRad(18) * sink;
    P.limbs.arm = { a1: rigRad(15) * sink, a2: rigRad(25) * sink }; P.limbs.armFar = { a1: rigRad(10) * sink };
  } else {
    P.limbs.armL = { a1: rigRad(12) * sink }; P.limbs.armR = { a1: -rigRad(12) * sink };
  }
  P.up = -rig.H * 0.08 * sink;
  for (const k of rig.kind === 'side' ? ['leg', 'legFar'] : ['legL', 'legR'])
    P.limbs[k] = Object.assign(P.limbs[k] || {}, { sy: 1 + P.up / rig.limbLen(k.replace('Far', '')) });
  if (t >= 0.6) P.fall = rigRad(90) * Math.min(1, (t - 0.6) / 0.4 + 0.35);
  return P;
}

// ---------- 弓箭 ----------
// 拉弓射箭的關鍵姿勢：bowArm 拿弓的手、pullArm 拉弦的手（[上臂, 手肘] 度）；aim 箭飛的方向（度，180 = 往左）；draw 拉弦程度 0～1
const RIG_BOW_KEYS = {
  // 側面（朝左）：近的手拿弓往前伸直，遠的手（畫暗）把弦拉到下巴
  side: [
    // reach：拿弓的手伸長幾倍（Q 版手很短，不伸長的話弓會擋在臉前面）
    { t: 0, lean: 0, bowArm: [30, 0], pullArm: [15, 20], aim: 155, draw: 0, arrow: 0, reach: 1 },        // 弓垂在前面
    { t: 0.25, lean: 0, bowArm: [88, 0], pullArm: [-60, -150], aim: 180, draw: 0.3, arrow: 1, reach: 1.5 }, // 舉弓搭箭
    { t: 0.5, lean: 4, bowArm: [90, 0], pullArm: [-80, -170], aim: 180, draw: 1, arrow: 1, reach: 1.65 },  // 拉滿
    { t: 0.62, lean: 2, bowArm: [90, 0], pullArm: [-100, -40], aim: 180, draw: 0, arrow: 0, reach: 1.65 }, // 放箭：弦彈回、手往後甩
    { t: 0.8, lean: 0, bowArm: [80, 0], pullArm: [-50, -40], aim: 175, draw: 0, arrow: 0, reach: 1.4 },
    { t: 1, lean: 0, bowArm: [30, 0], pullArm: [15, 20], aim: 155, draw: 0, arrow: 0, reach: 1 },
  ],
  // 正面：畫面左邊的手把弓舉在身體外側（弓直立，對著畫面外射），另一隻手在胸前把弦往身體中間拉；背面左右相反
  front: [
    { t: 0, bowArm: [8, -5], pullArm: [5, 0], draw: 0 },
    { t: 0.25, bowArm: [35, -25], pullArm: [30, 70], draw: 0.4 },
    { t: 0.5, bowArm: [42, -30], pullArm: [40, 100], draw: 1 },
    { t: 0.62, bowArm: [42, -30], pullArm: [20, 30], draw: 0 },
    { t: 0.8, bowArm: [30, -20], pullArm: [10, 10], draw: 0 },
    { t: 1, bowArm: [8, -5], pullArm: [5, 0], draw: 0 },
  ],
};
function rigBowPose(rig, t, view) {
  const k = rigLerpKeys(RIG_BOW_KEYS[rig.kind], t), P = { up: 0, lean: 0, limbs: {} };
  if (rig.kind === 'side') {
    P.lean = rigRad(k.lean || 0);
    const L = rig.limbLen('leg'), a = rigRad(8);
    P.up = -L * (1 - Math.cos(a));
    P.limbs.leg = { a1: a }; P.limbs.legFar = { a1: -a };
    P.limbs.arm = { a1: rigRad(k.bowArm[0]), a2: rigRad(k.bowArm[1]), sy: k.reach || 1 };
    P.limbs.armFar = { a1: rigRad(k.pullArm[0]), a2: rigRad(k.pullArm[1]) };
    P.bow = { hand: 'arm', pull: 'armFar', angle: rigRad(k.aim), draw: k.draw, arrow: k.arrow > 0.5 };
  } else {
    const back = view === 'back', sg = back ? -1 : 1, bowH = back ? 'armR' : 'armL', pullH = back ? 'armL' : 'armR';
    P.limbs[bowH] = { a1: sg * rigRad(k.bowArm[0]), a2: sg * rigRad(k.bowArm[1]) };
    P.limbs[pullH] = { a1: sg * rigRad(k.pullArm[0]), a2: sg * rigRad(k.pullArm[1]) };
    P.bow = { hand: bowH, pull: pullH, angle: back ? 0 : Math.PI, draw: k.draw * 0.6, arrow: false, behind: false };
  }
  return P;
}
// 弓：直立、不畫弦。整理成「弦在右邊、往左射」的方向，量出上下兩端（掛弦的地方）和握把
// lineW：縮小後大約 1 像素寬的線，在高解析度要多粗（弦、太細的弓身要至少這麼粗，縮小後才看得到）
function rigBowPrep(view, HN, s, lineW) {
  let img = crop(view.img, view.box.x, view.box.y, view.box.w, view.box.h);
  const scan = im => {
    const W = im.width, H = im.height, d = im.data, rowX = y => { let sx = 0, n = 0; for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) { sx += x; n++; } return n ? sx / n : W / 2; };
    let gx = 0; for (let y = Math.round(H * 0.45); y <= Math.round(H * 0.55); y++) gx += rowX(y); gx /= Math.round(H * 0.55) - Math.round(H * 0.45) + 1;
    return { gx, tx: (rowX(1) + rowX(H - 2)) / 2 };
  };
  let m = scan(img);
  if (m.tx < m.gx) { img = mirror(img); m = scan(img); } // 弓背朝左（弦在左）的圖翻過來
  const len = Math.max(16, Math.round(HN * s.bowLen / 100)), k = len / img.height;
  // 弓身太細的話橫向加粗
  let thick = 0; { const y = Math.round(img.height * 0.25), d = img.data; for (let x = 0; x < img.width; x++) if (d[(y * img.width + x) * 4 + 3] > 128) thick++; }
  const sx = Math.max(1, (lineW * 1.3) / Math.max(1, thick * k));
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(img.width * k * sx)); c.height = len;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(toCanvas(img), 0, 0, c.width, len);
  const d = ctx.getImageData(0, 0, c.width, len).data, W = c.width;
  const endAt = y0 => { // 從上（或下）往內找第一列有東西的地方
    const step = y0 === 0 ? 1 : -1;
    for (let y = y0; y >= 0 && y < len; y += step) { let sx2 = 0, n = 0; for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) { sx2 += x; n++; } if (n) return { x: sx2 / n, y }; }
    return { x: W / 2, y: y0 };
  };
  return { canvas: c, gx: m.gx * k * sx, gy: len / 2, top: endAt(0), bot: endAt(len - 1) };
}
// 箭：水平、箭頭在右。長度依設定，箭桿太細的話加粗
function rigArrowPrep(view, HN, s, lineW) {
  const img = crop(view.img, view.box.x, view.box.y, view.box.w, view.box.h);
  const len = Math.max(16, Math.round(HN * s.arrowLen / 100)), k = len / img.width;
  let thick = 0; { const x = Math.round(img.width * 0.5), d = img.data; for (let y = 0; y < img.height; y++) if (d[(y * img.width + x) * 4 + 3] > 128) thick++; }
  const sy = Math.max(1, (lineW * 1.1) / Math.max(1, thick * k));
  const c = document.createElement('canvas'); c.width = len; c.height = Math.max(2, Math.round(img.height * k * sy));
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(toCanvas(img), 0, 0, len, c.height);
  return { canvas: c, cy: c.height / 2 };
}

// 武器：裁掉空白、縮放到指定長度，找出握把位置
function rigWeaponPrep(view, HN, s) {
  let img = crop(view.img, view.box.x, view.box.y, view.box.w, view.box.h);
  if (s.weaponFlip) img = mirror(img);
  const len = Math.max(8, Math.round(HN * s.weaponLen / 100)), h = Math.max(1, Math.round(img.height * len / img.width));
  const c = document.createElement('canvas'); c.width = len; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(toCanvas(img), 0, 0, len, h);
  const d = ctx.getImageData(0, 0, len, h).data, gx = clamp(Math.round(len * s.weaponGrip / 100), 0, len - 1);
  let sy = 0, n = 0;
  for (let y = 0; y < h; y++) if (d[(y * len + gx) * 4 + 3] > 128) { sy += y; n++; }
  return { canvas: c, gx, gy: n ? sy / n : h / 2, reach: len - gx };
}

// 畫出一幀（高解析度）。mx、my 是四周留的空間
function rigRender(rig, pose, mx, my) {
  const c = document.createElement('canvas'); c.width = rig.W + mx * 2; c.height = rig.H + my * 2;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  const J = rig.J, chains = rig.chains || RIG_LIMBS[rig.kind], up = pose.up || 0, lean = pose.lean || 0, pv = J.pelvis;
  // 身體（含頭、手）以腰為中心前後傾；腳不跟著傾
  const bodyT = () => { ctx.translate(mx, my - up); ctx.translate(pv.x, pv.y); ctx.rotate(lean); ctx.translate(-pv.x, -pv.y); };
  const drawWeapon = (lp, name) => {
    const wp = lp.weapon, wd = rig.weapon; if (!wp || !wd) return;
    const E = J[chains[name][2]], base = lean + (lp.a1 || 0) + (lp.a2 || 0);
    ctx.save(); ctx.translate(E.x, E.y);
    if (wp.trailFrom != null && Math.abs(wp.trailFrom - wp.angle) >= rigRad(40)) { // 刀光：上一幀到這一幀刀掃過的扇形（掃得夠大才畫）
      const a1 = wp.angle - base, R1 = wd.reach, lim = rigRad(110);
      const a0 = a1 + clamp(wp.trailFrom - wp.angle, -lim, lim), ccw = a1 < a0; // 刀光最長 110 度，不會變成整圈
      ctx.beginPath(); ctx.arc(0, 0, R1 * 1.02, a0, a1, ccw); ctx.arc(0, 0, R1 * 0.8, a1, a0, !ccw); ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
    }
    ctx.rotate(wp.angle - base); ctx.drawImage(wd.canvas, -wd.gx, -wd.gy);
    ctx.restore();
  };
  // mode：'all' 畫整隻手腳；'weapon' 只畫武器（武器在身體後面時先畫）
  const drawLimb = (key, mode = 'all') => {
    const realFar = key === 'legFar' && rig.farLeg, lp = pose.limbs[key] || {}, name = realFar ? rig.farLeg : key.replace('Far', ''), i = Object.keys(chains).indexOf(name), far = key.endsWith('Far');
    const [r0, m] = chains[name], R0 = J[r0], M = J[m], wpOk = !far && lp.weapon && (mode === 'weapon') === !!lp.weapon.behind;
    if (mode === 'weapon' && !wpOk) return;
    ctx.save();
    if (far) ctx.filter = realFar ? 'brightness(0.9)' : 'brightness(0.72)';
    if (name.startsWith('arm')) bodyT(); else ctx.translate(mx, my - up);
    ctx.translate(R0.x, R0.y + (lp.dy || 0)); ctx.rotate(lp.a1 || 0); ctx.scale(1, lp.sy || 1); ctx.translate(-R0.x, -R0.y);
    ctx.save();
    ctx.translate(M.x, M.y + (lp.ldy || 0)); ctx.rotate(lp.a2 || 0); ctx.translate(-M.x, -M.y);
    if (mode === 'all') ctx.drawImage(rig.partImgs[i * 2 + 1], 0, 0); // 下段
    if (wpOk) drawWeapon(lp, name);
    ctx.restore();
    if (mode === 'all') ctx.drawImage(rig.partImgs[i * 2], 0, 0); // 上段
    ctx.restore();
  };
  const drawBase = () => { ctx.save(); bodyT(); ctx.drawImage(rig.base, 0, 0); ctx.restore(); };
  // 手在畫面上的位置：用跟 drawLimb 一樣的順序算變換矩陣（弓、弦、箭要接在手上）
  const deg = r => r * 180 / Math.PI;
  const handAt = key => {
    const lp = pose.limbs[key] || {}, name = key === 'legFar' && rig.farLeg ? rig.farLeg : key.replace('Far', ''), [r0, m, e] = chains[name], R0 = J[r0], M = J[m], E = J[e];
    let u = new DOMMatrix().translate(mx, my - up);
    if (name.startsWith('arm')) u = u.translate(pv.x, pv.y).rotate(deg(lean)).translate(-pv.x, -pv.y);
    u = u.translate(R0.x, R0.y + (lp.dy || 0)).rotate(deg(lp.a1 || 0)).scale(1, lp.sy || 1).translate(-R0.x, -R0.y);
    const l = u.translate(M.x, M.y + (lp.ldy || 0)).rotate(deg(lp.a2 || 0)).translate(-M.x, -M.y);
    return l.transformPoint(new DOMPoint(E.x, E.y));
  };
  // 弓、弦、箭畫在另一張圖（acc）：它們很細，縮小時要用「保留細線」的方式，不然會被吃掉
  let acc = null, actx = null;
  const drawBow = () => {
    const b = pose.bow, bd = rig.bow; if (!b || !bd) return;
    acc = document.createElement('canvas'); acc.width = c.width; acc.height = c.height;
    actx = acc.getContext('2d'); actx.imageSmoothingQuality = 'high';
    const ctx = actx;
    const hp = handAt(b.hand);
    const bm = new DOMMatrix().translate(hp.x, hp.y).rotate(deg(b.angle - Math.PI)).translate(-bd.gx, -bd.gy);
    ctx.save(); ctx.setTransform(bm); ctx.drawImage(bd.canvas, 0, 0); ctx.restore();
    const top = bm.transformPoint(new DOMPoint(bd.top.x, bd.top.y)), bot = bm.transformPoint(new DOMPoint(bd.bot.x, bd.bot.y));
    const grip = bm.transformPoint(new DOMPoint(bd.gx, bd.gy));
    // 弦：沒拉時是直線；拉的時候中間跟著拉弦的手走
    let nock = { x: (top.x + bot.x) / 2, y: (top.y + bot.y) / 2 };
    if (b.draw > 0.02 && b.pull) { const ph = handAt(b.pull); nock = { x: nock.x + (ph.x - nock.x) * b.draw, y: nock.y + (ph.y - nock.y) * b.draw }; }
    ctx.save(); ctx.strokeStyle = '#efe7cf'; ctx.lineWidth = rig.lineW || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(nock.x, nock.y); ctx.lineTo(bot.x, bot.y); ctx.stroke(); ctx.restore();
    // 箭：箭尾搭在弦上，指向握把
    const ad = rig.arrow;
    if (b.arrow && ad) {
      const ang = Math.atan2(grip.y - nock.y, grip.x - nock.x);
      ctx.save(); ctx.setTransform(new DOMMatrix().translate(nock.x, nock.y).rotate(deg(ang)).translate(0, -ad.cy)); ctx.drawImage(ad.canvas, 0, 0); ctx.restore();
    }
  };
  if (rig.kind === 'side') { drawLimb('armFar'); drawLimb('legFar'); drawLimb('leg'); drawBase(); drawLimb('arm'); }
  else { drawLimb('legL'); drawLimb('legR'); drawLimb('armL', 'weapon'); drawLimb('armR', 'weapon'); drawBase(); drawLimb('armL'); drawLimb('armR'); }
  drawBow();
  if (pose.fall) return rigFall(c, pose.fall, mx + rig.W / 2, my + rig.H);
  const out = ctx.getImageData(0, 0, c.width, c.height);
  if (acc) { out.acc = actx.getImageData(0, 0, c.width, c.height); out.accBehind = !!pose.bow.behind; }
  return out;
}
// 整個人以腳底為中心轉 angle（往後倒），轉完再擺回地面、左右置中
function rigFall(src, angle, cx, ground) {
  const W = src.width, H = src.height, t = document.createElement('canvas'); t.width = W; t.height = H;
  const x = t.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.translate(cx, ground); x.rotate(angle); x.translate(-cx, -ground); x.drawImage(src, 0, 0);
  const tmp = x.getImageData(0, 0, W, H), b = bbox(tmp, 128);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  if (b) out.getContext('2d').drawImage(t, Math.round(cx - (b.x + b.w / 2)), Math.round(ground - (b.y + b.h)));
  return out.getContext('2d').getImageData(0, 0, W, H);
}

// 從大圖切出一塊（超出範圍的地方是透明）
function rigRegion(src, rx, ry, rw, rh) {
  const out = new ImageData(rw, rh), W = src.width, H = src.height;
  for (let y = 0; y < rh; y++) {
    const sy = ry + y; if (sy < 0 || sy >= H) continue;
    const x0 = Math.max(0, -rx), x1 = Math.min(rw, W - rx); if (x1 <= x0) continue;
    out.data.set(src.data.subarray((sy * W + rx + x0) * 4, (sy * W + rx + x1) * 4), (y * rw + x0) * 4);
  }
  return out;
}

// ---------- 產生整套精靈圖 ----------
// joints：{ front, side, back } 各角度的關節（以人物高度為 1 的座標）；沒給的會自動偵測
// 回傳的 actions：每個動作一張精靈圖（直欄 = 方向：下、上、左、右；橫列 = 幀）
const rigCache = new Map();
function generateRigSprite(images, s, joints, ver) {
  const prep = prepViews(images, s);
  if (!prep.views) return { warn: prep.warn };
  const warn = prep.warn.slice(), views = prep.views;
  if (s.dirCount === '8') warn.push('骨架模式目前只做 4 方向（下、上、左、右），斜向之後再做。');
  const W = clamp(s.w | 0, 8, 256), H = clamp(s.h | 0, 8, 256), ol = s.outline === 'outer' ? 1 : 0;
  const HN = RIG_HN;
  const marg = a => a.big ? [Math.round(HN * 0.9), Math.round(HN * 0.6)] : [Math.round(HN * 0.4), Math.round(HN * 0.12)]; // 四周留的空間：攻擊要放得下刀
  const TAU = Math.PI * 2, nOf = (v, d) => clamp(Number(v) || d, 1, 12);
  // 武器種類：直立的長條 = 弓，橫的 = 刀（也可以在設定裡指定）
  const wv = views.weapon, isBow = !!wv && (s.weaponType === 'bow' || (s.weaponType !== 'sword' && wv.box.h > wv.box.w * 1.5));
  const lineW = Math.max(1.5, HN * 1.05 / Math.max(4, H - ol * 2)); // 縮小後約 1 像素寬
  const weapon = wv && !isBow ? rigWeaponPrep(wv, HN, s) : null;
  const bow = isBow ? rigBowPrep(wv, HN, s, lineW) : null;
  const arrow = isBow && views.ammo ? rigArrowPrep(views.ammo, HN, s, lineW) : null;
  // 要產生的動作
  const acts = [{ id: 'walk', label: '走路', name: 'Walk', N: nOf(s.rigFrames, 4), pose: (rig, f, n) => rigGaitPose(rig, TAU * f / n, rigWalkGait(s)) }];
  acts.push({ id: 'idle', label: '待機', name: 'Idle', N: nOf(s.idleFrames, 1), pose: (rig, f, n) => n > 1 ? rigIdlePose(rig, TAU * f / n) : { up: 0, lean: 0, limbs: {} } });
  if (s.actRun) acts.push({ id: 'run', label: '跑步', name: 'Run', N: nOf(s.runFrames, 6), pose: (rig, f, n) => rigGaitPose(rig, TAU * f / n, rigRunGait(s)) });
  if (s.actAtk && isBow) {
    acts.push({ id: 'attack', label: '拉弓射箭', name: 'Attack', N: nOf(s.atkFrames, 6), big: true, pose: (rig, f, n, view) => rigBowPose(rig, f / n, view) });
    if (!arrow) warn.push('沒有放箭的圖，拉弓時不會搭箭。在「箭」格子放一張箭的圖（水平、箭頭在右）。');
  } else if (s.actAtk) {
    acts.push({ id: 'attack', label: '揮刀攻擊', name: 'Attack', N: nOf(s.atkFrames, 6), big: true, pose: (rig, f, n, view) => rigAttackPose(rig, f / n, 1 / n, view, s.atkTrail) });
    if (!weapon) warn.push('沒有放武器圖，攻擊動畫只會揮手、沒有刀。在「武器」格子放一張刀的圖（刀水平放、刀柄在左），或弓的圖（直立、不畫弦）。');
  }
  if (s.actHit) acts.push({ id: 'hit', label: '受傷', name: 'Hit', N: 3, big: true, pose: (rig, f, n) => rigHurtPose(rig, 1 - f / n) });
  if (s.actDead) acts.push({ id: 'dead', label: '倒下', name: 'Dead', N: 4, big: true, pose: (rig, f, n) => rigDeadPose(rig, f, n) });
  const out = {}, info = {};
  for (const id of ['front', 'back', 'side']) {
    const kind = rigKind(id);
    let work = normView(views[id], HN);
    if (id === 'side' && s.sideFacing === 'right') work = mirror(work); // 計算時一律用朝左的側面
    const Jn = (joints && joints[id]) || rigAutoJoints(work, kind);
    // Q 版：先把原圖改成 Q 版比例，之後都在新的圖上做
    const rp = s.chibiOn ? rigReproportion(work, Jn, s) : { work, joints: Jn };
    const rwork = rp.work;
    // 一般關節 + 額外的（照片側面的第二條腿 hip2、knee2、foot2）
    const J = {}; for (const k of new Set([...RIG_JOINTS[kind], ...Object.keys(rp.joints)])) J[k] = { x: rp.joints[k].x * HN, y: rp.joints[k].y * HN };
    const R0 = rigAutoRadii(rwork, J, kind), R = { leg: R0.leg * s.rigLegW / 100, arm: R0.arm * s.rigArmW / 100 };
    const key = JSON.stringify([ver, id, Jn, R, s.bgMode, s.bgManual, s.bgTol, s.bgFlood, s.sideFacing, rwork.width,
      s.chibiOn && [s.chibiHeads, s.chibiHead, s.chibiLegs, s.chibiWidth]]);
    let rig = ver != null && rigCache.get(id);
    if (!rig || rig.key !== key) { rig = rigBuild(rwork, kind, J, R, { fillArmTorso: !!s.photo, allLegs: !!s.photo }); rig.key = key; if (ver != null) rigCache.set(id, rig); }
    rig.weapon = weapon; rig.bow = bow; rig.arrow = arrow; rig.lineW = lineW;
    const o = out[id] = { rig, acts: {} };
    // 第一輪只量每一幀的範圍（不留圖，省記憶體；手機上幾十張大圖會撐爆）
    for (const a of acts) {
      const poses = []; for (let f = 0; f < a.N; f++) poses.push(a.pose(rig, f, a.N, id));
      const [mx, my] = marg(a), A = o.acts[a.id] = { poses, mx, my, cx: mx + rwork.width / 2, bottom: my + HN, boxes: [] };
      for (const p of poses) {
        const f = rigRender(rig, p, mx, my);
        let b = bbox(f, 128); const ba = f.acc && bbox(f.acc, 60);
        if (ba) b = b ? unionBox(b, ba) : ba;
        A.boxes.push(b);
      }
    }
    // 關節點一律在原圖上編輯；Q 版時分區顏色是在變形後的圖上算的，對不上原圖，所以不給
    info[id] = { work, joints: Jn, J, R, labels: s.chibiOn ? null : rig.labels, kind };
  }
  // 縮放比例：每個角度縮到一樣高；走路、待機、跑步有任何一幀太寬，全部一起縮小（攻擊另外用比較大的格子）
  const innerW = W - ol * 2, innerH = H - ol * 2, headroom = 1 + Math.max(s.rigBob, s.actRun ? s.runBob : 0) / 100 + 0.02;
  let k = innerH / (HN * headroom);
  for (const id in out) for (const a of acts) if (!a.big) {
    const A = out[id].acts[a.id];
    for (const b of A.boxes) if (b) k = Math.min(k, innerW / 2 / Math.max(1, A.cx - b.x, b.x + b.w - A.cx));
  }
  // 每個動作的格子大小：攻擊的刀會伸出去，格子放大到裝得下（腳底位置不變）
  for (const a of acts) {
    a.W = W; a.H = H;
    if (!a.big) continue;
    let half = 0, top = 0;
    for (const id in out) { const o = out[id].acts[a.id]; for (const b of o.boxes) if (b) { half = Math.max(half, o.cx - b.x, b.x + b.w - o.cx); top = Math.max(top, o.bottom - b.y); } }
    a.W = Math.max(W, 2 * Math.ceil(half * k + ol + 0.5)); a.H = Math.max(H, Math.ceil(top * k + ol * 2 + 0.5));
  }
  // 照片模式：不做像素畫，直接平滑縮小；q = 輸出解析度倍率（2 = 格子大小的 2 倍，手機上才清楚）
  const photo = !!s.photo, q = photo ? (s.photoQ || 2) : 1;
  const smooth = (src, rx, ry, rw, rh, CW, CH) => {
    const t = document.createElement('canvas'); t.width = rw; t.height = rh; t.getContext('2d').putImageData(rigRegion(src, rx, ry, rw, rh), 0, 0);
    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(t, 0, 0, CW, CH);
    return x.getImageData(0, 0, CW, CH);
  };
  const pix = (img, o, CW, CH) => {
    const rw = Math.round(CW / k), rh = Math.round(CH / k);
    const rx = Math.round(o.cx - rw / 2), ry = Math.round(o.bottom - (CH - ol) / k);
    if (photo) {
      const px = smooth(img, rx, ry, rw, rh, CW * q, CH * q);
      if (img.acc) { // 照片模式的弓、弦、箭：直接疊上去
        const ap = smooth(img.acc, rx, ry, rw, rh, CW * q, CH * q), d = px.data, a = ap.data;
        for (let i = 0; i < d.length; i += 4) {
          const al = a[i + 3] / 255; if (!al || (img.accBehind && d[i + 3] > 128)) continue;
          for (let c = 0; c < 3; c++) d[i + c] = a[i + c] * al + d[i + c] * (1 - al);
          d[i + 3] = Math.max(d[i + 3], a[i + 3]);
        }
      }
      return px;
    }
    const g = { W: CW, H: CH, rx: 0, ry: 0, rw, rh, dx: 0, dy: 0, dw: CW, dh: CH };
    const px = resample(rigRegion(img, rx, ry, rw, rh), g, s.resample);
    thresholdAlpha(px, 128);
    if (img.acc) {
      // 細線那一層：區塊裡只要有一點點（約 15%）就畫出來，然後疊在人物上面（在身體後面的只補在空的地方）
      const ap = resample(rigRegion(img.acc, rx, ry, rw, rh), g, 'mode'), d = px.data, a = ap.data;
      thresholdAlpha(ap, 40);
      for (let i = 0; i < d.length; i += 4) {
        if (!a[i + 3] || (img.accBehind && d[i + 3])) continue;
        d[i] = a[i]; d[i + 1] = a[i + 1]; d[i + 2] = a[i + 2]; d[i + 3] = 255;
      }
    }
    return px;
  };
  // 第二輪：一幀一幀畫、馬上縮小。像素畫時身體上下移動對齊到整數像素（不然盔甲花紋每一幀都會跳動）
  const sp = {}; // sp[動作][角度] = 幀
  for (const a of acts) {
    sp[a.id] = {};
    for (const id in out) {
      const o = out[id], A = o.acts[a.id];
      sp[a.id][id] = A.poses.map(p => {
        const pp = photo ? p : Object.assign({}, p, { up: Math.round(p.up * k) / k });
        return pix(rigRender(o.rig, pp, A.mx, A.my), A, a.W, a.H);
      });
    }
  }
  // 遊戲裡射出去的箭：用同樣的縮放比例縮小
  let projectile = null;
  if (arrow) {
    const src = arrow.canvas.getContext('2d').getImageData(0, 0, arrow.canvas.width, arrow.canvas.height);
    const pw = Math.max(4, Math.round(src.width * k)), ph = Math.max(3, Math.round(src.height * k));
    projectile = resample(src, { W: pw, H: ph, rx: 0, ry: 0, rw: src.width, rh: src.height, dx: 0, dy: 0, dw: pw, dh: ph }, 'mode');
    thresholdAlpha(projectile, 40); // 箭桿很細，用「保留細線」的門檻
  }
  const all = acts.flatMap(a => Object.values(sp[a.id]).flat()).concat(projectile ? [projectile] : []);
  // 照片模式不減色、不加外框，保留照片原本的樣子
  const pal = photo ? null : choosePalette(countColors(all), s);
  if (pal) all.forEach(o => applyPalette(o, pal, s));
  if (!photo && (s.cleanFloat || s.cleanSpeck)) all.forEach(o => cleanup(o, s));
  const finish = f => { const c = cloneImg(f); if (!photo && s.outline !== 'none') outline(c, s); return c; };
  // 射出去的箭也加外框（箭桿跟泥土地的顏色很像，沒外框會看不到）；四周先留 1 像素放外框
  if (projectile && s.outline !== 'none') {
    const p2 = new ImageData(projectile.width + 2, projectile.height + 2);
    for (let y = 0; y < projectile.height; y++) p2.data.set(projectile.data.subarray(y * projectile.width * 4, (y + 1) * projectile.width * 4), ((y + 1) * p2.width + 1) * 4);
    outline(p2, Object.assign({}, s, { outline: 'outer' }));
    projectile = p2;
  }
  // 側面在計算時已統一朝左：左 = 原樣，右 = 鏡像
  const actions = acts.map(a => {
    const v = sp[a.id], dirs = [v.front, v.back, v.side, v.side.map(mirror)].map(fr => fr.map(finish)), order = [];
    for (let f = 0; f < a.N; f++) for (let d = 0; d < 4; d++) order.push(dirs[d][f]);
    return { id: a.id, label: a.label, name: a.name, W: a.W * q, H: a.H * q, N: a.N, dirs, sheet: compose(order, 4, a.N, a.W * q, a.H * q),
      ox: a.W * q / 2, oy: (a.H - ol) * q };
  });
  const walk = actions[0], idle = actions[1];
  return {
    W: W * q, H: H * q, q, photo, cols: 4, frames: walk.N, walk: walk.dirs, idle: idle.dirs.map(fr => fr[0]), actions, warn, rig: info,
    base: { sprites: { front: sp.idle.front[0], back: sp.idle.back[0], side: sp.idle.side[0] }, pal, synth: {} },
    walkSheet: walk.sheet, idleSheet: idle.sheet, projectile, weaponKind: isBow ? 'bow' : weapon ? 'sword' : null,
  };
}
