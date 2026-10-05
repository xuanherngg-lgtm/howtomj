/* HowToMJ practice game: setup panel, table, actions, results and rewind. Exposes window.Play. */
(function () {
  'use strict';
  const MJ = window.MJ;
  const { el, tileEl, handEl, windName, WIND_ZH, WIND_EN } = window.UI;
  const { Game } = window.MJGame;
  const Sound = window.Sound;
  const SETTINGS_KEY = 'howtomj.play.v2';
  const LEVELS = {
    beginner: { label: 'Beginner', note: 'Bots play loosely and often miss the best tile.' },
    intermediate: { label: 'Intermediate', note: 'Bots play sensibly and claim useful tiles.' },
    expert: { label: 'Expert', note: 'Bots play to win and defend late in the hand.' },
  };
  const CALL_TEXT = { pong: 'Pong! 碰', chi: 'Chi! 吃', kong: 'Kong! 槓', hu: 'Hu! 胡', zimo: 'Zi Mo! 自摸', bite: 'Bite! 咬' };
  const CALL_SOUND = { pong: 'pong', chi: 'chi', kong: 'kong', bite: 'flower' };
  const CLAIM_NAMES = { pong: 'Pong 碰', chow: 'Chi 吃', kong: 'Kong 槓', win: 'Hu 胡', pass: 'Pass' };

  let container = null;
  let settingsHost = null;
  let boardHost = null;
  let game = null;
  let setupOpen = true;
  let active = false;
  let timer = null;
  let fxTimer = null;
  let selected = null;
  let selectedId = null;
  let hintShown = null;
  let hintFor = null;
  let lastEvent = 0;
  let replay = null; // { idx, auto }
  let placement = null; // { total, scores: [], recorded }
  let replayTimer = null;
  const bubbles = {};
  let floats = [];
  let diceAnim = null; // { rollUntil, showUntil, dice, sum, owner }
  const ROLL_MS = 1300;
  const SHOW_MS = 1700;

  const settings = loadSettings();

  function loadSettings() {
    const d = { difficulty: 'beginner', speed: 1.5, manual: true, alwaysHint: false, oneTaiZiMo: false, allowSevenPairs: true, fei: false };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch (e) { return d; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---------- Loop ----------

  function newGame(forPlacement) {
    game = new Game({
      manual: forPlacement ? false : settings.manual, difficulty: forPlacement ? 'intermediate' : settings.difficulty,
      oneTaiZiMo: settings.oneTaiZiMo, allowSevenPairs: settings.allowSevenPairs, fei: settings.fei,
    });
    lastEvent = 0;
    setupOpen = false;
    startHand();
  }

  function startHand() {
    stopReplay();
    replay = null;
    game.setManual(placement ? false : settings.manual);
    game.startHand();
    resetTurnUi();
    renderSettings();
    tick();
  }

  function resetTurnUi() {
    selected = null;
    selectedId = null;
    hintShown = null;
    hintFor = null;
  }

  function delayFor(phase) {
    const move = settings.speed * 1000;
    return {
      botDiscard: move,
      claims: Math.min(700, Math.max(250, move * 0.4)),
      nextDraw: Math.min(500, Math.max(200, move * 0.3)),
      dice: 900,
      deal: 350,
      replace: 600,
    }[phase] || 300;
  }

  function tick() {
    clearTimeout(timer);
    try { render(); } catch (e) { console.error(e); } // a drawing error must never stall the game
    if (!active || !game || setupOpen || game.needsHuman() || game.isOver()) return;
    timer = setTimeout(() => {
      game.advance();
      tick();
    }, delayFor(game.phase));
  }

  function act(fn) {
    try { fn(); } catch (e) { console.error(e); }
    resetTurnUi();
    tick();
  }

  // ---------- Events: sounds, speech bubbles, chip floats ----------

  function processEvents() {
    const now = Date.now();
    game.events.filter((e) => e.id > lastEvent).forEach((e) => {
      lastEvent = e.id;
      if (e.type === 'call') {
        bubbles[e.player] = { text: CALL_TEXT[e.call] || '!', until: now + 1800, call: e.call };
        if (e.call === 'hu' || e.call === 'zimo') Sound.play(game.players[e.player].isHuman ? 'win' : 'lose');
        else Sound.play(CALL_SOUND[e.call]);
      } else if (e.type === 'pay') {
        floats.push({ player: e.to, amount: e.amount, until: now + 2200 });
        floats.push({ player: e.from, amount: -e.amount, until: now + 2200 });
        Sound.play('chips');
      } else if (e.type === 'discard') Sound.play('discard');
      else if (e.type === 'draw' && game.players[e.player].isHuman) Sound.play('draw');
      else if (e.type === 'deal') Sound.play('deal');
      else if (e.type === 'dice') {
        Sound.play('dice');
        diceAnim = { rollUntil: now + ROLL_MS, showUntil: now + ROLL_MS + SHOW_MS, dice: e.dice, owner: game.breakOwner };
      }
      else if (e.type === 'bonus') Sound.play('flower');
    });
    floats = floats.filter((f) => f.until > now);
    Object.keys(bubbles).forEach((k) => { if (bubbles[k].until <= now) delete bubbles[k]; });
    if (diceAnim && diceAnim.showUntil <= now) diceAnim = null;
    const times = floats.map((f) => f.until).concat(Object.values(bubbles).map((b) => b.until));
    if (diceAnim) times.push(diceAnim.rollUntil > now ? now + 90 : diceAnim.showUntil); // tumble the dice faces while rolling
    const next = Math.min(...times);
    clearTimeout(fxTimer);
    if (Number.isFinite(next)) fxTimer = setTimeout(safeRender, Math.max(16, next - now + 20));
  }

  function safeRender() { try { render(); } catch (e) { console.error(e); } }

  // ---------- Dice ----------

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieEl(n, extra) {
    return el('span', { class: 'die' + (extra ? ' ' + extra : ''), role: 'img', 'aria-label': 'Die showing ' + n }, Array.from({ length: 9 }, (_, k) =>
      el('span', { class: 'die__pip' + (PIPS[n].includes(k) ? ' is-on' : '') + ((n === 1 || n === 4) ? ' is-red' : '') })));
  }

  function diceOverlay() {
    if (!diceAnim) return null;
    const rolling = diceAnim.rollUntil > Date.now();
    const faces = rolling ? [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] : diceAnim.dice;
    const sum = diceAnim.dice[0] + diceAnim.dice[1];
    return el('div', { class: 'dice-overlay' + (rolling ? ' is-rolling' : ' is-settled'), role: 'status', 'aria-live': 'polite' }, [
      el('div', { class: 'dice-overlay__dice' }, faces.map((n, k) => dieEl(n, rolling ? 'die--roll die--roll' + k : 'die--land'))),
      rolling ? el('div', { class: 'dice-overlay__text', text: game.label(game.dealer) + ' ' + game.verb(game.dealer, 'throw', 'throws') + ' the dice…' })
        : el('div', { class: 'dice-overlay__text' }, [
          el('strong', { text: diceAnim.dice[0] + ' + ' + diceAnim.dice[1] + ' = ' + sum }),
          el('span', { text: 'The wall breaks in front of ' + game.label(diceAnim.owner) + ', ' + sum + ' stacks from the right' }),
        ]),
    ]);
  }

  // ---------- Small pieces ----------

  const isTurn = (i) => !game.isOver() && game.turn === i && !['dealing', 'dice', 'humanDice', 'deal', 'humanDeal'].includes(game.phase);
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
  const tiny = (id, extra) => tileEl(id, { small: true, extra: 'tile--tiny' + (extra ? ' ' + extra : '') });
  const tileRow = (ids, extra) => el('span', { class: 'tile-row' }, ids.map((id) => tiny(id, extra)));

  function windBadge(i, big) {
    const s = game.seatOf(i);
    return el('span', { class: 'wind-badge' + (big ? ' wind-badge--big' : '') + (game.dealer === i ? ' is-dealer' : ''), title: windName(s) + (game.dealer === i ? ' · dealer 莊' : '') }, [
      el('span', { class: 'wind-badge__zh', text: WIND_ZH[s] }),
      el('span', { class: 'wind-badge__en', text: WIND_EN[s] }),
    ]);
  }

  // ---------- Setup panel (before the game) ----------

  function seg(name, opts, value, onpick) {
    return el('div', { class: 'seg', role: 'group', 'aria-label': name }, opts.map(([v, label]) => el('button', {
      'aria-pressed': String(value === v), onclick: () => onpick(v), text: label,
    })));
  }
  const check = (label, on, onchange, note) => el('label', { class: 'check' }, [
    el('input', { type: 'checkbox', checked: on, onchange: (e) => onchange(e.target.checked) }),
    el('span', {}, [label, note ? el('span', { class: 'muted check__note', text: ' ' + note }) : null]),
  ]);

  function speedControl() {
    const label = el('span', { class: 'muted', text: settings.speed.toFixed(1) + ' s per bot move' });
    const input = el('input', {
      type: 'range', min: '0.5', max: '10', step: '0.5', value: String(settings.speed), 'aria-label': 'Bot speed in seconds per move',
      oninput: (e) => { settings.speed = Number(e.target.value); saveSettings(); label.textContent = settings.speed.toFixed(1) + ' s per bot move'; },
    });
    return el('div', { class: 'field' }, ['Bot speed', input, label]);
  }

  function setupPanel() {
    return el('section', { class: 'card setup' }, [
      el('h2', { text: 'Set up your game' }),
      el('p', { class: 'muted', text: 'Choose how you want to play. Manual play, hints, sound, English names and bot speed can also be changed during the game.' }),
      el('div', { class: 'setup__grid' }, [
        el('div', { class: 'setup__group' }, [
          el('h3', { text: 'Opponents' }),
          el('div', { class: 'field' }, ['Bot level', seg('Bot level', Object.entries(LEVELS).map(([k, m]) => [k, m.label]), settings.difficulty, (v) => { settings.difficulty = v; saveSettings(); renderSetup(); }),
            el('span', { class: 'muted', text: LEVELS[settings.difficulty].note })]),
          speedControl(),
        ]),
        el('div', { class: 'setup__group' }, [
          el('h3', { text: 'How you play' }),
          check('Manual play: throw the dice, take your stacks and draw every tile yourself', settings.manual, (on) => { settings.manual = on; saveSettings(); }),
          check('Always show hints', settings.alwaysHint, (on) => { settings.alwaysHint = on; saveSettings(); }, '(otherwise press Hint when you want one)'),
          check('Mahjong sound effects', Sound.enabled, (on) => Sound.setEnabled(on)),
          check('English names on tiles', window.UI.englishOn(), (on) => { window.UI.setEnglish(on); window.HowToMJ && window.HowToMJ.syncEnglish(); }),
        ]),
        el('div', { class: 'setup__group' }, [
          el('h3', { text: 'House rules' }),
          check('Fei 飛 jokers', settings.fei, (on) => { settings.fei = on; saveSettings(); }, '— adds 4 wild tiles that can stand in for any tile in a set or the pair (152 tiles).'),
          check('Seven Pairs 七對子 allowed', settings.allowSevenPairs, (on) => { settings.allowSevenPairs = on; saveSettings(); }),
          check('一台自摸 (Yī Tái Zì Mō): a hand worth only 1 tai must be self-drawn to win', settings.oneTaiZiMo, (on) => { settings.oneTaiZiMo = on; saveSettings(); }, '(not played at every table)'),
          el('p', { class: 'muted', text: 'Always: 1 tai minimum, 5 tai cap, 300 chips each.' }),
        ]),
      ]),
      el('div', { class: 'actions' }, [el('button', { class: 'btn btn--primary btn--big', onclick: () => { Sound.play('dice'); newGame(); }, text: 'Start game' })]),
    ]);
  }

  function renderSetup() {
    settingsHost.replaceChildren();
    boardHost.replaceChildren(setupPanel());
  }

  // ---------- In-game options ----------

  function optionsPanel() {
    const rules = [settings.fei ? 'Fei 飛 jokers' : null, settings.allowSevenPairs ? 'Seven Pairs' : 'No Seven Pairs', settings.oneTaiZiMo ? '一台自摸' : null].filter(Boolean).join(' · ');
    return el('details', { class: 'settings' }, [
      el('summary', { text: '⚙ Options · ' + LEVELS[settings.difficulty].label + ' · ' + settings.speed.toFixed(1) + ' s' + (settings.manual ? ' · Manual' : '') + (settings.alwaysHint ? ' · Hints on' : '') }),
      el('div', { class: 'settings__grid' }, [
        speedControl(),
        el('div', { class: 'field' }, [
          check('Manual play (dice, dealing and drawing)', settings.manual, (on) => { settings.manual = on; saveSettings(); game.setManual(on); resetTurnUi(); renderSettings(); tick(); }),
          check('Always show hints', settings.alwaysHint, (on) => { settings.alwaysHint = on; saveSettings(); hintFor = null; if (!on) hintShown = null; renderSettings(); render(); }),
        ]),
        el('div', { class: 'field' }, [
          check('Sound effects', Sound.enabled, (on) => Sound.setEnabled(on)),
          check('English names on tiles', window.UI.englishOn(), (on) => { window.UI.setEnglish(on); window.HowToMJ && window.HowToMJ.syncEnglish(); render(); }),
          el('span', { class: 'muted', text: 'Bots: ' + LEVELS[settings.difficulty].label + '. House rules: ' + rules + '. These are set when the game starts.' }),
        ]),
      ]),
    ]);
  }

  // ---------- Full screen (computers) ----------

  const canFullscreen = () => !!(document.fullscreenEnabled && container && container.requestFullscreen);
  const isFullscreen = () => document.fullscreenElement === container;
  function toggleFullscreen() {
    if (isFullscreen()) document.exitFullscreen();
    else container.requestFullscreen().catch((e) => console.error(e));
  }
  document.addEventListener('fullscreenchange', () => { renderSettings(); safeRender(); });

  function statusBar() {
    return el('div', { class: 'table-bar' }, [
      el('span', {}, [el('strong', { text: placement ? '🀄 Placement match · hand ' + game.handNo + ' of ' + placement.total : 'Hand ' + game.handNo }), ' · Round wind ' + windName(game.prevalent)]),
      canFullscreen() ? el('button', { class: 'btn btn--ghost fs-btn', onclick: toggleFullscreen, title: isFullscreen() ? 'Exit full screen (Esc)' : 'Play in full screen', text: isFullscreen() ? '✕ Exit full screen' : '⛶ Full screen' }) : null,
      el('button', { class: 'btn btn--ghost', onclick: () => { if (confirm('Start a new game? Everyone goes back to 300 chips.')) { game = null; placement = null; stopReplay(); clearTimeout(timer); setupOpen = true; renderSetup(); } }, text: 'New game' }),
    ]);
  }

  function renderSettings() {
    if (!settingsHost || !game || setupOpen) return;
    const wasOpen = settingsHost.querySelector('details.settings');
    settingsHost.replaceChildren(statusBar(), optionsPanel());
    if (wasOpen) settingsHost.querySelector('details.settings').open = wasOpen.open;
  }

  // ---------- The table ----------

  function seatPanel(i, pos) {
    const p = game.players[i];
    const delta = game.handDelta ? game.handDelta[i] : 0;
    const over = game.isOver();
    const sets = p.melds.map((m) => el('span', { class: 'meld' }, MJ.meldTiles(m).map((id) => tiny(id))));
    const bubble = bubbles[i];
    return el('section', { class: 'seat-panel seat-panel--' + pos + (isTurn(i) ? ' is-turn' : '') + (p.isHuman ? ' is-me' : ''), 'aria-label': (p.isHuman ? 'You' : p.name) + ', ' + windName(game.seatOf(i)) }, [
      el('div', { class: 'seat-panel__id' }, [
        windBadge(i, true),
        el('span', { class: 'seat-panel__who' }, [
          el('strong', { text: p.isHuman ? 'You' : p.name }),
          el('span', { class: 'seat-panel__chips', text: p.chips + ' chips' }),
          game.dealer === i ? el('span', { class: 'dealer-tag', text: 'Dealer 莊' }) : null,
        ]),
      ]),
      delta || over ? el('span', { class: 'delta' + (delta > 0 ? ' delta--up' : delta < 0 ? ' delta--down' : '') + (over ? ' delta--big' : ''), title: 'Chips won or lost this hand', text: signed(delta) }) : null,
      p.isHuman ? null : el('div', { class: 'seat-panel__backs', title: p.hand.length + ' tiles in hand' }, [el('span', { class: 'tile-back' }), '×' + p.hand.length]),
      p.bonus.length ? el('div', { class: 'seat-panel__flowers', title: 'Flowers and animals' }, p.bonus.map((id) => tileEl(id, { small: true, extra: 'tile--flower-seat' }))) : null,
      sets.length ? el('div', { class: 'seat-panel__sets' }, sets) : null,
      isTurn(i) && !over ? el('span', { class: 'seat-panel__turn', text: p.isHuman ? 'Your turn' : 'Thinking…' }) : null,
      bubble ? el('span', { class: 'bubble bubble--' + bubble.call, role: 'status', text: bubble.text }) : null,
      ...floats.filter((f) => f.player === i).map((f) => el('span', { class: 'float ' + (f.amount > 0 ? 'float--up' : 'float--down'), text: signed(f.amount) })),
    ]);
  }

  function pondFor(name, discards, pos, opts) {
    opts = opts || {};
    return el('div', { class: 'pond pond--' + pos + (opts.turn ? ' is-turn' : '') }, [
      el('div', { class: 'pond__label', text: name + ' discards' }),
      discards.length
        ? el('div', { class: 'tiles tiles--tiny' }, discards.map((id, k) => tiny(id, opts.lastHighlight && k === discards.length - 1 ? 'is-last' : '')))
        : el('div', { class: 'pond__empty', text: '—' }),
    ]);
  }

  function pond(i, pos) {
    const p = game.players[i];
    return pondFor(p.isHuman ? 'Your' : p.name + "'s", p.discards, pos, { turn: isTurn(i), lastHighlight: game.lastDiscard && game.lastDiscard.from === i });
  }

  function wallSide(side, view) {
    const seg2 = game.segments[side];
    let positions = Array.from({ length: seg2.len }, (_, k) => seg2.start + k);
    if (side === 'bottom' || side === 'left') positions = positions.reverse();
    return el('div', { class: 'wall wall--' + side, 'aria-hidden': 'true' }, positions.map((pos) => {
      const n = view.counts[pos] || 0;
      return el('span', { class: 'stk stk--' + n + (pos === view.front ? ' is-front' : '') + (pos === view.back ? ' is-back' : '') });
    }));
  }

  function compass() {
    const ld = game.lastDiscard;
    const children = [
      el('div', { class: 'round-wind', title: 'Round (prevalent) wind 圈風' }, [
        el('span', { class: 'round-wind__label', text: 'Round wind' }),
        el('span', { class: 'round-wind__zh', text: WIND_ZH[game.prevalent] }),
        el('span', { class: 'round-wind__en', text: WIND_EN[game.prevalent] }),
      ]),
      el('div', { class: 'pond__wall', text: game.tilesLeft + ' tiles left' }),
    ];
    if (game.dice && !diceAnim) children.push(el('div', { class: 'dice', title: 'Dice: ' + game.dice.join(' + ') }, game.dice.map((d) => dieEl(d, 'die--small'))));
    if (ld) children.push(el('div', { class: 'last-discard' }, [tileEl(ld.tile, { extra: 'is-last' }), el('span', { class: 'pond__label', text: 'Last discard · ' + game.label(ld.from) })]));
    if (game.isOver()) children.push(winBanner());
    return el('div', { class: 'pond pond--mid' }, children);
  }

  function winBanner() {
    const r = game.result;
    if (r.type === 'draw') return el('div', { class: 'win-banner win-banner--draw' }, [el('strong', { text: 'Draw 流局' }), el('span', { text: 'The wall ran out. Nobody pays.' })]);
    const ev = r.evaluation;
    return el('div', { class: 'win-banner' }, [
      el('strong', { text: (r.selfDraw ? 'Zi Mo 自摸! ' : 'Hu 胡! ') + game.label(r.winner) }),
      el('span', { text: ev.tai + ' tai · ' + (r.selfDraw ? ev.payout.each + ' chips from each player' : ev.payout.shooterPays + ' chips from ' + game.label(r.shooter)) }),
    ]);
  }

  function tableView() {
    const h = game.viewer;
    const seatAt = { bottom: h, right: (h + 1) % 4, top: (h + 2) % 4, left: (h + 3) % 4 };
    const view = game.wallView();
    return el('div', { class: 'mj-table' }, [
      seatPanel(seatAt.top, 'top'),
      seatPanel(seatAt.left, 'left'),
      el('section', { class: 'centre-table', 'aria-label': 'The wall and discards' }, [
        wallSide('top', view),
        wallSide('left', view),
        el('div', { class: 'centre-inner' }, [compass(), pond(seatAt.top, 'top'), pond(seatAt.left, 'left'), pond(seatAt.right, 'right'), pond(seatAt.bottom, 'bottom')]),
        wallSide('right', view),
        wallSide('bottom', view),
        diceOverlay(),
      ]),
      seatPanel(seatAt.right, 'right'),
      seatPanel(seatAt.bottom, 'bottom'),
      // Your hand and your actions (with the hint) sit on the table itself.
      el('div', { class: 'table-hand' }, [myArea(), game.isOver() ? null : actionBar()]),
    ]);
  }

  // ---------- Your hand and actions ----------

  function myArea() {
    const h = game.human;
    const myTurn = game.phase === 'humanTurn';
    const hint = hintShown;
    let rest = h.hand.slice();
    let drawn = null;
    if (myTurn && game.drawn && rest[rest.length - 1] === game.drawn) drawn = rest.pop();
    rest = MJ.sortTiles(rest);
    const blocked = (id) => myTurn && !game.canThrow(id);
    const tileFor = (id, key) => tileEl(id, {
      onclick: myTurn ? () => {
        if (blocked(id)) { hintShown = { text: 'You cannot throw ' + MJ.tileName(id) + ' straight after your claim: it would make the same set you just claimed. Throw a different tile.' }; render(); return; }
        if (selected === key) act(() => game.humanDiscard(id));
        else { selected = key; selectedId = id; Sound.play('tap'); render(); }
      } : undefined,
      ariaPrefix: myTurn ? (blocked(id) ? 'Cannot throw ' : 'Throw ') : '',
      extra: [selected === key ? 'is-selected' : '', hint && hint.type === 'discard' && hint.tile === id ? 'is-best' : '', MJ.isBonus(id) ? 'is-bonus' : '', blocked(id) ? 'is-blocked' : ''].join(' '),
    });
    const tiles = rest.map((id, k) => tileFor(id, 'h' + k));
    return el('section', { class: 'seat seat--me' + (myTurn ? ' is-turn' : ''), 'aria-label': 'Your hand' }, [
      el('div', { class: 'hand-row__label', text: 'Your hand · ' + windName(game.seatOf(h.index)) }),
      el('div', { class: 'my-hand' }, [
        el('div', { class: 'tiles' }, tiles.concat(drawn ? [el('span', { class: 'my-hand__drawn', title: 'The tile you just drew' }, [tileFor(drawn, 'drawn')])] : [])),
      ]),
    ]);
  }

  function hintBox() {
    if (!hintShown) return null;
    return el('div', { class: 'feedback feedback--ok hint-box' }, [
      el('strong', { text: 'Hint: ' }),
      hintShown.tiles ? tileRow(hintShown.tiles) : null,
      el('span', { text: ' ' + hintShown.text }),
    ]);
  }

  function ensureAutoHint() {
    const key = game.phase + ':' + game.turnCount + ':' + (game.pending ? game.pending.tile + game.pending.from : '');
    if (!placement && settings.alwaysHint && (game.phase === 'humanTurn' || game.phase === 'humanClaim') && hintFor !== key) {
      hintShown = game.hint();
      hintFor = key;
    }
  }

  function actionBar() {
    const items = [];
    const buttons = [];
    const hintBtn = settings.alwaysHint || placement ? null : el('button', { class: 'btn', onclick: () => { hintShown = game.hint(); render(); }, text: 'Hint' });
    const big = (text, onclick) => el('button', { class: 'btn btn--primary btn--big', onclick, text });

    switch (game.phase) {
      case 'humanDice':
        items.push(el('p', { class: 'prompt', text: 'You are the dealer (East 東). Throw the dice to break the wall.' }));
        buttons.push(big('🎲 Throw the dice', () => act(() => game.humanRollDice())));
        break;
      case 'humanDeal': {
        const s = game.dealStepNow;
        items.push(el('p', { class: 'prompt', text: 'Dealing: take your tiles from the front of the wall (clockwise from the break).' }));
        buttons.push(big(s.n === 4 ? 'Take 2 stacks (4 tiles)' : s.n === 2 ? 'Take 2 tiles' : 'Take 1 tile', () => act(() => game.humanDealTake())));
        break;
      }
      case 'humanReplace': {
        const rf = game.replaceFor;
        if (rf.reason === 'kong') {
          items.push(el('p', { class: 'prompt', text: 'Kong! Take a replacement tile from the BACK of the wall.' }));
          buttons.push(big('Draw replacement from the back', () => act(() => game.humanReplace())));
        } else {
          const b = game.human.hand.find(MJ.isBonus);
          items.push(el('div', { class: 'prompt prompt--claim' }, [
            el('span', { text: 'You have a bonus tile: ' }), tiny(b), el('span', { text: ' Reveal it and take a replacement from the BACK of the wall.' }),
          ]));
          buttons.push(big('Reveal ' + MJ.tileInfo(b).zh + ' and draw from the back', () => act(() => game.humanReplace())));
        }
        break;
      }
      case 'humanDraw':
        items.push(el('p', { class: 'prompt', text: 'Your turn: draw a tile from the front of the wall.' }));
        buttons.push(big('Draw a tile 摸牌', () => act(() => game.humanDrawTile())));
        break;
      case 'humanTurn': {
        const o = game.options || { kongs: [] };
        items.push(el('p', { class: 'prompt', text: o.win ? 'You can win! Declare Zi Mo, or keep playing.' : 'Your turn: tap a tile to select it, then tap again or press Throw.' }));
        const blockedTiles = [...new Set((game.forbidden || []).filter((x) => game.human.hand.includes(x)))];
        if (blockedTiles.length) {
          items.push(el('div', { class: 'prompt prompt--claim rule-note' }, [
            el('span', { text: 'No swapping: after your claim you cannot throw ' }), tileRow(blockedTiles),
            el('span', { text: ' this turn — it would make the same set you just claimed.' }),
          ]));
        }
        if (o.win) buttons.push(el('button', { class: 'btn btn--win', onclick: () => act(() => game.humanWin()), text: 'Zi Mo 自摸!' }));
        o.kongs.forEach((k) => buttons.push(el('button', { class: 'btn btn--tiles', onclick: () => act(() => game.humanKong(k)) }, [
          el('span', { text: (k.type === 'concealed' ? 'Concealed Kong' : 'Kong') + ' 槓' }), tileRow([k.tile, k.tile, k.tile, k.tile]),
        ])));
        buttons.push(el('button', { class: 'btn btn--primary', disabled: selected === null, onclick: () => { const id = selectedId; act(() => game.humanDiscard(id)); }, text: 'Throw' }));
        if (hintBtn) buttons.push(hintBtn);
        break;
      }
      case 'humanClaim': {
        const pd = game.pending;
        const o = pd.human;
        items.push(el('div', { class: 'prompt prompt--claim' }, [
          el('span', { text: game.label(pd.from) + ' threw ' }), tileEl(pd.tile, { small: true }), el('span', { text: ' Claim it?' }),
        ]));
        if (o.win) buttons.push(el('button', { class: 'btn btn--win', onclick: () => act(() => game.humanWin()), text: 'Hu 胡!' }));
        if (o.kong) buttons.push(el('button', { class: 'btn btn--tiles', onclick: () => act(() => game.humanClaim({ type: 'kong' })) }, [el('span', { text: 'Kong 槓' }), tileRow([pd.tile, pd.tile, pd.tile, pd.tile])]));
        if (o.pong) buttons.push(el('button', { class: 'btn btn--tiles', onclick: () => act(() => game.humanClaim({ type: 'pong' })) }, [el('span', { text: 'Pong 碰' }), tileRow([pd.tile, pd.tile, pd.tile])]));
        o.chows.forEach((c) => buttons.push(el('button', { class: 'btn btn--tiles', onclick: () => act(() => game.humanClaim({ type: 'chow', chow: c })) }, [el('span', { text: 'Chi 吃' }), tileRow(c.tiles)])));
        buttons.push(el('button', { class: 'btn btn--primary', onclick: () => act(() => game.humanClaim({ type: 'pass' })), text: 'Pass' }));
        if (hintBtn) buttons.push(hintBtn);
        break;
      }
      default: {
        const t = game.turn !== undefined ? game.turn : game.dealer;
        const who = game.phase === 'dice' ? game.label(game.dealer) + ' is throwing the dice…'
          : game.phase === 'deal' ? 'Dealing…'
            : game.phase === 'replace' ? game.label(game.replaceFor.player) + ' is replacing flowers…'
              : game.players[t] && game.players[t].isHuman ? 'Drawing your tile…' : game.label(t) + ' is thinking…';
        items.push(el('p', { class: 'prompt muted', text: who }));
      }
    }
    const hb = hintBox();
    if (hb) items.push(hb);
    if (buttons.length) items.push(el('div', { class: 'actions' }, buttons));
    return el('section', { class: 'action-bar', role: 'region', 'aria-label': 'Your actions' }, items);
  }

  // ---------- Result and review ----------

  /** Who threw the tile in a review item (self-drawn tiles have no thrower). */
  const fromName = (it) => (it.from !== undefined && it.from !== null ? game.label(it.from) : 'Someone');

  function reviewLine(it, from) {
    if (it.type === 'missedWin') {
      return [el('strong', { class: 'review--bad', text: 'Missed win: ' }), tiny(it.tile),
        el('span', { text: it.selfDraw ? ' You drew this and could have declared Zi Mo 自摸.' : ' ' + from + ' threw this and you could have called Hu 胡.' })];
    }
    if (it.type === 'betterDiscard') {
      return [el('span', { text: 'You threw ' }), tiny(it.chosen, 'is-wrong-tile'), el('span', { text: ' — better was ' }), tiny(it.best, 'is-best'), el('span', { text: '. ' + it.bestOpt.summary })];
    }
    if (it.type === 'claimAdvice') {
      return [tiny(it.tile), el('span', { text: it.suggestion === 'pass'
        ? ' You claimed (' + (CLAIM_NAMES[it.chosen] || it.chosen) + '), but passing kept your hand stronger.'
        : ' You could have called ' + (CLAIM_NAMES[it.suggestion] || it.suggestion) + ': ' }),
      it.tiles ? tileRow(it.tiles) : null, it.why ? el('span', { class: 'muted', text: ' ' + it.why }) : null];
    }
    return [tiny(it.tile), el('span', { text: ' completed your hand, but it had 0 tai, so you could not Hu. Keeping Men Qing 門清 (no revealed sets), a dragon pong or your own flower would have given you a tai.' })];
  }

  function reviewView(rv) {
    if (!rv) return null;
    const lines = rv.items.slice(0, 6).map((it) => el('li', {}, [el('strong', { text: 'Turn ' + it.turn + ': ' })].concat(reviewLine(it, fromName(it)))));
    if (rv.waits.length) lines.push(el('li', {}, [el('strong', { text: 'You were ready (ting) waiting for: ' }), tileRow(rv.waits)]));
    if (!lines.length) lines.push(el('li', { text: rv.won ? 'You won, and followed the best moves. Well played!' : 'No big mistakes this hand. Sometimes the tiles just don’t come.' }));
    return el('div', { class: 'review' }, [el('h3', { text: 'Your review: how you could have won earlier' }), el('ul', {}, lines)]);
  }

  // ---------- Placement match: the bots judge your play ----------

  const PLACEMENT_LEVELS = [
    { min: 90, skip: 9, label: 'Expert', text: 'You play like a seasoned player. Lessons 1–9 are marked done: jump to house rules, or straight into games.' },
    { min: 75, skip: 7, label: 'Strong player', text: 'Solid play. Lessons 1–7 are marked done: carry on with Defence.' },
    { min: 60, skip: 5, label: 'Player', text: 'You know the game. Lessons 1–5 are marked done: carry on with Waits and Ka Long.' },
    { min: 45, skip: 3, label: 'Learner', text: 'You know the basics. Lessons 1–3 are marked done: carry on with How a game flows.' },
    { min: 0, skip: 0, label: 'Beginner', text: 'Start from Lesson 1 — it will make the rest much easier.' },
  ];

  /** Scores one hand out of 100 from your discards, claims and result. */
  function assessHand() {
    const ds = game.decisions;
    const disc = ds.filter((d) => d.kind === 'discard');
    const good = disc.filter((d) => d.chosen === d.best || (d.chosenOpt && d.bestOpt && d.chosenOpt.shanten === d.bestOpt.shanten && d.chosenOpt.live >= d.bestOpt.live - 4)).length;
    const accuracy = disc.length ? good / disc.length : 0.5;
    const claims = ds.filter((d) => d.kind === 'claim' && !d.couldWin);
    const claimGood = claims.length ? claims.filter((d) => d.chosen === d.suggestion).length / claims.length : 1;
    const missed = ((game.result.review || {}).items || []).filter((i) => i.type === 'missedWin').length;
    const won = game.result.type === 'win' && game.result.winner === game.viewer;
    const shot = game.result.type === 'win' && game.result.shooter === game.viewer;
    const score = Math.max(0, Math.min(100, Math.round(65 * accuracy + 15 * claimGood + (won ? 20 : 0) - (shot ? 5 : 0) - 15 * missed)));
    return { score, accuracy, good, discards: disc.length, claimGood, claims: claims.length, missed, won, shot };
  }

  function placementCard() {
    if (!placement.recorded) { placement.scores.push(assessHand()); placement.recorded = true; }
    const a = placement.scores[placement.scores.length - 1];
    const lines = [
      'Discards: ' + a.good + ' of ' + a.discards + ' matched a strong player (' + Math.round(a.accuracy * 100) + '%)',
      a.claims ? 'Claims: ' + Math.round(a.claimGood * 100) + '% good calls on Pong / Chi' : 'Claims: none needed',
      a.won ? 'You won the hand! (+20)' : a.shot ? 'You threw the winning tile (−5)' : 'You did not win this hand',
      a.missed ? 'Missed wins: ' + a.missed + ' (−15 each)' : 'No missed wins',
    ];
    const out = [el('h2', { text: '🀄 Placement hand ' + placement.scores.length + ' of ' + placement.total + ': ' + a.score + '/100' }), el('ul', { class: 'mini-lines' }, lines.map((l) => el('li', { text: l })))];
    if (placement.scores.length < placement.total) {
      out.push(el('div', { class: 'actions' }, [el('button', { class: 'btn btn--primary btn--big', onclick: () => { placement.recorded = false; startHand(); }, text: 'Next placement hand' })]));
    } else {
      const avg = Math.round(placement.scores.reduce((t, x) => t + x.score, 0) / placement.scores.length);
      const level = PLACEMENT_LEVELS.find((l) => avg >= l.min);
      out.push(el('div', { class: 'placement-result' }, [
        el('div', { class: 'big' }, [el('span', { class: 'big__num', text: String(avg) }), el('span', { class: 'big__unit', text: '/100 · ' + level.label })]),
        el('p', { text: level.text }),
      ]));
      out.push(el('div', { class: 'actions' }, [
        el('button', { class: 'btn btn--primary btn--big', onclick: () => { const n = level.skip; placement = null; game = null; setupOpen = true; window.Learn.applyPlacement(n); window.HowToMJ.setMode('learn'); }, text: level.skip ? 'Skip ahead: go to my lessons' : 'Go to Lesson 1' }),
        el('button', { class: 'btn btn--big', onclick: () => { placement = { total: 2, scores: [], recorded: false }; newGame(true); }, text: 'Try the placement again' }),
      ]));
    }
    return el('section', { class: 'card result-panel placement-panel' }, out);
  }

  function resultCard() {
    const r = game.result;
    if (placement) return el('div', { class: 'placement-wrap' }, [placementCard(), resultDetails()]);
    return resultDetails();
  }

  function resultDetails() {
    const r = game.result;
    const out = [];
    if (r.type === 'win') {
      const ev = r.evaluation;
      out.push(el('h2', { text: (r.winner === game.viewer ? 'You win' : game.label(r.winner) + ' wins') + ' with ' + ev.tai + ' tai!' }));
      out.push(handEl(r.hand, { small: true }));
      out.push(el('table', { class: 'items' }, [el('tbody', {}, ev.items.map((i) => el('tr', {}, [
        el('td', { text: i.name }), el('td', { class: 'zh', text: i.zh }), el('td', { class: 'tai', text: '+' + i.tai }),
      ])).concat([el('tr', { class: 'total' }, [el('td', { text: ev.rawTai > ev.tai ? 'Total (capped from ' + ev.rawTai + ')' : 'Total' }), el('td', {}), el('td', { class: 'tai', text: ev.tai + ' tai' })])]))]));
    } else {
      out.push(el('h2', { text: 'Draw: the wall ran out' }));
    }
    out.push(el('p', { class: 'muted', text: 'Chips won and lost this hand are shown at each seat on the table.' }));
    out.push(reviewView(r.review));
    const keys = game.frames.filter((f) => f.review).length;
    out.push(el('div', { class: 'actions' }, [
      el('button', { class: 'btn btn--primary btn--big', onclick: startHand, text: 'Next hand' }),
      el('button', { class: 'btn btn--big', onclick: () => openReplay(), text: '⏪ Rewind this hand' + (keys ? ' (' + keys + ' key moment' + (keys === 1 ? '' : 's') + ')' : '') }),
    ]));
    return el('section', { class: 'card result-panel' }, out);
  }

  // ---------- Rewind ----------

  function openReplay() {
    replay = { idx: 0, auto: false };
    render();
    window.scrollTo(0, container.offsetTop);
  }

  function stopReplay() {
    clearInterval(replayTimer);
    replayTimer = null;
    if (replay) replay.auto = false;
  }

  function goFrame(i) {
    replay.idx = Math.max(0, Math.min(game.frames.length - 1, i));
    render();
  }

  function nextKey() {
    const f = game.frames.findIndex((fr, k) => k > replay.idx && fr.review);
    goFrame(f >= 0 ? f : game.frames.length - 1);
  }

  function toggleAuto() {
    if (replay.auto) { stopReplay(); render(); return; }
    replay.auto = true;
    replayTimer = setInterval(() => {
      if (replay.idx >= game.frames.length - 1) { stopReplay(); render(); return; }
      replay.idx++;
      // Stop at each moment where a better play was available.
      if (game.frames[replay.idx].review) stopReplay();
      render();
    }, Math.max(500, settings.speed * 500));
    render();
  }

  function frameText(f) {
    const a = f.action;
    const who = game.label(a.player);
    const v = (you, they) => game.verb(a.player, you, they);
    if (a.type === 'discard') return [el('span', { text: who + ' ' + v('throw', 'throws') + ' ' }), tiny(a.tile)];
    if (a.type === 'decide') return [el('span', { text: 'You chose ' + (CLAIM_NAMES[a.choice] || a.choice) + ' on ' }), tiny(a.tile)];
    if (a.type === 'win') return [el('span', { text: who + ' ' + v('win', 'wins') + (a.selfDraw ? ' by self-draw on ' : ' on ') }), tiny(a.tile)];
    return [el('span', { text: who + ' ' + v('call', 'calls') + ' ' + (CLAIM_NAMES[a.type] || a.type) + ' on ' }), tiny(a.tile)];
  }

  function replayView() {
    const frames = game.frames;
    const f = frames[replay.idx];
    const h = game.viewer;
    const seatAt = { bottom: h, right: (h + 1) % 4, top: (h + 2) % 4, left: (h + 3) % 4 };
    const name = (i) => (game.players[i].isHuman ? 'Your' : game.players[i].name + "'s");
    const keyIdx = frames.map((fr, k) => (fr.review ? k : -1)).filter((k) => k >= 0);
    const it = f.review;
    const handTiles = f.hand.map((id) => {
      let extra = '';
      if (it && it.type === 'betterDiscard' && id === it.best) extra = 'is-best';
      else if (it && it.type === 'betterDiscard' && id === it.chosen) extra = 'is-wrong-tile';
      else if (!it && f.action.type === 'discard' && game.players[f.action.player].isHuman && id === f.action.tile) extra = 'is-selected';
      return tileEl(id, { small: true, extra });
    });
    return el('section', { class: 'card replay' }, [
      el('div', { class: 'replay__head' }, [
        el('h2', { text: '⏪ Rewind: hand ' + game.handNo }),
        el('button', { class: 'btn', onclick: () => { stopReplay(); replay = null; render(); }, text: 'Back to results' }),
      ]),
      el('p', { class: 'muted', text: 'Step through every move. Auto-play stops at each key moment (⚠) where a better play was available.' }),
      el('div', { class: 'replay__controls' }, [
        el('button', { class: 'btn', onclick: () => goFrame(0), title: 'Start', text: '⏮' }),
        el('button', { class: 'btn', onclick: () => goFrame(replay.idx - 1), title: 'Previous move', text: '◀' }),
        el('button', { class: 'btn btn--primary', onclick: toggleAuto, text: replay.auto ? '⏸ Pause' : '▶ Play' }),
        el('button', { class: 'btn', onclick: () => goFrame(replay.idx + 1), title: 'Next move', text: '▶' }),
        el('button', { class: 'btn', onclick: nextKey, title: 'Next key moment', text: '⏭ Next key moment' }),
        el('span', { class: 'muted', text: 'Move ' + (replay.idx + 1) + ' of ' + frames.length + ' · turn ' + f.turn + ' · ' + f.tilesLeft + ' tiles left' }),
      ]),
      el('input', { class: 'replay__slider', type: 'range', min: '0', max: String(frames.length - 1), value: String(replay.idx), 'aria-label': 'Move', oninput: (e) => { stopReplay(); goFrame(Number(e.target.value)); } }),
      keyIdx.length ? el('div', { class: 'replay__keys' }, keyIdx.map((k) => el('button', {
        class: 'chip' + (k === replay.idx ? ' is-current' : ''), 'aria-pressed': String(k === replay.idx), onclick: () => { stopReplay(); goFrame(k); }, text: '⚠ Turn ' + frames[k].turn,
      }))) : el('p', { class: 'muted', text: 'No key moments this hand: you followed the suggested moves.' }),
      el('div', { class: 'replay__action' }, frameText(f)),
      it ? el('div', { class: 'feedback ' + (it.type === 'missedWin' ? 'feedback--no' : 'feedback--ok') + ' hint-box' }, [el('strong', { text: '⚠ Key moment: ' })].concat(reviewLine(it, fromName(it)))) : null,
      el('div', { class: 'replay__board' }, [
        pondFor(name(seatAt.top), f.discards[seatAt.top], 'top', { lastHighlight: f.action.player === seatAt.top && f.action.type === 'discard' }),
        pondFor(name(seatAt.left), f.discards[seatAt.left], 'left', { lastHighlight: f.action.player === seatAt.left && f.action.type === 'discard' }),
        pondFor(name(seatAt.right), f.discards[seatAt.right], 'right', { lastHighlight: f.action.player === seatAt.right && f.action.type === 'discard' }),
        pondFor(name(seatAt.bottom), f.discards[seatAt.bottom], 'bottom', { lastHighlight: f.action.player === seatAt.bottom && f.action.type === 'discard' }),
      ]),
      el('div', { class: 'hand-row__label', text: 'Your hand at this moment' + (f.melds[h].length ? ' (plus revealed sets)' : '') }),
      el('div', { class: 'tiles' }, handTiles.concat(f.melds[h].map((m) => el('span', { class: 'meld' }, MJ.meldTiles(m).map((id) => tiny(id)))))),
    ]);
  }

  // ---------- Render ----------

  function logView() {
    const lines = game.log.slice(-14);
    return el('details', { class: 'log-box' }, [
      el('summary', {}, [el('span', { class: 'muted', text: 'Game log · ' }), lines[lines.length - 1] || '']),
      el('ol', { class: 'log' }, lines.map((m) => el('li', { text: m }))),
    ]);
  }

  function render() {
    if (!boardHost) return;
    if (setupOpen || !game) return;
    processEvents();
    ensureAutoHint();
    if (replay) {
      boardHost.replaceChildren(replayView());
      return;
    }
    const logWasOpen = boardHost.querySelector('details.log-box');
    boardHost.replaceChildren(...[tableView(), game.isOver() ? resultCard() : null, logView()].filter(Boolean));
    if (logWasOpen) boardHost.querySelector('details.log-box').open = logWasOpen.open;
  }

  window.Play = {
    mount(node) {
      container = node;
      settingsHost = el('div', { class: 'play-top' });
      boardHost = el('div', { class: 'play-board' });
      node.replaceChildren(settingsHost, boardHost);
    },
    show() {
      active = true;
      if (setupOpen || !game) { setupOpen = true; renderSetup(); return; }
      renderSettings();
      tick();
    },
    hide() { active = false; clearTimeout(timer); stopReplay(); },
    /** Placement match: 2 hands vs intermediate bots, hints and manual play off. */
    startPlacement() {
      placement = { total: 2, scores: [], recorded: false };
      active = true;
      newGame(true);
    },
    render() { if (game && !setupOpen) render(); else if (setupOpen && boardHost) renderSetup(); },
  };
})();
