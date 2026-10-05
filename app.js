/* HowToMJ UI: hand builder shared by the hand scorer and the discard advisor. */
(function () {
  'use strict';
  const MJ = window.MJ;
  const RULES = MJ.RULES;
  const STORAGE_KEY = 'howtomj.state.v1';

  const MODES = {
    learn: { label: 'Lessons' },
    play: { label: 'Play' },
    scorer: { label: 'Scorer', result: 'Score', slot: 'Winning tile' },
    advisor: { label: 'Advisor', result: 'Best discard', slot: 'Drawn tile' },
  };
  const TARGETS = {
    hand: { label: 'Hand' },
    chow: { label: 'Chi 吃', meld: { type: 'chow' } },
    pong: { label: 'Pong 碰', meld: { type: 'pong' } },
    kongDiscard: { label: 'Kong from discard', meld: { type: 'kong', kongSource: 'discard' } },
    kongAdded: { label: 'Kong added to revealed pong', meld: { type: 'kong', kongSource: 'added' } },
    kongConcealed: { label: 'Concealed kong 暗槓', meld: { type: 'kong', kongSource: 'concealed' } },
  };
  const MELD_TAGS = { chow: 'Chi', pong: 'Pong', discard: 'Kong', added: 'Kong', concealed: 'Concealed kong' };
  const WINDS = [['E', 'East 東'], ['S', 'South 南'], ['W', 'West 西'], ['N', 'North 北']];

  const t = (s) => s.split(' ');
  const EXAMPLES = [
    { label: 'Ping Hu 平胡', state: { concealed: t('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9'), winningTile: 'c7' } },
    { label: 'Pong Pong + dragon', state: { concealed: t('b1 b1 b1 d5 d5 d5 c9 c9 c9 hG hG wN wN'), winningTile: 'hG', selfDraw: true } },
    { label: 'Half colour 混一色', state: { concealed: t('b1 b2 b3 b5 b5 b5 b7 b8 b9 hR hR hR b2'), winningTile: 'b2', bonus: ['f1', 'aCat'] } },
    { label: 'Full colour (capped)', state: { concealed: t('d1 d2 d3 d4 d5 d6 d7 d8 d9 d2 d3 d4 d5'), winningTile: 'd5' } },
    { label: 'Seven Pairs 七對子', state: { concealed: t('b1 b1 b9 b9 d3 d3 d7 d7 c2 c2 hW hW wN'), winningTile: 'wN' } },
    { label: '0 tai: cannot Hu', state: { concealed: t('b1 b2 b3 c1 c1 c1 c9'), winningTile: 'c9', melds: [{ type: 'chow', tile: 'd2' }, { type: 'pong', tile: 'b5' }] } },
    { label: 'With exposed sets', state: { concealed: t('b4 b5 b6 c9'), winningTile: 'c9', melds: [{ type: 'pong', tile: 'hR' }, { type: 'kong', tile: 'wE', kongSource: 'concealed' }, { type: 'chow', tile: 'd2' }] } },
    { label: 'Advisor: what to throw?', mode: 'advisor', state: { concealed: t('b1 b2 b3 d4 d5 d6 c7 c8 c2 c2 b5 b6 d9'), winningTile: 'wN' } },
  ];

  const blank = () => ({ concealed: [], winningTile: null, melds: [], bonus: [], selfDraw: false, bonusAtStart: false, afterBonus: false, lastTile: false, guess: null });
  const defaults = () => Object.assign({ mode: 'learn', target: 'hand', seat: 'E', prevalent: 'E', learning: false, oneTaiZiMo: false }, blank());
  const rules = () => Object.assign({}, RULES, { oneTaiZiMo: !!state.oneTaiZiMo });

  let state = load();
  let message = '';

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  const { el, tileEl, emptyTile } = window.UI;

  // ---------- State helpers ----------

  const handSize = () => 13 - 3 * state.melds.length;
  const handObj = () => ({
    concealed: state.concealed, winningTile: state.winningTile, melds: state.melds, bonus: state.bonus,
    seat: state.seat, prevalent: state.prevalent, selfDraw: state.selfDraw, bonusAtStart: state.bonusAtStart,
    afterBonus: state.selfDraw && state.afterBonus,
    lastTile: state.selfDraw && state.lastTile,
  });

  function usedCount(id) {
    let n = state.concealed.filter((x) => x === id).length + (state.winningTile === id ? 1 : 0);
    state.melds.forEach((m) => { n += MJ.meldTiles(m).filter((x) => x === id).length; });
    return n;
  }

  function update(changes, keepGuess) {
    Object.assign(state, changes);
    if (!keepGuess) state.guess = null;
    save();
    render();
  }

  function say(text) { message = text; }

  // ---------- Actions ----------

  function addTile(id) {
    message = '';
    if (MJ.isBonus(id)) {
      if (state.bonus.includes(id)) return update({ bonus: state.bonus.filter((x) => x !== id) });
      return update({ bonus: MJ.sortTiles(state.bonus.concat([id])) });
    }
    const target = TARGETS[state.target];
    if (target.meld && MJ.isFei(id)) { say('A Fei 飛 joker goes in your hand: the scorer works out what it stands for.'); return render(); }
    if (target.meld) return addMeld(id, target.meld);
    if (usedCount(id) >= 4) { say('All 4 ' + MJ.tileName(id) + ' tiles are already used.'); return render(); }
    if (state.concealed.length < handSize()) return update({ concealed: MJ.sortTiles(state.concealed.concat([id])) });
    if (!state.winningTile) return update({ winningTile: id });
    say('Your hand is full. Tap a tile in your hand to remove it.');
    render();
  }

  function addMeld(id, meld) {
    if (state.melds.length >= 4) { say('A hand has at most 4 sets.'); return render(); }
    const m = Object.assign({ tile: id }, meld);
    if (m.type === 'chow') {
      const info = MJ.tileInfo(id);
      if (info.kind !== 'suit' || info.rank > 7) { say('For a chow, tap its lowest tile (a suited 1–7).'); return render(); }
    }
    const tiles = MJ.meldTiles(m);
    const over = tiles.find((x) => usedCount(x) + tiles.filter((y) => y === x).length > 4);
    if (over) { say('Not enough ' + MJ.tileName(over) + ' tiles left for that set.'); return render(); }
    if (state.concealed.length > handSize() - 3) { say('Remove 3 tiles from your hand first to make room for this set.'); return render(); }
    update({ melds: state.melds.concat([m]), target: 'hand' });
  }

  function onHandTile(index) {
    message = '';
    if (state.mode === 'advisor' && state.learning) return guess(state.concealed[index]);
    const c = state.concealed.slice();
    c.splice(index, 1);
    update({ concealed: c });
  }

  function onWinningTile() {
    message = '';
    if (state.mode === 'advisor' && state.learning) return guess(state.winningTile);
    update({ winningTile: null });
  }

  function guess(id) {
    const r = MJ.adviseDiscard(handObj(), rules());
    if (r.status !== 'ok') return;
    update({ guess: id }, true);
  }

  // ---------- Render ----------

  function render() {
    renderTabs();
    const learning = state.mode === 'learn';
    const playing = state.mode === 'play';
    document.getElementById('tools').hidden = learning || playing;
    document.getElementById('learn').hidden = !learning;
    document.getElementById('play').hidden = !playing;
    if (playing) window.Play.show(); else window.Play.hide();
    if (learning || playing) return;
    renderHand();
    renderTargets();
    renderPalette();
    renderContext();
    renderResult();
    document.getElementById('message').textContent = message;
  }

  function renderTabs() {
    const nav = document.getElementById('tabs');
    nav.replaceChildren(...Object.entries(MODES).map(([key, m]) => el('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(state.mode === key),
      onclick: () => update({ mode: key }), text: m.label,
    })));
  }

  function renderHand() {
    const mode = MODES[state.mode];
    const learning = state.mode === 'advisor' && state.learning;
    const handTiles = state.concealed.map((id, i) => tileEl(id, {
      onclick: () => onHandTile(i), ariaPrefix: learning ? 'Throw ' : 'Remove ',
      extra: state.guess === id ? 'is-guess' : '',
    }));
    for (let i = state.concealed.length; i < handSize(); i++) handTiles.push(emptyTile('Empty slot'));

    const win = state.winningTile
      ? tileEl(state.winningTile, { onclick: onWinningTile, ariaPrefix: learning ? 'Throw ' : 'Remove ', extra: state.guess === state.winningTile ? 'is-guess' : '' })
      : emptyTile(mode.slot + ' slot');

    const melds = state.melds.map((m, i) => el('span', { class: 'meld' }, [
      el('span', { class: 'meld__tag', text: MELD_TAGS[m.kongSource || m.type] }),
      ...MJ.meldTiles(m).map((id) => tileEl(id, {
        small: true, ariaPrefix: 'Remove set with ',
        onclick: () => { message = ''; update({ melds: state.melds.filter((_, j) => j !== i) }); },
      })),
    ]));

    const bonus = state.bonus.map((id) => tileEl(id, {
      small: true, ariaPrefix: 'Remove ', onclick: () => { message = ''; update({ bonus: state.bonus.filter((x) => x !== id) }); },
    }));

    document.getElementById('hand').replaceChildren(
      el('div', { class: 'hand-main' }, [
        el('div', { class: 'hand-row' }, [
          el('div', { class: 'hand-row__label', text: 'In hand ' + state.concealed.length + '/' + handSize() }),
          el('div', { class: 'tiles' }, handTiles),
        ]),
        el('div', { class: 'hand-row win-slot' }, [
          el('div', { class: 'hand-row__label', text: mode.slot }),
          el('div', { class: 'tiles' }, [win]),
        ]),
      ]),
      el('div', { class: 'hand-row' }, [
        el('div', { class: 'hand-row__label', text: 'Exposed sets' }),
        melds.length ? el('div', { class: 'tiles' }, melds) : el('div', { class: 'empty-note', text: 'None. Pick Chi, Pong or Kong below, then tap a tile.' }),
      ]),
      el('div', { class: 'hand-row' }, [
        el('div', { class: 'hand-row__label', text: 'Flowers and animals' }),
        bonus.length ? el('div', { class: 'tiles' }, bonus) : el('div', { class: 'empty-note', text: 'None. Tap bonus tiles below to add them.' }),
      ]),
      el('p', { class: 'muted', text: learning ? 'Learning mode: tap the tile you would throw.' : 'Tap any tile above to remove it.' }),
    );
  }

  function renderTargets() {
    document.getElementById('targets').replaceChildren(...Object.entries(TARGETS).map(([key, tg]) => el('button', {
      class: 'chip', 'aria-pressed': String(state.target === key), text: tg.label,
      onclick: () => { message = ''; update({ target: key }, true); },
    })));
  }

  function renderPalette() {
    const groups = [
      ['Bamboo 索', MJ.TYPES.slice(0, 9)],
      ['Dots 筒', MJ.TYPES.slice(9, 18)],
      ['Characters 萬', MJ.TYPES.slice(18, 27)],
      ['Winds and dragons 風 · 龍', MJ.TYPES.slice(27)],
      ['Red flowers 1–4 · 花', MJ.BONUS_TILES.slice(0, 4)],
      ['Blue flowers 1–4 · 花', MJ.BONUS_TILES.slice(4, 8)],
      ['Animals 動物', MJ.BONUS_TILES.slice(8)],
      ['Fei 飛 joker (Fei games only)', [MJ.FEI]],
    ];
    document.getElementById('palette').replaceChildren(...groups.map(([label, ids]) => el('div', { class: 'palette-group' }, [
      el('div', { class: 'hand-row__label', text: label }),
      el('div', { class: 'tiles' }, ids.map((id) => tileEl(id, {
        onclick: () => addTile(id), ariaPrefix: 'Add ',
        extra: (MJ.isBonus(id) ? state.bonus.includes(id) : usedCount(id) >= 4) ? 'is-used' : '',
      }))),
    ])));
  }

  function select(label, value, onchange) {
    return el('label', { class: 'field' }, [label, el('select', { onchange: (e) => onchange(e.target.value) },
      WINDS.map(([v, text]) => el('option', { value: v, selected: v === value, text })))]);
  }

  function renderContext() {
    const items = [
      select('Your seat wind', state.seat, (v) => update({ seat: v })),
      select('Prevalent wind', state.prevalent, (v) => update({ prevalent: v })),
    ];
    if (state.mode === 'scorer') {
      items.push(el('div', { class: 'field' }, ['How you won', el('div', { class: 'seg' }, [
        el('button', { 'aria-pressed': String(!state.selfDraw), text: 'Discard', onclick: () => update({ selfDraw: false }) }),
        el('button', { 'aria-pressed': String(state.selfDraw), text: 'Self-draw 自摸', onclick: () => update({ selfDraw: true }) }),
      ])]));
      items.push(el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: state.bonusAtStart, onchange: (e) => update({ bonusAtStart: e.target.checked }) }),
        'Bites (animal or flower) were in my opening hand',
      ]));
      if (state.selfDraw) {
        items.push(el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', checked: state.afterBonus, onchange: (e) => update({ afterBonus: e.target.checked }) }),
          'Won on a flower replacement tile (Hua Shang 花上)',
        ]));
        items.push(el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', checked: state.lastTile, onchange: (e) => update({ lastTile: e.target.checked }) }),
          'Won on the last tile of the wall (Hai Di Lao 海底撈月)',
        ]));
      }
      items.push(el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: state.oneTaiZiMo, onchange: (e) => update({ oneTaiZiMo: e.target.checked }) }),
        'House rule 一台自摸 (Yī Tái Zì Mō): a 1-tai hand must be self-drawn',
      ]));
    } else {
      items.push(el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: state.learning, onchange: (e) => update({ learning: e.target.checked }) }),
        'Learning mode: guess first',
      ]));
    }
    document.getElementById('context').replaceChildren(...items);
  }

  function renderResult() {
    document.getElementById('result-title').textContent = MODES[state.mode].result;
    const box = document.getElementById('result');
    box.replaceChildren(...(state.mode === 'scorer' ? scorerView() : advisorView()));
  }

  function scorerView() {
    const hand = handObj();
    const r = MJ.evaluateHand(hand, rules());
    const instant = MJ.instantPayouts(hand, rules());
    const out = [];
    if (r.status === 'incomplete') {
      out.push(el('p', { class: 'hint', text: r.message }));
      out.push(el('p', { class: 'muted', text: 'Tip: load an example from the menu above to see how scoring works.' }));
    } else if (r.status === 'invalid') {
      out.push(el('span', { class: 'badge badge--no', text: 'Not a winning hand' }));
      out.push(el('p', { text: r.message }));
    } else {
      out.push(el('div', { class: 'big' }, [
        el('span', { class: 'big__num', text: String(r.tai) }),
        el('span', { class: 'big__unit', text: 'tai 台' }),
        el('span', { class: 'big__note', text: r.rawTai > RULES.maxTai ? r.rawTai + ' before the ' + RULES.maxTai + ' tai cap' : r.handType }),
      ]));
      out.push(el('span', {
        class: 'badge ' + (r.canWin ? 'badge--ok' : 'badge--no'),
        text: r.canWin ? 'Valid win' : 'Cannot win: needs at least ' + RULES.minTai + ' tai',
      }));
      if (!r.canWin) out.push(el('p', { class: 'muted', text: 'A complete hand with 0 tai (for example a mix of pongs and chis with revealed sets and nothing that scores) cannot be declared. You need at least 1 tai to Hu.' }));
      const rows = r.items.map((i) => el('tr', {}, [el('td', { text: i.name }), el('td', { class: 'zh', text: i.zh }), el('td', { class: 'tai', text: '+' + i.tai })]));
      if (!rows.length) rows.push(el('tr', {}, [el('td', { text: 'No scoring elements' }), el('td', {}), el('td', { class: 'tai', text: '0' })]));
      rows.push(el('tr', { class: 'total' }, [el('td', { text: 'Total' }), el('td', {}), el('td', { class: 'tai', text: r.tai + ' tai' })]));
      out.push(el('table', { class: 'items' }, [el('tbody', {}, rows)]));
      if (r.payout) {
        out.push(el('div', { class: 'pay' }, r.payout.selfDraw
          ? [el('strong', { text: r.payout.each + ' chips from each opponent' }), el('div', { class: 'muted', text: 'Self-draw: all three pay, ' + r.payout.total + ' chips in total.' })]
          : [el('strong', { text: r.payout.shooterPays + ' chips from the discarder' }), el('div', { class: 'muted', text: 'Discard win: the shooter pays for everyone.' })]));
      }
    }
    if (instant.length) {
      out.push(el('div', { class: 'pay' }, [
        el('strong', { text: 'Paid straight away' }),
        el('ul', {}, instant.map((p) => el('li', { text: p.label + ': ' + (p.single ? p.single + ' chips from ' + p.payer : p.each + ' chips from each opponent') }))),
      ]));
    }
    return out;
  }

  function advisorView() {
    const r = MJ.adviseDiscard(handObj(), rules());
    if (r.status !== 'ok') return [el('p', { class: r.status === 'invalid' ? '' : 'hint', text: r.message })];
    const out = [];
    if (r.complete) out.push(el('span', { class: 'badge badge--ok', text: 'This is already a winning hand. Check it in the Hand scorer!' }));
    else out.push(el('p', { class: 'muted', text: r.currentShanten === 0 ? 'You can be ready (ting) after this discard.' : 'Your hand is ' + r.currentShanten + ' tile' + (r.currentShanten === 1 ? '' : 's') + ' away from ready (ting).' }));

    if (state.learning && !state.guess) {
      out.push(el('p', { class: 'hint', text: 'Learning mode: tap the tile in your hand you would throw, then see how it compares.' }));
      return out;
    }
    if (state.learning && state.guess) {
      const rank = r.options.findIndex((o) => o.tile === state.guess) + 1;
      const best = r.options[0];
      const same = rank === 1 || (r.options[rank - 1].shanten === best.shanten && r.options[rank - 1].live === best.live);
      out.push(el('span', {
        class: 'badge ' + (same ? 'badge--ok' : 'badge--no'),
        text: same ? 'Great pick: ' + MJ.tileName(state.guess) : 'You picked ' + MJ.tileName(state.guess) + ' (#' + rank + ' of ' + r.options.length + ')',
      }));
    }
    r.options.slice(0, 3).forEach((o, i) => {
      out.push(el('div', { class: 'option' + (i === 0 ? ' option--best' : '') }, [
        tileEl(o.tile),
        el('div', { class: 'option__body' }, [
          el('div', { class: 'option__rank', text: i === 0 ? 'Best throw' : '#' + (i + 1) }),
          el('p', {}, [el('strong', { text: MJ.tileName(o.tile) })]),
          el('p', { text: o.summary }),
          o.notes.length ? el('ul', {}, o.notes.map((n) => el('li', { text: n }))) : null,
          o.shanten === 0 && o.improving.length ? el('div', { class: 'waits' }, o.improving.map((id) => tileEl(id, { small: true }))) : null,
        ]),
      ]));
    });
    out.push(el('p', { class: 'muted', text: 'Live tiles count only what you can see in your own hand and sets.' }));
    return out;
  }

  // ---------- Wiring ----------

  const exampleSelect = document.getElementById('examples');
  exampleSelect.replaceChildren(
    el('option', { value: '', text: 'Examples…' }),
    ...EXAMPLES.map((ex, i) => el('option', { value: String(i), text: ex.label })),
  );
  exampleSelect.addEventListener('change', (e) => {
    const ex = EXAMPLES[Number(e.target.value)];
    e.target.value = '';
    if (!ex) return;
    message = '';
    const loaded = JSON.parse(JSON.stringify(ex.state));
    loaded.concealed = MJ.sortTiles(loaded.concealed);
    update(Object.assign(blank(), { target: 'hand', mode: ex.mode || state.mode, seat: 'E', prevalent: 'E' }, loaded));
  });
  document.getElementById('clear').addEventListener('click', () => { message = ''; update(Object.assign(blank(), { target: 'hand' })); });

  // English names on tiles: a header toggle that applies everywhere.
  const enBtn = document.getElementById('english');
  function syncEnglish() {
    const on = window.UI.englishOn();
    document.body.classList.toggle('show-en', on);
    enBtn.setAttribute('aria-pressed', String(on));
  }
  enBtn.addEventListener('click', () => { window.UI.setEnglish(!window.UI.englishOn()); syncEnglish(); window.Play.render(); });
  syncEnglish();

  window.HowToMJ = {
    setMode: (mode) => { update({ mode }); window.scrollTo(0, 0); },
    syncEnglish,
    startPlacement: () => { update({ mode: 'play' }); window.Play.startPlacement(); window.scrollTo(0, 0); },
  };
  window.Learn.mount(document.getElementById('learn'));
  window.Play.mount(document.getElementById('play'));
  render();
})();
