'use strict';
// =====================================================
//  繪圖：程式繪製的物件（祭壇、旗幟、弩砲、物品圖示）
//  主角、怪物、地圖圖塊改用精靈圖，見 gfx.js
// =====================================================

function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2); }
function rrect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function star(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  c.closePath();
}
function shadow(c, rx, ry) { c.fillStyle = 'rgba(0,0,0,0.38)'; ell(c, 0, 0, rx, ry); c.fill(); }

// ---------- 弩砲 ----------
function drawTurret(c, x, y, tu, t) {
  c.save(); c.translate(x, y);
  shadow(c, 13, 5);
  // 木製弩砲：三腳架 + 旋轉的弩身
  c.strokeStyle = '#4a3420'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, -10); c.lineTo(-10, 2); c.moveTo(0, -10); c.lineTo(10, 2); c.moveTo(0, -10); c.lineTo(0, 4); c.stroke();
  c.fillStyle = '#6b4a2a'; rrect(c, -7, -20, 14, 10, 3); c.fill();
  c.save(); c.translate(0, -18); c.rotate(tu.sang || 0);
  c.fillStyle = '#7a5532'; c.fillRect(-4, -2.5, 22, 5);
  c.strokeStyle = '#3a2a18'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(12, -9); c.quadraticCurveTo(16, 0, 12, 9); c.stroke();
  c.strokeStyle = '#ddd'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(12, -9); c.lineTo(tu.flash > 0 ? 10 : 2, 0); c.lineTo(12, 9); c.stroke();
  c.restore();
  c.fillStyle = tu.life < 3 && Math.sin(t * 20) > 0 ? '#f44' : '#7bed6f'; ell(c, 0, -22, 2, 2); c.fill();
  c.restore();
}

// ---------- 場景物件 ----------
function drawProp(c, x, y, p, t) {
  c.save(); c.translate(x, y);
  switch (p.type) {
    case 'flag': {
      // 王國軍旗：深紅底、金邊、垂直飄動
      shadow(c, 6, 3);
      c.strokeStyle = '#5a4026'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -72); c.stroke();
      c.fillStyle = '#d9a93a'; ell(c, 0, -73, 2.5, 2.5); c.fill();
      c.strokeStyle = '#5a4026'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-1, -68); c.lineTo(20, -68); c.stroke();
      for (let k = 0; k < 6; k++) {
        const wv = Math.sin(t * 3 - k * 0.7) * 1.5;
        c.fillStyle = '#8e1f24'; c.fillRect(1 + k * 3.2, -68 + wv * 0.3, 3.3, 30 + wv);
        c.fillStyle = '#d9a93a'; c.fillRect(1 + k * 3.2, -40 + wv * 1.3, 3.3, 2);
      }
      c.fillStyle = '#d9a93a'; c.beginPath(); c.moveTo(10, -60); c.lineTo(14, -54); c.lineTo(10, -48); c.lineTo(6, -54); c.closePath(); c.fill();
      break;
    }
    case 'shrine': {
      const ready = p.cd <= 0;
      shadow(c, 26, 10);
      c.fillStyle = '#5c574c'; c.beginPath(); c.moveTo(-26, -4); c.lineTo(0, 9); c.lineTo(26, -4); c.lineTo(0, -17); c.fill();
      c.fillStyle = '#4a463d'; c.fillRect(-18, -22, 36, 12);
      c.fillStyle = '#6e685b'; c.fillRect(-18, -24, 36, 3);
      if (ready) {
        c.save(); c.globalCompositeOperation = 'lighter';
        const g = c.createRadialGradient(0, -48, 0, 0, -48, 34);
        g.addColorStop(0, 'rgba(255,220,120,0.6)'); g.addColorStop(1, 'rgba(255,180,40,0)');
        c.fillStyle = g; ell(c, 0, -48, 34, 34); c.fill(); c.restore();
      }
      const gold = ready ? '#d9a93a' : '#6d6150';
      c.fillStyle = gold; ell(c, 0, -28, 15, 7); c.fill();
      ell(c, 0, -40, 10, 12); c.fill();
      ell(c, 0, -56, 6.5, 7); c.fill();
      ell(c, 0, -63, 3.5, 3); c.fill();
      c.strokeStyle = ready ? 'rgba(255,230,150,0.9)' : 'rgba(120,110,90,0.6)'; c.lineWidth = 2;
      ell(c, 0, -56, 12 + (ready ? Math.sin(t * 3) : 0), 12); c.stroke();
      break;
    }
  }
  c.restore();
}

