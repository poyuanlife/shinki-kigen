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

  function draw(t) {
    if (!active) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#1d2b14'; c.fillRect(0, 0, W0, H0);
    const hw = 16 * S, hh = 8 * S;   // 菱形半寬、半高
    // 鏡頭沿著小路往右下慢慢移動（不繞回，地圖重複鋪開）
    const cam = t * 0.9;
    const ox = W0 / 2, oy = H0 * 0.1;
    const sp = (X, Y) => [ox + (X - Y) * hw, oy + (X + Y - cam * 2) * hh];
    const objs = [];
    // 只走畫面看得到的格子：s = X + Y（上下）、d = X - Y（左右）
    const s0 = Math.floor(cam * 2 - oy / hh) - 4, s1 = Math.ceil(cam * 2 + (H0 - oy) / hh) + 2;
    const dMax = Math.ceil(W0 / 2 / hw) + 2;
    for (let sum = s0; sum <= s1; sum++) for (let d = -dMax; d <= dMax; d++) {
      if (((sum + d) & 1) !== 0) continue;
      const X = (sum + d) / 2, Y = (sum - d) / 2, f = cell(X, Y);
      const [px, py] = sp(X, Y);
      c.save(); c.translate(px, py); c.scale(S / 2, S / 2);
      isoCell(c, T_FLOOR, 0, 12, 0, 0);
      if (isDirt(X, Y)) {   // 小路用自動接合，邊緣才會圓滑
        const m = (isDirt(X, Y - 1) ? 1 : 0) | (isDirt(X + 1, Y) ? 2 : 0) | (isDirt(X, Y + 1) ? 4 : 0) | (isDirt(X - 1, Y) ? 8 : 0);
        drawAuto(c, 'dirt', m, 0, 0, f.seed);
      }
      c.restore();
      if (isDirt(X, Y) && f.kind) continue;                          // 小路上不放東西
      if (Math.abs(d) < 4 && f.kind !== 'plant') continue;          // 路邊只放花草，樹和石頭不要擋住角色
      const cx = px, cy = py + hh;
      if (f.kind === 'plant') objs.push([sum, () => { const p = ART_DEFAULT.plants[Math.floor(f.seed * ART_DEFAULT.plants.length)]; drawCell(c, p[0], p[1], p[2], cx - 8 * S, cy - 12 * S, 1, 1, S); }]);
      if (f.kind === 'tree') objs.push([sum, () => { const w = ART_DEFAULT.walls[Math.floor(f.seed * ART_DEFAULT.walls.length)]; drawObj(c, w[0], w[1], w[2], w[3], w[4], cx, cy + 3 * S, S); }]);
      if (f.kind === 'rock') objs.push([sum, () => { const r = ART_DEFAULT.rocks[Math.floor(f.seed * ART_DEFAULT.rocks.length)]; drawObj(c, r[0], r[1], r[2], r[3], r[4], cx, cy + 4 * S, S); }]);
    }
    // 角色沿著小路往畫面下方跑；跑出畫面下緣就從上面重新出現
    const span = (H0 / hh) / 2 + 6;   // 一趟要跑幾格
    for (const a of actors) {
      const k = ((t * a.v + a.phase) % span) - 3;
      const X = cam + k + a.lat, Y = cam + k - a.lat;
      const [px, py] = sp(X, Y);
      objs.push([X + Y, () => {
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(px, py, 6 * S, 2.5 * S, 0, 0, Math.PI * 2); c.fill();
        drawSpec(c, a.spec, 'walk', 0, t + a.phase, px, py + (a.fly ? -10 * S + Math.sin(t * 4) * 2 * S : 0), S);   // 往畫面下方跑：正面
      }]);
    }
    objs.sort((p, q) => p[0] - q[0]).forEach(o => o[1]());
    // 落葉
    if (leaves.length < 40) leaves.push({ x: Math.random() * W0, y: -10, vx: -20 - Math.random() * 30, vy: 30 + Math.random() * 40, r: Math.random() * 6, s: 2 + Math.random() * 2 });
    for (const l of leaves) {
      l.x += l.vx / 60 + Math.sin(t * 2 + l.r) * 0.6; l.y += l.vy / 60;
      if (l.y > H0 + 10) { l.y = -10; l.x = Math.random() * W0 + 100; }
      c.fillStyle = l.r > 3 ? 'rgba(150,210,90,0.8)' : 'rgba(240,180,200,0.75)';
      c.fillRect(l.x, l.y, l.s * 1.6, l.s);
    }
    // 暗角，讓中間的標題更清楚
    const g = c.createRadialGradient(W0 / 2, H0 * 0.45, Math.min(W0, H0) * 0.2, W0 / 2, H0 * 0.5, Math.max(W0, H0) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0.58)'); g.addColorStop(1, 'rgba(0,0,0,0.9)');
    c.fillStyle = g; c.fillRect(0, 0, W0, H0);
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
  if (location.hash.startsWith('#play') || G.state === 'play') skip();   // 測試網址或已經在遊戲中
  return { draw, enter, skip, get active() { return active; } };
})();
