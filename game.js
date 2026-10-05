/*
 * HowToMJ practice game engine: one human vs three bots, Singapore rules.
 * No DOM. Exposes window.MJGame.
 *
 * The wall is modelled physically: 74 stacks of 2 tiles in a ring around the table.
 * The dealer rolls two dice, the wall breaks, tiles are drawn from the front and
 * replacements (flowers, animals, kongs) are taken from the back.
 *
 * `phase` is one of
 *   human phases (wait for the player):
 *     humanDice    roll the dice (manual mode, you are the dealer)
 *     humanDeal    take your stacks while dealing (manual mode)
 *     humanReplace reveal a flower/animal or a kong and draw from the back (manual mode)
 *     humanDraw    draw your tile from the wall (manual mode)
 *     humanTurn    discard (and maybe win by self-draw or kong)
 *     humanClaim   claim the last discard (Hu/Pong/Kong/Chi) or pass
 *   automatic phases (call advance()):
 *     dice, deal, replace, botDiscard, claims, nextDraw
 *   over          the hand has ended; startHand() deals the next one
 *
 * Every visible happening is also pushed to `events` (dice, deal, draw, discard, bonus, call, pay)
 * so the UI can animate it and play sounds.
 */
(function (global) {
  'use strict';
  const MJ = global.MJ;
  const WINDS = ['E', 'S', 'W', 'N'];
  const WIND_NAMES = { E: 'East', S: 'South', W: 'West', N: 'North' };
  const WIND_ZH = { E: '東', S: '南', W: '西', N: '北' };
  const windName = (w) => WIND_NAMES[w] + ' ' + WIND_ZH[w];
  const BOT_NAMES = ['Ah Huat', 'Mei Mei', 'Uncle Lim'];
  const STACKS = 74;
  // Ring positions run clockwise around the table: top wall left→right, right wall top→bottom,
  // bottom wall right→left, left wall bottom→top. Each segment starts at its owner's right-hand end.
  // 148 tiles = 74 stacks (19/18/19/18); with Fei jokers 152 tiles = 76 stacks (19 each).
  function segmentsFor(stacks) {
    const side = stacks === 76 ? [19, 19, 19, 19] : [19, 18, 19, 18];
    let s = 0;
    const out = {};
    ['top', 'right', 'bottom', 'left'].forEach((name, k) => { out[name] = { start: s, len: side[k] }; s += side[k]; });
    return out;
  }
  const SEGMENTS = segmentsFor(STACKS);
  const REL_SIDE = ['bottom', 'right', 'top', 'left'];

  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fullSet(withFei) {
    const tiles = [];
    MJ.TYPES.forEach((t) => { for (let i = 0; i < 4; i++) tiles.push(t); });
    MJ.BONUS_TILES.forEach((b) => tiles.push(b));
    if (withFei) for (let i = 0; i < 4; i++) tiles.push(MJ.FEI);
    return tiles;
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function removeOne(arr, id) {
    const i = arr.indexOf(id);
    if (i < 0) throw new Error('Tile not in hand: ' + id);
    arr.splice(i, 1);
  }

  function without(arr, ids) {
    const copy = arr.slice();
    ids.forEach((id) => removeOne(copy, id));
    return copy;
  }

  const countIn = (arr, id) => arr.filter((x) => x === id).length;

  /** Best shanten reachable by discarding one tile from `tiles`. */
  function bestAfterDiscard(tiles, meldCount) {
    const c = MJ.countsOf(tiles);
    let best = Infinity;
    for (let t = 0; t < 34; t++) {
      if (!c[t]) continue;
      c[t]--;
      best = Math.min(best, MJ.shanten(c, meldCount));
      c[t]++;
    }
    return best;
  }

  class Game {
    /**
     * opts: { seed, allBots, manual, difficulty: 'beginner'|'intermediate'|'expert',
     *         oneTaiZiMo, allowSevenPairs, fei }
     */
    constructor(opts) {
      opts = opts || {};
      this.rules = Object.assign({}, MJ.RULES, { oneTaiZiMo: !!opts.oneTaiZiMo, allowSevenPairs: opts.allowSevenPairs !== false });
      this.fei = !!opts.fei;
      this.rand = opts.seed !== undefined ? seededRandom(opts.seed) : Math.random;
      this.manual = !!opts.manual && !opts.allBots;
      this.difficulty = opts.difficulty || 'intermediate';
      let bot = 0;
      this.players = [0, 1, 2, 3].map((i) => {
        const human = !opts.allBots && i === 0;
        return { index: i, isHuman: human, name: human ? 'You' : BOT_NAMES[bot++], chips: this.rules.startingChips, hand: [], melds: [], bonus: [], discards: [], lastDrawAfterBonus: false };
      });
      this.viewer = 0; // the seat drawn at the bottom of the table
      this.dealer = 0;
      this.prevalent = 'E';
      this.dealerMoves = 0;
      this.handNo = 0;
      this.log = [];
      this.events = [];
      this.eventSeq = 0;
      this.phase = 'idle';
    }

    // ---------- Settings ----------

    setOneTaiZiMo(on) { this.rules = Object.assign({}, this.rules, { oneTaiZiMo: !!on }); }
    setDifficulty(d) { this.difficulty = d; }

    /** Manual dealing and drawing. Switching it off mid-hand finishes any step you were asked to do. */
    setManual(on) {
      this.manual = !!on && !!this.human;
      if (this.manual) return;
      for (let guard = 0; guard < 300; guard++) {
        switch (this.phase) {
          case 'humanDice': case 'dice': this.rollDice(); break;
          case 'humanDeal': case 'deal':
            while (this.dealIdx < this.dealSteps.length) this.dealStep();
            this.startReplacements();
            break;
          case 'replace': if (this.replaceAll(this.replaceFor.player)) this.nextReplacePhase(); break;
          case 'humanReplace': this.humanReplace(); break;
          case 'humanDraw': this.drawFor(this.turn, false); break;
          default: return;
        }
      }
    }

    // ---------- Helpers ----------

    seatOf(i) { return WINDS[(i - this.dealer + 4) % 4]; }
    playerAtSeat(w) { return this.players.findIndex((p, i) => this.seatOf(i) === w); }
    label(i) { return this.players[i].isHuman ? 'You' : this.players[i].name; }
    verb(i, you, they) { return this.players[i].isHuman ? you : they; }
    say(msg) { this.log.push(msg); if (this.log.length > 100) this.log.shift(); }
    emit(e) { e.id = ++this.eventSeq; this.events.push(e); if (this.events.length > 200) this.events.shift(); }
    needsHuman() { return this.phase.startsWith('human'); }
    isOver() { return this.phase === 'over'; }
    get human() { return this.players.find((p) => p.isHuman) || null; }

    evaluate(i, concealed, winningTile, selfDraw, afterBonus) {
      const p = this.players[i];
      return MJ.evaluateHand({
        concealed, winningTile, melds: p.melds, bonus: p.bonus,
        seat: this.seatOf(i), prevalent: this.prevalent, selfDraw, afterBonus: !!afterBonus,
        lastTile: selfDraw && this.tilesLeft === 0,
      }, this.rules);
    }

    // ---------- Rewind: a snapshot of the table at every move ----------

    record(action) {
      const h = this.human;
      const f = {
        turn: this.turnCount, action,
        hand: h ? MJ.sortTiles(h.hand) : [],
        melds: this.players.map((p) => p.melds.map((m) => Object.assign({}, m))),
        bonus: this.players.map((p) => p.bonus.slice()),
        discards: this.players.map((p) => p.discards.slice()),
        tilesLeft: this.tilesLeft,
        chips: this.players.map((p) => p.chips),
        decision: null,
      };
      this.frames.push(f);
      return f;
    }

    isValueTile(i, tile) {
      const info = MJ.tileInfo(tile);
      return info.kind === 'dragon' || (info.kind === 'wind' && (info.wind === this.seatOf(i) || info.wind === this.prevalent));
    }

    /** Tiles a player can see on the table: every discard and other players' sets. */
    seenBy(i) {
      const seen = [];
      this.players.forEach((p, j) => {
        p.discards.forEach((t) => seen.push(t));
        if (j !== i) p.melds.forEach((m) => MJ.meldTiles(m).forEach((t) => seen.push(t)));
      });
      return seen;
    }

    pay(from, to, n, reason) {
      this.players[from].chips -= n;
      this.players[to].chips += n;
      this.handDelta[from] -= n;
      this.handDelta[to] += n;
      this.emit({ type: 'pay', from, to, amount: n, reason });
    }

    payEach(to, n, reason) {
      this.players.forEach((p, j) => { if (j !== to) this.pay(j, to, n, reason); });
    }

    // ---------- The wall ----------

    get tilesLeft() { return this.ring ? this.ring.reduce((a, s) => a + s.length, 0) : 0; }
    get segments() { return segmentsFor(this.stackCount || STACKS); }

    sideOf(i) { return REL_SIDE[(i - this.viewer + 4) % 4]; }

    takeFront() {
      if (!this.tilesLeft) return null;
      while (this.ring[this.drawOrder[this.frontPtr]].length === 0) this.frontPtr++;
      return this.ring[this.drawOrder[this.frontPtr]].pop();
    }

    takeBack() {
      if (!this.tilesLeft) return null;
      while (this.ring[this.drawOrder[this.backPtr]].length === 0) this.backPtr--;
      return this.ring[this.drawOrder[this.backPtr]].pop();
    }

    /** For drawing the wall: tiles left in each ring position, and where the front and back are. */
    wallView() {
      if (!this.drawOrder) return { counts: this.ring ? this.ring.map((s) => s.length) : [], front: null, back: null };
      let f = this.frontPtr;
      while (f < this.stackCount && this.ring[this.drawOrder[f]].length === 0) f++;
      let b = this.backPtr;
      while (b >= 0 && this.ring[this.drawOrder[b]].length === 0) b--;
      return {
        counts: this.ring.map((s) => s.length),
        front: this.tilesLeft ? this.drawOrder[f] : null,
        back: this.tilesLeft ? this.drawOrder[b] : null,
      };
    }

    // ---------- Dealing ----------

    startHand() {
      this.handNo++;
      this.phase = 'dealing';
      this.players.forEach((p) => { p.hand = []; p.melds = []; p.bonus = []; p.discards = []; p.lastDrawAfterBonus = false; });
      this.viewer = this.human ? this.human.index : 0;
      this.handDelta = [0, 0, 0, 0];
      this.result = null;
      this.pending = null;
      this.drawn = null;
      this.lastDiscard = null;
      this.options = null;
      this.pendingFromBack = false;
      this.decisions = [];
      this.turnCount = 0;
      this.dice = null;
      this.drawOrder = null;
      this.frames = [];
      this.pendingDecision = null;
      this.forbidden = [];

      const tiles = shuffle(fullSet(this.fei), this.rand);
      this.totalTiles = tiles.length;
      this.stackCount = tiles.length / 2;
      this.ring = [];
      for (let s = 0; s < this.stackCount; s++) this.ring.push([tiles[2 * s], tiles[2 * s + 1]]);

      this.emit({ type: 'newHand' });
      this.say('Hand ' + this.handNo + ': ' + this.label(this.dealer) + ' ' + this.verb(this.dealer, 'are', 'is') + ' the dealer (East 東). Prevalent wind: ' + windName(this.prevalent) + '.');
      if (this.manual && this.players[this.dealer].isHuman) { this.phase = 'humanDice'; return; }
      if (this.manual) { this.phase = 'dice'; return; }
      this.rollDice();
    }

    rollDice() {
      const d1 = 1 + Math.floor(this.rand() * 6);
      const d2 = 1 + Math.floor(this.rand() * 6);
      const sum = d1 + d2;
      this.dice = [d1, d2];
      // Count anticlockwise from the dealer (dealer = 1) to find whose wall breaks,
      // then count `sum` stacks from that wall's right-hand end.
      const owner = (this.dealer + sum - 1) % 4;
      const n = this.stackCount;
      const seg = this.segments[this.sideOf(owner)];
      const breakPos = (seg.start + sum) % n;
      this.breakOwner = owner;
      this.drawOrder = Array.from({ length: n }, (_, k) => (breakPos + k) % n);
      this.frontPtr = 0;
      this.backPtr = n - 1;
      this.emit({ type: 'dice', dice: this.dice, player: this.dealer });
      this.say(this.label(this.dealer) + ' ' + this.verb(this.dealer, 'roll', 'rolls') + ' ' + d1 + ' + ' + d2 + ' = ' + sum + '. The wall breaks in front of ' + this.label(owner) + ' (' + windName(this.seatOf(owner)) + '), ' + sum + ' stacks from the right.');

      // Three rounds of 2 stacks (4 tiles) each, then 1 tile each — the dealer takes 2.
      this.dealSteps = [];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) this.dealSteps.push({ player: (this.dealer + k) % 4, n: 4 });
      for (let k = 0; k < 4; k++) this.dealSteps.push({ player: (this.dealer + k) % 4, n: k === 0 ? 2 : 1 });
      this.dealIdx = 0;
      if (!this.manual) {
        while (this.dealIdx < this.dealSteps.length) this.dealStep();
        this.startReplacements();
      } else {
        this.nextDealPhase();
      }
    }

    get dealStepNow() { return this.dealSteps && this.dealSteps[this.dealIdx]; }

    nextDealPhase() {
      if (this.dealIdx >= this.dealSteps.length) return this.startReplacements();
      this.phase = this.players[this.dealStepNow.player].isHuman ? 'humanDeal' : 'deal';
    }

    dealStep() {
      const s = this.dealSteps[this.dealIdx++];
      for (let n = 0; n < s.n; n++) this.players[s.player].hand.push(this.takeFront());
      this.emit({ type: 'deal', player: s.player, n: s.n });
    }

    startReplacements() {
      this.initialPhase = true;
      this.replaceOrder = [0, 1, 2, 3].map((k) => (this.dealer + k) % 4);
      this.replaceIdx = 0;
      this.say('Everyone reveals their flowers and animals and draws replacements from the back of the wall.');
      this.nextReplacePhase();
    }

    nextReplacePhase() {
      while (this.replaceIdx < 4) {
        const i = this.replaceOrder[this.replaceIdx];
        if (this.players[i].hand.some(MJ.isBonus)) {
          this.replaceFor = { player: i, reason: 'opening' };
          if (this.manual) { this.phase = this.players[i].isHuman ? 'humanReplace' : 'replace'; return; }
          if (!this.replaceAll(i)) return;
          continue;
        }
        this.replaceIdx++;
      }
      this.initialPhase = false;
      this.replaceFor = null;
      this.players.forEach((p) => { p.hand = MJ.sortTiles(p.hand); });
      this.afterDraw(this.dealer);
    }

    /** Reveals one bonus tile and draws its replacement from the back. Returns false if the wall ran out. */
    replaceOne(i) {
      const p = this.players[i];
      const idx = p.hand.findIndex(MJ.isBonus);
      this.addBonus(i, p.hand.splice(idx, 1)[0]);
      const t = this.takeBack();
      if (t === null) { this.endDraw(); return false; }
      p.hand.push(t);
      p.lastDrawAfterBonus = true;
      this.emit({ type: 'draw', player: i, fromBack: true });
      return true;
    }

    replaceAll(i) {
      while (this.players[i].hand.some(MJ.isBonus)) if (!this.replaceOne(i)) return false;
      return true;
    }

    addBonus(i, b) {
      const p = this.players[i];
      p.bonus.push(b);
      this.emit({ type: 'bonus', player: i, tile: b });
      this.say(this.label(i) + ' ' + this.verb(i, 'reveal', 'reveals') + ' ' + MJ.tileName(b) + ' and ' + this.verb(i, 'draw', 'draws') + ' a replacement from the back of the wall.');
      const I = this.rules.instant;
      const pair = MJ.BITES.find((pr) => pr.includes(b));
      if (pair && pair.every((x) => p.bonus.includes(x))) {
        const each = this.initialPhase ? I.biteAtStartEach : I.biteEach;
        this.emit({ type: 'call', player: i, call: 'bite' });
        this.payEach(i, each, 'Animal bite');
        this.say('Animal bite! Everyone pays ' + this.label(i) + ' ' + each + ' chips.');
      }
      const info = MJ.tileInfo(b);
      if (info.num && p.bonus.includes('f' + info.num) && p.bonus.includes('s' + info.num)) {
        const each = this.initialPhase ? I.flowerBiteAtStartEach : I.flowerBiteEach;
        const owner = this.playerAtSeat(MJ.NUM_SEAT[info.num]);
        this.emit({ type: 'call', player: i, call: 'bite' });
        if (owner === i) {
          this.payEach(i, each, 'Flower bite');
          this.say('Flower bite! ' + this.label(i) + ' ' + this.verb(i, 'have', 'has') + ' both ' + info.num + 's — your own number, so everyone pays ' + each + ' chips.');
        } else {
          this.pay(owner, i, each, 'Flower bite');
          this.say('Flower bite! ' + this.label(i) + ' ' + this.verb(i, 'have', 'has') + ' both ' + info.num + 's, which is ' + this.label(owner) + "'s number: " + this.label(owner) + ' ' + this.verb(owner, 'pay', 'pays') + ' ' + each + ' chips.');
        }
      }
    }

    // ---------- Drawing ----------

    /** Draw for player i from the front (or the back after a kong), then deal with any bonus tiles. */
    drawFor(i, fromBack) {
      const p = this.players[i];
      const t = fromBack ? this.takeBack() : this.takeFront();
      if (t === null) { this.endDraw(); return; }
      p.hand.push(t);
      p.lastDrawAfterBonus = false;
      this.emit({ type: 'draw', player: i, fromBack: !!fromBack });
      this.continueDraw(i);
    }

    continueDraw(i) {
      const p = this.players[i];
      if (p.hand.some(MJ.isBonus)) {
        if (p.isHuman && this.manual) {
          this.replaceFor = { player: i, reason: 'play' };
          this.phase = 'humanReplace';
          return;
        }
        if (!this.replaceAll(i)) return;
      }
      this.drawn = p.isHuman ? p.hand[p.hand.length - 1] : null;
      this.afterDraw(i);
    }

    // ---------- Turns ----------

    /** Options right after drawing: self-draw win and kongs. */
    turnOptions(i) {
      const p = this.players[i];
      const last = p.hand[p.hand.length - 1];
      const ev = this.evaluate(i, p.hand.slice(0, -1), last, true, p.lastDrawAfterBonus);
      const kongs = [];
      [...new Set(p.hand)].forEach((t) => { if (!MJ.isFei(t) && countIn(p.hand, t) === 4) kongs.push({ type: 'concealed', tile: t }); });
      p.melds.forEach((m) => { if (m.type === 'pong' && p.hand.includes(m.tile)) kongs.push({ type: 'added', tile: m.tile }); });
      return { win: ev.status === 'ok' && ev.canWin, noTai: ev.status === 'ok' && !ev.canWin, evaluation: ev, kongs };
    }

    afterDraw(i) {
      if (this.phase === 'over') return;
      this.turn = i;
      this.turnCount++;
      const opts = this.turnOptions(i);
      if (this.players[i].isHuman) {
        this.options = opts;
        if (opts.noTai) this.decisions.push({ kind: 'noTai', turn: this.turnCount, selfDraw: true, tile: this.players[i].hand[this.players[i].hand.length - 1] });
        this.phase = 'humanTurn';
        return;
      }
      if (opts.win) return this.endWin(i, true, null, this.players[i].hand[this.players[i].hand.length - 1]);
      if (opts.kongs.length) return this.doKong(i, opts.kongs[0]);
      this.phase = 'botDiscard';
    }

    doKong(i, k) {
      const p = this.players[i];
      const I = this.rules.instant;
      if (k.type === 'concealed') {
        for (let n = 0; n < 4; n++) removeOne(p.hand, k.tile);
        p.melds.push({ type: 'kong', tile: k.tile, kongSource: 'concealed' });
        this.emit({ type: 'call', player: i, call: 'kong' });
        this.payEach(i, I.concealedKongEach, 'Concealed kong');
        this.say(this.label(i) + ' ' + this.verb(i, 'declare', 'declares') + ' a concealed kong. Everyone pays ' + I.concealedKongEach + ' chips.');
      } else {
        removeOne(p.hand, k.tile);
        const m = p.melds.find((x) => x.type === 'pong' && x.tile === k.tile);
        m.type = 'kong';
        m.kongSource = 'added';
        this.emit({ type: 'call', player: i, call: 'kong' });
        this.payEach(i, I.exposedKongEach, 'Kong');
        this.say(this.label(i) + ' ' + this.verb(i, 'add', 'adds') + ' ' + MJ.tileName(k.tile) + ' to a revealed pong to make a kong. Everyone pays ' + I.exposedKongEach + ' chips.');
      }
      this.startKongReplacement(i);
    }

    startKongReplacement(i) {
      this.options = null;
      this.turn = i;
      this.say(this.label(i) + ' ' + this.verb(i, 'draw', 'draws') + ' a replacement tile from the back of the wall.');
      if (this.players[i].isHuman && this.manual) {
        this.replaceFor = { player: i, reason: 'kong' };
        this.phase = 'humanReplace';
        return;
      }
      this.pendingFromBack = true;
      this.phase = 'nextDraw';
    }

    discard(i, tile) {
      const p = this.players[i];
      const frame = this.record({ type: 'discard', player: i, tile });
      if (p.isHuman && this.pendingDecision) { frame.decision = this.pendingDecision; this.pendingDecision = null; }
      const decisionsBefore = this.decisions.length;
      this.forbidden = [];
      removeOne(p.hand, tile);
      p.hand = MJ.sortTiles(p.hand);
      p.discards.push(tile);
      this.drawn = null;
      this.options = null;
      this.lastDiscard = { tile, from: i };
      this.emit({ type: 'discard', player: i, tile });
      this.say(this.label(i) + ' ' + this.verb(i, 'throw', 'throws') + ' ' + MJ.tileName(tile) + '.');

      const claims = [];
      let human = null;
      for (let k = 1; k < 4; k++) {
        const q = (i + k) % 4;
        const opts = this.claimOptions(q, tile, i);
        if (this.players[q].isHuman && opts.noTai) this.decisions.push({ kind: 'noTai', turn: this.turnCount, selfDraw: false, tile, from: i });
        if (!opts.any) continue;
        if (this.players[q].isHuman) human = Object.assign({ player: q }, opts);
        else {
          const c = this.botClaim(q, tile, opts);
          if (c) claims.push(c);
        }
      }
      if (!frame.decision && this.decisions.length > decisionsBefore) frame.decision = this.decisions[this.decisions.length - 1];
      this.pending = { tile, from: i, claims, human };
      this.phase = human ? 'humanClaim' : 'claims';
    }

    claimOptions(q, tile, from) {
      const p = this.players[q];
      // A discarded Fei joker cannot be claimed.
      if (MJ.isFei(tile)) return { win: false, noTai: false, pong: false, kong: false, chows: [], any: false };
      const ev = this.evaluate(q, p.hand, tile, false, false);
      const n = countIn(p.hand, tile);
      const chows = [];
      const info = MJ.tileInfo(tile);
      if (q === (from + 1) % 4 && info.kind === 'suit') {
        for (let start = info.rank - 2; start <= info.rank; start++) {
          if (start < 1 || start > 7) continue;
          const uses = [start, start + 1, start + 2].filter((r) => r !== info.rank).map((r) => info.suit + r);
          if (uses.every((x) => p.hand.includes(x))) chows.push({ start: info.suit + start, uses, tiles: [start, start + 1, start + 2].map((r) => info.suit + r) });
        }
      }
      const win = ev.status === 'ok' && ev.canWin;
      return { win, noTai: ev.status === 'ok' && !ev.canWin, evaluation: ev, pong: n >= 2, kong: n >= 3, chows, any: win || n >= 2 || chows.length > 0 };
    }

    /** What a sensible player would claim. Also used for the human's hint. */
    suggestClaim(q, tile, opts) {
      if (opts.win) return { player: q, type: 'win', why: 'This tile completes your hand with ' + opts.evaluation.tai + ' tai. Hu!' };
      const p = this.players[q];
      const m = p.melds.length;
      const base = MJ.shanten(MJ.countsOf(p.hand), m);
      const value = this.isValueTile(q, tile);
      if (opts.kong && value) return { player: q, type: 'kong', tiles: [tile, tile, tile, tile], why: 'A kong of a scoring honour: 1 tai, plus 6 chips from the discarder.' };
      if (opts.pong) {
        const after = bestAfterDiscard(without(p.hand, [tile, tile]), m + 1);
        if (after < base) return { player: q, type: 'pong', tiles: [tile, tile, tile], why: 'Pong moves you closer to ready (' + base + ' → ' + after + ' tiles away). Note: revealing a set loses Men Qing (1 tai).' };
        if (value && after <= base) return { player: q, type: 'pong', tiles: [tile, tile, tile], why: 'A pong of ' + MJ.tileName(tile) + ' is worth 1 tai and keeps your pace.' };
      }
      let best = null;
      opts.chows.forEach((c) => {
        const after = bestAfterDiscard(without(p.hand, c.uses), m + 1);
        if (after < base && (!best || after < best.after)) {
          best = { player: q, type: 'chow', chow: c, tiles: c.tiles, after, why: 'This chi moves you closer to ready (' + base + ' → ' + after + ' tiles away). Note: revealing a set loses Men Qing (1 tai).' };
        }
      });
      return best;
    }

    botClaim(q, tile, opts) {
      if (this.difficulty === 'beginner') {
        if (opts.win) return { player: q, type: 'win' };
        if (opts.pong && this.isValueTile(q, tile) && this.rand() < 0.6) return { player: q, type: 'pong' };
        return null;
      }
      return this.suggestClaim(q, tile, opts);
    }

    resolveClaims(humanChoice) {
      const pd = this.pending;
      const claims = pd.claims.slice();
      if (humanChoice && humanChoice.type !== 'pass') claims.push(Object.assign({ player: pd.human.player }, humanChoice));
      const dist = (c) => (c.player - pd.from + 4) % 4;
      const rank = { win: 0, kong: 1, pong: 1, chow: 2 };
      claims.sort((a, b) => rank[a.type] - rank[b.type] || dist(a) - dist(b));
      const c = claims[0];
      this.pending = null;

      if (!c) {
        const next = (pd.from + 1) % 4;
        this.turn = next;
        this.pendingFromBack = false;
        this.phase = this.players[next].isHuman && this.manual ? 'humanDraw' : 'nextDraw';
        return;
      }
      const q = c.player;
      const p = this.players[q];
      const tile = pd.tile;
      if (c.type !== 'win') this.record({ type: c.type, player: q, tile, from: pd.from });
      this.players[pd.from].discards.pop();
      this.lastDiscard = null;

      if (c.type === 'win') {
        p.hand.push(tile);
        return this.endWin(q, false, pd.from, tile);
      }
      if (c.type === 'pong' || c.type === 'kong') {
        for (let n = 0; n < (c.type === 'pong' ? 2 : 3); n++) removeOne(p.hand, tile);
        this.emit({ type: 'call', player: q, call: c.type });
        if (c.type === 'pong') {
          p.melds.push({ type: 'pong', tile });
          this.say(this.label(q) + ' ' + this.verb(q, 'call', 'calls') + ' Pong 碰 on ' + MJ.tileName(tile) + '.');
        } else {
          p.melds.push({ type: 'kong', tile, kongSource: 'discard' });
          this.say(this.label(q) + ' ' + this.verb(q, 'call', 'calls') + ' Kong 槓 on ' + MJ.tileName(tile) + '. ' + this.label(pd.from) + ' ' + this.verb(pd.from, 'pay', 'pays') + ' ' + this.rules.instant.kongFromDiscardShooter + ' chips.');
          this.pay(pd.from, q, this.rules.instant.kongFromDiscardShooter, 'Kong');
          this.startKongReplacement(q);
          return;
        }
      } else {
        c.chow.uses.forEach((x) => removeOne(p.hand, x));
        p.melds.push({ type: 'chow', tile: c.chow.start });
        this.emit({ type: 'call', player: q, call: 'chi' });
        this.say(this.label(q) + ' ' + this.verb(q, 'call', 'calls') + ' Chi 吃 on ' + MJ.tileName(tile) + '.');
      }
      this.forbidden = this.swapForbidden(c.type, tile, c.chow);
      this.turn = q;
      this.drawn = null;
      if (p.isHuman) {
        this.options = { win: false, kongs: [] };
        this.phase = 'humanTurn';
      } else {
        this.phase = 'botDiscard';
      }
    }

    /**
     * After claiming a discard you may not immediately throw a tile that would have made the same set:
     * the claimed tile itself, or (for a Chi taken at one end) the tile at the other end of the run.
     * e.g. eat a 6 with 4–5 → you cannot throw the 3 or the 6 this turn.
     */
    swapForbidden(type, tile, chow) {
      const out = [tile];
      if (type === 'chow' && chow) {
        const info = MJ.tileInfo(tile);
        const start = Number(chow.start.slice(1));
        if (info.rank === start && start + 3 <= 9) out.push(info.suit + (start + 3));
        if (info.rank === start + 2 && start - 1 >= 1) out.push(info.suit + (start - 1));
      }
      return out;
    }

    canThrow(tile) { return !(this.forbidden || []).includes(tile); }

    adviceFor(i) {
      const p = this.players[i];
      return MJ.adviseDiscard({
        concealed: p.hand.slice(0, -1), winningTile: p.hand[p.hand.length - 1],
        melds: p.melds, seat: this.seatOf(i), prevalent: this.prevalent,
      }, this.rules, { seen: this.seenBy(i) });
    }

    botDiscard(i) {
      const p = this.players[i];
      const advice = this.adviceFor(i);
      const allowed = advice.status === 'ok' ? advice.options.filter((o) => this.canThrow(o.tile)) : [];
      if (!allowed.length) return this.discard(i, p.hand.find((x) => this.canThrow(x)) || p.hand[0]);
      const opts = allowed;
      let pick = opts[0];
      if (this.difficulty === 'beginner') {
        // Beginner bots often miss the best discard.
        const r = this.rand();
        pick = opts[Math.min(opts.length - 1, r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.88 ? 2 : 3)];
      } else if (this.difficulty === 'expert') {
        // Expert bots defend: when someone looks close to winning, prefer a safe tile that keeps pace.
        const danger = this.tilesLeft < 40 || this.players.some((o, j) => j !== i && o.melds.length >= 2);
        if (danger) {
          const seen = MJ.countsOf(this.seenBy(i).filter(MJ.isPlayable));
          const safety = (o) => {
            const t = MJ.TYPES.indexOf(o.tile);
            const discardedByOthers = this.players.some((x, j) => j !== i && x.discards.includes(o.tile)) ? 3 : 0;
            return seen[t] + discardedByOthers + (t >= 27 ? 1 : 0);
          };
          const keepPace = opts.filter((o) => o.shanten === opts[0].shanten && o.live >= opts[0].live * 0.6);
          keepPace.sort((a, b) => safety(b) - safety(a));
          pick = keepPace[0] || pick;
        }
      }
      this.discard(i, pick.tile);
    }

    /** Runs one automatic step (bot move, claim resolution, deal step or draw). */
    advance() {
      switch (this.phase) {
        case 'dice': return this.rollDice();
        case 'deal': this.dealStep(); return this.nextDealPhase();
        case 'replace': if (!this.replaceAll(this.replaceFor.player)) return; return this.nextReplacePhase();
        case 'botDiscard': return this.botDiscard(this.turn);
        case 'claims': return this.resolveClaims(null);
        case 'nextDraw': {
          const fromBack = this.pendingFromBack;
          this.pendingFromBack = false;
          return this.drawFor(this.turn, fromBack);
        }
        default: return undefined;
      }
    }

    // ---------- Human actions ----------

    humanRollDice() { this.expect('humanDice'); this.rollDice(); }
    humanDealTake() { this.expect('humanDeal'); this.dealStep(); this.nextDealPhase(); }
    humanDrawTile() { this.expect('humanDraw'); this.drawFor(this.turn, false); }

    humanReplace() {
      this.expect('humanReplace');
      const rf = this.replaceFor;
      const i = rf.player;
      const p = this.players[i];
      if (rf.reason === 'kong') {
        const t = this.takeBack();
        if (t === null) return this.endDraw();
        p.hand.push(t);
        p.lastDrawAfterBonus = false;
        this.emit({ type: 'draw', player: i, fromBack: true });
        this.replaceFor = null;
        return this.continueDraw(i);
      }
      if (!this.replaceOne(i)) return;
      if (rf.reason === 'opening') return this.nextReplacePhase();
      if (p.hand.some(MJ.isBonus)) return; // another flower: reveal again
      this.replaceFor = null;
      this.drawn = p.hand[p.hand.length - 1];
      this.afterDraw(i);
    }

    humanDiscard(tile) {
      this.expect('humanTurn');
      if (!this.canThrow(tile)) throw new Error('You cannot throw ' + MJ.tileName(tile) + ' straight after claiming: it would make the same set.');
      const advice = this.adviceFor(this.turn);
      if (advice.status === 'ok') {
        const best = advice.options.find((o) => this.canThrow(o.tile)) || advice.options[0];
        const chosen = advice.options.find((o) => o.tile === tile);
        const d = {
          kind: 'discard', turn: this.turnCount, hand: this.players[this.turn].hand.slice(), melds: this.players[this.turn].melds.slice(),
          chosen: tile, best: best.tile, bestOpt: best, chosenOpt: chosen, couldWin: !!(this.options && this.options.win),
        };
        this.decisions.push(d);
        this.pendingDecision = d;
      }
      this.discard(this.turn, tile);
    }

    humanWin() {
      if (this.phase === 'humanTurn' && this.options && this.options.win) {
        const p = this.players[this.turn];
        return this.endWin(this.turn, true, null, p.hand[p.hand.length - 1]);
      }
      if (this.phase === 'humanClaim' && this.pending.human.win) {
        const d = { kind: 'claim', turn: this.turnCount, tile: this.pending.tile, from: this.pending.from, couldWin: true, chosen: 'win', suggestion: 'win' };
        this.decisions.push(d);
        return this.resolveClaims({ type: 'win' });
      }
      throw new Error('You cannot win right now.');
    }

    humanKong(k) { this.expect('humanTurn'); this.doKong(this.turn, k); }

    humanClaim(choice) {
      this.expect('humanClaim');
      const pd = this.pending;
      const s = this.suggestClaim(pd.human.player, pd.tile, pd.human);
      const d = {
        kind: 'claim', turn: this.turnCount, tile: pd.tile, from: pd.from, couldWin: pd.human.win,
        chosen: choice.type, suggestion: s ? s.type : 'pass', suggestedTiles: s && s.tiles, why: s ? s.why : null,
        hand: this.players[pd.human.player].hand.slice(),
      };
      this.decisions.push(d);
      this.record({ type: 'decide', player: pd.human.player, tile: pd.tile, from: pd.from, choice: choice.type }).decision = d;
      this.resolveClaims(choice);
    }

    expect(phase) { if (this.phase !== phase) throw new Error('Not now: waiting for ' + this.phase); }

    /** Advice for the human's current decision. */
    hint() {
      const h = this.human;
      if (!h) return null;
      if (this.phase === 'humanTurn') {
        if (this.options && this.options.win) return { type: 'win', text: 'You can win by self-draw (自摸) with ' + this.options.evaluation.tai + ' tai. Declare Hu!' };
        const advice = this.adviceFor(h.index);
        if (advice.status !== 'ok') return null;
        const o = advice.options.find((x) => this.canThrow(x.tile)) || advice.options[0];
        return { type: 'discard', tile: o.tile, tiles: [o.tile], text: 'Throw ' + MJ.tileName(o.tile) + '. ' + o.summary + (o.notes.length ? ' ' + o.notes[0] : '') };
      }
      if (this.phase === 'humanClaim') {
        const s = this.suggestClaim(h.index, this.pending.tile, this.pending.human);
        if (!s) return { type: 'pass', text: 'Pass. Claiming this tile would not bring you closer to a winning hand.' };
        return { type: s.type, chow: s.chow, tiles: s.tiles, text: s.why };
      }
      return null;
    }

    // ---------- Ending ----------

    endWin(i, selfDraw, shooter, tile) {
      const p = this.players[i];
      const concealed = p.hand.slice();
      removeOne(concealed, tile);
      const ev = this.evaluate(i, concealed, tile, selfDraw, selfDraw && p.lastDrawAfterBonus);
      this.record({ type: 'win', player: i, tile, selfDraw, from: shooter });
      this.emit({ type: 'call', player: i, call: selfDraw ? 'zimo' : 'hu' });
      if (selfDraw) this.payEach(i, ev.payout.each, 'Win');
      else this.pay(shooter, i, ev.payout.shooterPays, 'Win');
      this.result = {
        type: 'win', winner: i, winnerSeat: this.seatOf(i), selfDraw, shooter, tile, evaluation: ev,
        hand: { concealed, winningTile: tile, melds: p.melds.slice(), bonus: p.bonus.slice() },
      };
      this.say(this.label(i) + ' ' + this.verb(i, 'win', 'wins') + (selfDraw ? ' by self-draw (自摸)' : ' on ' + this.label(shooter) + "'s discard") + ' with ' + ev.tai + ' tai!');
      this.finishHand(i === this.dealer);
    }

    endDraw() {
      this.result = { type: 'draw' };
      this.say('The wall is empty. This hand is a draw.');
      this.finishHand(true);
    }

    finishHand(dealerStays) {
      this.phase = 'over';
      this.pending = null;
      this.options = null;
      this.result.deltas = this.handDelta.slice();
      this.result.review = this.buildReview();
      if (!dealerStays) {
        this.dealer = (this.dealer + 1) % 4;
        this.dealerMoves++;
        if (this.dealerMoves % 4 === 0) this.prevalent = WINDS[(WINDS.indexOf(this.prevalent) + 1) % 4];
      }
    }

    /** What the human could have done better this hand. */
    buildReview() {
      const h = this.human;
      if (!h) return null;
      const items = [];
      this.decisions.forEach((d) => {
        if ((d.kind === 'discard' || d.kind === 'claim') && d.couldWin && d.chosen !== 'win') {
          items.push({ ref: d, type: 'missedWin', turn: d.turn, tile: d.kind === 'claim' ? d.tile : d.hand[d.hand.length - 1], selfDraw: d.kind === 'discard', from: d.from });
        } else if (d.kind === 'discard' && d.chosen !== d.best && d.chosenOpt && (d.chosenOpt.shanten > d.bestOpt.shanten || d.chosenOpt.live + 4 <= d.bestOpt.live)) {
          items.push({ ref: d, type: 'betterDiscard', turn: d.turn, hand: d.hand, chosen: d.chosen, best: d.best, bestOpt: d.bestOpt, chosenOpt: d.chosenOpt });
        } else if (d.kind === 'claim' && !d.couldWin && d.suggestion !== d.chosen) {
          items.push({ ref: d, type: 'claimAdvice', turn: d.turn, tile: d.tile, from: d.from, chosen: d.chosen, suggestion: d.suggestion, tiles: d.suggestedTiles, why: d.why });
        } else if (d.kind === 'noTai') {
          items.push({ ref: d, type: 'noTai', turn: d.turn, tile: d.tile, from: d.from, selfDraw: d.selfDraw });
        }
      });
      // Mark the rewind's stopping points: the moments a better play was available.
      (this.frames || []).forEach((f) => { f.review = items.find((it) => it.ref === f.decision) || null; });
      let waits = [];
      const won = this.result.type === 'win' && this.result.winner === h.index;
      if (!won) {
        const c = MJ.countsOf(h.hand.filter(MJ.isPlayable));
        if (h.hand.length === 13 - 3 * h.melds.length && MJ.shanten(c, h.melds.length) === 0) waits = MJ.waitingTiles(c, h.melds.length);
      }
      return { items, waits, won };
    }

    /** Every tile accounted for — used by tests. */
    tileCount() {
      let n = this.tilesLeft;
      this.players.forEach((p) => {
        n += p.hand.length + p.bonus.length + p.discards.length;
        p.melds.forEach((m) => { n += MJ.meldTiles(m).length; });
      });
      return n;
    }
  }

  global.MJGame = { Game, WIND_NAMES, WIND_ZH, windName, SEGMENTS, STACKS, segmentsFor };
})(typeof window !== 'undefined' ? window : globalThis);
