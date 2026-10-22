'use strict';
// =====================================================
//  音樂與音效（Ninja Adventure 素材，CC0）
//  - 音效：優先用 Web Audio（低延遲、可同時多個）；用 file:// 開啟時改用 <audio>
//  - 音樂：<audio> 串流播放，換曲時淡入淡出
//  - 瀏覽器規定要先有使用者操作（點擊、按鍵）才能出聲，所以第一次操作時才啟動
// =====================================================

const Snd = (() => {
  const BASE = 'assets/na/audio/';
  const SFX_NAMES = ['throw', 'hit', 'crit', 'kill', 'hurt', 'coin', 'pickup', 'heal', 'boom', 'thunder', 'fireball',
    'magic', 'shrine', 'tele', 'ui', 'cancel', 'alert', 'levelup', 'gameover', 'victory'];
  // 每個音效的音量、最短間隔（秒，避免連發時太吵）
  const SFX_CFG = {
    throw: [0.35, 0.06], hit: [0.4, 0.05], crit: [0.55, 0.08], kill: [0.5, 0.06], hurt: [0.6, 0.2], coin: [0.5, 0.05],
    pickup: [0.6, 0.1], heal: [0.6, 0.2], boom: [0.7, 0.1], thunder: [0.8, 0.2], fireball: [0.3, 0.15], magic: [0.5, 0.15],
    shrine: [0.7, 0.5], tele: [0.6, 0.3], ui: [0.4, 0.05], cancel: [0.4, 0.1], alert: [0.8, 1], levelup: [0.8, 0.5],
    gameover: [0.8, 1], victory: [0.8, 1],
  };
  const MUSIC_VOL = { title: 0.45, camp: 0.4, field: 0.4, boss: 0.5 };

  // 設定（記住在瀏覽器裡）
  let cfg = { music: true, sfx: true, musicVol: 1, sfxVol: 1 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('dm_audio') || '{}')); } catch (e) { /* 忽略 */ }
  const saveCfg = () => { try { localStorage.setItem('dm_audio', JSON.stringify(cfg)); } catch (e) { /* 忽略 */ } };

  let started = false, actx = null, master = null;
  const buffers = {};      // Web Audio 用
  const pools = {};        // 備用：<audio> 池
  const lastPlay = {};

  function start() {
    if (started) return;
    started = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && location.protocol !== 'file:') {
      try {
        actx = new AC(); master = actx.createGain(); master.connect(actx.destination);
        for (const n of SFX_NAMES) {
          fetch(BASE + 'sfx_' + n + '.mp3').then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)).then(buf => { buffers[n] = buf; })
            .catch(() => { buffers[n] = null; });
        }
      } catch (e) { actx = null; }
    }
    if (wantTrack) playMusic(wantTrack, true);
  }
  // 第一次使用者操作時啟動聲音
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, start, { once: false, passive: true });

  function play(name, volMul = 1) {
    if (!started || !cfg.sfx) return;
    const [vol, gap] = SFX_CFG[name] || [0.5, 0.05];
    const now = performance.now() / 1000;
    if (lastPlay[name] && now - lastPlay[name] < gap) return;
    lastPlay[name] = now;
    const v = vol * volMul * cfg.sfxVol;
    if (actx && buffers[name]) {
      if (actx.state === 'suspended') actx.resume();
      const src = actx.createBufferSource(), g = actx.createGain();
      src.buffer = buffers[name]; g.gain.value = v;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;   // 音高稍微隨機，重複時比較不單調
      src.connect(g); g.connect(master); src.start();
      return;
    }
    // 備用：<audio> 池（每個音效最多 4 個同時播放）
    const pool = pools[name] || (pools[name] = []);
    let a = pool.find(x => x.paused || x.ended);
    if (!a && pool.length < 4) { a = new Audio(BASE + 'sfx_' + name + '.mp3'); a.preload = 'auto'; pool.push(a); }
    if (!a) return;
    a.volume = Math.min(1, v); a.currentTime = 0;
    a.play().catch(() => {});
  }

  // ---------- 音樂 ----------
  let cur = null, curName = null, wantTrack = null;
  const fades = new Set();
  function fade(a, to, sec, then) {
    const from = a.volume, t0 = performance.now();
    const job = { a };
    fades.add(job);
    const step = () => {
      if (!fades.has(job)) return;
      const k = Math.min(1, (performance.now() - t0) / (sec * 1000));
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step); else { fades.delete(job); if (then) then(); }
    };
    requestAnimationFrame(step);
  }
  function playMusic(name, force) {
    wantTrack = name;
    if (!started) return;
    if (!cfg.music) { if (cur) { cur.pause(); cur = null; curName = null; } return; }
    if (name === curName && !force && cur) return;
    const old = cur;
    if (old) fade(old, 0, 1.2, () => old.pause());
    if (!name) { cur = null; curName = null; return; }
    const a = new Audio(BASE + 'music_' + name + '.mp3');
    a.loop = true; a.volume = 0;
    a.play().then(() => fade(a, (MUSIC_VOL[name] || 0.4) * cfg.musicVol, 1.5)).catch(() => {});
    cur = a; curName = name;
  }
  function stopMusic() { playMusic(null); }

  function toggleMusic() { cfg.music = !cfg.music; saveCfg(); playMusic(wantTrack, true); return cfg.music; }
  // 音量（0～1）：音樂會立刻套用到正在播放的曲子
  function setVolume(kind, v) {
    v = Math.max(0, Math.min(1, v));
    if (kind === 'music') {
      cfg.musicVol = v;
      if (cur && curName) { for (const j of fades) if (j.a === cur) fades.delete(j); cur.volume = (MUSIC_VOL[curName] || 0.4) * v; }
    } else cfg.sfxVol = v;
    saveCfg();
  }
  function setEnabled(kind, on) {
    if (kind === 'music') { if (cfg.music !== on) toggleMusic(); } else { cfg.sfx = on; saveCfg(); }
  }
  function toggleSfx() { cfg.sfx = !cfg.sfx; saveCfg(); return cfg.sfx; }

  // 狀態（給診斷報告用）
  const status = () => ({ 已啟動: started, 方式: actx ? 'WebAudio(' + actx.state + ')' : '<audio>', 音效已載入: Object.values(buffers).filter(Boolean).length + '/' + SFX_NAMES.length,
    音樂: curName || '無', 音樂播放中: !!(cur && !cur.paused), 音樂開: cfg.music, 音效開: cfg.sfx });
  return { status, play, music: playMusic, stopMusic, toggleMusic, toggleSfx, setVolume, setEnabled, get cfg() { return cfg; } };
})();
