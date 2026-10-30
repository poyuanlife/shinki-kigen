// Flare（https://github.com/flareteam/flare-game，美術 CC-BY-SA 3.0）素材轉換設定
// 用 build-flare.js 執行：把 Flare 的原圖裁切、縮成一半、打包成 WebP + JSON，放到 assets/flare/
// 這個檔案在 Node（build-flare.js）和瀏覽器（flare-pack.html）都會讀
'use strict';
const FLARE_CONFIG = {
  // 存檔的縮放比例：Flare 的格子 192×96，遊戲的格子 64×32（1/3）。存成 1/2，畫的時候再縮到 1/3，高解析度手機上才清楚
  scale: 0.5,
  quality: 0.82,   // WebP 品質
  // Flare 圖裡的 8 個方向（畫面上）：0 左、1 左上、2 上、3 右上、4 右、5 右下、6 下、7 左下
  // 場景：每一種用哪些圖塊（tilesetdefs/tileset_grassland.txt 的編號）
  tilesets: {
    field: {
      def: 'tilesetdefs/tileset_grassland.txt',
      tiles: {
        grass: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
        road: [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43],
        water: [176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187],
        wall: [248, 249, 250, 251],   // 森林邊緣、遺跡的牆：松樹
        tree: [252, 253, 254, 255, 240, 241, 242, 243],
        rock: [128, 129, 130, 131],
        crate: [96, 98, 100, 101],
        chest: [76, 77],
        anvil: [103],
        campfire: [102],
        tent: [72],
        fence: [104, 105, 106, 107],
        lamp: [138, 139],
        grave: [140, 141, 142, 143],
        plant: [112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125, 126, 127],
        flower: [118, 119],
        stump: [136, 137],
        portal: [265],
      },
    },
  },
  // 動作對應：遊戲的動作名稱 → Flare 的動作名稱
  // 怪物：遊戲用 walk / idle / attack / hit / dead
  monsters: {
    goblin: { attack: 'swing' },
    antlion_small: { attack: 'swing' },
    skeleton_weak: { attack: 'swing' },
    skeleton_archer: { attack: 'shoot' },
    skeleton_mage: { attack: 'cast' },
    zombie: { attack: 'swing' },
    goblin_elite: { attack: 'swing' },
  },
  // 主角：用好幾層裝備疊出來（engine/hero_layers.txt 的順序），每個職業一套
  heroes: {
    samurai: { attack: 'swing', layers: { head: 'head_short', chest: 'chain_cuirass', legs: 'chain_greaves', feet: 'chain_boots', hands: 'chain_gloves', main: 'longsword' } },
    ninja: { attack: 'shoot', layers: { head: 'leather_hood', chest: 'leather_chest', legs: 'leather_pants', feet: 'leather_boots', hands: 'leather_gloves', main: 'longbow' } },
    onmyoji: { attack: 'cast', layers: { head: 'mage_hood', chest: 'mage_vest', legs: 'mage_skirt', feet: 'mage_boots', hands: 'default_hands', main: 'greatstaff' } },
  },
  // 遊戲動作 ← Flare 動作（attack 依上面各自的設定）
  anims: { idle: 'stance', walk: 'run', hit: 'hit', dead: 'die' },
};
if (typeof module !== 'undefined') module.exports = FLARE_CONFIG;