// ---------- 物品圖示（產生 dataURL 快取） ----------
// 武器類型 → 圖示（crop = 圖裡有兩格動畫，只顯示左邊那格，例如大型手裏劍）
const WEAPON_ICONS = {
  rifle: { file: 'Items/Projectile/Shuriken.png' },
  smg: { file: 'Items/Projectile/Kunai.png' },
  shotgun: { file: 'Items/Projectile/Caltrop.png' },
  gatling: { file: 'Items/Projectile/Dynamite.png' },
  rail: { file: 'FX/Projectile/BigShuriken.png', crop: true },
  katana: { file: 'Items/Weapons/Katana/Sprite.png' },
  tanto: { file: 'Items/Weapons/Ninjaku/Sprite.png' },
  odachi: { file: 'Items/Weapons/BigSword/Sprite.png' },
  naginata: { file: 'Items/Weapons/Lance/Sprite.png' },
  ofuda: { file: 'Items/Weapons/MagicWand/Sprite.png' },   // 術士：魔杖
  gohei: { file: 'Items/Scroll/Scroll.png' },   // 術士：卷軸
  shakujo: { file: 'Items/Weapons/Stick/Sprite.png' },
  jusho: { file: 'Items/Weapons/Book/Sprite.png' },
};
const _iconCache = {};
function itemIcon(it) {
  const key = (it.slot === 'weapon' ? 'w_' + it.wkey : it.slot) + '_' + it.rarity;
  if (_iconCache[key]) return _iconCache[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = 48;
  const c = cv.getContext('2d');
  const col = RARITIES[it.rarity].color;
  const g = c.createRadialGradient(24, 24, 2, 24, 24, 30);
  g.addColorStop(0, col + '55'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 48, 48);
  const M = '#9aa6b8', D = '#3a4252';
  c.translate(24, 24);
  c.lineJoin = 'round';
  switch (it.slot) {
    // 武器不在這裡畫：直接顯示素材圖（見 game.js 的 slotEl），因為用 file:// 開啟時畫布不能匯出外部圖片
    case 'helm': c.fillStyle = M; ell(c, 0, 2, 14, 13); c.fill(); c.fillStyle = col; rrect(c, -9, -2, 18, 6, 3); c.fill(); break;
    case 'armor': c.fillStyle = M; rrect(c, -13, -14, 26, 28, 7); c.fill(); c.fillStyle = D; ell(c, -14, -11, 7, 5); c.fill(); ell(c, 14, -11, 7, 5); c.fill(); c.fillStyle = col; c.fillRect(-7, -6, 14, 3); break;
    case 'gloves': c.fillStyle = M; rrect(c, -10, -8, 20, 20, 5); c.fill(); c.fillStyle = D; for (let i = 0; i < 4; i++) c.fillRect(-9 + i * 5, -14, 4, 8); c.fillStyle = col; c.fillRect(-10, 8, 20, 3); break;
    case 'boots': c.fillStyle = M; rrect(c, -10, -14, 12, 22, 3); c.fill(); rrect(c, -10, 4, 22, 9, 3); c.fill(); c.fillStyle = col; c.fillRect(-10, -2, 12, 3); break;
    case 'belt': c.fillStyle = D; rrect(c, -18, -5, 36, 10, 3); c.fill(); c.fillStyle = col; rrect(c, -5, -7, 10, 14, 2); c.fill(); c.fillStyle = M; for (let i = 0; i < 3; i++) c.fillRect(-16 + i * 4, -3, 2, 6); break;
    case 'amulet': c.strokeStyle = M; c.lineWidth = 2; ell(c, 0, -6, 11, 12); c.stroke(); c.fillStyle = col; star(c, 0, 8, 8); c.fill(); break;
    case 'ring': c.strokeStyle = M; c.lineWidth = 4; ell(c, 0, 4, 10, 10); c.stroke(); c.fillStyle = col; ell(c, 0, -7, 5, 4); c.fill(); break;
  }
  return (_iconCache[key] = cv.toDataURL());
}
