/* HowToMJ lessons: lesson list, lesson cards and quizzes. Exposes window.Learn. */
(function () {
  'use strict';
  const MJ = window.MJ;
  const { el, tileEl, handEl, setsEl } = window.UI;
  const LESSONS = window.LESSONS;
  const RULES = MJ.RULES;
  const STORAGE_KEY = 'howtomj.learn.v1';
  const PASS_RATE = 0.8;
  const WIND_NAMES = { E: 'East 東', S: 'South 南', W: 'West 西', N: 'North 北' };

  let container = null;
  let view = { name: 'list' };
  let progress = loadProgress();

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }

  const passMark = (count) => Math.ceil(count * PASS_RATE);
  const quizCount = (lesson) => lesson.quizSize || lesson.quiz.length;

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /** A fresh quiz: fixed questions plus newly generated ones, shuffled, with shuffled answer options. */
  function buildQuiz(lesson) {
    const keyOf = (q) => q.prompt + '|' + (q.tiles || []).join() + '|' + (q.hand ? q.hand.concealed.join() + q.hand.winningTile : '');
    const candidates = lesson.quiz.slice();
    // Keep generating until there are enough different questions to fill the quiz.
    for (let round = 0; round < 6; round++) {
      (lesson.generators || []).forEach((g) => { const q = g(Math.random); if (q) candidates.push(q); });
      if (new Set(candidates.map(keyOf)).size >= quizCount(lesson) + 2) break;
    }
    const seen = new Set();
    const picked = [];
    shuffled(candidates).forEach((q) => {
      const key = keyOf(q);
      if (picked.length < quizCount(lesson) && !seen.has(key)) { seen.add(key); picked.push(prepare(q)); }
    });
    return picked;
  }

  function prepare(q) {
    if ((q.type === 'choice' || q.type === 'choiceTiles') && !q.ordered) {
      const order = shuffled(q.options.map((_, i) => i));
      q = Object.assign({}, q, { options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) });
    } else if (q.type === 'tile') {
      q = Object.assign({}, q, { options: shuffled(q.options) });
    }
    return { q, res: resolve(q) };
  }
  const isUnlocked = (i) => i === 0 || !!(progress[LESSONS[i - 1].id] && progress[LESSONS[i - 1].id].passed);

  // ---------- Questions ----------

  function nearest(values, correct, n) {
    return [...new Set(values)].filter((v) => v !== correct)
      .sort((a, b) => Math.abs(a - correct) - Math.abs(b - correct) || a - b)
      .slice(0, n);
  }

  /** Turns a question into { options: [{ label | tile }], answer: index }, using the engine where needed. */
  function resolve(q) {
    if (q.type === 'choice') return { options: q.options.map((label) => ({ label })), answer: q.answer };
    if (q.type === 'choiceTiles') return { options: q.options.map((tiles) => ({ tiles, label: tiles.join(' ') })), answer: q.answer };
    if (q.type === 'tile') return { options: q.options.map((tile) => ({ tile })), answer: q.options.indexOf(q.answer) };
    const r = MJ.evaluateHand(q.hand, RULES);
    const breakdown = r.status === 'ok'
      ? (r.items.length ? r.items.map((i) => i.name + ' ' + i.zh + ' +' + i.tai).join(', ') + ' = ' + (r.rawTai > r.tai ? r.rawTai + ', capped at ' + r.tai : r.tai) + ' tai' + (r.tai >= RULES.maxTai ? ' — Mǎn 滿 (full)!' : '.') : 'Nothing scores: 0 tai.')
      : '';
    if (q.type === 'win') {
      const yes = q.mode === 'canWin' ? r.status === 'ok' && r.canWin : r.status === 'ok';
      return { options: [{ label: 'Yes' }, { label: 'No' }], answer: yes ? 0 : 1, explain: q.explain || (yes ? 'Yes. ' + breakdown : 'No.') };
    }
    if (q.type === 'tai') {
      const values = [r.tai].concat(nearest([0, 1, 2, 3, 4, 5], r.tai, 3)).sort((a, b) => a - b);
      return { options: values.map((v) => ({ label: v + ' tai' })), answer: values.indexOf(r.tai), explain: breakdown + (q.explain ? ' ' + q.explain : '') };
    }
    if (q.type === 'chips') {
      const correct = r.payout.selfDraw ? r.payout.each : r.payout.shooterPays;
      const pool = Object.values(RULES.payouts.selfDrawEach).concat(Object.values(RULES.payouts.shooter), [correct * 3]);
      const values = [correct].concat(nearest(pool, correct, 3)).sort((a, b) => a - b);
      return { options: values.map((v) => ({ label: v + ' chips' })), answer: values.indexOf(correct), explain: breakdown + (q.explain ? ' ' + q.explain : '') };
    }
    throw new Error('Unknown question type: ' + q.type);
  }

  // ---------- Navigation ----------

  function go(next) {
    view = next;
    render();
    window.scrollTo(0, 0);
  }

  const openLesson = (i) => go({ name: 'lesson', lesson: i, step: 0 });
  const startQuiz = (i) => go({ name: 'quiz', lesson: i, q: 0, picked: null, correct: 0, qs: buildQuiz(LESSONS[i]) });

  function pick(index) {
    if (view.picked !== null) return;
    const res = view.qs[view.q].res;
    view.picked = index;
    if (index === res.answer) view.correct++;
    if (window.Sound) window.Sound.play(index === res.answer ? 'pong' : 'lose');
    render();
  }

  function nextQuestion() {
    const lesson = LESSONS[view.lesson];
    const total = view.qs.length;
    if (view.q + 1 < total) {
      view = Object.assign({}, view, { q: view.q + 1, picked: null });
      render();
      return;
    }
    const prev = progress[lesson.id] || { best: 0 };
    const passed = view.correct >= passMark(total);
    progress[lesson.id] = { best: Math.max(prev.best || 0, view.correct), total, passed: !!prev.passed || passed };
    saveProgress();
    go({ name: 'result', lesson: view.lesson, correct: view.correct, total, passed });
  }

  // ---------- Views ----------

  function render() {
    if (!container) return;
    if (view.name === 'mini') {
      const host = el('div', { class: 'mini-host' });
      container.replaceChildren(host);
      window.MiniGames.start(host, LESSONS[view.lesson], () => go({ name: 'list' }));
      return;
    }
    const views = { list: listView, lesson: lessonView, quiz: quizView, result: resultView };
    container.replaceChildren(...views[view.name]().filter(Boolean));
  }

  function listView() {
    const done = LESSONS.filter((l) => progress[l.id] && progress[l.id].passed).length;
    return [
      el('div', { class: 'learn-head' }, [
        el('h1', { text: 'Learn Singapore mahjong' }),
        el('p', { class: 'muted', text: done + ' of ' + LESSONS.length + ' lessons passed. Pass each quiz (' + Math.round(PASS_RATE * 100) + '%) to unlock the next lesson.' }),
        el('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(LESSONS.length), 'aria-valuenow': String(done) }, [
          el('span', { style: 'width:' + (done / LESSONS.length) * 100 + '%' }),
        ]),
      ]),
      done < LESSONS.length - 1 ? el('section', { class: 'card placement-card' }, [
        el('div', {}, [
          el('strong', { text: 'Already play mahjong? Take the placement match.' }),
          el('p', { class: 'muted', text: 'Play 2 hands against the bots. They judge your discards, claims and wins, and you skip the lessons you clearly already know.' }),
        ]),
        el('button', { class: 'btn btn--primary', onclick: () => window.HowToMJ && window.HowToMJ.startPlacement(), text: '🀄 Start placement match' }),
      ]) : null,
      el('ol', { class: 'lesson-list' }, LESSONS.map((l, i) => {
        const p = progress[l.id];
        const open = isUnlocked(i);
        const status = p && p.placement ? 'Skipped by your placement match' : p && p.passed ? 'Passed · best ' + p.best + '/' + p.total : open ? l.minutes + ' min · ' + quizCount(l) + ' quiz questions, new each try' : 'Pass Lesson ' + i + ' to unlock';
        const mini = window.MiniGames && window.MiniGames.info(l.id);
        const miniBtn = mini && p && p.passed ? el('button', { class: 'mini-launch', onclick: () => go({ name: 'mini', lesson: i }), title: mini.desc }, [
          el('span', { text: '🎮 ' + mini.name }), window.MiniGames.best(l.id) ? el('span', { class: 'muted', text: ' · best ' + window.MiniGames.best(l.id) }) : null,
        ]) : null;
        return el('li', { class: 'lesson-row' }, [miniBtn, el('button', {
          class: 'lesson-item' + (p && p.passed ? ' is-done' : '') + (open ? '' : ' is-locked'),
          disabled: !open,
          onclick: () => openLesson(i),
        }, [
          el('span', { class: 'lesson-item__num', text: p && p.passed ? '✓' : String(i + 1) }),
          el('span', { class: 'lesson-item__text' }, [
            el('span', { class: 'lesson-item__title', text: l.title + ' ' }),
            el('span', { class: 'lesson-item__zh', text: l.zh }),
            el('span', { class: 'lesson-item__status', text: status }),
          ]),
          el('span', { class: 'lesson-item__go', 'aria-hidden': 'true', text: open ? '›' : '🔒' }),
        ])]);
      })),
    ];
  }

  function crumb(lesson, i, extra) {
    return el('div', { class: 'crumb' }, [
      el('button', { class: 'btn btn--ghost', onclick: () => go({ name: 'list' }), text: '← All lessons' }),
      el('span', { class: 'muted', text: 'Lesson ' + (i + 1) + ' · ' + lesson.title + (extra ? ' · ' + extra : '') }),
    ]);
  }

  function steps(count, at) {
    return el('div', { class: 'steps', 'aria-hidden': 'true' },
      Array.from({ length: count }, (_, i) => el('span', { class: i < at ? 'is-done' : i === at ? 'is-now' : '' })));
  }

  function cardContent(card) {
    const out = [el('h2', { class: 'lesson-card__title', text: card.title })];
    card.body.forEach((p) => out.push(el('p', { text: p })));
    if (card.tiles) out.push(el('div', { class: 'tiles lesson-tiles' }, card.tiles.map((id) => tileEl(id))));
    (card.groups || []).forEach((g) => out.push(el('div', { class: 'lesson-group' }, [
      el('div', { class: 'hand-row__label', text: g.label }),
      el('div', { class: 'tiles' }, g.tiles.map((id) => tileEl(id))),
    ])));
    (card.hands || []).forEach((h) => out.push(el('div', { class: 'lesson-group' }, [
      el('div', { class: 'hand-row__label', text: h.label }),
      setsEl(h.hand, { small: true }),
    ])));
    if (card.taiList) {
      out.push(el('ul', { class: 'tai-list' }, card.taiList.map((x) => el('li', { class: 'tai-item' }, [
        el('div', { class: 'tai-item__head' }, [
          el('strong', { text: x.name }), el('span', { class: 'tai-item__zh', text: x.zh }),
          el('span', { class: 'tai-item__tai', text: /^\+?\d/.test(x.tai) ? x.tai.replace(/^(\+?\d+)/, '$1 tai') : x.tai }),
        ]),
        el('p', { class: 'tai-item__def', text: x.def }),
        x.tiles.length ? el('div', { class: 'tiles' }, x.tiles.map((id) => tileEl(id, { small: true }))) : null,
      ]))));
    }
    if (card.table) {
      const [head, ...rows] = card.table;
      out.push(el('div', { class: 'table-wrap' }, [el('table', { class: 'lesson-table' }, [
        el('thead', {}, [el('tr', {}, head.map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', { text: c }))))),
      ])]));
    }
    return out;
  }

  function lessonView() {
    const lesson = LESSONS[view.lesson];
    const card = lesson.cards[view.step];
    const last = view.step === lesson.cards.length - 1;
    return [
      crumb(lesson, view.lesson, 'card ' + (view.step + 1) + ' of ' + lesson.cards.length),
      steps(lesson.cards.length, view.step),
      el('article', { class: 'card lesson-card' }, cardContent(card)),
      el('div', { class: 'nav-row' }, [
        el('button', { class: 'btn', disabled: view.step === 0, onclick: () => go(Object.assign({}, view, { step: view.step - 1 })), text: 'Back' }),
        last
          ? el('button', { class: 'btn btn--primary', onclick: () => startQuiz(view.lesson), text: 'Start the quiz' })
          : el('button', { class: 'btn btn--primary', onclick: () => go(Object.assign({}, view, { step: view.step + 1 })), text: 'Next' }),
      ]),
    ];
  }

  function handContext(hand) {
    return 'Seat ' + WIND_NAMES[hand.seat || 'E'] + ' · round wind ' + WIND_NAMES[hand.prevalent || 'E'] + ' · ' + (hand.selfDraw ? 'self-draw 自摸' : 'won on a discard')
      + (hand.lastTile ? ' · last tile of the wall' : '') + (hand.afterBonus ? ' · replacement tile after a flower' : '')
      + ((hand.melds || []).length ? ' · revealed sets shown on the right' : '');
  }

  function quizView() {
    const lesson = LESSONS[view.lesson];
    const total = view.qs.length;
    const { q, res } = view.qs[view.q];
    const answered = view.picked !== null;
    const right = answered && view.picked === res.answer;

    const options = res.options.map((o, i) => {
      const state = !answered ? '' : i === res.answer ? ' is-right' : i === view.picked ? ' is-wrong' : ' is-dim';
      if (o.tile) {
        return el('button', { class: 'quiz-tile' + state, disabled: answered, 'aria-label': MJ.tileInfo(o.tile).name, onclick: () => pick(i) }, [tileEl(o.tile)]);
      }
      if (o.tiles) {
        return el('button', { class: 'quiz-option quiz-option--tiles' + state, disabled: answered, 'aria-label': o.tiles.map((x) => MJ.tileInfo(x).name).join(', '), onclick: () => pick(i) },
          o.tiles.map((x) => tileEl(x, { small: true })));
      }
      return el('button', { class: 'quiz-option' + state, disabled: answered, onclick: () => pick(i), text: o.label });
    });

    const body = [el('h2', { class: 'quiz-prompt', text: q.prompt })];
    if (q.tiles) body.push(el('div', { class: 'tiles lesson-tiles' }, q.tiles.map((id) => tileEl(id))));
    if (q.hand) {
      body.push(handEl(q.hand, { small: true }));
      body.push(el('p', { class: 'muted', text: handContext(q.hand) }));
    }
    body.push(el('div', { class: res.options[0].tile ? 'quiz-tiles' : 'quiz-options' }, options));
    if (answered) {
      body.push(el('div', { class: 'feedback ' + (right ? 'feedback--ok' : 'feedback--no'), role: 'status' }, [
        el('strong', { text: right ? 'Correct!' : 'Not quite.' }),
        el('span', { text: ' ' + (res.explain || q.explain || '') }),
      ]));
      // After answering, show the hand split into its sets with each move named above the tiles.
      if (q.hand && MJ.describeSets(q.hand)) body.push(el('div', { class: 'lesson-group' }, [el('div', { class: 'hand-row__label', text: 'How the hand splits up' }), setsEl(q.hand, { small: true })]));
    }

    return [
      crumb(lesson, view.lesson, 'quiz'),
      steps(total, view.q),
      el('article', { class: 'card lesson-card' }, [el('div', { class: 'option__rank', text: 'Question ' + (view.q + 1) + ' of ' + total })].concat(body)),
      el('div', { class: 'nav-row' }, [
        el('span', { class: 'muted', text: view.correct + ' correct so far' }),
        el('button', { class: 'btn btn--primary', disabled: !answered, onclick: nextQuestion, text: view.q + 1 < total ? 'Next question' : 'See my score' }),
      ]),
    ];
  }

  function resultView() {
    const lesson = LESSONS[view.lesson];
    const next = view.lesson + 1 < LESSONS.length ? view.lesson + 1 : null;
    const actions = [];
    if (view.passed && next !== null) actions.push(el('button', { class: 'btn btn--primary', onclick: () => openLesson(next), text: 'Next: ' + LESSONS[next].title }));
    if (view.passed && next === null) actions.push(el('button', { class: 'btn btn--primary', onclick: () => window.HowToMJ && window.HowToMJ.setMode('play'), text: 'Play a practice game' }));
    const mini = window.MiniGames && window.MiniGames.info(lesson.id);
    if (view.passed && mini) actions.push(el('button', { class: 'btn btn--primary', onclick: () => go({ name: 'mini', lesson: view.lesson }), text: '🎮 Practise it: ' + mini.name }));
    actions.push(el('button', { class: 'btn' + (view.passed ? '' : ' btn--primary'), onclick: () => startQuiz(view.lesson), text: 'Retry the quiz' }));
    actions.push(el('button', { class: 'btn', onclick: () => openLesson(view.lesson), text: 'Review the lesson' }));

    return [
      crumb(lesson, view.lesson, 'result'),
      el('article', { class: 'card lesson-card result-card' }, [
        el('div', { class: 'big' }, [
          el('span', { class: 'big__num', text: view.correct + '/' + view.total }),
          el('span', { class: 'big__unit', text: view.passed ? 'Passed!' : 'Not yet' }),
        ]),
        el('p', { text: view.passed
          ? (next !== null ? 'Lesson ' + (next + 1) + ' is unlocked.' : 'You have finished every lesson. Put it into practice against three bots.')
          : 'You need ' + passMark(view.total) + ' correct to pass. Review the lesson and try again — you will get new questions.' }),
        el('div', { class: 'nav-row nav-row--wrap' }, actions),
      ]),
    ];
  }

  window.Learn = {
    mount(node) { container = node; render(); },
    render,
    resolve, // exposed for tests
    buildQuiz,
    prepare,
    /** Marks the first n lessons as done after a placement match. */
    applyPlacement(n) {
      LESSONS.slice(0, n).forEach((l) => {
        const prev = progress[l.id];
        if (!(prev && prev.passed && !prev.placement)) progress[l.id] = { best: 0, total: 0, passed: true, placement: true };
      });
      saveProgress();
      view = { name: 'list' };
      render();
    },
  };
})();
