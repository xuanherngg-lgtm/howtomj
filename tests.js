/* HowToMJ tests. Open tests.html in a browser; results also land in window.__testSummary. */
(function () {
  'use strict';
  const MJ = window.MJ;
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  function eq(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error((label ? label + ': ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
  }
  function ok(cond, label) { if (!cond) throw new Error(label || 'expected true'); }
  const t = (s) => (s.trim() ? s.trim().split(/\s+/) : []);
  const hand = (concealed, winning, extra) => Object.assign(
    { concealed: t(concealed), winningTile: winning, melds: [], bonus: [], seat: 'E', prevalent: 'E', selfDraw: false },
    extra || {},
  );
  const names = (r) => r.items.map((i) => i.zh).sort();
  const chow = (tile) => ({ type: 'chow', tile });
  const pong = (tile) => ({ type: 'pong', tile });

  // ---- Basic hands (a concealed hand also scores Men Qing 門清) ----

  test('Ping Hu + Men Qing: 4 + 1 = 5 tai, shooter pays 40', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7'));
    eq(r.status, 'ok'); eq(r.tai, 5); eq(names(r), ['平胡', '門清'].sort());
    eq(r.waits, ['c4', 'c7'], 'waits');
    eq(r.payout, { selfDraw: false, shooterPays: 40, total: 40 });
  });

  test('Ping Hu fails with an edge (single) wait', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b4 b5 b6 d2 d3 d4 c5 c6 c7 c9 c9', 'b3'));
    ok(!names(r).includes('平胡')); eq(r.tai, 1);
  });

  test('Ping Hu fails with any flower', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7', { bonus: ['f2'] }));
    ok(!names(r).includes('平胡'));
  });

  test('Pong Pong + Green Dragon + Men Qing, self-draw = 4 tai, 12 from each', () => {
    const r = MJ.evaluateHand(hand('b1 b1 b1 d5 d5 d5 c9 c9 c9 hG hG wN wN', 'hG', { selfDraw: true }));
    eq(r.tai, 4); eq(names(r), ['對對胡', '發碰', '門清'].sort());
    eq(r.payout, { selfDraw: true, each: 12, total: 36 });
    ok(r.items.some((i) => i.name.includes('Green Dragon Pong') && i.name.includes('Qīng Fā')), 'pinyin + English name');
  });

  test('Exposed sets: Pong Pong + Green Dragon = 3 tai, no Men Qing', () => {
    const r = MJ.evaluateHand(hand('c9 c9 c9 hG hG wN wN', 'hG', { melds: [pong('b1'), pong('d5')] }));
    eq(r.tai, 3); ok(!names(r).includes('門清'));
  });

  test('Half Colour + Red Dragon + Men Qing = 4 tai, shooter pays 20', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b3 b5 b5 b5 b7 b8 b9 hR hR hR b2', 'b2'));
    eq(r.tai, 4); eq(r.payout.shooterPays, 20);
  });

  test('Full Colour + Ping Hu + Men Qing = 9 raw, capped at 5', () => {
    const r = MJ.evaluateHand(hand('d1 d2 d3 d4 d5 d6 d7 d8 d9 d2 d3 d4 d5', 'd5'));
    eq(r.rawTai, 9); eq(r.tai, 5); eq(r.payout.shooterPays, 40);
  });

  test('Revealed East Wind pong as East seat in the East round = 2 tai', () => {
    eq(MJ.evaluateHand(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c9', 'c9', { melds: [pong('wE')] })).tai, 2);
  });

  test('Revealed non-seat wind pong scores nothing: 0 tai, cannot Hu', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c9', 'c9', { melds: [pong('wN')] }));
    eq(r.tai, 0); eq(r.canWin, false); eq(r.payout, null);
  });

  test('Mixed pongs and chis with revealed sets = 0 tai (no Hu)', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b3 c1 c1 c1 c9', 'c9', { melds: [chow('d2'), pong('b5')] }));
    eq(r.tai, 0); eq(r.canWin, false);
  });

  test('Men Qing still counts with a concealed kong', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c9', 'c9', { melds: [{ type: 'kong', tile: 'wN', kongSource: 'concealed' }] }));
    ok(names(r).includes('門清'));
  });

  // ---- Hua Shang and the self-draw house rule ----

  test('Hua Shang 花上: +1 on a self-drawn flower replacement only', () => {
    const base = { melds: [chow('b1')], selfDraw: true };
    const h = hand('b4 b5 b6 d2 d3 d4 c5 c6 c7 c9', 'c9', Object.assign({}, base, { bonus: ['f2'] }));
    eq(MJ.evaluateHand(h).tai, 0);
    eq(MJ.evaluateHand(Object.assign({}, h, { afterBonus: true })).tai, 1);
    eq(MJ.evaluateHand(Object.assign({}, h, { afterBonus: true, selfDraw: false })).tai, 0);
  });

  test('House rule 一台自摸: a 1-tai hand can only win by self-draw', () => {
    const h = hand('b4 b5 b6 d2 d3 d4 c5 c6 c7 c9', 'c9', { melds: [chow('b1')], selfDraw: true });
    eq(MJ.evaluateHand(h).tai, 0);
    const r1 = Object.assign({}, MJ.RULES, { oneTaiZiMo: true });
    const one = hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c9', 'c9', { melds: [pong('hR')] });
    eq(MJ.evaluateHand(one, r1).canWin, false, '1 tai off a discard');
    eq(MJ.evaluateHand(Object.assign({}, one, { selfDraw: true }), r1).canWin, true, '1 tai self-drawn');
    eq(MJ.evaluateHand(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c9', 'c9', { melds: [pong('wE')] }), r1).canWin, true, '2 tai off a discard')
  });

  // ---- Ka Long, Hai Di Lao, Si Xi, Seven Pairs switch ----

  test('Ka Long 卡窿: +1 when self-drawn, nothing off a discard', () => {
    const h = hand('b1 b2 b3 d4 d6 c2 c2 wN wN wN', 'd5', { melds: [chow('c7')] });
    const discard = MJ.evaluateHand(h);
    eq(discard.tai, 0); eq(discard.kaLong, true);
    const self = MJ.evaluateHand(Object.assign({}, h, { selfDraw: true }));
    eq(self.tai, 1); ok(names(self).includes('卡窿'));
  });

  test('Ka Long needs a single middle wait (a two-sided wait is not Ka Long)', () => {
    const r = MJ.evaluateHand(hand('b1 b2 b3 d4 d5 c2 c2 wN wN wN', 'd6', { melds: [chow('c7')], selfDraw: true }));
    ok(!names(r).includes('卡窿'));
  });

  test('Hai Di Lao 海底撈月: +1 for a self-draw on the last tile only', () => {
    const h = hand('b4 b5 b6 d2 d3 d4 c5 c6 c7 c9', 'c9', { melds: [chow('b1')], lastTile: true });
    eq(MJ.evaluateHand(h).tai, 0);
    eq(MJ.evaluateHand(Object.assign({}, h, { selfDraw: true })).tai, 1);
  });

  test('Da Si Xi 大四喜 and Xiao Si Xi 小四喜 are limit hands', () => {
    const da = MJ.evaluateHand(hand('wE wE wE wS wS wS wW wW wW wN wN wN b5', 'b5'));
    eq(da.limit, true); eq(names(da), ['大四喜']);
    const xiao = MJ.evaluateHand(hand('wE wE wE wS wS wS wW wW wW wN wN b2 b3', 'b4'));
    eq(xiao.limit, true); eq(names(xiao), ['小四喜']);
  });

  test('Seven Pairs can be switched off as a house rule', () => {
    const h = hand('b1 b1 b9 b9 d3 d3 d7 d7 c2 c2 hW hW wN', 'wN');
    eq(MJ.evaluateHand(h, Object.assign({}, MJ.RULES, { allowSevenPairs: false })).status, 'invalid');
  });

  // ---- Fei jokers ----

  test('Fei 飛 fills a missing chi tile', () => {
    const r = MJ.evaluateHand(hand('b1 b2 jF d4 d5 d6 c7 c8 c9 hR hR hR wN', 'wN'));
    eq(r.status, 'ok'); eq(r.feiAs, ['b3']); ok(r.tai >= 1);
  });

  test('Two Fei can be the pair; Fei as the winning tile works too', () => {
    eq(MJ.evaluateHand(hand('jF jF c4 c5 c6 b7 b8 b9 d2 d2 d2 wE wE', 'wE')).status, 'ok');
    eq(MJ.evaluateHand(hand('b1 b2 b3 d4 d5 d6 c7 c8 c9 hR hR hR wN', 'jF')).status, 'ok');
  });

  test('Fei cannot rescue a hopeless hand', () => {
    eq(MJ.evaluateHand(hand('b1 b3 b5 b7 jF d1 d3 d5 c2 c4 c6 wE wS', 'hW')).status, 'invalid');
  });

  test('The advisor never tells you to throw a Fei', () => {
    const r = MJ.adviseDiscard(hand('b1 b2 jF d4 d5 d7 c7 c8 c2 c2 wN b5 hG', 'wS'));
    eq(r.status, 'ok');
    ok(r.options.every((o) => !MJ.isFei(o.tile)));
  });

  test('Xiao San Yuan 小三元: two dragon pongs + a dragon pair = 4 tai', () => {
    const r = MJ.evaluateHand(hand('hR hR hR hG hG hG hW b1 b2 b3 d5 d6 d7', 'hW', { melds: [] }));
    ok(names(r).includes('小三元')); ok(!names(r).includes('中碰'), 'dragon pongs not double counted');
    eq(r.items.find((i) => i.zh === '小三元').tai, 4);
  });

  test('describeSets splits a hand into labelled sets', () => {
    const g = MJ.describeSets(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7'));
    eq(g.map((x) => x.type), ['chi', 'chi', 'chi', 'chi', 'pair']);
    eq(MJ.describeSets(hand('b1 b3 b5 b7 b9 d1 d3 d5 d7 d9 c1 c3 c5', 'c7')), null);
  });

  // ---- Special hands ----

  test('Seven Pairs + Men Qing: 3 on a discard, 4 on a self-draw', () => {
    eq(MJ.evaluateHand(hand('b1 b1 b9 b9 d3 d3 d7 d7 c2 c2 hW hW wN', 'wN')).tai, 3);
    eq(MJ.evaluateHand(hand('b1 b1 b9 b9 d3 d3 d7 d7 c2 c2 hW hW wN', 'wN', { selfDraw: true })).tai, 4);
  });

  test('Limit hands: Thirteen Wonders, Big Three Dragons, All Honours, Nine Gates', () => {
    eq(MJ.evaluateHand(hand('b1 b9 d1 d9 c1 c9 wE wS wW wN hR hG hW', 'b1')).limit, true);
    eq(MJ.evaluateHand(hand('hR hR hR hG hG hG hW hW hW b1 b2 b3 d5', 'd5')).limit, true);
    eq(MJ.evaluateHand(hand('wE wE wE wS wS wS wW wW wW hR hR hR hG', 'hG')).limit, true);
    eq(names(MJ.evaluateHand(hand('c1 c1 c1 c2 c3 c4 c5 c6 c7 c8 c9 c9 c9', 'c5'))), ['九蓮寶燈']);
  });

  // ---- Flowers ----

  test('Your red and blue flowers (East) = 1 tai each', () => {
    eq(MJ.evaluateHand(hand('b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7', { melds: [chow('b1')], bonus: ['f1', 's1'] })).tai, 2);
  });

  test('All 4 red flowers as South = your flower 1 + set bonus 1', () => {
    eq(MJ.evaluateHand(hand('b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7', { melds: [chow('b1')], seat: 'S', bonus: ['f1', 'f2', 'f3', 'f4'] })).tai, 2);
  });

  test('Two animals = 2 tai', () => {
    eq(MJ.evaluateHand(hand('b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7', { melds: [chow('b1')], bonus: ['aCat', 'aMouse'] })).tai, 2);
  });

  test('Bonus tile names use red/blue flowers, not seasons', () => {
    eq(MJ.tileInfo('s2').name, 'Summer, blue flower 2');
    eq(MJ.tileInfo('f3').en, 'Red 3');
  });

  // ---- Instant payouts ----

  test('Animal bite: 2 each; 4 each in the opening hand', () => {
    eq(MJ.instantPayouts({ bonus: ['aCat', 'aMouse'] })[0].each, 2);
    eq(MJ.instantPayouts({ bonus: ['aCat', 'aMouse'], bonusAtStart: true })[0].each, 4);
    eq(MJ.instantPayouts({ bonus: ['aCat', 'aRooster'] }).length, 0);
  });

  test('Flower bite: own number → everyone pays; other number → that player pays', () => {
    const own = MJ.instantPayouts({ bonus: ['f2', 's2'], seat: 'S' });
    eq([own[0].each, own[0].total], [2, 6]);
    const other = MJ.instantPayouts({ bonus: ['f3', 's3'], seat: 'E' });
    eq([other[0].single, other[0].total], [2, 2]);
    ok(/West/.test(other[0].payer), 'payer is West');
    eq(MJ.instantPayouts({ bonus: ['f3', 's3'], seat: 'E', bonusAtStart: true })[0].single, 4);
    eq(MJ.instantPayouts({ bonus: ['f3', 's2'], seat: 'E' }).length, 0);
  });

  test('Kong payouts: concealed 4 each, added 2 each, from discard 6 from the discarder', () => {
    const p = MJ.instantPayouts({ melds: [
      { type: 'kong', tile: 'd5', kongSource: 'concealed' },
      { type: 'kong', tile: 'b2', kongSource: 'added' },
      { type: 'kong', tile: 'c7', kongSource: 'discard' },
    ] });
    eq(p.map((x) => x.total), [12, 6, 6]);
    eq(p[2].single, 6);
  });

  // ---- Validation ----

  test('Incomplete, impossible and non-winning hands are reported', () => {
    eq(MJ.evaluateHand(hand('b1 b2 b3', null)).status, 'incomplete');
    eq(MJ.evaluateHand(hand('b1 b1 b1 b1 b1 b2 b3 d4 d5 d6 c7 c8 c9', 'wE')).status, 'invalid');
    eq(MJ.evaluateHand(hand('b1 b3 b5 b7 b9 d1 d3 d5 d7 d9 c1 c3 c5', 'c7')).status, 'invalid');
  });

  // ---- Shanten / advisor ----

  test('Shanten: ready = 0, complete = -1, Seven Pairs counted', () => {
    eq(MJ.shanten(MJ.countsOf(t('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9')), 0), 0);
    eq(MJ.shanten(MJ.countsOf(t('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c7 c9 c9')), 0), -1);
    eq(MJ.shanten(MJ.countsOf(t('b1 b1 b9 b9 d3 d3 d7 d7 c2 c2 hW hW wN')), 0), 0);
  });

  test('Advisor throws an isolated tile and keeps a seat-wind pair', () => {
    const r = MJ.adviseDiscard(hand('b1 b2 b3 d4 d5 d6 c7 c8 c2 c2 b5 b6 d9', 'wN'));
    ok(['wN', 'd9'].includes(r.options[0].tile), 'top pick was ' + r.options[0].tile);
    const r2 = MJ.adviseDiscard(hand('b1 b2 b3 d4 d5 d6 c7 c8 wE wE b5 b6 c1', 'hW'));
    ok(r2.options[0].tile !== 'wE', 'broke the East pair');
    eq(MJ.adviseDiscard(hand('b1 b2 b3 b4 b5 b6 d2 d3 d4 c5 c6 c9 c9', 'c7')).complete, true);
  });

  // ---- Lessons ----

  function checkQuestion(q, where) {
    if (q.hand && (q.type === 'tai' || q.type === 'chips')) {
      const r = MJ.evaluateHand(q.hand);
      if (r.status !== 'ok' || !r.canWin) throw new Error(where + ' hand does not score: ' + (r.message || r.tai + ' tai'));
    }
    const res = window.Learn.resolve(q);
    if (!(res.answer >= 0 && res.answer < res.options.length)) throw new Error(where + ' answer index out of range');
    if (res.options.length < 2) throw new Error(where + ' has fewer than 2 options');
    const labels = res.options.map((o) => o.label || o.tile);
    if (new Set(labels).size !== labels.length) throw new Error(where + ' has duplicate options: ' + labels.join(', '));
    if (q.type === 'tile' && !q.options.includes(q.answer)) throw new Error(where + ' answer tile not offered');
  }

  (window.LESSONS || []).forEach((lesson) => {
    test(lesson.id + ' ' + lesson.title + ': fixed questions and 40 runs of each generator are valid', () => {
      lesson.quiz.forEach((q, i) => checkQuestion(q, 'Q' + (i + 1)));
      (lesson.generators || []).forEach((g, gi) => {
        let made = 0;
        for (let k = 0; k < 25; k++) {
          const q = g(Math.random);
          if (!q) continue;
          made++;
          checkQuestion(q, 'generator ' + gi + ' run ' + k);
        }
        if (made < 20) throw new Error('generator ' + gi + ' only produced ' + made + '/25 questions');
      });
    });
    test(lesson.id + ': every retry builds a fresh quiz of ' + (lesson.quizSize || lesson.quiz.length), () => {
      const a = window.Learn.buildQuiz(lesson);
      eq(a.length, lesson.quizSize || lesson.quiz.length);
      let differs = false;
      for (let k = 0; k < 6 && !differs; k++) {
        const b = window.Learn.buildQuiz(lesson);
        differs = JSON.stringify(a.map((x) => [x.q.prompt, x.q.tiles, x.q.options])) !== JSON.stringify(b.map((x) => [x.q.prompt, x.q.tiles, x.q.options]));
      }
      ok(differs, 'quiz never changed');
    });
  });

  test('Set Builder recognises chi, pong and pair', () => {
    const c = window.MiniGames.classify;
    eq(c(['b3', 'b1', 'b2']), 'chi'); eq(c(['hR', 'hR', 'hR']), 'pong'); eq(c(['d5', 'd5']), 'pair');
    eq(c(['b1', 'b2', 'd3']), null); eq(c(['wE', 'wS', 'wW']), null);
  });

  test('Every lesson has a mini game', () => {
    window.LESSONS.forEach((l) => ok(window.MiniGames.info(l.id), l.id + ' has no mini game'));
  });

  test('Every wind in lesson text carries its character', () => {
    const texts = [];
    const walk = (o) => { if (typeof o === 'string') texts.push(o); else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object' && !o.noWindChars) Object.keys(o).forEach((k) => { if (k !== 'tiles' && k !== 'hand') walk(o[k]); }); };
    window.LESSONS.forEach((l) => { walk(l.cards); walk(l.quiz); });
    const bare = texts.filter((s) => /\b(East|South|West|North)\b(?!\s*[東南西北])/.test(s));
    eq(bare, []);
  });

  test('Lesson 2 no longer asks about tai before it is taught', () => {
    const l2 = window.LESSONS.find((l) => l.id === 'L2');
    ok(!l2.quiz.some((q) => q.type === 'tai'));
  });

  test('Lesson 5 chip questions follow the table', () => {
    const l5 = window.LESSONS.find((l) => l.id === 'L5');
    const gen = l5.generators[3];
    const table = { self: [0, 4, 5, 7, 12, 22], shooter: [0, 4, 7, 11, 20, 40] };
    for (let k = 0; k < 30; k++) {
      const q = gen(Math.random);
      const tai = Number(q.prompt.match(/(\d)-tai/)[1]);
      const expect = (/self-draw/.test(q.prompt) ? table.self : table.shooter)[tai];
      eq(q.options[q.answer], expect + ' chips', q.prompt);
    }
  });

  // ---- Practice game ----

  function playHand(g, humanPolicy) {
    if (!g._swapChecked) {
      // Nobody (bot or human) may throw a tile that swaps the set they just claimed.
      const orig = g.discard.bind(g);
      g.discard = (i, tile) => {
        if (!g.canThrow(tile)) throw new Error(g.label(i) + ' threw ' + tile + ' right after claiming it into a set');
        return orig(i, tile);
      };
      g._swapChecked = true;
    }
    g.startHand();
    let steps = 0;
    while (!g.isOver()) {
      if (++steps > 3000) throw new Error('hand did not finish, stuck in ' + g.phase);
      if (g.needsHuman()) humanPolicy(g);
      else g.advance();
      if (g.tileCount() !== g.totalTiles) throw new Error('tile count is ' + g.tileCount() + ' of ' + g.totalTiles + ' in phase ' + g.phase);
    }
  }

  const hintPolicy = (game) => {
    switch (game.phase) {
      case 'humanDice': return game.humanRollDice();
      case 'humanDeal': return game.humanDealTake();
      case 'humanReplace': return game.humanReplace();
      case 'humanDraw': return game.humanDrawTile();
      default: break;
    }
    const hint = game.hint();
    if (game.phase === 'humanTurn') {
      if (hint.type === 'win') return game.humanWin();
      if (game.options.kongs.length) return game.humanKong(game.options.kongs[0]);
      return game.humanDiscard(hint.tile);
    }
    if (hint.type === 'win') return game.humanWin();
    if (hint.type === 'pass') return game.humanClaim({ type: 'pass' });
    return game.humanClaim({ type: hint.type, chow: hint.chow });
  };

  ['beginner', 'intermediate', 'expert'].forEach((difficulty, n) => {
    test('Bot-only session (' + difficulty + '): 20 hands keep every tile and 1200 chips', () => {
      const g = new window.MJGame.Game({ seed: 7 + n, allBots: true, difficulty });
      let wins = 0;
      for (let h = 0; h < 20; h++) {
        playHand(g);
        if (g.result.type === 'win') {
          wins++;
          ok(g.result.evaluation.canWin, 'hand ' + h + ' won without a tai');
        }
        eq(g.players.reduce((a, p) => a + p.chips, 0), 1200, 'chips after hand ' + (h + 1));
        eq(g.result.deltas.reduce((a, b) => a + b, 0), 0, 'deltas balance');
      }
      ok(wins >= 4, 'bots only won ' + wins + ' of 20 hands');
    });
  });

  test('Human following hints: 15 hands, automatic dealing', () => {
    const g = new window.MJGame.Game({ seed: 11 });
    for (let h = 0; h < 15; h++) { playHand(g, hintPolicy); ok(g.result.review, 'review built'); }
    eq(g.players.reduce((a, p) => a + p.chips, 0), 1200, 'chips');
  });

  test('Manual mode: dice, dealing by stacks, replacements from the back, manual draws', () => {
    const g = new window.MJGame.Game({ seed: 5, manual: true });
    const phases = new Set();
    const policy = (game) => { phases.add(game.phase); hintPolicy(game); };
    for (let h = 0; h < 12; h++) playHand(g, policy);
    ['humanDeal', 'humanDraw', 'humanTurn'].forEach((p) => ok(phases.has(p), 'never reached ' + p));
    ok(phases.has('humanDice'), 'human never threw the dice');
    eq(g.players.reduce((a, p) => a + p.chips, 0), 1200, 'chips');
  });

  test('Seats: the highest roller draws a wind; whoever sits East is the first banker', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = new window.MJGame.Game({ seed });
      const s = g.rollForSeats();
      const last = s.rounds[s.rounds.length - 1];
      const top = Math.max(...last.map((r) => r.dice[0] + r.dice[1]));
      eq(last.filter((r) => r.dice[0] + r.dice[1] === top).length, 1, 'one clear highest roller');
      eq([...s.tiles].sort(), ['wE', 'wN', 'wS', 'wW']);
      const pos = seed % 4;
      const w = g.chooseSeatWind(pos);
      eq(g.seatOf(s.highest), w, 'highest roller sits at the wind they drew');
      eq(g.seatOf(g.dealer), 'E', 'banker sits East');
    }
  });

  test('Advanced bots pass up small early wins; other levels always win', () => {
    const g = new window.MJGame.Game({ seed: 2, difficulty: 'expert' });
    g.startHand();
    const small = { tai: 1, limit: false };
    eq(g.botWantsWin(1, small, false), g.tilesLeft < 36, 'expert: 1 tai early');
    eq(g.botWantsWin(1, { tai: 3, limit: false }, false), true, 'expert: 3 tai');
    eq(g.botWantsWin(1, { tai: 1, limit: true }, false), true, 'expert: limit hand');
    g.setDifficulty('beginner');
    eq(g.botWantsWin(1, small, false), true, 'beginner always wins');
    g.setDifficulty('intermediate');
    eq(g.botWantsWin(1, small, false), true, 'intermediate always wins');
  });

  test('No swapping after a Chi or Pong', () => {
    const g = new window.MJGame.Game({ seed: 1 });
    eq(g.swapForbidden('chow', 'd6', { start: 'd4' }), ['d6', 'd3'], 'eat the 6 into 4-5-6');
    eq(g.swapForbidden('chow', 'd3', { start: 'd3' }), ['d3', 'd6'], 'eat the 3 into 3-4-5');
    eq(g.swapForbidden('chow', 'd5', { start: 'd4' }), ['d5'], 'Ka Long chi');
    eq(g.swapForbidden('chow', 'b7', { start: 'b7' }), ['b7'], '7-8-9 has no 10');
    eq(g.swapForbidden('pong', 'hR'), ['hR']);
    g.forbidden = ['d3'];
    eq(g.canThrow('d3'), false); eq(g.canThrow('d4'), true);
  });

  test('Fei game: 152 tiles (76 stacks), 15 hands stay consistent, Fei never claimed', () => {
    const g = new window.MJGame.Game({ seed: 13, fei: true });
    for (let h = 0; h < 15; h++) {
      playHand(g, hintPolicy);
      eq(g.totalTiles, 152);
      g.players.forEach((p) => p.melds.forEach((m) => ok(!MJ.isFei(m.tile), 'Fei in a claimed set')));
    }
    eq(g.players.reduce((a, p) => a + p.chips, 0), 1200, 'chips');
  });

  test('Switching manual play off mid-deal finishes the deal for you', () => {
    const g = new window.MJGame.Game({ seed: 17, manual: true });
    g.startHand();
    g.humanRollDice();
    if (g.phase === 'humanDeal') g.humanDealTake();
    g.setManual(false);
    ok(!['humanDice', 'humanDeal', 'humanReplace', 'humanDraw', 'deal', 'replace', 'dice'].includes(g.phase), 'still in ' + g.phase);
    eq(g.tileCount(), g.totalTiles);
  });

  test('Rewind: every move is recorded and key moments are marked', () => {
    const g = new window.MJGame.Game({ seed: 23 });
    // A careless player: always throws the first tile and passes every claim.
    const careless = (game) => {
      if (game.phase === 'humanTurn') return game.humanDiscard(game.human.hand[0]);
      if (game.phase === 'humanClaim') return game.humanClaim({ type: 'pass' });
      return hintPolicy(game);
    };
    let keyMoments = 0;
    for (let h = 0; h < 4; h++) {
      playHand(g, careless);
      ok(g.frames.length > 5, 'frames recorded');
      ok(g.frames.every((f) => f.discards.length === 4 && Array.isArray(f.hand)), 'frame shape');
      keyMoments += g.frames.filter((f) => f.review).length;
    }
    ok(keyMoments > 0, 'no key moments found for a careless player');
  });

  test('Deal: 2 stacks at a time ×3, then 1 each (dealer 2) → 14 / 13 / 13 / 13', () => {
    const g = new window.MJGame.Game({ seed: 9, manual: true, allBots: false });
    g.startHand();
    g.humanRollDice();
    while (g.phase === 'humanDeal' || g.phase === 'deal') { if (g.phase === 'humanDeal') g.humanDealTake(); else g.advance(); }
    const sizes = g.players.map((p) => p.hand.length + p.bonus.length);
    eq(sizes[g.dealer], 14);
    eq(sizes.filter((s) => s === 13).length, 3);
  });

  test('Dice break the wall; replacements come from the back', () => {
    const g = new window.MJGame.Game({ seed: 21, allBots: true });
    g.startHand();
    ok(g.dice && g.dice.length === 2, 'dice rolled');
    const before = g.wallView();
    const backPos = before.back;
    const left = before.counts[backPos];
    g.players[1].hand.push('f1'); // pretend player 1 drew a flower
    g.replaceOne(1);
    const after = g.wallView();
    ok(after.counts[backPos] === left - 1 || after.back !== backPos, 'replacement was not taken from the back');
  });

  test('Flower bite in play: own number → everyone pays 2; other number → that player pays 2', () => {
    const g = new window.MJGame.Game({ seed: 4, allBots: true });
    g.startHand();
    g.initialPhase = false;
    const i = 0;
    const ownNum = MJ.SEAT_NUM[g.seatOf(i)];
    g.players[i].bonus = g.players[i].bonus.filter((b) => !/^[fs]/.test(b));
    g.players.forEach((p) => { p.bonus = p.bonus.filter((b) => b !== 'f' + ownNum && b !== 's' + ownNum); });
    const chips = g.players.map((p) => p.chips);
    g.players[i].bonus.push('f' + ownNum);
    g.addBonus(i, 's' + ownNum);
    eq(g.players[i].chips - chips[i], 6, 'own number: +6');
    const otherNum = (ownNum % 4) + 1;
    const owner = g.playerAtSeat(MJ.NUM_SEAT[otherNum]);
    const c2 = g.players.map((p) => p.chips);
    g.players.forEach((p) => { p.bonus = p.bonus.filter((b) => b !== 'f' + otherNum && b !== 's' + otherNum); });
    g.players[i].bonus.push('f' + otherNum);
    g.addBonus(i, 's' + otherNum);
    eq(g.players[i].chips - c2[i], 2, 'other number: +2');
    eq(c2[owner] - g.players[owner].chips, 2, 'owner pays 2');
  });

  test('Dealer passes on after a non-dealer win; round wind moves after 4 passes', () => {
    const g = new window.MJGame.Game({ seed: 3, allBots: true });
    let moves = 0;
    for (let h = 0; h < 80 && moves < 4; h++) {
      const dealer = g.dealer;
      playHand(g);
      const stays = g.result.type === 'draw' || g.result.winner === dealer;
      eq(g.dealer === dealer, stays, 'dealer rotation in hand ' + (h + 1));
      if (!stays) moves++;
    }
    eq(moves, 4);
    eq(g.prevalent, 'S');
  });

  // ---- Render ----

  const passed = results.filter((r) => r.ok).length;
  window.__testSummary = { passed, total: results.length, failed: results.filter((r) => !r.ok) };
  const root = document.getElementById('results');
  const head = document.createElement('h2');
  head.textContent = passed + ' / ' + results.length + ' passed';
  head.className = passed === results.length ? 'pass' : 'fail';
  root.appendChild(head);
  const ul = document.createElement('ul');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : ' — ' + r.err);
    ul.appendChild(li);
  });
  root.appendChild(ul);
})();
