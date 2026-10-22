'use strict';
// =====================================================
//  遊戲首頁：動態背景（45 度青葉之原、奔跑的忍者、妖怪、落葉）
//  點滑鼠、按任意鍵或觸碰 → 淡出，進入人物選擇畫面
// =====================================================

const Home = (() => {
  const cv = $('homeBg'), c = cv.getContext('2d');
  let W0 = 0, H0 = 0, S = 2, active = true, leaving = false;
  const leaves = [];

  // 背景用的小地圖（固定亂數，每次打開都一樣；重複鋪開，可以無限捲動）
  const R = mulberry32(777);
  const N0 = 32, field = [];
  for (let i = 0; i < N0 * N0; i++) {
    const r = R();
    field.push({ seed: R(), kind: r < 0.045 ? 'tree' : r < 0.06 ? 'rock' : r < 0.16 ? 'plant' : '' });
  }
  const cell = (X, Y) => field[(((Y % N0) + N0) % N0) * N0 + (((X % N0) + N0) % N0)];
  const isDirt = (X, Y) => Math.abs(X - Y) <= 1;   // 沿著畫面正中央往下的小路
  // 在小路上奔跑的角色：外觀、速度、起始位置、左右偏移（格）
  const actors = [
    { spec: 'hero', v: 1.3, phase: 0, lat: 0 },
    { spec: 'slime', v: 1.0, phase: 6, lat: -0.6 },
    { spec: 'bat', v: 1.5, phase: 11, lat: 0.7, fly: true },
    { spec: 'skeleton', v: 1.15, phase: 15, lat: 0.3 },
  ];

  function resizeHome() {
    W0 = innerWidth; H0 = innerHeight;
    cv.width = W0; cv.height = H0;
    S = Math.max(2, Math.round(H0 / 300));   // 整數倍放大，像素才清楚
  }
  addEventListener('resize', resizeHome);
  resizeHome();

  // 背景（地板 + 樹石花草）預先畫成一張長圖：地圖每 32 格重複，所以只要畫一個週期，
  // 之後每幀捲動貼上即可，角色、落葉、暗角另外畫。
  const PERIOD = N0;
  let bg = null;
  // 菱形地板快取：同一種圖塊只做一次變形，之後直接貼（CPU 繪圖時快很多）
  const isoCache = {};
  function isoTile(key, drawFn) {
    let t = isoCache[key];
    if (t) return t;
    const hw = 16 * S, hh = 8 * S, cv3 = document.createElement('canvas');
    cv3.width = hw * 2; cv3.height = hh * 2;
    const g3 = cv3.getContext('2d'); g3.imageSmoothingEnabled = false;
    g3.translate(hw, 0); g3.scale(S / 2, S / 2);
    if (!drawFn(g3)) return null;   // 圖還沒載完：不快取
    return (isoCache[key] = cv3);
  }
  function buildBg() {
    const hw = 16 * S, hh = 8 * S, oy = H0 * 0.1;
    const sMin = Math.floor(-oy / hh) - 4, sMax = Math.ceil((H0 - oy) / hh) + 2 + PERIOD * 2;
    const M = (-sMin + 6) * hh;   // 上方預留空間（樹會往上長）
    const cv2 = document.createElement('canvas');
    cv2.width = W0; cv2.height = Math.ceil(M + sMax * hh + hh * 2);
    const g = cv2.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#1d2b14'; g.fillRect(0, 0, cv2.width, cv2.height);
    const ox = W0 / 2, dMax = Math.ceil(W0 / 2 / hw) + 2;
    const sp = (X, Y) => [ox + (X - Y) * hw, M + (X + Y) * hh];
    const objs = [];
    let ok = true;
    for (let sum = sMin; sum <= sMax; sum++) for (let d = -dMax; d <= dMax; d++) {
      if (((sum + d) & 1) !== 0) continue;
      const X = (sum + d) / 2, Y = (sum - d) / 2, f = cell(X, Y);
      const [px, py] = sp(X, Y);
      const grass = isoTile('g', c3 => isoCell(c3, T_FLOOR, 0, 12, 0, 0));
      if (grass) g.drawImage(grass, px - hw, py); else ok = false;
      if (isDirt(X, Y)) {   // 小路用自動接合，邊緣才會圓滑
        const m = (isDirt(X, Y - 1) ? 1 : 0) | (isDirt(X + 1, Y) ? 2 : 0) | (isDirt(X, Y + 1) ? 4 : 0) | (isDirt(X - 1, Y) ? 8 : 0);
        const dirt = isoTile('d' + m, c3 => drawAuto(c3, 'dirt', m, 0, 0, 0.5));
        if (dirt) g.drawImage(dirt, px - hw, py); else ok = false;
      }
      if (isDirt(X, Y) && f.kind) continue;                 // 小路上不放東西
      if (Math.abs(d) < 4 && f.kind !== 'plant') continue; // 路邊只放花草，樹和石頭不要擋住角色
      const cx = px, cy = py + hh;
      if (f.kind === 'plant') objs.push([sum, () => { const p = ART_DEFAULT.plants[Math.floor(f.seed * ART_DEFAULT.plants.length)]; drawCell(g, p[0], p[1], p[2], cx - 8 * S, cy - 12 * S, 1, 1, S); }]);
      if (f.kind === 'tree') objs.push([sum, () => { const w = ART_DEFAULT.walls[Math.floor(f.seed * ART_DEFAULT.walls.length)]; drawObj(g, w[0], w[1], w[2], w[3], w[4], cx, cy + 3 * S, S); }]);
      if (f.kind === 'rock') objs.push([sum, () => { const r = ART_DEFAULT.rocks[Math.floor(f.seed * ART_DEFAULT.rocks.length)]; drawObj(g, r[0], r[1], r[2], r[3], r[4], cx, cy + 4 * S, S); }]);
    }
    objs.sort((p, q) => p[0] - q[0]).forEach(o => o[1]());
    if (!ok) return;   // 圖還沒載完，下一幀再試
    bg = { cv: cv2, M, oy, hw, hh };
    // 暗角改用 CSS（#homeVig），交給瀏覽器合成，不用每幀在畫布上多貼一張全螢幕圖
  }
  addEventListener('resize', () => { bg = null; for (const k in isoCache) delete isoCache[k]; });

  let perfN = 0, perfSum = 0;
  function draw(t) {
    if (!active) return;
    const tp0 = performance.now();
    try { drawInner(t); } finally { if (bg && location.hash.includes('homeperf') && perfN < 20) { perfSum += performance.now() - tp0; if (++perfN === 20) console.log('HOMEPERF 平均每幀 ' + (perfSum / 20).toFixed(2) + ' ms'); } }
  }
  function drawInner(t) {
    if (!bg) { const tb = performance.now(); buildBg(); if (!bg) return; if (location.hash.includes('homeperf')) console.log('HOMEPERF 預先畫背景 ' + (performance.now() - tb).toFixed(0) + ' ms'); }
    const { hw, hh, oy, M } = bg;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    // 鏡頭沿著小路往下捲動：一個週期 = 2 × 32 列
    const cam = t * 0.9, camMod = cam % PERIOD;
    c.drawImage(bg.cv, 0, Math.round(oy - M - camMod * 2 * hh));
    // 角色沿著小路往畫面下方跑；跑出畫面下緣就從上面重新出現
    const span = (H0 / hh) / 2 + 6;
    for (const a of actors) {
      const k = ((t * a.v + a.phase) % span) - 3;
      const px = W0 / 2 + 2 * a.lat * hw, py = oy + 2 * k * hh;
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(px, py, 6 * S, 2.5 * S, 0, 0, Math.PI * 2); c.fill();
      drawSpec(c, a.spec, 'walk', 0, t + a.phase, px, py + (a.fly ? -10 * S + Math.sin(t * 4) * 2 * S : 0), S);   // 往畫面下方跑：正面
    }
    // 落葉
    if (leaves.length < 40) leaves.push({ x: Math.random() * W0, y: -10, vx: -20 - Math.random() * 30, vy: 30 + Math.random() * 40, r: Math.random() * 6, s: 2 + Math.random() * 2 });
    for (const l of leaves) {
      l.x += l.vx / 60 + Math.sin(t * 2 + l.r) * 0.6; l.y += l.vy / 60;
      if (l.y > H0 + 10) { l.y = -10; l.x = Math.random() * W0 + 100; }
      c.fillStyle = l.r > 3 ? 'rgba(150,210,90,0.8)' : 'rgba(240,180,200,0.75)';
      c.fillRect(l.x, l.y, l.s * 1.6, l.s);
    }
  }


  // 進入人物選擇畫面
  function enter() {
    if (leaving || !active) return;
    leaving = true;
    Snd.play('ui');
    $('home').classList.add('leaving');
    setTimeout(() => {
      active = false;
      $('home').classList.add('hidden');
      $('title').classList.remove('hidden');
      G.state = 'title';
    }, 450);
  }
  $('home').addEventListener('pointerdown', enter);
  addEventListener('keydown', e => { if (active && !leaving && !e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.key)) enter(); });

  // 直接進遊戲（測試網址 #play）時跳過首頁
  function skip() { active = false; $('home').classList.add('hidden'); }
  if (TOUCH) $('homeHint').textContent = '點一下開始';
  Diag.mute(4000);   // 開啟時載入素材、預先畫背景，本來就會花一點時間
  if (location.hash.startsWith('#play') || G.state === 'play') skip();   // 測試網址或已經在遊戲中
  return { draw, enter, skip, get active() { return active; } };
})();
