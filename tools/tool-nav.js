// 三個圖片工具共用的切換列：批次轉換、精靈圖產生器（單一角色）、像素圖轉換器（單張圖）
'use strict';
(() => {
  const TOOLS = [
    ['batch.html', '批次轉換', '整批人物、怪物、場景'],
    ['sprite-generator.html', '精靈圖產生器', '單一角色：三視圖 → 走路動畫'],
    ['pixel-converter.html', '像素圖轉換器', '單張圖 → 像素風'],
  ];
  const here = location.pathname.split('/').pop() || 'batch.html';
  const css = document.createElement('style');
  css.textContent = `
    .toolnav { display: flex; gap: 4px; padding: 6px 10px 0; background: #16181e; border-bottom: 1px solid #3a3f52; flex: none; overflow-x: auto; }
    .toolnav a { padding: 6px 14px 7px; border-radius: 8px 8px 0 0; color: #9aa0b4; text-decoration: none; white-space: nowrap;
      font: 14px/1.3 "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", system-ui, sans-serif; border: 1px solid transparent; border-bottom: none; }
    .toolnav a small { display: block; font-size: 11px; opacity: .8; }
    .toolnav a:hover { color: #e6e8ef; background: #242733; }
    .toolnav a.on { color: #f2c471; background: #242733; border-color: #3a3f52; font-weight: bold; margin-bottom: -1px; padding-bottom: 8px; }
    .toolnav a.on small { font-weight: normal; }`;
  document.head.appendChild(css);
  const nav = document.createElement('nav');
  nav.className = 'toolnav';
  nav.innerHTML = TOOLS.map(([f, name, sub]) => `<a href="${f}" class="${f === here ? 'on' : ''}">${name}<small>${sub}</small></a>`).join('');
  document.body.insertBefore(nav, document.body.firstChild);
})();
