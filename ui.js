/* Shared DOM helpers for the HowToMJ pages. Exposes window.UI. */
(function () {
  'use strict';
  const MJ = window.MJ;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach((c) => { if (c !== null && c !== undefined && c !== false) node.append(c); });
    return node;
  }

  // ---------- Tile faces (SVG, viewBox 30 × 40) ----------

  const COL = { b: '#1f4f9c', g: '#1f7a3d', r: '#b3261e', ink: '#1d1b18', gold: '#c98a00' };
  const FACE = 'style="fill:var(--tile-face)"';
  const FACE_STROKE = 'style="stroke:var(--tile-face)"';
  const CJK = "font-family=\"'Noto Serif SC','Songti SC','SimSun','PMingLiU',serif\"";
  const NUMERALS = '一二三四五六七八九';

  const DOTS = {
    2: [[15, 11, 5, 'g'], [15, 29, 5, 'b']],
    3: [[8, 9, 4.5, 'b'], [15, 20, 4.5, 'r'], [22, 31, 4.5, 'g']],
    4: [[10, 12, 5, 'b'], [20, 12, 5, 'g'], [10, 28, 5, 'g'], [20, 28, 5, 'b']],
    5: [[9, 10, 4.3, 'b'], [21, 10, 4.3, 'g'], [15, 20, 4.3, 'r'], [9, 30, 4.3, 'g'], [21, 30, 4.3, 'b']],
    6: [[10, 8, 4, 'g'], [20, 8, 4, 'g'], [10, 21, 4, 'r'], [20, 21, 4, 'r'], [10, 32, 4, 'r'], [20, 32, 4, 'r']],
    7: [[7, 6, 3.4, 'g'], [15, 10, 3.4, 'g'], [23, 14, 3.4, 'g'], [10, 24, 3.8, 'r'], [20, 24, 3.8, 'r'], [10, 33, 3.8, 'r'], [20, 33, 3.8, 'r']],
    8: [7, 15.7, 24.3, 33].flatMap((y) => [[10, y, 3.8, 'b'], [20, y, 3.8, 'b']]),
    9: [[9, 'b'], [20, 'r'], [31, 'g']].flatMap(([y, c]) => [8, 15, 22].map((x) => [x, y, 3.6, c])),
  };

  const BAMBOO = {
    2: [[15, 12, 'g'], [15, 28, 'b']],
    3: [[15, 12, 'b'], [10, 28, 'g'], [20, 28, 'g']],
    4: [[10, 12, 'b'], [20, 12, 'g'], [10, 28, 'g'], [20, 28, 'b']],
    5: [[9, 12, 'g'], [21, 12, 'b'], [15, 20, 'r'], [9, 28, 'b'], [21, 28, 'g']],
    6: [8, 15, 22].flatMap((x) => [[x, 12, 'g'], [x, 28, 'b']]),
    7: [[15, 7, 'r']].concat([8, 15, 22].flatMap((x) => [[x, 20, 'g'], [x, 32, 'g']])),
    // The classic 8 Bamboo: an "M" on top and a "W" underneath (| \ / | over | / \ |).
    8: [[5, 11, 'g', 0], [11.5, 11, 'g', -24], [18.5, 11, 'g', 24], [25, 11, 'g', 0],
      [5, 29, 'g', 0], [11.5, 29, 'g', 24], [18.5, 29, 'g', -24], [25, 29, 'g', 0]],
    9: [[8, 'g'], [15, 'r'], [22, 'b']].flatMap(([x, c]) => [7, 20, 33].map((y) => [x, y, c])),
  };

  const ANIMAL_PICTURES = { aCat: '🐈', aMouse: '🐁', aRooster: '🐓', aCentipede: '🐛' };

  // Both flower sets show flowers: 1 plum, 2 orchid, 3 chrysanthemum, 4 bamboo — red set in red, blue set in blue.
  const PETAL = { red: ['#c2185b', '#f06292'], blue: ['#1f4f9c', '#64b5f6'] };
  function flowerArt(num, colour) {
    const [deep, light] = PETAL[colour];
    const cx = 15;
    const cy = 20;
    if (num === 1) {
      return [0, 72, 144, 216, 288].map((a) => {
        const r = (a - 90) * Math.PI / 180;
        return '<circle cx="' + (cx + 5 * Math.cos(r)).toFixed(2) + '" cy="' + (cy + 5 * Math.sin(r)).toFixed(2) + '" r="3.7" fill="' + light + '" stroke="' + deep + '" stroke-width="0.8"/>';
      }).join('') + '<circle cx="15" cy="20" r="2.2" fill="' + COL.gold + '"/>';
    }
    if (num === 2) {
      return '<path d="M15 28 Q15 33 13 35" stroke="' + COL.g + '" stroke-width="1" fill="none"/>'
        + [-50, 0, 50].map((a) => '<ellipse cx="15" cy="15" rx="2.4" ry="6.5" fill="' + light + '" stroke="' + deep + '" stroke-width="0.8" transform="rotate(' + a + ' 15 21)"/>').join('')
        + '<ellipse cx="15" cy="23" rx="3.5" ry="2" fill="' + deep + '"/>';
    }
    if (num === 3) {
      return Array.from({ length: 12 }, (_, k) => '<ellipse cx="15" cy="13.5" rx="1.4" ry="5" fill="' + (k % 2 ? light : deep) + '" transform="rotate(' + k * 30 + ' 15 20)"/>').join('')
        + '<circle cx="15" cy="20" r="2.4" fill="' + COL.gold + '"/>';
    }
    return '<rect x="13.8" y="7" width="2.4" height="24" rx="1" fill="' + deep + '"/>'
      + [12, 19, 26].map((y) => '<line x1="13.8" x2="16.2" y1="' + y + '" y2="' + y + '" ' + FACE_STROKE + ' stroke-width="0.8"/>').join('')
      + '<ellipse cx="20" cy="13" rx="1.8" ry="5" fill="' + light + '" transform="rotate(50 20 13)"/>'
      + '<ellipse cx="10" cy="20" rx="1.8" ry="5" fill="' + light + '" transform="rotate(-50 10 20)"/>'
      + '<ellipse cx="20" cy="25" rx="1.6" ry="4.5" fill="' + light + '" transform="rotate(55 20 25)"/>';
  }

  const dot = (x, y, r, c) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + COL[c] + '"/>'
    + '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.62) + '" ' + FACE + '/>'
    + '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.3) + '" fill="' + COL[c] + '"/>';

  const stick = (x, y, c, angle) => (angle ? '<g transform="rotate(' + angle + ' ' + x + ' ' + y + ')">' : '')
    + '<rect x="' + (x - 2) + '" y="' + (y - 5.5) + '" width="4" height="11" rx="1.6" fill="' + COL[c] + '"/>'
    + '<line x1="' + (x - 2) + '" x2="' + (x + 2) + '" y1="' + y + '" y2="' + y + '" ' + FACE_STROKE + ' stroke-width="0.8"/>'
    + '<line x1="' + x + '" x2="' + x + '" y1="' + (y - 4.3) + '" y2="' + (y + 4.3) + '" ' + FACE_STROKE + ' stroke-width="0.5" opacity="0.6"/>'
    + (angle ? '</g>' : '');

  const BIRD = '<path d="M12 30 L8 37 M15 31 L15 38 M18 30 L22 37" stroke="' + COL.g + '" stroke-width="1.6" stroke-linecap="round"/>'
    + '<ellipse cx="15" cy="23" rx="6.5" ry="8.5" fill="' + COL.g + '"/>'
    + '<path d="M11 21 Q15 27 19 21" fill="none" ' + FACE_STROKE + ' stroke-width="0.9"/>'
    + '<circle cx="15" cy="12" r="4.4" fill="' + COL.r + '"/>'
    + '<path d="M19 11.3 L23.5 12.8 L19 14.2Z" fill="' + COL.gold + '"/>'
    + '<circle cx="16.4" cy="11.2" r="1" ' + FACE + '/>';

  const ONE_DOT = '<circle cx="15" cy="20" r="10" fill="' + COL.g + '"/><circle cx="15" cy="20" r="8.2" ' + FACE + '/>'
    + '<circle cx="15" cy="20" r="6.8" fill="' + COL.r + '"/><circle cx="15" cy="20" r="4.6" ' + FACE + '/>'
    + '<circle cx="15" cy="20" r="2.8" fill="' + COL.b + '"/>';

  const glyph = (ch, y, size, fill, weight) => '<text x="15" y="' + y + '" font-size="' + size + '" text-anchor="middle" fill="' + fill + '" font-weight="' + (weight || 700) + '" ' + CJK + '>' + ch + '</text>';

  function faceSvg(id) {
    const info = MJ.tileInfo(id);
    let body = '';
    if (info.kind === 'suit') {
      if (info.suit === 'd') body = info.rank === 1 ? ONE_DOT : DOTS[info.rank].map((d) => dot(...d)).join('');
      else if (info.suit === 'b') body = info.rank === 1 ? BIRD : BAMBOO[info.rank].map((s) => stick(...s)).join('');
      else body = glyph(NUMERALS[info.rank - 1], 17, 14, COL.ink) + glyph('萬', 35, 14, COL.r);
    } else if (info.kind === 'wind') {
      body = glyph(info.zh, 27, 20, COL.ink);
    } else if (info.kind === 'dragon') {
      if (info.dragon === 'W') {
        body = '<rect x="6" y="7" width="18" height="26" rx="2" fill="none" stroke="' + COL.b + '" stroke-width="1.8"/>'
          + '<rect x="9" y="10" width="12" height="20" rx="1" fill="none" stroke="' + COL.b + '" stroke-width="0.8"/>';
      } else {
        body = glyph(info.zh, 28, 21, info.dragon === 'R' ? COL.r : COL.g);
      }
    } else if (info.kind === 'fei') {
      body = '<rect x="3" y="4" width="24" height="32" rx="3" fill="#ede7f6" stroke="#5e35b1" stroke-width="1"/>'
        + glyph('飛', 25, 18, '#5e35b1') + '<text x="15" y="34" font-size="5.5" font-weight="700" text-anchor="middle" fill="#5e35b1">JOKER</text>';
    } else if (info.kind === 'animal') {
      body = '<text x="15" y="25" font-size="14" text-anchor="middle">' + ANIMAL_PICTURES[id] + '</text>'
        + glyph(info.zh, 37, info.zh.length > 1 ? 6 : 7.5, COL.gold, 600);
    } else {
      const c = info.colour === 'red' ? COL.r : COL.b;
      body = '<text x="3.5" y="9" font-size="8" font-weight="700" fill="' + c + '">' + info.num + '</text>'
        + flowerArt(info.num, info.colour)
        + glyph(info.zh, 38.5, 6.5, c, 600);
    }
    return '<svg viewBox="0 0 30 40" width="100%" height="100%" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function tileEl(id, opts) {
    opts = opts || {};
    const info = MJ.tileInfo(id);
    const cls = ['tile', 'tile--' + info.kind, opts.small && 'tile--small', opts.extra].filter(Boolean).join(' ');
    const face = el('span', { class: 'tile__face' });
    face.innerHTML = faceSvg(id);
    return el(opts.onclick ? 'button' : 'span', {
      class: cls,
      type: opts.onclick ? 'button' : undefined,
      'data-en': info.en,
      title: info.name + ' ' + info.zh,
      'aria-label': (opts.ariaPrefix || '') + info.name,
      role: opts.onclick ? undefined : 'img',
      onclick: opts.onclick,
    }, [face]);
  }

  const emptyTile = (label) => el('span', { class: 'tile tile--empty', 'aria-label': label }, [el('span', { class: 'tile__sub', text: '?' })]);

  /** A hand drawn as tiles: concealed, then the winning tile, exposed sets and bonus tiles. */
  function handEl(hand, opts) {
    opts = opts || {};
    const parts = [el('span', { class: 'tiles' }, MJ.sortTiles(hand.concealed || []).map((id) => tileEl(id, { small: opts.small })))];
    if (hand.winningTile) {
      parts.push(el('span', { class: 'hand-plus', text: '+' }));
      parts.push(tileEl(hand.winningTile, { small: opts.small, extra: 'is-best' }));
    }
    (hand.melds || []).forEach((m) => parts.push(el('span', { class: 'meld' }, MJ.meldTiles(m).map((id) => tileEl(id, { small: true })))));
    if ((hand.bonus || []).length) {
      parts.push(el('span', { class: 'meld meld--bonus' }, hand.bonus.map((id) => tileEl(id, { small: true }))));
    }
    return el('div', { class: 'hand-view' }, parts);
  }

  const SET_LABELS = { chi: 'Chī 吃 · Chi', pong: 'Pèng 碰 · Pong', kong: 'Gàng 槓 · Kong', pair: 'Yǎn 眼 · Pair', wonders: 'Shí Sān Yāo 十三幺 · Thirteen Wonders' };

  /** A complete hand shown set by set, with the move's name above each group of tiles. Falls back to a plain hand. */
  function setsEl(hand, opts) {
    const groups = MJ.describeSets(hand);
    if (!groups) return handEl(hand, opts);
    return el('div', { class: 'sets-view' }, groups.map((g) => el('div', { class: 'set-group' + (g.revealed ? ' is-revealed' : '') }, [
      el('span', { class: 'set-group__label', text: SET_LABELS[g.type] + (g.revealed ? ' (revealed)' : '') }),
      el('span', { class: 'tile-row' }, g.tiles.map((id) => tileEl(id, { small: true, extra: hand.winningTile === id && !g.revealed ? 'is-winning' : '' }))),
    ])));
  }

  // ---------- English captions (a global, remembered setting) ----------

  const EN_KEY = 'howtomj.english.v1';
  function englishOn() {
    try { return localStorage.getItem(EN_KEY) === '1'; } catch (e) { return false; }
  }
  function setEnglish(on) {
    try { localStorage.setItem(EN_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
    document.body.classList.toggle('show-en', on);
  }

  const WIND_ZH = { E: '東', S: '南', W: '西', N: '北' };
  const WIND_EN = { E: 'East', S: 'South', W: 'West', N: 'North' };
  /** "South 南" — every wind name in the UI carries its character. */
  const windName = (w) => WIND_EN[w] + ' ' + WIND_ZH[w];

  window.UI = { el, tileEl, emptyTile, handEl, setsEl, faceSvg, englishOn, setEnglish, windName, WIND_ZH, WIND_EN };
})();
