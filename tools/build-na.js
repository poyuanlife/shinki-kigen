// 從 Ninja Adventure 素材包挑出遊戲用得到的檔案，複製到 assets/na/（保留原本的資料夾結構）
// 用法：node tools/build-na.js [素材包資料夾]
// 素材授權：CC0（Pixel-boy & AAA，https://pixel-boy.itch.io/ninja-adventure-asset-pack）
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'D:/RPG_assets/ninja/extracted/Ninja Adventure - Asset Pack';
const OUT = path.join(__dirname, '..', 'assets', 'na');

const FILES = [
  // 主角：綠忍者（每個動作一張圖）
  ...['Walk', 'Attack', 'Idle', 'Hit', 'Dead'].map(a => `Actor/CharacterAnimated/NinjaGreen/Separate/${a}.png`),
  // 人形角色（敵人與 NPC）
  ...['Skeleton', 'NinjaRed', 'OldMan', 'Samurai'].map(n => `Actor/Character/${n}/SpriteSheet.png`),
  // 怪物
  'Actor/Monster/Slime/Slime.png', 'Actor/Monster/BlueBat/SpriteSheet.png',
  'Actor/Monster/Flam/SpriteSheet.png', 'Actor/Monster/Cyclope/SpriteSheet.png',
  // 首領：鬼王
  ...['Walk', 'Idle', 'Hit'].map(a => `Actor/Boss/DemonCyclop/${a}.png`),
  // 地圖
  ...['TilesetFloor', 'TilesetWater', 'TilesetNature', 'tileset_camp'].map(n => `Backgrounds/Tilesets/${n}.png`),
  // 飛行道具與特效
  ...['Shuriken', 'Fireball', 'Kunai', 'EnergyBall'].map(n => `FX/Projectile/${n}.png`),
  'FX/Elemental/Explosion/SpriteSheet.png', 'FX/Elemental/Thunder/SpriteSheet.png', 'FX/Smoke/Smoke/SpriteSheet.png',
  // 物品
  'Items/Potion/LifePot.png', 'Items/Potion/WaterPot.png', 'Items/Treasure/GoldCoin.png',
  // 武器圖示（背包、商店）
  ...['Shuriken', 'Kunai', 'Caltrop', 'Dynamite'].map(n => `Items/Projectile/${n}.png`), 'FX/Projectile/BigShuriken.png',
  // ---- 其他區域：竹林、沙漠、雪地、地城、鬼王城 ----
  // 怪物（檔名不一定是 SpriteSheet.png）
  ...[['Bamboo'], ['BambooYellow'], ['Racoon'], ['KappaGreen'], ['Mushroom', 'mushroom'], ['Snake', 'Snake'], ['Lizard', 'Lizard'],
    ['Mole', 'Mole'], ['Reptile', 'Reptile'], ['DragonYellow'], ['Beast2', 'Beast2'], ['SkullBlue'], ['Owl', 'Owl'], ['Axolot'],
    ['Eye2', 'Eye2'], ['Spirit2'], ['Bear'], ['Skull'], ['SpiderRed'], ['Mollusc', 'Mollusc'], ['Eye', 'Eye'], ['Octopus'],
    ['Cyclope2'], ['Beast', 'Beast'], ['Dragon'], ['LanternRed'], ['Flam2']].map(([d, f]) => `Actor/Monster/${d}/${f || 'SpriteSheet'}.png`),
  'Actor/Character/NinjaBlue/SpriteSheet.png',
  // 首領
  ...['Idle', 'Jump', 'Hit'].map(a => `Actor/Boss/GiantSlime/${a}.png`),
  ...['Walk', 'Idle', 'Attack', 'Hit'].map(a => `Actor/Boss/GiantBamboo/${a}.png`),
  ...['Walk', 'Idle', 'Attack'].map(a => `Actor/Boss/TenguRed/${a}.png`),
  ...['Idle', 'Hit'].map(a => `Actor/Boss/GiantSpirit/${a}.png`),
  ...['Walk', 'Idle', 'Shoot'].map(a => `Actor/Boss/SquidGreen/${a}.png`),
  // 圖塊與傳送陣
  ...['TilesetDesert', 'TilesetDungeon', 'TilesetFloorDetail'].map(n => `Backgrounds/Tilesets/${n}.png`),
  'FX/Magic/Circle/SpriteSheetWhite.png',
  // 授權說明
  'LICENSE.txt', 'README.md',
];

let bytes = 0, copied = 0;
for (const f of FILES) {
  const from = path.join(SRC, f), to = path.join(OUT, f);
  if (!fs.existsSync(from)) { console.error('找不到：' + f); process.exitCode = 1; continue; }
  const st = fs.statSync(from); bytes += st.size;
  if (fs.existsSync(to) && fs.statSync(to).size === st.size) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to); copied++;
}
console.log(`素材 ${FILES.length} 個檔案（新複製 ${copied} 個），共 ${(bytes / 1024).toFixed(0)} KB → ${OUT}`);
