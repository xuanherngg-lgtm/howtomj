/*
 * HowToMJ mini games: one per lesson, to practise what the lesson taught. Exposes window.MiniGames.
 *
 * Most lessons get a timed "arcade" round built from that lesson's own question generators
 * (3 lives, a timer per question, streak bonuses). Lesson 3 gets Set Builder: group 14 tiles
 * into 4 sets + 1 pair yourself.
 */
(function () {
  'use strict';
  const MJ = window.MJ;
  const { el, tileEl, handEl } = window.UI;
  const BEST_KEY = 'howtomj.mini.v1';
  const SET_LABELS = { chi: 'Chī 吃 · Chi', pong: 'Pèng 碰 · Pong', pair: 'Yǎn 眼 · Pair' };

  const GAMES = {
    L1: { name: 'Tile Snap', zh: '認牌', desc: 'Name the tiles before the timer runs out.' },
    L2: { name: 'Flower Frenzy', zh: '花牌', desc: 'Whose flower is it? Who pays the bite?' },
    L3: { name: 'Set Builder', zh: '組牌', desc: 'Tap tiles to group a winning hand into 4 sets + 1 pair — as fast as you can.', custom: 'sets' },
    L4: { name: 'Claim Rush', zh: '搶牌', desc: 'Quick-fire rules of the table: claims, dealing and replacements.' },
    L5: { name: 'Tai Counter', zh: '計台', desc: 'Count the tai and the chips against the clock.' },
    L6: { name: 'Wait Hunter', zh: '聽牌', desc: 'Find the waiting tiles and name the wait.' },
    L7: { name: 'Discard Duel', zh: '打牌', desc: 'Pick the best tile to throw, again and again.' },
    L8: { name: 'Safe Tile', zh: '防守', desc: 'Someone is ready — find the safe throw.' },
    L9: { name: 'Limit Spotter', zh: '滿台', desc: 'Spot the special hands and count their tai.' },
    L10: { name: 'Fei Finder', zh: '飛', desc: 'Can the Fei joker finish the hand?' },
  };

  function loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch (e) { return {}; } }
  function saveBest(id, score) {
    const b = loadBest();
    const isNew = score > (b[id] || 0);
    if (isNew) { b[id] = score; try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ } }
    return isNew;
  }

  const sound = (n) => window.Sound && window.Sound.play(n);
  const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- Shared pieces ----------

  function header(game, st, extra) {
    return el('div', { class: 'mini-head' }, [
      el('div', { class: 'mini-head__title' }, [el('strong', { text: '🎮 ' + game.name + ' ' }), el('span', { class: 'muted', text: game.zh })]),
      el('div', { class: 'mini-stats' }, [
        el('span', { class: 'mini-stat', text: '⭐ ' + st.score }),
        st.lives !== undefined ? el('span', { class: 'mini-stat', 'aria-label': st.lives + ' lives left', text: '❤'.repeat(st.lives) + '♡'.repeat(Math.max(0, 3 - st.lives)) }) : null,
        st.streak ? el('span', { class: 'mini-stat mini-stat--hot', text: '🔥 ×' + st.streak }) : null,
        extra || null,
      ]),
    ]);
  }

  function summary(node, game, lessonId, score, lines, again, exit) {
    const isNew = saveBest(lessonId, score);
    sound(isNew ? 'win' : 'chips');
    node.replaceChildren(el('article', { class: 'card lesson-card mini-card mini-over' }, [
      el('h2', { text: '🎮 ' + game.name + ' — finished!' }),
      el('div', { class: 'big' }, [el('span', { class: 'big__num', text: String(score) }), el('span', { class: 'big__unit', text: 'points' })]),
      el('p', { text: isNew ? '🏆 New best score!' : 'Best: ' + (loadBest()[lessonId] || score) + ' points' }),
      lines.length ? el('ul', { class: 'mini-lines' }, lines.map((l) => el('li', { text: l }))) : null,
      el('div', { class: 'nav-row nav-row--wrap' }, [
        el('button', { class: 'btn btn--primary', onclick: again, text: 'Play again' }),
        el('button', { class: 'btn', onclick: exit, text: 'Back to lessons' }),
      ]),
    ]));
  }

  // ---------- Arcade: timed questions from the lesson ----------

  function arcade(node, lesson, game, exit) {
    const SECONDS = 20;
    const ROUNDS = 10;
    const st = { score: 0, lives: 3, streak: 0, round: 0, correct: 0 };
    let cur = null;
    let timer = null;

    function nextQuestion() {
      st.round++;
      if (st.lives <= 0 || st.round > ROUNDS) return finish();
      const pool = (lesson.generators || []).map((g) => () => g(Math.random)).concat(lesson.quiz.map((q) => () => q));
      let q = null;
      for (let k = 0; k < 10 && !q; k++) q = pool[Math.floor(Math.random() * pool.length)]();
      cur = Object.assign(window.Learn.prepare(q), { picked: null, deadline: Date.now() + SECONDS * 1000 });
      clearInterval(timer);
      timer = setInterval(tickTimer, 200);
      draw();
    }

    function tickTimer() {
      const left = Math.max(0, cur.deadline - Date.now());
      const bar = node.querySelector('.mini-timer > span');
      if (bar) bar.style.width = (left / (SECONDS * 1000)) * 100 + '%';
      if (left <= 0 && cur.picked === null) answer(-1);
    }

    function answer(i) {
      if (cur.picked !== null) return;
      clearInterval(timer);
      cur.picked = i;
      const right = i === cur.res.answer;
      if (right) {
        const secs = Math.ceil(Math.max(0, cur.deadline - Date.now()) / 1000);
        st.streak++;
        st.correct++;
        cur.gain = 100 + secs * 10 + (st.streak - 1) * 25;
        st.score += cur.gain;
        sound('pong');
      } else {
        st.streak = 0;
        st.lives--;
        cur.gain = 0;
        sound('lose');
      }
      draw();
    }

    function finish() {
      clearInterval(timer);
      summary(node, game, lesson.id, st.score, [st.correct + ' correct answers', st.lives > 0 ? 'Survived all ' + ROUNDS + ' rounds' : 'Out of lives in round ' + (st.round - 1)],
        () => arcade(node, lesson, game, exit), () => { clearInterval(timer); exit(); });
    }

    function draw() {
      const { q, res } = cur;
      const answered = cur.picked !== null;
      const options = res.options.map((o, i) => {
        const stCls = !answered ? '' : i === res.answer ? ' is-right' : i === cur.picked ? ' is-wrong' : ' is-dim';
        if (o.tile) return el('button', { class: 'quiz-tile' + stCls, disabled: answered, 'aria-label': MJ.tileInfo(o.tile).name, onclick: () => answer(i) }, [tileEl(o.tile)]);
        if (o.tiles) return el('button', { class: 'quiz-option quiz-option--tiles' + stCls, disabled: answered, onclick: () => answer(i) }, o.tiles.map((x) => tileEl(x, { small: true })));
        return el('button', { class: 'quiz-option' + stCls, disabled: answered, onclick: () => answer(i), text: o.label });
      });
      const body = [
        header(game, st, el('span', { class: 'mini-stat', text: 'Round ' + Math.min(st.round, ROUNDS) + '/' + ROUNDS })),
        el('div', { class: 'mini-timer', 'aria-hidden': 'true' }, [el('span', { style: 'width:' + (answered ? 0 : 100) + '%' })]),
        el('h2', { class: 'quiz-prompt', text: q.prompt }),
      ];
      if (q.tiles) body.push(el('div', { class: 'tiles lesson-tiles' }, q.tiles.map((id) => tileEl(id))));
      if (q.hand) body.push(answered ? window.UI.setsEl(q.hand, { small: true }) : handEl(q.hand, { small: true }));
      body.push(el('div', { class: res.options[0].tile ? 'quiz-tiles' : 'quiz-options' }, options));
      if (answered) {
        const right = cur.picked === res.answer;
        body.push(el('div', { class: 'feedback ' + (right ? 'feedback--ok' : 'feedback--no') }, [
          el('strong', { text: right ? '+' + cur.gain + ' points! ' : (cur.picked === -1 ? 'Time up! ' : 'Not quite. ') }),
          el('span', { text: res.explain || q.explain || '' }),
        ]));
        body.push(el('div', { class: 'nav-row' }, [
          el('button', { class: 'btn', onclick: () => { clearInterval(timer); exit(); }, text: 'Quit' }),
          el('button', { class: 'btn btn--primary', onclick: nextQuestion, text: st.lives <= 0 || st.round >= ROUNDS ? 'See my score' : 'Next' }),
        ]));
      }
      node.replaceChildren(el('article', { class: 'card lesson-card mini-card' }, body));
      tickTimer();
    }

    nextQuestion();
  }

  // ---------- Set Builder (Lesson 3) ----------

  function classify(ids) {
    const s = MJ.sortTiles(ids);
    if (s.length === 2 && s[0] === s[1]) return 'pair';
    if (s.length !== 3) return null;
    if (s[0] === s[1] && s[1] === s[2]) return 'pong';
    const a = MJ.tileInfo(s[0]);
    const b = MJ.tileInfo(s[1]);
    const c = MJ.tileInfo(s[2]);
    if (a.kind === 'suit' && b.kind === 'suit' && c.kind === 'suit' && a.suit === b.suit && b.suit === c.suit && b.rank === a.rank + 1 && c.rank === b.rank + 1) return 'chi';
    return null;
  }

  function setBuilder(node, lesson, game, exit) {
    const ROUNDS = 3;
    const st = { score: 0, round: 0, mistakes: 0 };
    let r = null;
    let clock = null;

    function nextRound() {
      st.round++;
      if (st.round > ROUNDS) return finish();
      const w = window.LESSON_TOOLS.randomWinningHand(Math.random);
      const tiles = shuffled(w.concealed.concat([w.winningTile])).map((id, k) => ({ id, key: k }));
      r = { pool: tiles, built: [], selected: new Set(), start: Date.now(), message: null, shake: false };
      clearInterval(clock);
      clock = setInterval(() => { const t = node.querySelector('.mini-clock'); if (t) t.textContent = '⏱ ' + secs() + 's'; }, 500);
      draw();
    }

    const secs = () => Math.floor((Date.now() - r.start) / 1000);

    function toggle(key) {
      if (r.selected.has(key)) r.selected.delete(key); else r.selected.add(key);
      r.message = null;
      sound('tap');
      draw();
    }

    function makeSet() {
      const chosen = r.pool.filter((t) => r.selected.has(t.key));
      const type = classify(chosen.map((t) => t.id));
      const hasPair = r.built.some((b) => b.type === 'pair');
      if (!type || (type === 'pair' && hasPair)) {
        st.mistakes++;
        st.score = Math.max(0, st.score - 20);
        r.message = !type ? 'That is not a set. A chi is 3 in a row of one suit, a pong is 3 the same, a pair is 2 the same. (−20)' : 'You already have your pair — the rest must be sets of three. (−20)';
        r.shake = true;
        sound('lose');
        return draw();
      }
      r.built.push({ type, tiles: chosen });
      r.pool = r.pool.filter((t) => !r.selected.has(t.key));
      r.selected.clear();
      r.message = null;
      sound(type === 'chi' ? 'chi' : 'pong');
      if (!r.pool.length) {
        clearInterval(clock);
        const gain = Math.max(100, 400 - secs() * 8);
        st.score += gain;
        r.done = gain;
        sound('win');
      }
      draw();
    }

    function undo(i) {
      if (r.done) return;
      const g = r.built.splice(i, 1)[0];
      r.pool = r.pool.concat(g.tiles);
      sound('tap');
      draw();
    }

    function finish() {
      clearInterval(clock);
      summary(node, game, lesson.id, st.score, [ROUNDS + ' hands built', st.mistakes + ' mistake' + (st.mistakes === 1 ? '' : 's')],
        () => setBuilder(node, lesson, game, exit), () => { clearInterval(clock); exit(); });
    }

    function draw() {
      const pool = MJ.sortTiles(r.pool.map((t) => t.id));
      const ordered = [];
      const used = new Set();
      pool.forEach((id) => { const t = r.pool.find((x) => x.id === id && !used.has(x.key)); used.add(t.key); ordered.push(t); });
      const body = [
        header(game, st, el('span', { class: 'mini-stat mini-clock', text: '⏱ ' + secs() + 's' })),
        el('h2', { class: 'quiz-prompt', text: 'Hand ' + st.round + ' of ' + ROUNDS + ': group these 14 tiles into 4 sets + 1 pair.' }),
        el('p', { class: 'muted', text: 'Tap tiles to select them, then press Make set. Tap a finished set to take it apart.' }),
        el('div', { class: 'sets-view mini-built' }, r.built.map((g, i) => el('button', { class: 'set-group set-group--btn', onclick: () => undo(i), title: 'Take this set apart' }, [
          el('span', { class: 'set-group__label', text: SET_LABELS[g.type] }),
          el('span', { class: 'tile-row' }, g.tiles.map((t) => tileEl(t.id, { small: true }))),
        ]))),
        el('div', { class: 'tiles mini-pool' + (r.shake ? ' is-shake' : '') }, ordered.map((t) => tileEl(t.id, { onclick: () => toggle(t.key), extra: r.selected.has(t.key) ? 'is-selected' : '', ariaPrefix: r.selected.has(t.key) ? 'Unselect ' : 'Select ' }))),
      ];
      r.shake = false;
      if (r.message) body.push(el('div', { class: 'feedback feedback--no', role: 'status', text: r.message }));
      if (r.done) {
        body.push(el('div', { class: 'feedback feedback--ok', role: 'status' }, [el('strong', { text: 'Hu! +' + r.done + ' points. ' }), el('span', { text: 'All 14 tiles are in 4 sets + 1 pair.' })]));
        body.push(el('div', { class: 'nav-row' }, [
          el('button', { class: 'btn', onclick: () => { clearInterval(clock); exit(); }, text: 'Quit' }),
          el('button', { class: 'btn btn--primary', onclick: nextRound, text: st.round >= ROUNDS ? 'See my score' : 'Next hand' }),
        ]));
      } else {
        body.push(el('div', { class: 'nav-row' }, [
          el('button', { class: 'btn', onclick: () => { clearInterval(clock); exit(); }, text: 'Quit' }),
          el('button', { class: 'btn btn--primary', disabled: r.selected.size < 2, onclick: makeSet, text: 'Make set (' + r.selected.size + ')' }),
        ]));
      }
      node.replaceChildren(el('article', { class: 'card lesson-card mini-card' }, body));
    }

    nextRound();
  }

  window.MiniGames = {
    info: (lessonId) => GAMES[lessonId] || null,
    best: (lessonId) => loadBest()[lessonId] || 0,
    start(node, lesson, exit) {
      const game = GAMES[lesson.id];
      if (!game) return exit();
      if (game.custom === 'sets') setBuilder(node, lesson, game, exit);
      else arcade(node, lesson, game, exit);
    },
    classify, // exposed for tests
  };
})();
