// 從 Ninja Adventure 素材包挑出音樂與音效，用 ffmpeg 轉成 MP3（所有瀏覽器與手機都能播），存到 assets/na/audio/
// 用法：node tools/build-audio.js [素材包資料夾] [ffmpeg 路徑]
// 素材授權：CC0（Pixel-boy & AAA）
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = path.join(process.argv[2] || 'D:/RPG_assets/ninja/extracted/Ninja Adventure - Asset Pack', 'Audio');
const FFMPEG = process.argv[3] || findFfmpeg();
const OUT = path.join(__dirname, '..', 'assets', 'na', 'audio');

function findFfmpeg() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(base).filter(d => d.startsWith('Gyan.FFmpeg'))) {
      for (const sub of fs.readdirSync(path.join(base, d))) {
        const p = path.join(base, d, sub, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch (e) { /* 找不到就用 PATH 裡的 */ }
  return 'ffmpeg';
}

// 遊戲裡的名稱 → 原始檔案
const MUSIC = {
  title: 'Musics/1 - Adventure Begin.ogg',
  camp: 'Musics/33 - Calm Village.ogg',
  field: 'Musics/35 - Adventure.ogg',
  boss: 'Musics/17 - Fight.ogg',
};
const SFX = {
  throw: 'Sounds/Whoosh & Slash/Whoosh.wav',
  slash: 'Sounds/Whoosh & Slash/Slash.wav',
  hit: 'Sounds/Hit & Impact/Hit2.wav',
  crit: 'Sounds/Hit & Impact/Impact.wav',
  kill: 'Sounds/Hit & Impact/Impact4.wav',
  hurt: 'Sounds/Hit & Impact/Hit5.wav',
  coin: 'Sounds/Bonus/Coin.wav',
  pickup: 'Sounds/Bonus/Bonus.wav',
  heal: 'Sounds/Magic & Skill/Heal.wav',
  boom: 'Sounds/Elemental/Explosion.wav',
  thunder: 'Sounds/Elemental/Explosion4.wav',
  fireball: 'Sounds/Elemental/Fireball.wav',
  magic: 'Sounds/Magic & Skill/Magic1.wav',
  shrine: 'Sounds/Magic & Skill/Spirit.wav',
  tele: 'Sounds/Magic & Skill/Magic3.wav',
  ui: 'Sounds/Menu/Accept.wav',
  cancel: 'Sounds/Menu/Cancel.wav',
  alert: 'Sounds/Alert/Alert2.wav',
  levelup: 'Jingles/LevelUp1.wav',
  gameover: 'Jingles/GameOver.wav',
  victory: 'Jingles/Success1.wav',
};

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
const conv = (name, src, args) => {
  const from = path.join(SRC, src), to = path.join(OUT, name + '.mp3');
  if (!fs.existsSync(from)) { console.error('找不到：' + src); process.exitCode = 1; return; }
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', from, ...args, to]);
  const kb = fs.statSync(to).size / 1024; total += kb;
  console.log(`${name.padEnd(10)} ${kb.toFixed(0).padStart(5)} KB  ← ${src}`);
};
// 音樂：立體聲 96 kbps；音效：單聲道 64 kbps
for (const [k, v] of Object.entries(MUSIC)) conv('music_' + k, v, ['-ac', '2', '-codec:a', 'libmp3lame', '-b:a', '96k']);
for (const [k, v] of Object.entries(SFX)) conv('sfx_' + k, v, ['-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k']);
console.log(`合計 ${(total / 1024).toFixed(2)} MB → ${OUT}`);
