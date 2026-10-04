/*
 * HowToMJ rules engine — Singapore mahjong.
 * Pure logic, no DOM. Exposes window.MJ.
 *
 * Tile ids
 *   suited   b1–b9 (bamboo 索), d1–d9 (dots 筒), c1–c9 (characters 萬)
 *   winds    wE wS wW wN
 *   dragons  hR (中) hG (發) hW (白)
 *   bonus    f1–f4 red flowers (梅蘭菊竹), s1–s4 blue flowers (春夏秋冬), aCat aMouse aRooster aCentipede
 */
(function (global) {
  'use strict';

  // ---------- Default rule profile (see PRD "Default ruleset") ----------

  const SG_DEFAULT = {
    name: 'Singapore default',
    minTai: 1,
    maxTai: 5,
    tai: {
      dragonPong: 1,
      seatWindPong: 1,
      prevalentWindPong: 1,
      seatFlower: 1,
      flowerSet: 1,
      animal: 1,
      pongPong: 2,
      halfColour: 2,
      fullColour: 4,
      pingHu: 4,
      sevenPairsDiscard: 2,
      sevenPairsSelfDraw: 3,
      menQing: 1,
      huaShang: 1,
      kaLong: 1, // only on a self-draw
      haiDiLao: 1, // only on a self-draw of the last tile
      selfDraw: 1, // only when houseSelfDrawTai is on
    },
    // House rule 一台自摸: a self-drawn win earns 1 extra tai.
    houseSelfDrawTai: false,
    // House rule: some houses do not play Seven Pairs.
    allowSevenPairs: true,
    limitHands: ['thirteenWonders', 'bigThreeDragons', 'bigFourWinds', 'smallFourWinds', 'allHonours', 'nineGates', 'heavenlyHand', 'earthlyHand'],
    payouts: {
      // chips paid by EACH of the three opponents on a self-draw
      selfDrawEach: { 1: 4, 2: 5, 3: 7, 4: 12, 5: 22 },
      // chips paid by the discarder alone on a discard win
      shooter: { 1: 4, 2: 7, 3: 11, 4: 20, 5: 40 },
    },
    instant: {
      exposedKongEach: 2,
      kongFromDiscardShooter: 6,
      concealedKongEach: 4,
      biteEach: 2,
      biteAtStartEach: 4,
      flowerBiteEach: 2,
      flowerBiteAtStartEach: 4,
    },
    startingChips: 300,
  };

  // ---------- Tiles ----------

  const SUITS = ['b', 'd', 'c'];
  const SUIT_INFO = {
    b: { en: 'Bamboo', short: 'Bam', zh: '索' },
    d: { en: 'Dots', short: 'Dot', zh: '筒' },
    c: { en: 'Characters', short: 'Char', zh: '萬' },
  };
  const WIND_INFO = {
    E: { en: 'East', zh: '東' },
    S: { en: 'South', zh: '南' },
    W: { en: 'West', zh: '西' },
    N: { en: 'North', zh: '北' },
  };
  const DRAGON_INFO = {
    R: { en: 'Red Dragon', short: 'Red', zh: '中' },
    G: { en: 'Green Dragon', short: 'Green', zh: '發' },
    W: { en: 'White Dragon', short: 'White', zh: '白' },
  };
  // Flowers come in two colours: red 梅蘭菊竹 and blue 春夏秋冬, each numbered 1–4.
  // (Internally the blue set keeps the kind 'season'.)
  const BONUS_INFO = {
    f1: { kind: 'flower', colour: 'red', num: 1, en: 'Plum', zh: '梅' },
    f2: { kind: 'flower', colour: 'red', num: 2, en: 'Orchid', zh: '蘭' },
    f3: { kind: 'flower', colour: 'red', num: 3, en: 'Chrysanthemum', zh: '菊' },
    f4: { kind: 'flower', colour: 'red', num: 4, en: 'Bamboo', zh: '竹' },
    s1: { kind: 'season', colour: 'blue', num: 1, en: 'Spring', zh: '春' },
    s2: { kind: 'season', colour: 'blue', num: 2, en: 'Summer', zh: '夏' },
    s3: { kind: 'season', colour: 'blue', num: 3, en: 'Autumn', zh: '秋' },
    s4: { kind: 'season', colour: 'blue', num: 4, en: 'Winter', zh: '冬' },
    aCat: { kind: 'animal', en: 'Cat', zh: '貓' },
    aMouse: { kind: 'animal', en: 'Mouse', zh: '鼠' },
    aRooster: { kind: 'animal', en: 'Rooster', zh: '雞' },
    aCentipede: { kind: 'animal', en: 'Centipede', zh: '蜈蚣' },
  };

  const TYPES = [];
  SUITS.forEach((s) => { for (let n = 1; n <= 9; n++) TYPES.push(s + n); });
  ['E', 'S', 'W', 'N'].forEach((w) => TYPES.push('w' + w));
  ['R', 'G', 'W'].forEach((d) => TYPES.push('h' + d));
  const INDEX = {};
  TYPES.forEach((t, i) => { INDEX[t] = i; });

  const BONUS_TILES = Object.keys(BONUS_INFO);
  const SEAT_NUM = { E: 1, S: 2, W: 3, N: 4 };
  const NUM_SEAT = { 1: 'E', 2: 'S', 3: 'W', 4: 'N' };
  const TERMINALS_HONOURS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const BITES = [['aCat', 'aMouse'], ['aRooster', 'aCentipede']];

  // Fei 飛: an optional joker tile (house rule). It can stand in for any tile in a set or the pair.
  const FEI = 'jF';
  const isFei = (id) => id === FEI;

  const isBonus = (id) => Object.prototype.hasOwnProperty.call(BONUS_INFO, id);
  const isPlayable = (id) => Object.prototype.hasOwnProperty.call(INDEX, id);
  const isSuitedIdx = (i) => i < 27;

  function tileInfo(id) {
    if (isFei(id)) return { id, kind: 'fei', en: 'Fei', name: 'Fei (joker)', zh: '飛' };
    if (isPlayable(id)) {
      const i = INDEX[id];
      if (i < 27) {
        const s = id[0];
        const n = Number(id.slice(1));
        return { id, kind: 'suit', suit: s, rank: n, en: n + ' ' + SUIT_INFO[s].short, name: n + ' ' + SUIT_INFO[s].en, zh: n + SUIT_INFO[s].zh };
      }
      if (i < 31) {
        const w = id[1];
        return { id, kind: 'wind', wind: w, en: WIND_INFO[w].en, name: WIND_INFO[w].en + ' Wind', zh: WIND_INFO[w].zh };
      }
      const d = id[1];
      return { id, kind: 'dragon', dragon: d, en: DRAGON_INFO[d].short, name: DRAGON_INFO[d].en, zh: DRAGON_INFO[d].zh };
    }
    if (isBonus(id)) {
      const b = BONUS_INFO[id];
      const name = b.kind === 'animal' ? b.en : b.en + ', ' + b.colour + ' flower ' + b.num;
      const en = b.kind === 'animal' ? b.en : (b.colour === 'red' ? 'Red ' : 'Blue ') + b.num;
      return { id, kind: b.kind, colour: b.colour, num: b.num, en, name, zh: b.zh };
    }
    throw new Error('Unknown tile: ' + id);
  }

  const tileName = (id) => { const t = tileInfo(id); return t.name + ' (' + t.zh + ')'; };
  const sortTiles = (ids) => ids.slice().sort((a, b) => order(a) - order(b));
  function order(id) {
    if (isPlayable(id)) return INDEX[id];
    if (isFei(id)) return 50;
    return 100 + BONUS_TILES.indexOf(id);
  }

  /** Tile counts by type. Fei jokers are not a tile type and are left out. */
  function countsOf(ids) {
    const c = new Array(34).fill(0);
    ids.forEach((id) => { if (id in INDEX) c[INDEX[id]]++; });
    return c;
  }

  function meldTiles(m) {
    const i = INDEX[m.tile];
    if (m.type === 'chow') return [TYPES[i], TYPES[i + 1], TYPES[i + 2]];
    return new Array(m.type === 'kong' ? 4 : 3).fill(m.tile);
  }

  // ---------- Hand decomposition ----------

  function extractSets(c, start, acc, out) {
    let i = start;
    while (i < 34 && c[i] === 0) i++;
    if (i === 34) { out.push(acc.slice()); return; }
    if (c[i] >= 3) {
      c[i] -= 3; acc.push({ type: 'pong', tile: i });
      extractSets(c, i, acc, out);
      acc.pop(); c[i] += 3;
    }
    if (isSuitedIdx(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--; acc.push({ type: 'chow', tile: i });
      extractSets(c, i, acc, out);
      acc.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  }

  /** All ways to split concealed counts (3k+2 tiles) into k sets + 1 pair. */
  function standardDecompositions(c) {
    const results = [];
    for (let p = 0; p < 34; p++) {
      if (c[p] < 2) continue;
      c[p] -= 2;
      const out = [];
      extractSets(c, 0, [], out);
      out.forEach((sets) => results.push({ pair: p, sets }));
      c[p] += 2;
    }
    return results;
  }

  const sum = (c) => c.reduce((a, b) => a + b, 0);

  function isSevenPairs(c, meldCount) {
    return meldCount === 0 && sum(c) === 14 && c.every((n) => n === 0 || n === 2);
  }

  function isThirteenWonders(c, meldCount) {
    if (meldCount !== 0 || sum(c) !== 14) return false;
    for (let i = 0; i < 34; i++) {
      if (TERMINALS_HONOURS.includes(i)) { if (c[i] < 1) return false; } else if (c[i] > 0) return false;
    }
    return TERMINALS_HONOURS.some((i) => c[i] === 2);
  }

  function isComplete(c, meldCount) {
    if (sum(c) !== 3 * (4 - meldCount) + 2) return false;
    return standardDecompositions(c).length > 0 || isSevenPairs(c, meldCount) || isThirteenWonders(c, meldCount);
  }

  /** Tile types that would complete a 13-tile (minus melds) hand. */
  function waitingTiles(c, meldCount, used) {
    const waits = [];
    for (let t = 0; t < 34; t++) {
      if ((used ? used[t] : c[t]) >= 4) continue;
      c[t]++;
      if (isComplete(c, meldCount)) waits.push(TYPES[t]);
      c[t]--;
    }
    return waits;
  }

  // ---------- Validation ----------

  function validate(hand) {
    const melds = hand.melds || [];
    const concealed = hand.concealed || [];
    if (melds.length > 4) return 'A hand can have at most 4 exposed sets.';
    const inHand = concealed.concat(hand.winningTile ? [hand.winningTile] : []);
    for (const id of inHand) {
      if (!isPlayable(id) && !isFei(id)) return 'Bonus tiles (flowers and animals) go in the bonus row, not the hand.';
    }
    if (inHand.filter(isFei).length > 4) return 'There are only 4 Fei 飛 jokers.';
    for (const m of melds) {
      if (!isPlayable(m.tile)) return 'Unknown tile in an exposed set.';
      if (m.type === 'chow') {
        const i = INDEX[m.tile];
        if (!isSuitedIdx(i) || i % 9 > 6) return 'A chow must start on a suited tile from 1 to 7.';
      }
    }
    const all = concealed.concat(hand.winningTile ? [hand.winningTile] : []);
    melds.forEach((m) => meldTiles(m).forEach((id) => all.push(id)));
    const c = countsOf(all);
    for (let i = 0; i < 34; i++) {
      if (c[i] > 4 && !hand._feiSubstituted) return 'There are only 4 of each tile, but this hand has ' + c[i] + ' × ' + tileName(TYPES[i]) + '.';
    }
    const bonus = hand.bonus || [];
    if (new Set(bonus).size !== bonus.length) return 'Each flower and animal tile is unique.';
    return null;
  }

  // ---------- Scoring ----------

  const item = (name, zh, tai) => ({ name, zh, tai });

  function colourInfo(indices) {
    const suits = new Set();
    let honours = false;
    indices.forEach((i) => { if (i >= 27) honours = true; else suits.add(Math.floor(i / 9)); });
    return { suits, honours };
  }

  function colourItems(indices, rules) {
    const col = colourInfo(indices);
    if (col.suits.size !== 1) return [];
    const suit = SUIT_INFO[SUITS[[...col.suits][0]]];
    if (col.honours) return [item('Half Colour: ' + suit.en + ' + honours', '混一色', rules.tai.halfColour)];
    return [item('Full Colour: all ' + suit.en, '清一色', rules.tai.fullColour)];
  }

  function bonusItems(bonus, seat, rules) {
    const items = [];
    const n = SEAT_NUM[seat];
    sortTiles(bonus).forEach((id) => {
      const b = BONUS_INFO[id];
      if ((b.kind === 'flower' || b.kind === 'season') && b.num === n) {
        items.push(item('Your Flower: ' + b.en + ' (' + b.colour + ' ' + b.num + ')', b.zh, rules.tai.seatFlower));
      }
      if (b.kind === 'animal') items.push(item('Animal: ' + b.en, b.zh, rules.tai.animal));
    });
    if (['f1', 'f2', 'f3', 'f4'].every((f) => bonus.includes(f))) items.push(item('All 4 Red Flowers', '梅蘭菊竹', rules.tai.flowerSet));
    if (['s1', 's2', 's3', 's4'].every((s) => bonus.includes(s))) items.push(item('All 4 Blue Flowers', '春夏秋冬', rules.tai.flowerSet));
    return items;
  }

  /** Tai that apply to any hand shape: concealed hand, flower replacement win, house self-draw rule. */
  function contextItems(ctx, rules) {
    const items = [];
    if (ctx.concealedHand) items.push(item('Men Qing: no exposed sets', '門清', rules.tai.menQing));
    if (ctx.afterBonus && ctx.selfDraw) items.push(item('Hua Shang: won on a flower replacement tile', '花上', rules.tai.huaShang));
    if (ctx.lastTile && ctx.selfDraw) items.push(item('Hai Di Lao: self-drew the last tile of the wall', '海底撈月', rules.tai.haiDiLao));
    if (rules.houseSelfDrawTai && ctx.selfDraw) items.push(item('Zi Mo: self-draw (house rule 一台自摸)', '自摸', rules.tai.selfDraw));
    return items;
  }

  const LIMIT_NAMES = {
    thirteenWonders: ['Thirteen Wonders', '十三幺'],
    bigThreeDragons: ['Da San Yuan (Big Three Dragons)', '大三元'],
    bigFourWinds: ['Da Si Xi (Big Four Winds)', '大四喜'],
    smallFourWinds: ['Xiao Si Xi (Small Four Winds)', '小四喜'],
    allHonours: ['All Honours', '字一色'],
    nineGates: ['Nine Gates', '九蓮寶燈'],
    heavenlyHand: ['Heavenly Hand', '天胡'],
    earthlyHand: ['Earthly Hand', '地胡'],
  };

  function limitResult(keys, rules) {
    const allowed = keys.filter((k) => rules.limitHands.includes(k));
    if (!allowed.length) return null;
    return { limit: true, items: allowed.map((k) => item('Limit hand: ' + LIMIT_NAMES[k][0], LIMIT_NAMES[k][1], rules.maxTai)) };
  }

  function specialLimits(ctx) {
    if (ctx.special === 'heavenly') return ['heavenlyHand'];
    if (ctx.special === 'earthly') return ['earthlyHand'];
    return [];
  }

  function scoreStandard(sets, pair, ctx, rules) {
    const T = rules.tai;
    const pongs = sets.filter((s) => s.type !== 'chow');
    const dragonPongs = pongs.filter((s) => s.tile >= 31);
    const windPongs = pongs.filter((s) => s.tile >= 27 && s.tile <= 30);
    const indices = [pair];
    sets.forEach((s) => { if (s.type === 'chow') indices.push(s.tile, s.tile + 1, s.tile + 2); else indices.push(s.tile); });
    const col = colourInfo(indices);

    const limits = specialLimits(ctx);
    if (dragonPongs.length === 3) limits.push('bigThreeDragons');
    if (windPongs.length === 4) limits.push('bigFourWinds');
    if (windPongs.length === 3 && pair >= 27 && pair <= 30) limits.push('smallFourWinds');
    if (col.suits.size === 0) limits.push('allHonours');
    if (ctx.nineGates) limits.push('nineGates');
    const lim = limitResult(limits, rules);
    if (lim) return Object.assign({ handType: 'Standard hand' }, lim);

    const items = [];
    dragonPongs.forEach((s) => {
      const d = DRAGON_INFO[TYPES[s.tile][1]];
      items.push(item(d.en + (s.type === 'kong' ? ' Kong' : ' Pong'), d.zh, T.dragonPong));
    });
    windPongs.forEach((s) => {
      const w = TYPES[s.tile][1];
      const word = WIND_INFO[w].en + ' Wind' + (s.type === 'kong' ? ' Kong' : ' Pong');
      if (w === ctx.seat) items.push(item(word + ' (your seat wind)', WIND_INFO[w].zh, T.seatWindPong));
      if (w === ctx.prevalent) items.push(item(word + ' (prevalent wind)', WIND_INFO[w].zh, T.prevalentWindPong));
    });
    if (pongs.length === 4) items.push(item('Pong Pong: all pongs', '對對胡', T.pongPong));
    const allChows = sets.every((s) => s.type === 'chow');
    if (allChows && ctx.bonus.length === 0 && ctx.waits.length > 1) {
      items.push(item('Ping Hu: all chis, no flowers or animals, multi-tile wait', '平胡', T.pingHu));
    }
    // Ka Long 卡窿: the winning tile was the only wait and fills the middle of a chi from the hand.
    // It earns a tai only when self-drawn.
    const kaLong = ctx.waits.length === 1 && ctx.winIdx !== undefined
      && sets.some((s) => s.type === 'chow' && s.fromHand && s.tile + 1 === ctx.winIdx);
    if (kaLong && ctx.selfDraw) items.push(item('Ka Long: self-drew the middle tile of a chi', '卡窿', T.kaLong));
    colourItems(indices, rules).forEach((i) => items.push(i));
    bonusItems(ctx.bonus, ctx.seat, rules).forEach((i) => items.push(i));
    contextItems(ctx, rules).forEach((i) => items.push(i));
    return { handType: 'Standard hand', limit: false, items, kaLong };
  }

  function scoreSevenPairs(c, ctx, rules) {
    const indices = [];
    c.forEach((n, i) => { if (n) indices.push(i); });
    const limits = specialLimits(ctx);
    if (colourInfo(indices).suits.size === 0) limits.push('allHonours');
    const lim = limitResult(limits, rules);
    if (lim) return Object.assign({ handType: 'Seven Pairs' }, lim);
    const items = [item(
      'Seven Pairs (' + (ctx.selfDraw ? 'self-draw' : 'discard win') + ')',
      '七對子',
      ctx.selfDraw ? rules.tai.sevenPairsSelfDraw : rules.tai.sevenPairsDiscard,
    )];
    colourItems(indices, rules).forEach((i) => items.push(i));
    bonusItems(ctx.bonus, ctx.seat, rules).forEach((i) => items.push(i));
    contextItems(ctx, rules).forEach((i) => items.push(i));
    return { handType: 'Seven Pairs', limit: false, items };
  }

  function isNineGates(c, meldCount) {
    if (meldCount !== 0) return false;
    for (let s = 0; s < 3; s++) {
      const base = s * 9;
      let inSuit = 0;
      for (let r = 0; r < 9; r++) inSuit += c[base + r];
      if (inSuit !== 14) continue;
      const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      return need.every((n, r) => c[base + r] >= n);
    }
    return false;
  }

  function payoutFor(tai, selfDraw, rules) {
    if (selfDraw) {
      const each = rules.payouts.selfDrawEach[tai];
      return { selfDraw: true, each, total: each * 3 };
    }
    const total = rules.payouts.shooter[tai];
    return { selfDraw: false, shooterPays: total, total };
  }

  /**
   * hand = {
   *   concealed: [ids]  — tiles in hand, NOT counting the winning tile
   *   winningTile: id
   *   melds: [{ type: 'chow'|'pong'|'kong', tile: id (lowest for chow), kongSource?: 'discard'|'added'|'concealed' }]
   *   bonus: [ids], seat: 'E'|'S'|'W'|'N', prevalent: same, selfDraw: bool,
   *   afterBonus?: bool  — the winning tile was a replacement drawn after a flower/animal (花上)
   *   lastTile?: bool    — the winning tile was the last tile of the wall (海底撈月 when self-drawn)
   *   special?: 'heavenly'|'earthly', bonusAtStart?: bool
   * }
   * Fei 飛 jokers in the concealed tiles (or as the winning tile) are tried as every useful tile.
   */
  function evaluateHand(hand, rules) {
    rules = rules || SG_DEFAULT;
    const inHand = (hand.concealed || []).concat(hand.winningTile ? [hand.winningTile] : []);
    if (!inHand.some(isFei)) return evaluatePlain(hand, rules);
    const err = validate(hand);
    if (err) return { status: 'invalid', message: err };
    const plain = evaluatePlain(Object.assign({}, hand, { concealed: hand.concealed.filter((x) => !isFei(x)).concat(new Array(hand.concealed.filter(isFei).length).fill('wE')), _probe: true }), rules);
    if (plain.status === 'incomplete') return plain;
    return evaluateWithFei(hand, rules);
  }

  /** Tile types a Fei could usefully become: the tiles in hand and their neighbours. */
  function feiCandidates(real, many) {
    const set = new Set();
    real.forEach((id) => {
      const i = INDEX[id];
      set.add(i);
      if (!many && isSuitedIdx(i)) [-2, -1, 1, 2].forEach((d) => { const j = i + d; if (j >= 0 && Math.floor(j / 9) === Math.floor(i / 9)) set.add(j); });
    });
    if (!set.size) set.add(31);
    return [...set].sort((a, b) => a - b);
  }

  function evaluateWithFei(hand, rules) {
    const concealed = hand.concealed || [];
    const real = concealed.filter((x) => !isFei(x));
    const feiInHand = concealed.length - real.length;
    const winIsFei = isFei(hand.winningTile);
    const k = feiInHand + (winIsFei ? 1 : 0);
    const melds = hand.melds || [];
    const candidates = feiCandidates(real.concat(winIsFei ? [] : [hand.winningTile]), k >= 3);
    let best = null;
    const combo = [];
    const tryCombo = () => {
      const subs = combo.map((i) => TYPES[i]);
      const newConcealed = real.concat(subs.slice(0, feiInHand));
      const winning = winIsFei ? subs[feiInHand] : hand.winningTile;
      if (!isComplete(countsOf(newConcealed.concat([winning])), melds.length)) return;
      const r = evaluatePlain(Object.assign({}, hand, { concealed: newConcealed, winningTile: winning, _feiSubstituted: true }), rules);
      if (r.status !== 'ok') return;
      const score = (r.canWin ? 1000 : 0) + (r.limit ? 500 : 0) + r.rawTai;
      if (!best || score > best.score) best = { score, r, subs };
    };
    (function choose(start) {
      if (combo.length === k) return tryCombo();
      for (let j = start; j < candidates.length; j++) { combo.push(candidates[j]); choose(j); combo.pop(); }
    })(0);
    if (!best) {
      return { status: 'invalid', message: 'Even with the Fei 飛 jokers, these tiles are not a winning hand.', waits: [] };
    }
    return Object.assign({}, best.r, { feiAs: best.subs, items: best.r.items.concat([{ name: 'Fei 飛 used as ' + best.subs.map((s) => tileInfo(s).name).join(', '), zh: '飛', tai: 0 }]) });
  }

  function evaluatePlain(hand, rules) {
    const melds = hand.melds || [];
    const concealed = hand.concealed || [];
    const bonus = hand.bonus || [];
    const need = 13 - 3 * melds.length;

    const err = hand._probe ? null : validate(hand);
    if (err) return { status: 'invalid', message: err };
    if (concealed.length < need || !hand.winningTile) {
      const missing = need - concealed.length + (hand.winningTile ? 0 : 1);
      return { status: 'incomplete', message: 'Add ' + missing + ' more tile' + (missing === 1 ? '' : 's') + ' (' + need + ' in hand + the winning tile).' };
    }
    if (concealed.length > need) {
      return { status: 'invalid', message: 'Too many tiles: with ' + melds.length + ' exposed set(s) your hand holds ' + need + ' tiles plus the winning tile.' };
    }
    if (hand._probe) return { status: 'probe' };

    const c13 = countsOf(concealed);
    const used = countsOf(concealed.concat(...melds.map(meldTiles)));
    const waits = waitingTiles(c13, melds.length, used);
    const c = countsOf(concealed.concat([hand.winningTile]));
    const ctx = {
      seat: hand.seat || 'E',
      prevalent: hand.prevalent || 'E',
      selfDraw: !!hand.selfDraw,
      bonus,
      waits,
      special: hand.special,
      nineGates: isNineGates(c, melds.length),
      concealedHand: melds.every((m) => m.type === 'kong' && m.kongSource === 'concealed'),
      afterBonus: !!hand.afterBonus,
      lastTile: !!hand.lastTile,
      winIdx: INDEX[hand.winningTile],
    };
    const meldSets = melds.map((m) => ({ type: m.type, tile: INDEX[m.tile] }));

    const candidates = [];
    standardDecompositions(c.slice()).forEach((d) => {
      const handSets = d.sets.map((s) => Object.assign({ fromHand: true }, s));
      candidates.push(scoreStandard(handSets.concat(meldSets), d.pair, ctx, rules));
    });
    if (rules.allowSevenPairs !== false && isSevenPairs(c, melds.length)) candidates.push(scoreSevenPairs(c, ctx, rules));
    if (isThirteenWonders(c, melds.length)) {
      candidates.push(Object.assign({ handType: 'Thirteen Wonders' }, limitResult(specialLimits(ctx).concat(['thirteenWonders']), rules)));
    }
    if (!candidates.length) {
      return { status: 'invalid', message: 'These tiles are not a winning hand. A winning hand is 4 sets + 1 pair, Seven Pairs or Thirteen Wonders.', waits };
    }

    candidates.forEach((cand) => {
      cand.rawTai = cand.limit ? rules.maxTai : cand.items.reduce((a, i) => a + i.tai, 0);
    });
    candidates.sort((a, b) => (b.limit - a.limit) || (b.rawTai - a.rawTai));
    const best = candidates[0];
    const tai = Math.min(best.rawTai, rules.maxTai);
    const canWin = tai >= rules.minTai;
    return {
      status: 'ok',
      handType: best.handType,
      limit: best.limit,
      items: best.items,
      rawTai: best.rawTai,
      tai,
      canWin,
      payout: canWin ? payoutFor(tai, ctx.selfDraw, rules) : null,
      waits,
      kaLong: !!best.kaLong,
    };
  }

  /**
   * Flower bite: holding the red and blue flower of the same number.
   * Your own number → every other player pays; someone else's number → only that player pays.
   * Returns [{ num, payerSeat|null (null = everyone), each }].
   */
  function flowerBites(bonus, seat, atStart, rules) {
    const I = (rules || SG_DEFAULT).instant;
    const out = [];
    for (let n = 1; n <= 4; n++) {
      if (!bonus.includes('f' + n) || !bonus.includes('s' + n)) continue;
      const each = atStart ? I.flowerBiteAtStartEach : I.flowerBiteEach;
      out.push({ num: n, payerSeat: n === SEAT_NUM[seat] ? null : NUM_SEAT[n], each });
    }
    return out;
  }

  /**
   * Chips paid straight away for kongs and bites. Each entry is either
   * { label, each, total } (every other player pays `each`) or { label, single, payer, total } (one player pays).
   */
  function instantPayouts(hand, rules) {
    rules = rules || SG_DEFAULT;
    const I = rules.instant;
    const list = [];
    (hand.melds || []).forEach((m) => {
      if (m.type !== 'kong') return;
      const name = tileName(m.tile);
      if (m.kongSource === 'concealed') list.push({ label: 'Concealed kong of ' + name, each: I.concealedKongEach, total: I.concealedKongEach * 3 });
      else if (m.kongSource === 'added') list.push({ label: 'Kong added to a revealed pong (' + name + ')', each: I.exposedKongEach, total: I.exposedKongEach * 3 });
      else list.push({ label: 'Kong from a discard (' + name + ')', single: I.kongFromDiscardShooter, payer: 'the discarder', total: I.kongFromDiscardShooter });
    });
    const bonus = hand.bonus || [];
    const start = hand.bonusAtStart ? ' in the opening hand' : '';
    BITES.forEach(([a, b]) => {
      if (!bonus.includes(a) || !bonus.includes(b)) return;
      const each = hand.bonusAtStart ? I.biteAtStartEach : I.biteEach;
      list.push({ label: 'Animal bite: ' + BONUS_INFO[a].en + ' and ' + BONUS_INFO[b].en + start, each, total: each * 3 });
    });
    flowerBites(bonus, hand.seat || 'E', hand.bonusAtStart, rules).forEach((fb) => {
      const label = 'Flower bite: red and blue ' + fb.num + 's' + start;
      if (fb.payerSeat === null) list.push({ label: label + ' (your number)', each: fb.each, total: fb.each * 3 });
      else list.push({ label: label + ' (' + WIND_INFO[fb.payerSeat].en + ' ' + WIND_INFO[fb.payerSeat].zh + "'s number)", single: fb.each, payer: 'the ' + WIND_INFO[fb.payerSeat].en + ' ' + WIND_INFO[fb.payerSeat].zh + ' player', total: fb.each });
    });
    return list;
  }

  // ---------- Shanten and discard advice ----------

  /** Standard-hand shanten: -1 = complete, 0 = ready (ting). */
  function standardShanten(c, meldCount) {
    const need = 4 - meldCount;
    let best = 2 * need;
    function search(i, sets, partials, pair) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) {
        const p = Math.min(partials, need - sets);
        const v = 2 * (need - sets) - p - (pair ? 1 : 0);
        if (v < best) best = v;
        return;
      }
      const suited = isSuitedIdx(i);
      const r = i % 9;
      if (c[i] >= 3) { c[i] -= 3; search(i, sets + 1, partials, pair); c[i] += 3; }
      if (suited && r <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; search(i, sets + 1, partials, pair); c[i]++; c[i + 1]++; c[i + 2]++;
      }
      if (c[i] >= 2) {
        c[i] -= 2;
        if (!pair) search(i, sets, partials, true);
        search(i, sets, partials + 1, pair);
        c[i] += 2;
      }
      if (suited && r <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; search(i, sets, partials + 1, pair); c[i]++; c[i + 1]++; }
      if (suited && r <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; search(i, sets, partials + 1, pair); c[i]++; c[i + 2]++; }
      // leave the remaining copies of tile i unused
      const saved = c[i];
      c[i] = 0; search(i + 1, sets, partials, pair); c[i] = saved;
    }
    search(0, 0, 0, false);
    return best;
  }

  function sevenPairsShanten(c) {
    let pairs = 0;
    let kinds = 0;
    c.forEach((n) => { if (n >= 1) kinds++; if (n >= 2) pairs++; });
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  function thirteenWondersShanten(c) {
    let kinds = 0;
    let pair = 0;
    TERMINALS_HONOURS.forEach((i) => { if (c[i]) kinds++; if (c[i] >= 2) pair = 1; });
    return 13 - kinds - pair;
  }

  function shanten(c, meldCount) {
    let s = standardShanten(c, meldCount);
    if (meldCount === 0) s = Math.min(s, sevenPairsShanten(c), thirteenWondersShanten(c));
    return s;
  }

  function improvingTiles(c, meldCount, visible, base) {
    let count = 0;
    const tiles = [];
    for (let t = 0; t < 34; t++) {
      const left = 4 - visible[t];
      if (left <= 0) continue;
      c[t]++;
      if (shanten(c, meldCount) < base) { count += left; tiles.push(TYPES[t]); }
      c[t]--;
    }
    return { count, tiles };
  }

  function isIsolated(c, i) {
    if (c[i] !== 1) return false;
    if (!isSuitedIdx(i)) return true;
    const r = i % 9;
    for (let d = -2; d <= 2; d++) {
      if (d === 0) continue;
      const rr = r + d;
      if (rr >= 0 && rr <= 8 && c[i + d] > 0) return false;
    }
    return true;
  }

  /**
   * Rank every possible discard from a 14-tile hand (concealed + drawn tile).
   * opts.seen: ids of tiles already visible on the table (discards etc.).
   */
  function adviseDiscard(hand, rules, opts) {
    rules = rules || SG_DEFAULT;
    opts = opts || {};
    const melds = hand.melds || [];
    const m = melds.length;
    const tiles = (hand.concealed || []).concat(hand.winningTile ? [hand.winningTile] : []);
    const need = 14 - 3 * m;
    const err = validate(hand);
    if (err) return { status: 'invalid', message: err };
    if (tiles.length !== need) {
      const missing = need - tiles.length;
      return missing > 0
        ? { status: 'incomplete', message: 'Add ' + missing + ' more tile' + (missing === 1 ? '' : 's') + ' (' + (need - 1) + ' in hand + the tile you just drew).' }
        : { status: 'invalid', message: 'Too many tiles for ' + m + ' exposed set(s).' };
    }
    const c = countsOf(tiles);
    const visible = c.slice();
    melds.forEach((md) => meldTiles(md).forEach((id) => { visible[INDEX[id]]++; }));
    (opts.seen || []).forEach((id) => { if (isPlayable(id)) visible[INDEX[id]] = Math.min(4, visible[INDEX[id]] + 1); });

    // Each Fei joker can replace any one missing tile, so it brings the hand one step closer.
    const fei = tiles.filter(isFei).length;
    const withFei = (s) => Math.max(-1, s - fei);
    const current = withFei(shanten(c, m));
    const seatIdx = INDEX['w' + (hand.seat || 'E')];
    const prevIdx = INDEX['w' + (hand.prevalent || 'E')];
    const valueTiles = new Set([31, 32, 33, seatIdx, prevIdx]);

    const suitCounts = [0, 0, 0];
    let honourCount = 0;
    tiles.filter((id) => !isFei(id)).forEach((id) => { const i = INDEX[id]; if (i >= 27) honourCount++; else suitCounts[Math.floor(i / 9)]++; });
    melds.forEach((md) => meldTiles(md).forEach((id) => { const i = INDEX[id]; if (i >= 27) honourCount++; else suitCounts[Math.floor(i / 9)]++; }));
    const dom = suitCounts.indexOf(Math.max(...suitCounts));
    const offSuit = suitCounts.reduce((a, n, s) => a + (s === dom ? 0 : n), 0);
    const chasingColour = suitCounts[dom] + honourCount >= 9 && offSuit <= 4 && offSuit > 0;

    const options = [];
    for (let t = 0; t < 34; t++) {
      if (!c[t]) continue;
      c[t]--;
      const raw = shanten(c, m);
      const imp = improvingTiles(c, m, visible, raw);
      const sh = withFei(raw);
      c[t]++;

      const notes = [];
      let penalty = 0;
      if (valueTiles.has(t) && c[t] >= 2) {
        penalty += 40;
        notes.push('Breaks your pair of ' + tileName(TYPES[t]) + ', which could become a 1-tai pong.');
      }
      if (chasingColour && isSuitedIdx(t) && Math.floor(t / 9) !== dom) {
        penalty -= 15;
        notes.push('Off-suit tile: throwing it keeps you on track for half or full colour in ' + SUIT_INFO[SUITS[dom]].en + '.');
      }
      if (isIsolated(c, t)) {
        // a lone honour can only ever pair or pong, so it goes before a lone suited tile
        penalty -= isSuitedIdx(t) ? 2 : (valueTiles.has(t) ? 1 : 3);
        notes.push(isSuitedIdx(t) ? 'Isolated: no nearby tiles to build a chi with.' : 'Single honour tile with no pair: it can only become a pair or pong.');
      }
      if (!isSuitedIdx(t) && c[t] === 1 && visible[t] >= 3) {
        penalty -= 3;
        notes.push('Safe throw: the other copies are already out, so nobody can pong it.');
      }

      let summary;
      if (sh === 0) summary = 'You will be ready (ting), waiting on ' + imp.tiles.length + ' tile type' + (imp.tiles.length === 1 ? '' : 's') + ' (' + imp.count + ' left).';
      else summary = sh + ' tile' + (sh === 1 ? '' : 's') + ' away from ready, with ' + imp.count + ' live tiles that move you closer.';

      options.push({ tile: TYPES[t], shanten: sh, live: imp.count, improving: imp.tiles, notes, summary, score: sh * 1000 - imp.count * 10 + penalty });
    }
    options.sort((a, b) => a.score - b.score || INDEX[a.tile] - INDEX[b.tile]);
    if (fei) options.forEach((o) => o.notes.push('Keep your Fei 飛 joker: it can become any tile you need.'));
    return { status: 'ok', currentShanten: current, complete: current === -1, options };
  }

  global.MJ = {
    RULES: SG_DEFAULT,
    TYPES,
    BONUS_TILES,
    SUITS,
    tileInfo,
    tileName,
    sortTiles,
    countsOf,
    meldTiles,
    isBonus,
    isPlayable,
    validate,
    evaluateHand,
    instantPayouts,
    flowerBites,
    FEI,
    isFei,
    BITES,
    WIND_INFO,
    SEAT_NUM,
    NUM_SEAT,
    waitingTiles,
    isComplete,
    shanten,
    adviseDiscard,
  };
})(typeof window !== 'undefined' ? window : globalThis);
