/*
 * HowToMJ lesson content (data only). Exposes window.LESSONS.
 *
 * Lesson = { id, title, zh, minutes, cards: [Card], quiz: [Question], generators: [rand => Question], quizSize }
 * Each quiz attempt draws `quizSize` questions from the fixed `quiz` pool plus freshly generated ones,
 * so a retry never repeats the same quiz.
 *
 * Card   = { title, body: [paragraphs], tiles?, groups?: [{ label, tiles }], hands?: [{ label, hand }], table?, taiList? }
 * Question types
 *   choice  { prompt, options: [text], answer: index, explain, tiles?, hand?, ordered? }
 *   tile    { prompt, options: [tile ids], answer: tile id, explain }
 *   win     { prompt, hand, explain?, mode?: 'canWin' }   — answer worked out by the engine
 *   tai     { prompt, hand, explain? }                   — answer worked out by the engine
 */
(function () {
  'use strict';
  const MJ = window.MJ;
  const t = (s) => s.split(' ');
  const H = (concealed, winningTile, extra) => Object.assign(
    { concealed: t(concealed), winningTile, melds: [], bonus: [], seat: 'E', prevalent: 'E', selfDraw: false },
    extra || {},
  );
  const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
  const WINDS = { E: 'East 東', S: 'South 南', W: 'West 西', N: 'North 北' };
  const WIND_PY = { E: 'Dōng', S: 'Nán', W: 'Xī', N: 'Běi' };
  const SEAT_ORDER = ['E', 'S', 'W', 'N'];
  const NUMERALS = '一二三四五六七八九';
  const SUIT_EN = { b: 'Bamboo', d: 'Dots', c: 'Characters' };

  // ---------- Generators ----------

  /** A random complete hand (4 sets + 1 pair), with a description of its sets. */
  function randomWinningHand(rand) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const counts = {};
      const tiles = [];
      const parts = [];
      const room = (id, n) => (counts[id] || 0) + n <= 4;
      const add = (id) => { counts[id] = (counts[id] || 0) + 1; tiles.push(id); };
      let ok = true;
      for (let s = 0; s < 4 && ok; s++) {
        if (rand() < 0.6) {
          const suit = pick(['b', 'd', 'c'], rand);
          const r = 1 + Math.floor(rand() * 7);
          const ids = [suit + r, suit + (r + 1), suit + (r + 2)];
          if (!ids.every((id) => room(id, 1))) { ok = false; break; }
          ids.forEach(add);
          parts.push(r + '–' + (r + 1) + '–' + (r + 2) + ' ' + SUIT_EN[suit]);
        } else {
          const id = pick(MJ.TYPES, rand);
          if (!room(id, 3)) { ok = false; break; }
          add(id); add(id); add(id);
          parts.push('pong of ' + MJ.tileInfo(id).name);
        }
      }
      if (!ok) continue;
      const pairId = pick(MJ.TYPES, rand);
      if (!room(pairId, 2)) continue;
      add(pairId); add(pairId);
      parts.push('pair of ' + MJ.tileInfo(pairId).name);
      const winIdx = Math.floor(rand() * tiles.length);
      const winningTile = tiles[winIdx];
      const concealed = MJ.sortTiles(tiles.filter((_, k) => k !== winIdx));
      return { concealed, winningTile, parts };
    }
    return null;
  }

  const genWinningHand = (rand) => {
    const w = randomWinningHand(rand);
    if (rand() < 0.5) {
      return { type: 'win', prompt: 'Is this a winning hand?', hand: { concealed: w.concealed, winningTile: w.winningTile }, explain: 'Yes: ' + w.parts.join(' · ') + '.' };
    }
    // Swap one tile so it no longer completes.
    for (let k = 0; k < 40; k++) {
      const concealed = w.concealed.slice();
      const at = Math.floor(rand() * concealed.length);
      concealed[at] = pick(MJ.TYPES, rand);
      const hand = { concealed: MJ.sortTiles(concealed), winningTile: w.winningTile };
      const r = MJ.evaluateHand(hand);
      if (r.status === 'invalid' && !/only 4/.test(r.message || '')) {
        return { type: 'win', prompt: 'Is this a winning hand?', hand, explain: 'No: these tiles cannot be split into 4 sets + 1 pair. One tile is out of place.' };
      }
    }
    return { type: 'win', prompt: 'Is this a winning hand?', hand: { concealed: w.concealed, winningTile: w.winningTile }, explain: 'Yes: ' + w.parts.join(' · ') + '.' };
  };

  const genIsChi = (rand) => {
    const suit = pick(['b', 'd', 'c'], rand);
    const r = 1 + Math.floor(rand() * 7);
    const kind = pick(['run', 'run', 'mixed', 'gap', 'honours'], rand);
    if (kind === 'run') return { type: 'choice', prompt: 'Is this a chi (a run)?', tiles: [suit + r, suit + (r + 1), suit + (r + 2)], options: ['Yes', 'No'], answer: 0, ordered: true, explain: 'Three numbers in a row, all ' + SUIT_EN[suit] + '.' };
    if (kind === 'mixed') {
      const other = pick(['b', 'd', 'c'].filter((s) => s !== suit), rand);
      return { type: 'choice', prompt: 'Is this a chi (a run)?', tiles: [suit + r, suit + (r + 1), other + (r + 2)], options: ['Yes', 'No'], answer: 1, ordered: true, explain: 'The numbers run, but the last tile is ' + SUIT_EN[other] + '. A chi must be one suit.' };
    }
    if (kind === 'gap') {
      const rr = Math.min(r, 6);
      return { type: 'choice', prompt: 'Is this a chi (a run)?', tiles: [suit + rr, suit + (rr + 1), suit + (rr + 3)], options: ['Yes', 'No'], answer: 1, ordered: true, explain: rr + ', ' + (rr + 1) + ' and ' + (rr + 3) + ' skip a number, so they are not a run.' };
    }
    return { type: 'choice', prompt: 'Is this a chi (a run)?', tiles: t('wE wS wW'), options: ['Yes', 'No'], answer: 1, ordered: true, explain: 'Winds have no numbers, so they can never form a chi.' };
  };

  const genTapSuited = (rand) => {
    const suit = pick(['b', 'd', 'c'], rand);
    const r = 1 + Math.floor(rand() * 9);
    const others = ['b', 'd', 'c'].filter((s) => s !== suit).map((s) => s + r);
    const near = suit + (r === 9 ? 8 : r + 1);
    return { type: 'tile', prompt: 'Tap the ' + r + ' ' + SUIT_EN[suit] + '.', options: others.concat([suit + r, near]), answer: suit + r, explain: suit === 'c' ? NUMERALS[r - 1] + ' means ' + r + ', above 萬.' : suit === 'd' ? 'Count the circles: ' + r + '.' : r === 1 ? 'The 1 of Bamboo is the bird.' : 'Count the sticks: ' + r + '.' };
  };

  const genNumeral = (rand) => {
    const r = 1 + Math.floor(rand() * 9);
    const opts = [r];
    while (opts.length < 4) { const x = 1 + Math.floor(rand() * 9); if (!opts.includes(x)) opts.push(x); }
    opts.sort((a, b) => a - b);
    return { type: 'choice', prompt: 'Which number is this character tile?', tiles: ['c' + r], options: opts.map(String), answer: opts.indexOf(r), ordered: true, explain: NUMERALS[r - 1] + ' is ' + r + '.' };
  };

  const genWind = (rand) => {
    const w = pick(SEAT_ORDER, rand);
    return { type: 'tile', noWindChars: true, prompt: 'Tap the ' + WINDS[w].split(' ')[0] + ' Wind (' + WIND_PY[w] + ').', options: t('wE wS wW wN'), answer: 'w' + w, explain: WINDS[w] + '. The order is East 東, South 南, West 西, North 北.' };
  };

  /** 'Which wind is Nán?' — learning the pinyin. */
  const genWindPinyin = (rand) => {
    const w = pick(SEAT_ORDER, rand);
    return { type: 'tile', noWindChars: true, prompt: 'Which wind tile is ' + WIND_PY[w] + '?', options: t('wE wS wW wN'), answer: 'w' + w, explain: WIND_PY[w] + ' is ' + WINDS[w] + '. Dōng 東 East, Nán 南 South, Xī 西 West, Běi 北 North.' };
  };

  const genDragon = (rand) => {
    const d = pick(['R', 'G', 'W'], rand);
    const names = { R: 'Red Dragon 中', G: 'Green Dragon 發', W: 'White Dragon 白' };
    return { type: 'tile', prompt: 'Tap the ' + names[d].replace(/ .$/, '') + '.', options: t('hR hG hW').concat([pick(t('wE wS wW wN'), rand)]), answer: 'h' + d, explain: names[d] + (d === 'W' ? ' is drawn as a blue frame.' : '.') };
  };

  const genMyFlower = (rand) => {
    const w = pick(SEAT_ORDER, rand);
    const n = SEAT_ORDER.indexOf(w) + 1;
    const blue = rand() < 0.5;
    const set = blue ? t('s1 s2 s3 s4') : t('f1 f2 f3 f4');
    return { type: 'tile', prompt: 'You sit ' + WINDS[w] + '. Which ' + (blue ? 'blue' : 'red') + ' flower is yours?', options: set, answer: set[n - 1], explain: WINDS[w] + ' is seat ' + n + ', so the red and blue flowers numbered ' + n + ' are yours.' };
  };

  const genFlowerBite = (rand) => {
    const w = pick(SEAT_ORDER, rand);
    const n = 1 + Math.floor(rand() * 4);
    const ownerSeat = SEAT_ORDER[n - 1];
    const own = ownerSeat === w;
    const options = ['Everyone pays you 2 chips', 'Only the ' + WINDS[own ? SEAT_ORDER[n % 4] : ownerSeat] + ' player pays you 2 chips', 'Nobody pays', 'You pay everyone 2 chips'];
    return {
      type: 'choice', prompt: 'You sit ' + WINDS[w] + '. During play you collect the red AND blue flower numbered ' + n + '. What happens?',
      tiles: ['f' + n, 's' + n], options, answer: own ? 0 : 1,
      explain: own ? n + ' is your own number, so it is a flower bite paid by everyone: 2 chips each (4 if it was in your opening hand).'
        : n + ' is ' + WINDS[ownerSeat] + "'s number, so only that player pays you: 2 chips (4 if it was in your opening hand).",
    };
  };

  const genReplacement = (rand) => {
    const what = pick([['a flower', 'f3'], ['an animal', 'aCat'], ['a kong', null]], rand);
    return { type: 'choice', prompt: 'After ' + what[0] + ', where do you take your replacement tile from?', tiles: what[1] ? [what[1]] : ['hG', 'hG', 'hG', 'hG'], options: ['The back (end) of the wall', 'The front of the wall, as normal', 'The discard pile', 'Any player you choose'], answer: 0, explain: 'Replacement tiles for flowers, animals and kongs always come from the back of the wall.' };
  };

  // Hands whose tai are worked out by the engine (the explanation lists the elements).
  const TAI_HANDS = [
    { label: 'East seat', hand: H('b1 b2 b3 b5 b5 b5 b7 b8 b9 hR hR hR b2', 'b2') },
    { label: 'East seat', hand: H('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7') },
    { label: 'East seat', hand: H('b1 b2 b3 d4 d5 d6 c7 c8 c9 c5', 'c5', { melds: [{ type: 'pong', tile: 'hG' }] }) },
    { label: 'East seat', hand: H('c9 c9 c9 hG hG wN wN', 'hG', { melds: [{ type: 'pong', tile: 'b1' }, { type: 'pong', tile: 'd5' }] }) },
    { label: 'South seat', hand: H('b1 b2 b3 c4 c5 c6 c7 c8 c9 b9', 'b9', { seat: 'S', bonus: ['f2', 's2'], melds: [{ type: 'chow', tile: 'd2' }] }) },
    { label: 'East seat', hand: H('d1 d2 d3 d4 d5 d6 d7 d7 d7 d9', 'd9', { melds: [{ type: 'pong', tile: 'hW' }] }) },
    { label: 'East seat, East round', hand: H('b1 b2 b3 b4 b5 b6 d2 d3 d4 c9', 'c9', { melds: [{ type: 'pong', tile: 'wE' }] }) },
    { label: 'East seat', hand: H('b4 b5 b6 d2 d3 d4 c5 c6 c7 c9', 'c9', { bonus: ['aCat', 'aRooster'], melds: [{ type: 'chow', tile: 'b1' }] }) },
    { label: 'East seat', hand: H('b1 b1 b1 d2 d3 d4 c5 c6 c7 c8 c8 c8 wN', 'wN') },
    { label: 'East seat', hand: H('b1 b1 b9 b9 d3 d3 d7 d7 c2 c2 hW hW wN', 'wN') },
    { label: 'West seat, self-draw', hand: H('c2 c3 c4 c5 c6 c7 b6 b7 b8 d9', 'd9', { seat: 'W', selfDraw: true, melds: [{ type: 'chow', tile: 'd1' }] , bonus: ['f3'] }) },
    { label: 'East seat', hand: H('d1 d2 d3 d4 d5 d6 d7 d8 d9 d2 d3 d4 d5', 'd5') },
  ];

  const genTai = (rand) => {
    const x = pick(TAI_HANDS, rand);
    return { type: 'tai', prompt: 'How many tai is this hand worth? (' + x.label + ')', hand: x.hand };
  };

  const CHIP_TABLE = { self: { 1: 4, 2: 5, 3: 7, 4: 12, 5: 22 }, shooter: { 1: 4, 2: 7, 3: 11, 4: 20, 5: 40 } };
  const genChips = (rand) => {
    const tai = 1 + Math.floor(rand() * 5);
    const self = rand() < 0.5;
    const correct = (self ? CHIP_TABLE.self : CHIP_TABLE.shooter)[tai];
    const pool = [...new Set(Object.values(CHIP_TABLE.self).concat(Object.values(CHIP_TABLE.shooter)))].filter((v) => v !== correct);
    pool.sort((a, b) => Math.abs(a - correct) - Math.abs(b - correct) || a - b);
    const values = [correct].concat(pool.slice(0, 3)).sort((a, b) => a - b);
    return {
      type: 'choice', ordered: true,
      prompt: self ? 'You win a ' + tai + '-tai hand by self-draw (自摸). How many chips does EACH other player pay you?' : 'You win a ' + tai + '-tai hand on a discard. How many chips does the shooter (the discarder) pay you?',
      options: values.map((v) => v + ' chips'), answer: values.indexOf(correct),
      explain: (self ? 'Self-draw at ' + tai + ' tai: each player pays ' + correct + ' chips (' + correct * 3 + ' in total).' : 'Discard win at ' + tai + ' tai: the shooter alone pays ' + correct + ' chips.') + ' Self-draw: 4 / 5 / 7 / 12 / 22. Shooter: 4 / 7 / 11 / 20 / 40.',
    };
  };

  // ---------- Generators for the in-depth lessons ----------

  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  /** "Which tiles complete this ready hand?" — the answer is worked out by the engine. */
  const genWaits = (rand) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const w = randomWinningHand(rand);
      const hand13 = w.concealed;
      const waits = MJ.waitingTiles(MJ.countsOf(hand13), 0);
      if (!waits.length || waits.length > 4) continue;
      const opts = [waits];
      const neighbour = (id) => {
        const i = MJ.TYPES.indexOf(id);
        if (i >= 27) return pick(MJ.TYPES.slice(27), rand);
        const r = i % 9;
        return MJ.TYPES[i - r + Math.max(0, Math.min(8, r + (rand() < 0.5 ? -1 : 1)))];
      };
      for (let k = 0; k < 40 && opts.length < 4; k++) {
        let o = waits.slice();
        const mode = Math.floor(rand() * 3);
        if (mode === 0 && o.length > 1) o.splice(Math.floor(rand() * o.length), 1);
        else if (mode === 1) o.push(neighbour(pick(waits, rand)));
        else o[Math.floor(rand() * o.length)] = neighbour(pick(waits, rand));
        o = MJ.sortTiles([...new Set(o)]);
        if (o.length && !opts.some((x) => sameSet(x, o))) opts.push(o);
      }
      if (opts.length < 4) continue;
      return {
        type: 'choiceTiles', prompt: 'This hand is ready (ting). Which tiles would complete it?', tiles: hand13, options: opts, answer: 0,
        explain: 'It waits on ' + waits.map((x) => MJ.tileInfo(x).name).join(' or ') + '. Check every tile: which one turns your 13 tiles into 4 sets + 1 pair?',
      };
    }
    return null;
  };

  const WAIT_TYPES = {
    twoSided: 'Two-sided 兩面 (two tiles can finish it)',
    kaLong: 'Ka Long 卡窿 (the middle tile)',
    edge: 'Edge 邊張 (only one end is open)',
    pair: 'Pair wait 單吊 (waiting for the pair)',
    doublePair: 'Double pong 對碰 (either pair becomes a pong)',
  };
  const genWaitType = (rand) => {
    const suit = pick(['b', 'd', 'c'], rand);
    const kind = pick(Object.keys(WAIT_TYPES), rand);
    let tiles;
    let finish;
    if (kind === 'twoSided') { const r = 2 + Math.floor(rand() * 6); tiles = [suit + r, suit + (r + 1)]; finish = [suit + (r - 1), suit + (r + 2)]; }
    else if (kind === 'kaLong') { const r = 1 + Math.floor(rand() * 7); tiles = [suit + r, suit + (r + 2)]; finish = [suit + (r + 1)]; }
    else if (kind === 'edge') { const low = rand() < 0.5; tiles = low ? [suit + 1, suit + 2] : [suit + 8, suit + 9]; finish = [low ? suit + 3 : suit + 7]; }
    else if (kind === 'pair') { const x = pick(MJ.TYPES, rand); tiles = [x]; finish = [x]; }
    else { const a = suit + (1 + Math.floor(rand() * 4)); const b = pick(MJ.TYPES.slice(27), rand); tiles = [a, a, b, b]; finish = [a, b]; }
    const others = Object.keys(WAIT_TYPES).filter((k) => k !== kind);
    const options = [kind].concat(others.sort(() => rand() - 0.5).slice(0, 3));
    return {
      type: 'choice', prompt: 'Your other sets are complete. You are waiting with these tiles. What kind of wait is it?', tiles,
      options: options.map((k) => WAIT_TYPES[k]), answer: 0,
      explain: WAIT_TYPES[kind] + ': finished by ' + finish.map((x) => MJ.tileInfo(x).name).join(' or ') + '.',
    };
  };

  function randomHand14(rand) {
    const pool = [];
    MJ.TYPES.forEach((x) => { for (let i = 0; i < 4; i++) pool.push(x); });
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return MJ.sortTiles(pool.slice(0, 14));
  }

  /** "Which tile should you throw?" — the best discard must be clearly better than the other choices. */
  const genBestDiscard = (rand) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const hand = randomHand14(rand);
      const r = MJ.adviseDiscard({ concealed: hand.slice(0, 13), winningTile: hand[13], seat: 'E', prevalent: 'E' });
      if (r.status !== 'ok' || r.complete) continue;
      const best = r.options[0];
      const worse = r.options.filter((o) => o.shanten > best.shanten || o.live + 6 <= best.live);
      if (worse.length < 3) continue;
      const picks = worse.sort(() => rand() - 0.5).slice(0, 3).map((o) => o.tile);
      return {
        type: 'tile', prompt: 'You just drew your 14th tile. Which of these should you throw?', tiles: hand,
        options: [best.tile].concat(picks), answer: best.tile,
        explain: 'Throw ' + MJ.tileInfo(best.tile).name + ': ' + best.summary + (best.notes.length ? ' ' + best.notes[0] : ''),
      };
    }
    return null;
  };

  const genSafeTile = (rand) => {
    const discards = MJ.sortTiles(randomHand14(rand).slice(0, 7));
    const safe = pick(discards, rand);
    const others = MJ.TYPES.filter((x) => !discards.includes(x)).sort(() => rand() - 0.5).slice(0, 3);
    return {
      type: 'tile', prompt: 'Mei Mei has revealed three sets and looks ready. These are her discards (shown above). Which of your tiles is safest to throw?', tiles: discards,
      options: [safe].concat(others), answer: safe,
      explain: 'Mei Mei already threw ' + MJ.tileInfo(safe).name + ' herself, so it is very unlikely to be the tile she is waiting for. The others are unknown — any could complete her hand.',
    };
  };

  const SPECIAL_HANDS = [
    { label: 'Da Si Xi 大四喜', hand: H('wE wE wE wS wS wS wW wW wW wN wN wN b5', 'b5') },
    { label: 'Xiao Si Xi 小四喜', hand: H('wE wE wE wS wS wS wW wW wW wN wN b2 b3', 'b4') },
    { label: 'Da San Yuan 大三元', hand: H('hR hR hR hG hG hG hW hW hW b1 b2 b3 d5', 'd5') },
    { label: 'Thirteen Wonders 十三幺', hand: H('b1 b9 d1 d9 c1 c9 wE wS wW wN hR hG hW', 'hR') },
  ];  const genNameLimit = (rand) => {
    const x = pick(SPECIAL_HANDS, rand);
    const options = [x.label].concat(SPECIAL_HANDS.filter((y) => y !== x).map((y) => y.label));
    return { type: 'choice', prompt: 'Which limit hand (5 tai) is this?', hand: x.hand, options, answer: 0, explain: x.label + '.' };
  };

  const SPECIAL_TAI = [
    { label: 'East seat · self-drew the last tile of the wall', hand: H('b4 b5 b6 d2 d3 d4 c5 c6 c7 c9', 'c9', { melds: [chowM('b1')], selfDraw: true, lastTile: true }) },
    { label: 'East seat · self-drew the replacement after a flower', hand: H('b4 b5 b6 d2 d3 d4 c5 c6 c7 c9', 'c9', { melds: [chowM('b1')], selfDraw: true, afterBonus: true, bonus: ['f3'] }) },
    { label: 'East seat · self-drew the 5 Dots (only wait)', hand: H('b1 b2 b3 d4 d6 c2 c2 wN wN wN', 'd5', { melds: [chowM('c7')], selfDraw: true }) },
    { label: 'East seat · won on a discard', hand: H('wE wE wE wS wS wS wW wW wW wN wN b2 b3', 'b4') },
    { label: 'East seat · self-draw', hand: H('b1 b2 b3 d4 d6 c7 c8 c9 c2 c2 wN wN wN', 'd5', { selfDraw: true }) },
    { label: 'East seat · won on a discard (two dragon pongs + a dragon pair)', hand: H('hR hR hR hG hG hG hW b1 b2 b3 d5 d6 d7', 'hW') },
  ];
  function chowM(tile) { return { type: 'chow', tile }; }
  const genSpecialTai = (rand) => {
    const x = pick(SPECIAL_TAI, rand);
    return { type: 'tai', prompt: 'How many tai is this hand worth? (' + x.label + ')', hand: x.hand };
  };

  const genFeiWin = (rand) => {
    const yes = rand() < 0.5;
    const hand = yes
      ? pick([H('b1 b2 jF d4 d5 d6 c7 c8 c9 hR hR hR wN', 'wN'), H('d3 d3 d3 jF b5 b6 c1 c2 c3 wS wS hG hG', 'hG'), H('jF jF c4 c5 c6 b7 b8 b9 d2 d2 d2 wE wE', 'wE')], rand)
      : pick([H('b1 b4 jF d4 d6 d8 c7 c8 c9 hR hR hR wN', 'wN'), H('b1 b3 b5 b7 jF d1 d3 d5 c2 c4 c6 wE wS', 'hW')], rand);
    return { type: 'win', prompt: 'Fei 飛 game: is this a winning hand? (飛 can stand for any tile)', hand, explain: yes ? 'Yes: the Fei fills the missing tile of a set (or the pair).' : 'No: even using the Fei as any one tile, these cannot make 4 sets + 1 pair.' };
  };

  window.LESSON_TOOLS = { randomWinningHand };

  // ---------- Lessons ----------

  window.LESSONS = [
    {
      id: 'L1',
      title: 'Meet the tiles',
      zh: '認識麻將牌',
      minutes: 5,
      quizSize: 6,
      cards: [
        {
          title: 'A Singapore set has 148 tiles',
          body: [
            'There are 136 playing tiles: three suits numbered 1 to 9, plus winds and dragons. There are 4 copies of every playing tile.',
            'Singapore sets also have 12 bonus tiles: 8 flowers (4 red, 4 blue) and 4 animals. You meet those in Lesson 2.',
          ],
          tiles: t('b5 d5 c5 wE hR f1 s1 aCat'),
        },
        {
          title: 'Bamboo 索',
          body: [
            'Bamboo tiles show sticks of bamboo: count the sticks to read the number.',
            'The 1 of Bamboo shows a bird instead of a stick, and the 8 of Bamboo has its classic "M over W" shape.',
          ],
          tiles: t('b1 b2 b3 b4 b5 b6 b7 b8 b9'),
        },
        {
          title: 'Dots 筒',
          body: ['Dots tiles show circles. Count the circles to read the number.', 'The 1 of Dots is one large decorated circle.'],
          tiles: t('d1 d2 d3 d4 d5 d6 d7 d8 d9'),
        },
        {
          title: 'Characters 萬',
          body: ['Character tiles show a Chinese numeral on top and a red 萬 underneath. Learn the nine numerals and you can read every character tile.'],
          tiles: t('c1 c2 c3 c4 c5 c6 c7 c8 c9'),
          table: [['一', '二', '三', '四', '五', '六', '七', '八', '九'], ['1', '2', '3', '4', '5', '6', '7', '8', '9']],
        },
        {
          title: 'Winds 風',
          body: [
            'The four winds are East 東, South 南, West 西 and North 北. They have no numbers, so they can never be part of a run (a chi).',
            'Every player has a seat wind, and every round has a round (prevalent) wind. Both matter for scoring later.',
          ],
          tiles: t('wE wS wW wN'),
        },
        {
          title: 'Dragons 龍',
          body: [
            'The three dragons are the Red Dragon 中, the Green Dragon 發 and the White Dragon 白, which is usually drawn as a blue frame.',
            'Winds and dragons together are called honour tiles.',
          ],
          tiles: t('hR hG hW'),
        },
        {
          title: 'Saying the names: pinyin',
          body: [
            'At the table people call tiles by their Chinese names. Here is how to say them in Hanyu Pinyin (the marks over the vowels show the tone).',
          ],
          table: [['Tile', 'Chinese', 'Pinyin', 'English'], ['Wind', '東', 'Dōng', 'East'], ['Wind', '南', 'Nán', 'South'], ['Wind', '西', 'Xī', 'West'], ['Wind', '北', 'Běi', 'North'], ['Dragon', '中', 'Hóng Zhōng', 'Red Dragon'], ['Dragon', '發', 'Qīng Fā', 'Green Dragon'], ['Dragon', '白', 'Bái Bǎn', 'White Dragon'], ['Suit', '索', 'Suǒ', 'Bamboo'], ['Suit', '筒', 'Tǒng', 'Dots'], ['Suit', '萬', 'Wàn', 'Characters']],
          tiles: t('wE wS wW wN hR hG hW'),
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'Which suit is marked 萬?', tiles: t('c2 c5 c8'), options: ['Bamboo', 'Characters', 'Dots', 'Dragons'], answer: 1, explain: '萬 (wan) is on every character tile.' },
        { type: 'choice', prompt: 'How many copies of each playing tile are in a set?', tiles: t('d5'), options: ['2', '3', '4', '8'], answer: 2, ordered: true, explain: 'Every suited, wind and dragon tile has 4 copies: 136 playing tiles in total.' },
        { type: 'choice', prompt: 'Which tiles can never be part of a run (chi)?', tiles: t('b4 wE hR d7 wN hG'), options: ['1s and 9s', 'Honour tiles: winds and dragons', 'Dots', 'Any tile can be'], answer: 1, explain: 'Winds and dragons have no numbers, so they can only form pairs, pongs and kongs.' },
        { type: 'tile', prompt: 'Tap the 8 Bamboo.', options: t('b6 b7 b8 b9'), answer: 'b8', explain: 'The 8 of Bamboo is the classic "M over W" shape.' },
      ],
      generators: [genTapSuited, genTapSuited, genNumeral, genWind, genDragon, genWindPinyin, genWindPinyin],
    },

    {
      id: 'L2',
      title: 'Flowers and animals',
      zh: '花牌與動物',
      minutes: 6,
      quizSize: 5,
      cards: [
        {
          title: 'Bonus tiles never stay in your hand',
          body: [
            'When you draw a flower or an animal, place it face up in front of you straight away.',
            'Then take a replacement tile from the BACK of the wall — the opposite end from where normal draws are taken. If the replacement is another bonus tile, reveal it and take another from the back.',
          ],
          groups: [
            { label: 'Red flowers 1–4 (梅蘭菊竹)', tiles: t('f1 f2 f3 f4') },
            { label: 'Blue flowers 1–4 (春夏秋冬)', tiles: t('s1 s2 s3 s4') },
            { label: 'Animals 動物', tiles: t('aCat aMouse aRooster aCentipede') },
          ],
        },
        {
          title: 'Two colours of flowers',
          body: [
            'A Singapore set has two flower colours: a red set and a blue set. Each set is numbered 1 to 4 — read the small number in the corner.',
            'Both sets show flowers. The red set is usually labelled 梅蘭菊竹 and the blue set 春夏秋冬, but what matters for scoring is the colour and the number.',
          ],
          groups: [{ label: 'Red 1 and Blue 1 — both belong to East', tiles: t('f1 s1') }],
        },
        {
          title: 'Your flowers match your seat number',
          body: [
            'Seats are numbered: East 1, South 2, West 3, North 4. The red flower AND the blue flower with your number are yours: each is worth 1 tai.',
            'Flowers with a different number are worth nothing to you.',
            'Collect all 4 flowers of one colour for 1 bonus tai on top.',
          ],
          table: [['Seat', 'Your red flower', 'Your blue flower'], ['East 東 · 1', 'Plum 梅', 'Spring 春'], ['South 南 · 2', 'Orchid 蘭', 'Summer 夏'], ['West 西 · 3', 'Chrysanthemum 菊', 'Autumn 秋'], ['North 北 · 4', 'Bamboo 竹', 'Winter 冬']],
        },
        {
          title: 'Animals and the animal bite 咬',
          body: [
            'Every animal tile is worth 1 tai, whatever your seat.',
            'Animals come in pairs: the cat catches the mouse, and the rooster eats the centipede. Collecting a matching pair is a bite: each other player pays you 2 chips straight away, or 4 chips if the pair was in your opening hand.',
          ],
          groups: [{ label: 'Bite 1', tiles: t('aCat aMouse') }, { label: 'Bite 2', tiles: t('aRooster aCentipede') }],
        },
        {
          title: 'The flower bite',
          body: [
            'Collecting the red and blue flower with the SAME number is also a bite.',
            'If it is your own number, every other player pays you 2 chips. If it is someone else\'s number, only that player pays you 2 chips.',
            'If the pair was in your opening hand, the payment is 4 chips instead of 2.',
          ],
          groups: [{ label: 'Both 2s: South\'s number', tiles: t('f2 s2') }],
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'You draw this flower. What do you do?', tiles: t('f3'), options: ['Keep it in your hand', 'Discard it', 'Reveal it and take a replacement from the back of the wall', 'Swap it with another player'], answer: 2, explain: 'Bonus tiles are always revealed, and the replacement comes from the back of the wall.' },
        { type: 'choice', prompt: 'Which two animals make a bite?', tiles: t('aCat aMouse aRooster aCentipede'), options: ['Cat and rooster', 'Cat and mouse', 'Mouse and centipede', 'Rooster and cat'], answer: 1, explain: 'The cat catches the mouse; the rooster eats the centipede.' },
        { type: 'choice', prompt: 'This animal bite is in your opening hand. How many chips does each other player pay you?', tiles: t('aRooster aCentipede'), options: ['2', '4', '6', '8'], answer: 1, ordered: true, explain: 'A bite pays 2 chips from each player, or 4 from each if you had it from the start.' },
        { type: 'choice', prompt: 'How many flower colours are there in a Singapore set?', tiles: t('f1 f2 s1 s2'), options: ['One', 'Two: red and blue', 'Four', 'Eight'], answer: 1, explain: 'Red flowers 梅蘭菊竹 and blue flowers 春夏秋冬, each numbered 1 to 4.' },
      ],
      generators: [genMyFlower, genMyFlower, genFlowerBite, genFlowerBite, genReplacement],
    },

    {
      id: 'L3',
      title: 'Sets and winning hands',
      zh: '組合與胡牌',
      minutes: 7,
      quizSize: 6,
      cards: [
        {
          title: 'Chi 吃: a run of three',
          body: [
            'Three tiles in a row, in the same suit. Also called a chow. Honour tiles cannot form a chi.',
            'You can only take a discard for a chi from the player just before you (on your left).',
          ],
          groups: [{ label: 'Chi', tiles: t('b3 b4 b5') }, { label: 'Not a chi: mixed suits', tiles: t('c8 c9 d1') }],
        },
        {
          title: 'Pong 碰 and Kong 槓',
          body: [
            'A pong is three identical tiles. You can take a pong from anyone\'s discard.',
            'A kong is all four identical tiles. After a kong, take a replacement tile from the back of the wall.',
          ],
          groups: [{ label: 'Pong', tiles: t('d7 d7 d7') }, { label: 'Kong', tiles: t('hG hG hG hG') }],
        },
        { title: 'The pair (eyes 眼)', body: ['Two identical tiles. Every normal winning hand needs exactly one pair.'], tiles: t('c5 c5') },
        {
          title: 'A winning hand: 4 sets + 1 pair',
          body: [
            'You hold 13 tiles. When the 14th tile completes 4 sets and 1 pair, you can win: call "Hu!" (胡).',
            'The sets can be any mix of chis, pongs and kongs — but remember, the hand also needs at least 1 tai (Lesson 5).',
          ],
          hands: [{ label: '1–2–3 Bamboo · 4–5–6 Bamboo · 2–3–4 Dots · 5–6–7 Characters · pair of 9 Characters', hand: H('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7') }],
        },
        {
          title: 'Two special winning hands',
          body: [
            'Seven Pairs 七對子: seven different pairs and no sets. It is worth 2 tai on a discard, or 3 tai on a self-draw.',
            'Some houses do not play Seven Pairs at all, so always ask the host before the game starts.',
            'Thirteen Wonders 十三幺: one of every 1, 9, wind and dragon, plus one extra copy of any of them. It is a limit hand, worth the full 5 tai.',
          ],
          hands: [
            { label: 'Seven Pairs', hand: H('b1 b1 b9 b9 d3 d3 d7 d7 c2 c2 hW hW wN', 'wN') },
            { label: 'Thirteen Wonders', hand: H('b1 b9 d1 d9 c1 c9 wE wS wW wN hR hG hW', 'b1') },
          ],
        },
      ],
      quiz: [
        { type: 'win', prompt: 'Is this a winning hand?', hand: H('b1 b2 b4 b5 b7 b8 d2 d3 d4 c5 c6 c7 c9', 'c9'), explain: 'No. The bamboo tiles are three broken runs — 1 & 2, 4 & 5 and 7 & 8 Bamboo — each missing a tile, so there are not 4 complete sets.' },
        { type: 'choice', prompt: 'Who can you take a discard from to make a chi?', tiles: t('c4 c5 c6'), options: ['Anyone', 'Only the player before you (your left)', 'Only the player opposite', 'Nobody, chis must be drawn'], answer: 1, explain: 'Chis can only be claimed from the player just before you. Pongs and kongs can be claimed from anyone.' },
        { type: 'win', prompt: 'Is this Seven Pairs hand a winning hand?', hand: H('b2 b2 b5 b5 d1 d1 d8 d8 c3 c3 c7 c7 hG', 'hG'), explain: 'Seven different pairs: a valid Seven Pairs hand (if your house plays it).' },
        { type: 'choice', prompt: 'You want to go for Seven Pairs. What should you check first?', tiles: t('b2 b2 d6 d6 c9 c9 hW hW'), options: ['Nothing, it is always allowed', 'Ask the host whether the house plays Seven Pairs', 'Whether you are the dealer', 'Whether it is the East round'], answer: 1, explain: 'Some houses do not play Seven Pairs, so ask before the game starts.' },
        { type: 'choice', prompt: 'How many tiles are in a winning hand without kongs?', tiles: t('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c7 c9 c9'), options: ['13', '14', '15', '16'], answer: 1, ordered: true, explain: '13 in your hand plus the winning tile: 4 sets of 3 and a pair of 2.' },
      ],
      generators: [genIsChi, genIsChi, genWinningHand, genWinningHand, genWinningHand],
    },

    {
      id: 'L4',
      title: 'How a game flows',
      zh: '打牌流程',
      minutes: 7,
      quizSize: 5,
      cards: [
        {
          title: 'Building the wall and throwing the dice',
          body: [
            'The tiles are shuffled and built into four walls, two tiles high, one in front of each player.',
            'The dealer (East 東) throws two dice. Count anticlockwise from the dealer (dealer = 1) to find whose wall is broken, then count that many stacks from the right-hand end of that wall and break it there.',
          ],
        },
        {
          title: 'Dealing: two stacks at a time',
          body: [
            'Starting with the dealer and going anticlockwise, each player takes 2 stacks (4 tiles) at a time from the front of the break, three times round.',
            'Then everyone takes 1 more tile, and the dealer takes 2. The dealer now has 14 tiles and everyone else has 13.',
            'Finally, everyone reveals their flowers and animals and takes replacements from the back of the wall.',
          ],
        },
        {
          title: 'Each turn: draw one, throw one',
          body: [
            'Play moves anticlockwise: East, then South, West and North.',
            'On your turn, draw a tile from the front of the wall, then discard one tile face up in the middle. You always end your turn with 13 tiles.',
            'If the tile you draw completes your hand (with at least 1 tai), you win by self-draw (自摸).',
          ],
        },
        {
          title: 'Claiming a discard',
          body: [
            'Any player can claim the tile just discarded, and play then continues from them.',
            'If several players want the same tile, the strongest claim wins: Hu 胡 beats Pong 碰 or Kong 槓, which beats Chi 吃.',
          ],
          table: [['Claim', 'From whom', 'Priority'], ['Hu 胡', 'Anyone', '1st'], ['Pong 碰 / Kong 槓', 'Anyone', '2nd'], ['Chi 吃', 'Player before you only', '3rd']],
        },
        {
          title: 'No swapping after a Chi',
          body: [
            'After you eat a tile for a Chi, you may NOT throw a tile that would have made the same set.',
            'Example: you hold 3–4–5 Dots and eat a 6 Dots to make 4–5–6. You cannot then throw the 3 Dots (or the 6 you just took) — that would just swap one end of the run for the other.',
            'The same goes for a Pong: you cannot throw the tile you just ponged. The game greys these tiles out for the turn.',
          ],
          groups: [{ label: 'Eat this 6…', tiles: t('d6') }, { label: '…to make 4–5–6, then you may NOT throw the 3', tiles: t('d3 d4 d5') }],
        },
        {
          title: 'Where replacement tiles come from',
          body: [
            'Normal draws come from the FRONT of the wall. Replacement tiles come from the BACK (the other end).',
            'You take a replacement from the back after revealing a flower, after revealing an animal, and after making any kong.',
            'A hand ends when someone wins, or when the wall runs out (a draw, with no payment).',
          ],
          table: [['Situation', 'Take from'], ['Normal turn', 'Front of the wall'], ['Flower or animal', 'Back of the wall'], ['Any kong', 'Back of the wall']],
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'How many tiles does the dealer start with?', options: ['13', '14', '15', '16'], answer: 1, ordered: true, explain: 'The dealer ends the deal with 14 tiles and starts by discarding one.' },
        { type: 'choice', prompt: 'One player calls Pong and another calls Chi on this discard. Who gets it?', tiles: t('d6'), options: ['The Chi', 'The Pong', 'Whoever spoke first', 'Nobody'], answer: 1, explain: 'Pong beats Chi. Only Hu beats a Pong.' },
        { type: 'choice', prompt: 'Can you claim a discard from the player opposite you to make a chi?', options: ['Yes', 'No'], answer: 1, ordered: true, explain: 'Chis only come from the player just before you.' },
        { type: 'choice', prompt: 'You hold 3–4–5 Bamboo and eat a 6 Bamboo to make 4–5–6. Can you now throw the 3 Bamboo?', tiles: t('b3 b4 b5 b6'), options: ['No — that would swap one end of the same run', 'Yes, any tile is fine', 'Only if it is your last tile', 'Only the dealer can'], answer: 0, explain: 'No swapping: after a Chi you cannot throw the tile that would have made the same set (here the 3, or the 6 itself).' },
        { type: 'choice', prompt: 'You eat a 5 Dots with 4 and 6 Dots (a Ka Long chi). Which tile can you NOT throw this turn?', tiles: t('d4 d5 d6'), options: ['The 5 Dots you just took', 'Any Bamboo', 'Your winds', 'Nothing is blocked'], answer: 0, explain: 'You can never throw back the tile you just claimed. A middle-tile chi has no other end to swap.' },
        { type: 'choice', prompt: 'Who throws the dice to break the wall?', options: ['The dealer (East)', 'The youngest player', 'Whoever won last', 'The North player'], answer: 0, explain: 'The dealer throws the dice.' },
        { type: 'choice', prompt: 'How do players take their tiles during the deal?', options: ['2 stacks (4 tiles) at a time, three times round, then 1 each', 'All 13 at once', '1 tile at a time', 'The dealer hands them out'], answer: 0, explain: 'Three rounds of 2 stacks each, then one more tile each — the dealer takes two.' },
        { type: 'choice', prompt: 'Which way does play move around the table?', options: ['Clockwise', 'Anticlockwise: East, South, West, North', 'The winner chooses', 'Randomly'], answer: 1, explain: 'Play moves anticlockwise, in wind order.' },
      ],
      generators: [genReplacement, genReplacement],
    },

    {
      id: 'L5',
      title: 'Tai scoring and chips',
      zh: '計台與籌碼',
      minutes: 10,
      quizSize: 6,
      cards: [
        {
          title: 'You need at least 1 tai to win',
          body: [
            'Tai 台 measures how valuable a winning hand is. At our table a hand needs at least 1 tai to win, and scoring stops at 5 tai.',
            'A 5-tai hand is called Mǎn 滿 (\"full\"): it is the most a hand can be worth.',
            'Add up everything on the next card that applies to your hand. If the total is over 5, it counts as 5.',
          ],
        },
        {
          title: 'Where tai comes from',
          body: ['Each line shows an example and what it means.'],
          taiList: [
            { name: 'Pèng · Dragon Pong', zh: '中/發/白 碰', tai: '1', def: 'Three (or four) of any one dragon.', tiles: t('hR hR hR') },
            { name: 'Mén Fēng · Seat Wind Pong', zh: '門風', tai: '1', def: 'Three of your own seat wind. Here: you sit South.', tiles: t('wS wS wS') },
            { name: 'Quān Fēng · Round Wind Pong', zh: '圈風', tai: '1', def: 'Three of the round (prevalent) wind. Stacks with the seat wind if they are the same.', tiles: t('wE wE wE') },
            { name: 'Zhèng Huā · Your Flower', zh: '正花', tai: '1 each', def: 'The red or blue flower with your seat number. Here: you sit West (3).', tiles: t('f3 s3') },
            { name: 'Yī Tào Huā · Full Flower Set', zh: '一套花', tai: '+1', def: 'All 4 flowers of one colour.', tiles: t('f1 f2 f3 f4') },
            { name: 'Dòng Wù · Animal', zh: '動物', tai: '1 each', def: 'Every animal tile counts, whatever your seat.', tiles: t('aCat') },
            { name: 'Mén Qīng · Concealed Hand', zh: '門清', tai: '1', def: 'A fully concealed hand: you never revealed a pong, chi or kong (concealed kongs are fine).', tiles: [] },
            { name: 'Huā Shàng · Win on a Flower Replacement', zh: '花上', tai: '1', def: 'You win by self-draw on the replacement tile taken after revealing a flower or animal.', tiles: t('f1') },
            { name: 'Kǎ Lóng · Middle-tile Win', zh: '卡窿', tai: '1 (self-draw only)', def: 'Your only wait was the middle tile of a chi (e.g. 4 _ 6 waiting for 5). Only counts if you draw it yourself — off a discard it is worth nothing.', tiles: t('d4 d5 d6') },
            { name: 'Hǎi Dǐ Lāo Yuè · Win on the Last Tile', zh: '海底撈月', tai: '1', def: 'You win by self-drawing the very last tile of the wall.', tiles: [] },
            { name: 'Duì Duì Hú · All Pongs', zh: '對對胡', tai: '2', def: 'All four sets are pongs (or kongs).', tiles: t('b2 b2 b2 d5 d5 d5') },
            { name: 'Hùn Yī Sè · Half Colour', zh: '混一色', tai: '2', def: 'One suit only, plus honour tiles.', tiles: t('b1 b2 b3 hR hR hR') },
            { name: 'Qī Duì Zǐ · Seven Pairs', zh: '七對子', tai: '2 (3 self-drawn)', def: 'Seven different pairs — only if your house plays it.', tiles: t('b1 b1 d9 d9') },
            { name: 'Píng Hú · All Chis', zh: '平胡', tai: '4', def: 'All chis, no flowers or animals, and waiting on more than one tile.', tiles: t('b1 b2 b3 d4 d5 d6') },
            { name: 'Qīng Yī Sè · Full Colour', zh: '清一色', tai: '4', def: 'Every tile from one suit, no honours.', tiles: t('d1 d2 d3 d7 d8 d9') },
            { name: 'Xiǎo Sān Yuán · Small Three Dragons', zh: '小三元', tai: '4', def: 'Pongs of two dragons plus a pair of the third dragon. Counts instead of the two dragon pongs.', tiles: t('hR hR hR hG hG hG hW hW') },
            { name: 'Dà Sān Yuán · Big Three Dragons', zh: '大三元', tai: '5 (Mǎn 滿)', def: 'Pongs of all three dragons.', tiles: t('hR hR hR hG hG hG hW hW hW') },
            { name: 'Dà Sì Xǐ · Big Four Winds', zh: '大四喜', tai: '5 (Mǎn 滿)', def: 'Pongs of all four winds.', tiles: t('wE wE wE wS wS wS wW wW wW wN wN wN') },
            { name: 'Xiǎo Sì Xǐ · Small Four Winds', zh: '小四喜', tai: '5 (Mǎn 滿)', def: 'Pongs of three winds plus a pair of the fourth wind.', tiles: t('wE wE wE wS wS wS wW wW wW wN wN') },
            { name: 'Mǎn · Other limit hands', zh: '滿', tai: '5 (Mǎn 滿)', def: 'Thirteen Wonders, All Honours, Nine Gates, Heavenly and Earthly Hands — see Lesson 9.', tiles: t('b1 b9 d1 d9 c1 c9') },
          ],
        },
        {
          title: 'No tai, no Hu',
          body: [
            'A hand made of a plain mix of pongs and chis, with revealed sets and nothing else that scores, is worth 0 tai.',
            'Even though the tiles are complete, you CANNOT call Hu. Keep going until you have at least 1 tai — for example by keeping your hand concealed (Men Qing), collecting your flower, or making a dragon pong.',
          ],
          hands: [{ label: 'Complete, but 0 tai: revealed chi and pong, nothing that scores', hand: H('b1 b2 b3 c1 c1 c1 c9', 'c9', { melds: [{ type: 'chow', tile: 'd2' }, { type: 'pong', tile: 'b5' }] }) }],
        },
        {
          title: 'Ping Hu 平胡 in detail',
          body: [
            'All four sets are chis, you have no flowers or animals, and you were waiting on more than one tile.',
            'Here you wait on 4 or 7 Characters (two tiles), so it counts: Ping Hu 4 tai, plus Men Qing 1 tai because nothing is revealed = 5 tai. Waiting on only one tile, such as the 3 in 1–2, does not count.',
          ],
          hands: [{ label: 'Ping Hu: wins on 4 or 7 Characters', hand: H('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7') }],
        },
        {
          title: 'House rules: ask the host',
          body: [
            'Houses differ. Before playing, ask the host about these:',
            'Yī Tái Zì Mō 一台自摸: in some houses a hand worth only 1 tai can only win if you DRAW the winning tile yourself. With 2 tai or more you can win on a discard as normal. Not every table plays it — you can switch it on in the game setup panel.',
            'Seven Pairs 七對子: some houses do not allow it.',
            'Fei 飛: some houses add joker tiles. Lesson 10 explains how they work.',
          ],
        },
        {
          title: 'Who pays, in chips',
          body: [
            'Discard win: the player who threw your winning tile (the shooter) pays for everyone.',
            'Self-draw 自摸: each of the three other players pays.',
          ],
          table: [['Tai', 'Self-draw: each player pays', 'Shooter pays'], ['1', '4', '4'], ['2', '5', '7'], ['3', '7', '11'], ['4', '12', '20'], ['5', '22', '40']],
        },
        {
          title: 'Paid straight away',
          body: [
            'Some payments happen during the hand, win or lose:',
            'Kong added to your revealed pong: 2 chips from each player. Kong from a discard: 6 chips from the discarder. Concealed kong: 4 chips from each player.',
            'Animal bite and flower bite: 2 chips (4 if in your opening hand) — see Lesson 2 for who pays.',
            'Everyone starts with 300 chips.',
          ],
        },
      ],
      quiz: [
        { type: 'win', mode: 'canWin', prompt: 'This hand is complete. Can you call Hu with it? (East seat)', hand: H('b1 b2 b3 c1 c1 c1 c9', 'c9', { melds: [{ type: 'chow', tile: 'd2' }, { type: 'pong', tile: 'b5' }] }), explain: 'No. The chi and pong are revealed (no Men Qing) and nothing else scores: 0 tai, below the 1 tai minimum.' },
        { type: 'choice', prompt: 'What is Men Qing 門清?', options: ['A fully concealed hand: no revealed pong, chi or kong', 'Winning on the last tile of the wall', 'A hand of all pongs', 'Holding all four winds'], answer: 0, explain: 'Men Qing means you never revealed a set. It is worth 1 tai.' },
        { type: 'choice', prompt: 'What is Hua Shang 花上?', options: ['Winning by self-draw on the replacement tile after a flower or animal', 'Collecting all 8 flowers', 'Winning with a flower in your hand', 'Throwing a flower by mistake'], answer: 0, explain: 'Hua Shang: you reveal a flower or animal, take the replacement from the back, and it completes your hand. 1 tai.' },
        { type: 'choice', prompt: 'Some houses play 一台自摸 (Yī Tái Zì Mō). What does it mean?', options: ['A hand worth only 1 tai can only win by self-draw', 'A self-drawn win earns 1 extra tai', 'Self-draw pays nothing', 'The dealer gets 1 extra tai'], answer: 0, explain: 'With 一台自摸, a 1-tai hand must be won by drawing the tile yourself. With 2 or more tai you can win on a discard. Ask the host whether the house plays it.' },
        { type: 'choice', prompt: 'You win on a Ka Long 卡窿 (a middle-tile wait) off someone\'s discard. Does the Ka Long add a tai?', options: ['No — Ka Long only counts if you self-draw it', 'Yes, 1 tai', 'Yes, 2 tai', 'Only for the dealer'], answer: 0, explain: 'A Ka Long won by eating someone\'s discard is worth nothing. Draw it yourself and it is worth 1 tai.' },
        { type: 'choice', prompt: 'What is Hai Di Lao 海底撈月?', options: ['Self-drawing the very last tile of the wall to win: 1 tai', 'Winning with all honour tiles', 'Pongs of all four winds', 'Winning on your first draw'], answer: 0, explain: 'Hai Di Lao means "fishing the moon from the bottom of the sea": winning on the last tile of the wall by self-draw.' },
      ],
      generators: [genTai, genTai, genTai, genChips, genChips],
    },

    {
      id: 'L6',
      title: 'Waiting: ting, waits and Ka Long',
      zh: '聽牌與卡窿',
      minutes: 9,
      quizSize: 6,
      cards: [
        {
          title: 'Ready (ting 聽) means one tile away',
          body: [
            'Your hand is ready, or "ting", when one more tile would complete it. The tiles that would complete it are your waits.',
            'More waits means more chances to win. A good player shapes the hand so it waits on as many tiles as possible.',
          ],
          hands: [{ label: 'Ready: waits on 4 or 7 Characters', hand: H('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', null) }],
        },
        {
          title: 'The five kinds of wait',
          body: ['Look at the last unfinished shape in your hand. Each shape waits in a different way:'],
          taiList: [
            { name: 'Liǎng Miàn · Two-sided', zh: '兩面', tai: 'best', def: 'Two tiles in a row in the middle: 4–5 waits on 3 or 6. Up to 8 tiles can finish it.', tiles: t('d4 d5') },
            { name: 'Kǎ Lóng · Middle tile', zh: '卡窿', tai: 'weak', def: 'A gap in the middle: 4 _ 6 waits only on the 5. At most 4 tiles.', tiles: t('d4 d6') },
            { name: 'Biān Zhāng · Edge', zh: '邊張', tai: 'weak', def: '1–2 can only be finished by 3, and 8–9 only by 7.', tiles: t('b1 b2') },
            { name: 'Dān Diào · Pair wait', zh: '單吊', tai: 'flexible', def: 'All four sets are done and you wait for a single tile to make the pair.', tiles: t('hG') },
            { name: 'Duì Pèng · Double pong', zh: '對碰', tai: 'OK', def: 'Two pairs: either one can become a pong, and the other is your pair.', tiles: t('c3 c3 wN wN') },
          ],
        },
        {
          title: 'Ka Long 卡窿 and its tai',
          body: [
            'A Ka Long is a middle-tile wait, like 4 _ 6 waiting for the 5. It is a narrow wait, so winning on it is harder.',
            'If the Ka Long tile is your only wait and you DRAW it yourself, it is worth 1 tai.',
            'If you win by "eating" the Ka Long tile from someone else\'s discard, it does NOT count as a tai.',
          ],
          hands: [{ label: 'Ka Long: only the 5 Dots finishes 4 _ 6', hand: H('b1 b2 b3 d4 d6 c7 c8 c9 c2 c2 wN wN wN', 'd5') }],
        },
        {
          title: 'Counting live tiles',
          body: [
            'Each tile has 4 copies. Subtract the ones you can see — in your hand, in revealed sets and in the discards — to know how many are still live.',
            'If all four copies of your wait are already visible, you can never win on it: change your wait.',
          ],
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'You hold 4 and 6 Bamboo and need one tile to finish the set. What do you need?', tiles: t('b4 b6'), options: ['5 Bamboo — a Ka Long', '3 or 7 Bamboo', 'Any Bamboo', 'Another 4 or 6'], answer: 0, explain: 'Only the middle 5 fills the gap: this is a Ka Long 卡窿.' },
        { type: 'choice', prompt: 'You self-draw the 5 to finish a Ka Long, and it was your only wait. Is it worth a tai?', options: ['Yes, 1 tai for Ka Long', 'No, never', 'Only off a discard', 'It is a limit hand'], answer: 0, explain: 'A self-drawn Ka Long is worth 1 tai. Off a discard it is worth nothing.' },
        { type: 'win', mode: 'canWin', prompt: 'You win this Ka Long hand on a DISCARD. Can you call Hu? (revealed chi, nothing else scores)', hand: H('b1 b2 b3 d4 d6 c2 c2 wN wN wN', 'd5', { melds: [chowM('c7')] }), explain: 'No. Eating the Ka Long tile from a discard does not count as a tai, and nothing else scores here: 0 tai.' },
        { type: 'choice', prompt: 'Which shape gives the most winning tiles?', options: ['Two-sided, like 5–6', 'Ka Long, like 5 _ 7', 'Edge, like 1–2', 'They are all the same'], answer: 0, explain: '5–6 can be finished by 4 or 7: up to 8 tiles, double a Ka Long or edge.' },
      ],
      generators: [genWaits, genWaits, genWaits, genWaitType, genWaitType, genSpecialTai],
    },

    {
      id: 'L7',
      title: 'Strategy: building a strong hand',
      zh: '策略',
      minutes: 9,
      quizSize: 6,
      cards: [
        {
          title: 'Early game: throw the loners first',
          body: [
            'At the start, throw tiles that cannot join anything: single winds that are not yours, then lone 1s and 9s, then other isolated tiles.',
            'Keep tiles that touch each other (4–5, 6 _ 8) and pairs. You need exactly one pair to win, so two or three pairs is useful; five pairs is too many.',
          ],
        },
        {
          title: 'Pick a target tai early',
          body: [
            'Remember: no tai, no Hu. Decide early where your tai will come from.',
            'Lots of one suit plus honours? Aim for Half Colour (2 tai). A pair of dragons or your seat wind? A pong gives 1 tai. All runs and no flowers? Ping Hu (4 tai).',
            'Keeping your hand concealed gives Men Qing (1 tai) — a reliable safety net.',
          ],
        },
        {
          title: 'When to Pong or Chi',
          body: [
            'Claiming makes your hand faster, but reveals a set and loses Men Qing.',
            'Good reasons to claim: it gives you a tai (a dragon or your wind), or you already have your tai and just need speed.',
            'Think twice when your only tai would be Men Qing: claiming could leave you with a complete hand you cannot win with.',
          ],
        },
        {
          title: 'Count before you choose',
          body: [
            'When two discards look equal, keep the one with more live tiles that help you. The advisor shows this as "live tiles".',
            'Tiles in the middle (3–7) connect in more ways than 1s and 9s, so they are usually worth keeping.',
          ],
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'Early in the hand you hold a single North Wind (not your seat or the round wind). What should you do?', options: ['Throw it early', 'Keep it until the end', 'Pong it', 'Hide it'], answer: 0, explain: 'A lone non-scoring wind can only become a pair or pong. Throw it early, while it is safe.' },
        { type: 'choice', prompt: 'Your only possible tai is Men Qing. Someone throws a tile you could Chi. Should you?', options: ['Usually no — you would lose Men Qing and your only tai', 'Always yes', 'Only if it is a dragon', 'Only on your first turn'], answer: 0, explain: 'Revealing a chi loses Men Qing. Without another tai you might finish a hand you cannot win with.' },
        { type: 'choice', prompt: 'You have 9 Dots tiles and a pair of Red Dragons. Which target makes sense?', options: ['Half Colour in Dots, plus a Red Dragon pong', 'Thirteen Wonders', 'Ping Hu', 'Seven Pairs only'], answer: 0, explain: 'Many tiles of one suit plus honours points to Half Colour (2 tai); the dragon pong adds 1.' },
      ],
      generators: [genBestDiscard, genBestDiscard, genBestDiscard, genBestDiscard],
    },

    {
      id: 'L8',
      title: 'Defence: not paying the shooter',
      zh: '防守',
      minutes: 7,
      quizSize: 5,
      cards: [
        {
          title: 'Why defence matters',
          body: [
            'The shooter (the player who throws the winning tile) pays for everyone: up to 40 chips at 5 tai.',
            'When an opponent looks ready, avoiding being the shooter can matter more than finishing your own hand.',
          ],
        },
        {
          title: 'Signs someone is ready',
          body: [
            'They have revealed three sets. They suddenly throw a tile they kept for a long time. Late in the hand, few tiles are left in the wall.',
            'A player collecting one suit (lots of Bamboo pongs and chis) is probably going for colour — be careful with that suit.',
          ],
        },
        {
          title: 'Safe tiles',
          body: [
            'The safest tile is one that player has already thrown themselves: they are very unlikely to be waiting on it.',
            'Honour tiles with 2 or 3 copies already visible are also fairly safe: they can only be won on as a pair wait.',
            'Late in the hand, keep a few safe tiles. If you are far from ready, give up on winning and throw only safe tiles.',
          ],
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'An opponent has revealed three sets. You are 3 tiles from ready. What is wise?', options: ['Play safe: throw tiles they have already thrown', 'Throw your most dangerous tile', 'Pong everything', 'It does not matter'], answer: 0, explain: 'You are far from winning and they are close. Avoid being the shooter.' },
        { type: 'choice', prompt: 'Three Green Dragons are already visible. How dangerous is the last Green Dragon?', options: ['Fairly safe: it can only finish a pair wait', 'Extremely dangerous', 'It can complete any chi', 'It always wins'], answer: 0, explain: 'With three out, nobody can pong it; it can only complete a single-tile pair wait.' },
      ],
      generators: [genSafeTile, genSafeTile, genSafeTile, genSafeTile],
    },

    {
      id: 'L9',
      title: 'Special and limit hands',
      zh: '特別牌型',
      minutes: 8,
      quizSize: 6,
      cards: [
        {
          title: 'Limit hands: straight to Mǎn 滿 (5 tai)',
          body: ['These hands score the full 5 tai — Mǎn 滿, \"full\" — on their own.'],
          taiList: [
            { name: 'Dà Sān Yuán · Big Three Dragons', zh: '大三元', tai: '5', def: 'Pongs (or kongs) of all three dragons.', tiles: t('hR hR hR hG hG hG hW hW hW') },
            { name: 'Dà Sì Xǐ · Big Four Winds', zh: '大四喜', tai: '5', def: 'Pongs of all four winds.', tiles: t('wE wE wE wS wS wS wW wW wW wN wN wN') },
            { name: 'Xiǎo Sì Xǐ · Small Four Winds', zh: '小四喜', tai: '5', def: 'Pongs of three winds and a pair of the fourth.', tiles: t('wE wE wE wS wS wS wW wW wW wN wN') },
            { name: 'Shí Sān Yāo · Thirteen Wonders', zh: '十三幺', tai: '5', def: 'One of every 1, 9, wind and dragon, plus one duplicate.', tiles: t('b1 b9 d1 d9 c1 c9 wE wS wW wN hR hG hW') },
            { name: 'Zì Yī Sè · All Honours', zh: '字一色', tai: '5', def: 'Only winds and dragons.', tiles: t('wE wE wE hG hG hG') },
            { name: 'Jiǔ Lián Bǎo Dēng · Nine Gates', zh: '九蓮寶燈', tai: '5', def: '1-1-1-2-3-4-5-6-7-8-9-9-9 of one suit, plus any tile of that suit.', tiles: t('c1 c1 c1 c2 c3 c4 c5 c6 c7 c8 c9 c9 c9') },
            { name: 'Tiān Hú / Dì Hú · Heavenly / Earthly Hand', zh: '天胡 / 地胡', tai: '5', def: 'The dealer wins on the dealt hand, or a player wins on the dealer\'s first discard.', tiles: [] },
          ],
        },
        {
          title: 'Lucky-moment tai',
          body: ['These add 1 tai for HOW you won:'],
          taiList: [
            { name: 'Hǎi Dǐ Lāo Yuè · Win on the Last Tile', zh: '海底撈月', tai: '1', def: 'Self-drawing the very last tile of the wall to win.', tiles: [] },
            { name: 'Huā Shàng · Win on a Flower Replacement', zh: '花上', tai: '1', def: 'Winning on the replacement tile after a flower or animal.', tiles: t('f2') },
            { name: 'Kǎ Lóng · Self-drawn Middle Tile', zh: '卡窿', tai: '1', def: 'Self-drawing the middle tile of your only wait.', tiles: t('d4 d5 d6') },
          ],
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'A 5-tai hand has a special name. What is it?', tiles: t('hR hR hR hG hG hG hW hW hW'), options: ['Mǎn 滿 (full)', 'Píng Hú 平胡', 'Mén Qīng 門清', 'Zì Mō 自摸'], answer: 0, explain: '5 tai is the cap, called Mǎn 滿 — "full".' },
        { type: 'choice', prompt: 'How many tai is Xiǎo Sān Yuán 小三元 (two dragon pongs + a dragon pair)?', tiles: t('hR hR hR hG hG hG hW hW'), options: ['2', '3', '4', '5'], answer: 2, ordered: true, explain: 'Xiǎo Sān Yuán is 4 tai. With all three dragon pongs it becomes Dà Sān Yuán 大三元, a Mǎn 滿 limit hand.' },
        { type: 'choice', prompt: 'What is the difference between Da Si Xi and Xiao Si Xi?', options: ['Da Si Xi has pongs of all four winds; Xiao Si Xi has three wind pongs and a wind pair', 'They are the same hand', 'Xiao Si Xi uses dragons', 'Da Si Xi needs flowers'], answer: 0, explain: 'Da 大 (big) = four wind pongs. Xiao 小 (small) = three pongs and a pair.' },
      ],
      generators: [genNameLimit, genNameLimit, genSpecialTai, genSpecialTai, genSpecialTai],
    },

    {
      id: 'L10',
      title: 'House rules, Fei and etiquette',
      zh: '家規與禮儀',
      minutes: 8,
      quizSize: 6,
      cards: [
        {
          title: 'Agree the rules before you start',
          body: [
            'Every table plays a little differently. Before the first hand, ask the host:',
            'Minimum tai and the cap (we use 1, and 5 = Mǎn 滿). The chip table. Whether Seven Pairs counts. Whether 一台自摸 (a 1-tai hand must be self-drawn) is played. Whether Fei jokers are used.',
          ],
        },
        {
          title: 'Fei 飛: joker tiles',
          body: [
            'Some houses add 4 Fei tiles. A Fei is wild: it can stand in for any tile to finish a chi, a pong or your pair.',
            'In this app: a discarded Fei cannot be claimed, and you cannot use a Fei to call Pong or Chi on someone\'s discard — it only works inside your own hand.',
            'Because Fei makes hands easier, keep yours! Throwing a Fei is almost always a mistake.',
          ],
          groups: [{ label: 'Fei as the missing 3 Bamboo', tiles: t('b1 b2 jF') }],
        },
        {
          title: 'Table etiquette',
          body: [
            'Call clearly ("Pong!", "Chi!", "Hu!") before taking a discard, and only take a tile after the call is accepted.',
            'Don\'t touch the wall out of turn, and don\'t look at tiles you have not drawn.',
            'When you win, lay your whole hand face up so everyone can check it. A false Hu is usually penalised — check your tai first!',
            'Pay straight away for kongs and bites, and settle chips at the end of the session.',
          ],
        },
      ],
      quiz: [
        { type: 'choice', prompt: 'What can a Fei 飛 joker do in your hand?', options: ['Stand in for any tile to finish a set or the pair', 'Count as 1 tai by itself', 'Let you take any discard', 'Nothing — it is a flower'], answer: 0, explain: 'A Fei is wild inside your hand.' },
        { type: 'choice', prompt: 'Someone throws a Fei 飛. Can you Pong it?', options: ['No — a discarded Fei cannot be claimed', 'Yes, any time', 'Only the dealer can', 'Only for Hu'], answer: 0, explain: 'In this app, a discarded Fei is dead: nobody can claim it.' },
        { type: 'choice', prompt: 'Before the first hand at a new table, what should you ask?', options: ['The house rules: min tai, cap, chips, Seven Pairs, 一台自摸, Fei', 'Nothing, rules are the same everywhere', 'Only who deals', 'Only the chip colours'], answer: 0, explain: 'Rules vary between houses — always agree them first.' },
        { type: 'choice', prompt: 'You think you have won. What should you do?', options: ['Call Hu clearly and lay your whole hand face up', 'Quietly take the chips', 'Show only the winning tile', 'Keep playing'], answer: 0, explain: 'Everyone needs to check the hand and its tai.' },
        { type: 'choice', prompt: 'Your table plays 一台自摸. Your hand is worth exactly 1 tai and someone throws your winning tile. Can you Hu?', tiles: t('hR hR hR'), options: ['No — a 1-tai hand must be self-drawn under 一台自摸', 'Yes, as normal', 'Only if you are the dealer', 'Yes, and it scores 2 tai'], answer: 0, explain: 'Under 一台自摸 a 1-tai hand can only win on your own draw. Wait to draw the tile yourself, or build a second tai.' },
      ],
      generators: [genFeiWin, genFeiWin, genFeiWin],
    },
  ];

  // ---------- Every wind name in lessons and questions carries its character ----------
  // "East" → "East 東" (unless the character is already there). Tile ids and identification
  // questions marked noWindChars are left alone so the answer is not given away.
  const WIND_CHAR = { East: '東', South: '南', West: '西', North: '北' };
  const addWindChars = (s) => s.replace(/\b(East|South|West|North)\b(?!\s*[東南西北])/g, (m) => m + ' ' + WIND_CHAR[m]);
  function withWindChars(o, key) {
    if (typeof o === 'string') return key === 'answer' || key === 'tiles' ? o : addWindChars(o);
    if (Array.isArray(o)) return o.map((x) => withWindChars(x, key));
    if (o && typeof o === 'object') {
      if (o.noWindChars) return o;
      const r = {};
      Object.keys(o).forEach((k) => {
        const keepIds = k === 'tiles' || k === 'hand' || (k === 'options' && o.type === 'tile') || k === 'answer';
        r[k] = keepIds ? o[k] : withWindChars(o[k], k);
      });
      return r;
    }
    return o;
  }
  window.LESSONS = window.LESSONS.map((lesson) => Object.assign(withWindChars(lesson), {
    generators: (lesson.generators || []).map((g) => (rand) => { const q = g(rand); return q ? withWindChars(q) : q; }),
  }));
})();
