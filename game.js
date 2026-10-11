/* FlipX – ren spillogik (ingen DOM, ingen netværk). Bruges af index.html (vært) og af tests i Node. */
(function (root) {
  'use strict';
  var MAX_LOG = 40, MAX_EV = 60;

  var SPEC_KEYS = ['fr', 'f3', 'sc', 'et', 'gv', 'pa', 'h2', 'gh'];
  function defaultSpecials() { return { fr: true, f3: true, sc: true, et: false, gv: false, pa: false, h2: false, gh: false }; }
  // Minuskort (valgfrit): sæt af tre værdier. Kortkode 'd<v>' (fx 'd4' = −4).
  var MINUS_SETS = { a: [2, 4, 6], b: [4, 6, 8], c: [8, 10, 12] };
  function normalizeRules(S) {
    if ([8, 12, 16].indexOf(S.deckMax) < 0) S.deckMax = 12;
    if (S.chance !== 'low' && S.chance !== 'high') S.chance = 'std';
    if (!MINUS_SETS[S.minus]) S.minus = 'off';
    if (S.minusChance !== 'low' && S.minusChance !== 'high') S.minusChance = 'std';
    if (!S.specials) S.specials = defaultSpecials();
    SPEC_KEYS.forEach(function (k) { if (typeof S.specials[k] !== 'boolean') S.specials[k] = !!defaultSpecials()[k]; });
  }
  // Standard: 1 af hver modifikator, 3 af hvert tændt specialkort.
  // Lille ≈ halvdelen (mindst 1). Høj = dobbelt. Talkort er uændrede.
  function chanceCopies(base, chance) {
    if (chance === 'low') return Math.max(1, Math.round(base / 2));
    if (chance === 'high') return base * 2;
    return base;
  }
  function buildDeck(max, specials, chance, minus, minusChance) {
    max = max || 12;
    if (chance !== 'low' && chance !== 'high') chance = 'std';
    var d = ['n0'], v, i, k, n;
    for (v = 1; v <= max; v++) for (i = 0; i < v; i++) d.push('n' + v);
    n = chanceCopies(1, chance);
    for (i = 0; i < n; i++) d.push('m2', 'm4', 'm6', 'm8', 'm10', 'x2');
    var sp = specials || defaultSpecials();
    n = chanceCopies(3, chance);
    for (k = 0; k < SPEC_KEYS.length; k++) if (sp[SPEC_KEYS[k]]) for (i = 0; i < n; i++) d.push(SPEC_KEYS[k]);
    // Minuskort: Standard = 2 af hver værdi (6 i alt, som +kortene), Lille 1 af hver, Høj 4 af hver
    if (MINUS_SETS[minus]) {
      n = chanceCopies(2, minusChance);
      for (k = 0; k < 3; k++) for (i = 0; i < n; i++) d.push('d' + MINUS_SETS[minus][k]);
    }
    return d;
  }
  function shuffle(a, rng) {
    rng = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function isNum(c) { return c[0] === 'n'; }
  function isMinus(c) { return c[0] === 'd'; }
  function isMod(c) { return c[0] === 'm' || c === 'x2' || c[0] === 'd'; }
  function numVal(c) { return parseInt(c.slice(1), 10); }
  function label(c) {
    if (isNum(c)) return c.slice(1);
    if (c[0] === 'm') return '+' + c.slice(1);
    if (c[0] === 'd') return '−' + c.slice(1);
    return { x2: '×2', fr: 'Frys', f3: 'Træk 3', sc: '2. chance', et: 'Ekstra træk', gv: 'Giv væk', pa: 'Pause', h2: '÷2', gh: 'Giv ÷2' }[c] || c;
  }
  function roundScore(p) {
    if (p.status === 'bust') return 0;
    var s = 0, i;
    for (i = 0; i < p.nums.length; i++) s += p.nums[i];
    if (p.mods.indexOf('x2') >= 0) s *= 2;
    for (i = 0; i < p.mods.length; i++) if (p.mods[i][0] === 'm') s += parseInt(p.mods[i].slice(1), 10);
    if (p.seven) s += 15;
    // Minuskort efter de andre modifikatorer. Må gerne gå under 0 (trækker fra totalen). Bust er stadig 0.
    for (i = 0; i < p.mods.length; i++) if (p.mods[i][0] === 'd') s -= parseInt(p.mods[i].slice(1), 10);
    // Derefter ÷2 pr. halveringskort, afrundet mod 0 (7 → 3, −5 → −2)
    var acts = p.acts || [];
    for (i = 0; i < acts.length; i++) if (acts[i] === 'h2' || acts[i] === 'gh') s = Math.trunc(s / 2);
    return s === 0 ? 0 : s;
  }
  function roundScoreRaw(p) { return roundScore({ status: 'active', nums: p.nums, mods: p.mods, acts: p.acts, seven: false }); }
  function tableCards(p) {
    var c = p.nums.map(function (v) { return 'n' + v; }).concat(p.mods, p.acts);
    if (p.bustCard !== null && p.bustCard !== undefined) c.push('n' + p.bustCard);
    return c;
  }
  function log(S, txt, kind) {
    S.seq = (S.seq || 0) + 1;
    S.log.push({ n: S.seq, txt: txt, kind: kind || '' });
    if (S.log.length > MAX_LOG) S.log.splice(0, S.log.length - MAX_LOG);
  }
  // Hændelseslog til animationer: {id, type, p (spiller), t (mål), card, ...}. id stiger altid (evSeq), så klienter kan
  // afspille hver hændelse præcis én gang.
  function ev(S, type, data) {
    if (!S.events) S.events = [];
    S.evSeq = (S.evSeq || 0) + 1;
    var e = { id: S.evSeq, type: type }, k;
    for (k in data) if (data[k] !== undefined) e[k] = data[k];
    S.events.push(e);
    if (S.events.length > MAX_EV) S.events.splice(0, S.events.length - MAX_EV);
    return e;
  }
  function nm(S, i) { return S.players[i].name; }
  function isActive(S, i) { return S.players[i].status === 'active'; }
  function activeIdx(S) { var r = []; for (var i = 0; i < S.players.length; i++) if (isActive(S, i)) r.push(i); return r; }

  function createLobby(target) {
    return { v: 1, phase: 'lobby', target: target || 200, deckMax: 12, chance: 'std', specials: defaultSpecials(), minus: 'off', minusChance: 'std', players: [], log: [], seq: 0, events: [], evSeq: 0 };
  }
  function addPlayer(S, id, name) {
    var p = { id: id, name: name, online: true, total: 0 };
    S.players.push(p); return p;
  }
  function resetPlayerRound(p) {
    p.nums = []; p.mods = []; p.acts = []; p.status = 'active'; p.sc = false; p.seven = false; p.bustCard = null; p.roundPts = 0; p.skip = 0;
  }
  function startGame(S, rng) {
    if (S.players.length < 2) return { ok: false, err: 'Mindst 2 spillere' };
    S.phase = 'play'; S.round = 0; S.dealer = -1; S.history = []; S.winners = []; S.tie = false;
    normalizeRules(S);
    S.deck = shuffle(buildDeck(S.deckMax, S.specials, S.chance, S.minus, S.minusChance), rng); S.discard = [];
    S.players.forEach(function (p) { p.total = 0; resetPlayerRound(p); });
    S.matchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    log(S, 'Spillet starter! Mål: ' + S.target + ' point', 'info');
    startRound(S, rng);
    return { ok: true };
  }
  function startRound(S, rng) {
    var n = S.players.length;
    S.players.forEach(function (p) {
      if (p.nums) S.discard.push.apply(S.discard, tableCards(p));
      resetPlayerRound(p);
    });
    S.round++; S.dealer = (S.dealer + 1) % n; S.phase = 'play'; S.stage = 'deal'; S.turn = -1; S.pending = null; S.sevenEnd = false; S.tie = false;
    S.queue = []; delete S.hold; S.endOk = false;
    for (var k = 1; k <= n; k++) S.queue.push({ t: 'deal', i: (S.dealer + k) % n });
    log(S, 'Runde ' + S.round + ' – ' + nm(S, S.dealer) + ' giver', 'info');
    ev(S, 'round', { round: S.round, p: S.dealer });
    process(S, rng);
  }
  function drawCard(S, rng) {
    if (!S.deck.length) {
      if (!S.discard.length) return null;
      S.deck = shuffle(S.discard, rng); S.discard = [];
      log(S, 'Bunken er tom – kastebunken blandes', 'info');
    }
    return S.deck.pop();
  }
  // Giv et kort til spiller i. frame = aktiv Træk 3 (eller null).
  function give(S, i, card, frame, verb) {
    var p = S.players[i], f3 = frame ? 1 : undefined, deal = verb === 'fik' ? 1 : undefined;
    if (isNum(card)) {
      var v = numVal(card);
      if (p.nums.indexOf(v) >= 0) {
        if (p.sc) {
          p.sc = false; p.acts.splice(p.acts.indexOf('sc'), 1);
          S.discard.push('sc', card);
          log(S, nm(S, i) + ' ' + verb + ' ' + v + ' igen – reddet af 2. chance!', 'save');
          ev(S, 'save', { p: i, card: card, f3: f3 });
        } else {
          p.status = 'bust'; p.bustCard = v;
          log(S, nm(S, i) + ' ' + verb + ' ' + v + ' igen og gik bust!', 'bust');
          ev(S, 'bust', { p: i, card: card, f3: f3, lost: roundScoreRaw(p) });
        }
      } else {
        p.nums.push(v);
        log(S, nm(S, i) + ' ' + verb + ' ' + v, '');
        ev(S, 'card', { p: i, card: card, f3: f3, deal: deal });
        if (p.nums.length >= 7) { p.seven = true; S.sevenEnd = true; log(S, nm(S, i) + ' fik 7 forskellige! +15', 'seven'); ev(S, 'seven', { p: i, pts: roundScore(p) }); }
      }
      return;
    }
    var action = SPEC_KEYS.indexOf(card) >= 0;
    log(S, nm(S, i) + ' ' + verb + ' ' + label(card), action ? 'action' : '');
    ev(S, 'card', { p: i, card: card, f3: f3, deal: deal });
    if (isMod(card)) { p.mods.push(card); return; }
    if (card === 'h2') {
      p.acts.push('h2');
      log(S, nm(S, i) + ' får ÷2 – rundens point halveres', 'action');
      ev(S, 'half', { p: i, t: i, card: 'h2' });
      return;
    }
    if (card === 'sc') {
      if (!p.sc) { p.sc = true; p.acts.push('sc'); ev(S, 'sc', { p: i, t: i }); }
      else S.queue.unshift({ t: 'assign', card: 'sc', from: i });
      return;
    }
    if (card === 'et') {
      p.acts.push('et');
      ev(S, 'extra', { p: i, n: 2 });
      log(S, nm(S, i) + ' trækker to kort mere', 'action');
      S.queue.unshift({ t: 'draw', i: i, x: 1 }, { t: 'draw', i: i, x: 1 });
      return;
    }
    if (card === 'pa') {
      p.skip = (p.skip || 0) + 1; p.acts.push('pa');
      log(S, nm(S, i) + ' springes over én gang (bliver i runden)', 'action');
      ev(S, 'pause', { p: i });
      return;
    }
    if (card === 'gv') {
      var who = [];
      for (var gi = 0; gi < S.players.length; gi++) if (gi !== i && S.players[gi].status !== 'bust') who.push(gi);
      if (!p.nums.length || !who.length) {
        S.discard.push('gv');
        log(S, !p.nums.length ? nm(S, i) + ' trak Giv væk, men har ingen talkort' : nm(S, i) + ' trak Giv væk, men der er ingen at give til', 'info');
        ev(S, 'give', { p: i, none: 1 });
        return;
      }
      S.queue.unshift({ t: 'assign', card: 'gv', from: i });
      return;
    }
    if (frame) { frame.aside.push(card); log(S, label(card) + ' lægges til side til efter Træk 3', 'info'); return; }
    S.queue.unshift({ t: 'assign', card: card, from: i });
  }
  function candidates(S, card, from) {
    if (card === 'sc') return activeIdx(S).filter(function (i) { return i !== from && !S.players[i].sc; });
    if (card === 'gv') { var r = []; for (var i = 0; i < S.players.length; i++) if (i !== from && S.players[i].status !== 'bust') r.push(i); return r; }
    // Giv ÷2: en anden aktiv spiller. Er der ingen, beholder trækkeren den selv.
    if (card === 'gh') { var o = activeIdx(S).filter(function (k) { return k !== from; }); return o.length ? o : [from]; }
    return activeIdx(S);
  }
  function resolveGive(S, from, target, v) {
    var g = S.players[from], r = S.players[target], k = g.nums.indexOf(v);
    if (k < 0) return;
    g.nums.splice(k, 1); g.acts.push('gv');
    var card = 'n' + v;
    if (r.nums.indexOf(v) >= 0) {
      if (r.sc) {
        r.sc = false; r.acts.splice(r.acts.indexOf('sc'), 1);
        S.discard.push('sc', card);
        log(S, nm(S, from) + ' gav ' + v + ' til ' + r.name + ' – reddet af 2. chance!', 'save');
        ev(S, 'give', { p: from, t: target, card: card });
        ev(S, 'save', { p: target, card: card });
      } else {
        r.status = 'bust'; r.bustCard = v;
        log(S, nm(S, from) + ' gav ' + v + ' til ' + r.name + ', som gik bust!', 'bust');
        ev(S, 'give', { p: from, t: target, card: card, bust: 1 });
        ev(S, 'bust', { p: target, card: card, lost: roundScoreRaw(r) });
      }
    } else {
      r.nums.push(v);
      log(S, nm(S, from) + ' gav ' + v + ' til ' + r.name, 'action');
      ev(S, 'give', { p: from, t: target, card: card });
      if (r.nums.length >= 7) { r.seven = true; S.sevenEnd = true; log(S, r.name + ' fik 7 forskellige! +15', 'seven'); ev(S, 'seven', { p: target, pts: roundScore(r) }); }
    }
  }
  function resolveAssign(S, card, from, target) {
    var tp = S.players[target], self = from === target;
    if (card === 'fr') {
      tp.status = 'frozen'; tp.acts.push('fr');
      log(S, self ? nm(S, from) + ' frøs sig selv (' + roundScore(tp) + ' point)' : nm(S, from) + ' frøs ' + tp.name + ' (' + roundScore(tp) + ' point)', 'action');
      ev(S, 'freeze', { p: from, t: target, pts: roundScore(tp) });
    } else if (card === 'f3') {
      tp.acts.push('f3');
      log(S, self ? nm(S, from) + ' tager selv Træk 3' : nm(S, from) + ' giver Træk 3 til ' + tp.name, 'action');
      ev(S, 'take3', { p: from, t: target });
      S.queue.unshift({ t: 'take3', target: target, left: 3, aside: [] });
    } else if (card === 'gh') {
      tp.acts.push('gh');
      log(S, self ? nm(S, from) + ' må selv beholde Giv ÷2 (ingen andre aktive)' : nm(S, from) + ' giver ÷2 til ' + tp.name, 'action');
      ev(S, 'half', { p: from, t: target, card: 'gh' });
    } else if (card === 'sc') {
      tp.sc = true; tp.acts.push('sc');
      log(S, nm(S, from) + ' giver 2. chance til ' + tp.name, 'action');
      ev(S, 'sc', { p: from, t: target });
    }
  }
  function nextTurn(S, from) {
    var n = S.players.length, guard = 0, i = from;
    while (guard++ < n * 4) {
      i = (i + 1) % n;
      if (!isActive(S, i)) continue;
      if (S.players[i].skip) {
        S.players[i].skip--;
        log(S, nm(S, i) + ' springes over (pause)', 'action');
        ev(S, 'skipped', { p: i });
        continue;
      }
      S.turn = i; return true;
    }
    S.turn = -1; return false;
  }
  // Tempo (S.pace, sat af værten): efter et træk med specialkort/modifikator/bust/SYV, hvert Træk 3- og
  // Ekstra træk-kort og hvert bekræftet valg stopper process med S.hold = {k:'step', from: evSeq før}. Værten venter,
  // til animationen er vist, og kalder resume(). Før rundeslut stoppes der også én gang (S.hold.k = 'end').
  // Uden S.pace opfører alt sig som før.
  function notable(S, from, task) {
    if (task && (task.t === 'take3' || task.x)) return true;
    var es = (S.events || []).filter(function (e) { return e.id > from; });
    for (var k = 0; k < es.length; k++) {
      var e = es[k];
      if (e.type !== 'card') return true;
      if (!isNum(e.card)) return true;
    }
    return false;
  }
  function finishRound(S) {
    if (S.pace && !S.endOk) { S.hold = { k: 'end', from: S.evSeq || 0 }; return; }
    S.endOk = false; return endRound(S);
  }
  function resume(S, rng) {
    if (!S.hold) return { ok: false };
    var k = S.hold.k; delete S.hold;
    if (S.phase !== 'play') return { ok: true };
    if (k === 'end') S.endOk = true;
    process(S, rng); S.endOk = false;
    return { ok: true };
  }
  function process(S, rng) {
    var guard = 0;
    while (S.phase === 'play' && !S.pending && !S.hold) {
      if (++guard > 10000) throw new Error('process loop');
      if (S.sevenEnd) return finishRound(S);
      if (!S.queue.length) {
        var base = S.stage === 'deal' ? S.dealer : S.turn;
        S.stage = 'turns';
        if (!nextTurn(S, base)) return finishRound(S);
        return;
      }
      var task = S.queue[0], card, before = S.evSeq || 0;
      if (task.t === 'deal' || task.t === 'draw') {
        S.queue.shift();
        if (!isActive(S, task.i)) continue;
        card = drawCard(S, rng);
        if (card === null) { log(S, 'Ikke flere kort!', 'info'); S.queue = []; return endRound(S); }
        give(S, task.i, card, null, task.t === 'deal' ? 'fik' : 'trak');
        if (S.pace && notable(S, before, task)) { S.hold = { k: 'step', from: before }; return; }
      } else if (task.t === 'assign') {
        S.queue.shift();
        var c = candidates(S, task.card, task.from);
        if (!c.length) { S.discard.push(task.card); log(S, label(task.card) + ' kasseres (ingen kan modtage den)', 'info'); }
        else if (c.length === 1 && task.card !== 'gv') { resolveAssign(S, task.card, task.from, c[0]); if (S.pace) { S.hold = { k: 'step', from: before }; return; } }
        else { S.pending = { card: task.card, chooser: task.from, options: c }; if (task.card === 'gv') S.pending.numbers = S.players[task.from].nums.slice(); }
      } else if (task.t === 'take3') {
        if (!isActive(S, task.target)) { S.queue.shift(); S.discard.push.apply(S.discard, task.aside); continue; }
        if (task.left <= 0) {
          S.queue.shift();
          var extra = task.aside.map(function (cd) { return { t: 'assign', card: cd, from: task.target }; });
          S.queue.unshift.apply(S.queue, extra);
          continue;
        }
        task.left--;
        card = drawCard(S, rng);
        if (card === null) { log(S, 'Ikke flere kort!', 'info'); S.queue = []; return endRound(S); }
        give(S, task.target, card, task, 'trak');
        if (S.pace) { S.hold = { k: 'step', from: before }; return; }
      } else S.queue.shift();
    }
  }
  function endRound(S) {
    (S.queue || []).forEach(function (t) { if (t.t === 'take3') S.discard.push.apply(S.discard, t.aside); if (t.t === 'assign') S.discard.push(t.card); });
    if (S.pending) { S.discard.push(S.pending.card); S.pending = null; }
    S.queue = []; S.turn = -1; S.sevenEnd = false;
    var pts = S.players.map(function (p) { p.roundPts = roundScore(p); p.total += p.roundPts; return p.roundPts; });
    S.history.push(pts);
    log(S, 'Runde ' + S.round + ' er slut', 'info');
    ev(S, 'roundEnd', { round: S.round, pts: pts });
    var max = Math.max.apply(null, S.players.map(function (p) { return p.total; }));
    if (max >= S.target) {
      var lead = []; S.players.forEach(function (p, i) { if (p.total === max) lead.push(i); });
      if (lead.length === 1) { S.phase = 'over'; S.winners = lead; log(S, S.players[lead[0]].name + ' vinder med ' + max + ' point!', 'seven'); ev(S, 'win', { p: lead[0], pts: max }); return; }
      S.tie = true; log(S, 'Uafgjort på ' + max + ' point – der spilles en runde mere', 'info');
    }
    S.phase = 'roundEnd';
  }
  function canStop(p) { return p.status === 'active' && (p.nums.length + p.mods.length + p.acts.length) > 0; }
  // Spillerhandling. Returnerer {ok, err}
  function act(S, pid, a, rng) {
    var i = -1; S.players.forEach(function (p, k) { if (p.id === pid) i = k; });
    if (i < 0) return { ok: false, err: 'Ukendt spiller' };
    if (S.hold && (a.a === 'draw' || a.a === 'stop' || a.a === 'choose')) return { ok: false, err: 'Vent et øjeblik…' };
    if (a.a === 'draw' || a.a === 'stop') {
      if (S.phase !== 'play' || S.stage !== 'turns' || S.pending || S.turn !== i || !isActive(S, i)) return { ok: false, err: 'Ikke din tur' };
      if (a.a === 'draw') S.queue.push({ t: 'draw', i: i });
      else {
        if (!canStop(S.players[i])) return { ok: false, err: 'Du har ingen kort endnu' };
        S.players[i].status = 'stopped';
        log(S, nm(S, i) + ' stopper med ' + roundScore(S.players[i]) + ' point', 'stop');
        ev(S, 'stop', { p: i, pts: roundScore(S.players[i]) });
      }
      process(S, rng); return { ok: true };
    }
    if (a.a === 'choose') {
      var P = S.pending;
      if (S.phase !== 'play' || !P || P.chooser !== i || P.options.indexOf(a.target) < 0) return { ok: false, err: 'Ugyldigt valg' };
      if (P.card === 'gv') {
        var num = parseInt(a.num, 10);
        if (S.players[i].nums.indexOf(num) < 0) return { ok: false, err: 'Du har ikke det talkort' };
        var b1 = S.evSeq || 0;
        S.pending = null; resolveGive(S, i, a.target, num);
        if (S.pace) S.hold = { k: 'step', from: b1 }; else process(S, rng);
        return { ok: true };
      }
      var b2 = S.evSeq || 0;
      S.pending = null; resolveAssign(S, P.card, P.chooser, a.target);
      if (S.pace) S.hold = { k: 'step', from: b2 }; else process(S, rng);
      return { ok: true };
    }
    return { ok: false, err: 'Ukendt handling' };
  }
  function nextRound(S, rng) { if (S.phase !== 'roundEnd') return { ok: false }; startRound(S, rng); return { ok: true }; }
  function backToLobby(S) {
    S.phase = 'lobby'; S.players.forEach(function (p) { p.total = 0; delete p.nums; });
    ['deck', 'discard', 'queue', 'pending', 'hold', 'endOk', 'history', 'winners', 'turn', 'stage', 'round', 'dealer'].forEach(function (k) { delete S[k]; });
    log(S, 'Nyt spil – venter i lobbyen', 'info');
  }
  function countCards(S) {
    var n = (S.deck || []).length + (S.discard || []).length;
    S.players.forEach(function (p) { if (p.nums) n += tableCards(p).length; });
    (S.queue || []).forEach(function (t) { if (t.t === 'take3') n += t.aside.length; if (t.t === 'assign') n++; });
    if (S.pending) n++;
    return n;
  }
  // Offentlig visning til klienter: skjul bunkens rækkefølge
  function publicView(S) {
    var v = JSON.parse(JSON.stringify(S));
    v.deckCount = (S.deck || []).length; v.discardCount = (S.discard || []).length;
    delete v.deck; delete v.discard;
    return v;
  }

  var AI_NAMES = ['Kaptajn Kartoffel', 'Fru Bust', 'Grev Kort', 'Baron Bunker', 'Madame Minus', 'Hr. Syv', 'Skipper Stak', 'Tante Træk', 'Professor Plus', 'Kong Kasino', 'Onkel Ombyt', 'Frk. Flip', 'Doktor Dobbelt', 'Bedste Bluff', 'Hr. Heldig', 'Fru Fumle', 'Sir Stop', 'Lady Lykke', 'Major Makker', 'Grevinde Gæt', 'Mester Minus', 'Fætter Flaks', 'Kusine Kort', 'Hertug Hjerte', 'Bager Bunke', 'Pastor Point', 'Ridder Risiko', 'Frøken Flaks', 'Admiral Ace', 'Nisse Nul', 'Hr. Hasard', 'Fru Flipflop', 'Konsul Kaos', 'Smukke Syver', 'Lille Lotto', 'Tømrer Tæller', 'Jarl Joker', 'Kok Krone', 'Bonde Bonus', 'Pirat Plat'];
  function aiBase(name) { return String(name || '').replace(/ \(AI\)$/, '').trim().toLowerCase(); }
  // Tilfældige, unikke navne (Fisher-Yates med injiceret rng), springer menneskers navne over
  function pickAiNames(taken, n, rng) {
    rng = rng || Math.random;
    var used = {}, out = [], pool = AI_NAMES.slice(), i, j, t;
    for (i = pool.length - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    (taken || []).forEach(function (x) { used[aiBase(x)] = 1; });
    for (i = 0; i < pool.length && out.length < n; i++) {
      if (used[aiBase(pool[i])]) continue;
      used[aiBase(pool[i])] = 1;
      out.push(pool[i]);
    }
    return out;
  }
  // Giv eksisterende AI-spillere nye navne (fx ved Nyt spil)
  function renameAi(S, rng) {
    var ais = S.players.filter(function (p) { return p.ai; });
    var fresh = pickAiNames(S.players.filter(function (p) { return !p.ai; }).map(function (p) { return p.name; }), ais.length, rng);
    ais.forEach(function (p, k) { if (fresh[k]) p.name = fresh[k] + ' (AI)'; });
  }
  // Den med flest point i alt, og ved lige højst i runden. Andre foretrækkes frem for en selv.
  function aiLeader(S, options, from) {
    var best = -1, bt = -1, br = -1, k, i, t, r;
    for (k = 0; k < options.length; k++) {
      i = options[k];
      if (i === from) continue;
      t = S.players[i].total; r = roundScore(S.players[i]);
      if (t > bt || (t === bt && r > br)) { best = i; bt = t; br = r; }
    }
    return best < 0 ? options[0] : best;
  }
  function aiChoose(S, i) {
    var P = S.pending, p = S.players[i], target = aiLeader(S, P.options, i), num, have, bustN, k;
    if (P.card === 'gv') {
      have = S.players[target].nums;
      bustN = null;
      for (k = 0; k < p.nums.length; k++) if (have.indexOf(p.nums[k]) >= 0 && (bustN === null || p.nums[k] > bustN)) bustN = p.nums[k];
      num = bustN;
      if (num === null) { num = p.nums[0]; for (k = 1; k < p.nums.length; k++) if (p.nums[k] < num) num = p.nums[k]; }
      return { pid: p.id, a: 'choose', target: target, num: num };
    }
    return { pid: p.id, a: 'choose', target: target };
  }
  function aiHit(S, i) {
    var p = S.players[i], sc, hi, k;
    if (!canStop(p)) return { pid: p.id, a: 'draw' };
    sc = roundScore(p); hi = 0;
    for (k = 0; k < p.nums.length; k++) if (p.nums[k] > hi) hi = p.nums[k];
    if (sc >= 22) return { pid: p.id, a: 'stop' };
    if (sc >= 16 && hi >= 9) return { pid: p.id, a: 'stop' };
    if (sc >= 12 && p.nums.length >= 5) return { pid: p.id, a: 'stop' };
    return { pid: p.id, a: 'draw' };
  }
  // Ét træk for den AI, der skal handle nu. Null hvis det er et menneske, eller ingen skal handle.
  function aiDecide(S) {
    var i, p;
    if (!S || S.phase !== 'play' || S.hold) return null;
    if (S.pending) {
      i = S.pending.chooser; p = S.players[i];
      if (!p || !p.ai) return null;
      return aiChoose(S, i);
    }
    if (S.stage !== 'turns' || S.turn < 0) return null;
    p = S.players[S.turn];
    if (!p || !p.ai || !isActive(S, S.turn)) return null;
    return aiHit(S, S.turn);
  }

  // Placering i det spil der lige er vundet. Lige point deler plads.
  function gameRanking(players) {
    var rows = (players || []).map(function (p, i) {
      return { i: i, id: p.id, name: p.name, total: p.total | 0, ai: !!p.ai };
    });
    rows.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return String(a.name || '').localeCompare(String(b.name || ''), 'da');
    });
    var place = 0, last = null;
    rows.forEach(function (r, n) {
      if (last === null || r.total !== last) place = n + 1;
      last = r.total;
      r.place = place;
    });
    return rows;
  }
  function winPercent(wins, games) {
    wins = wins | 0; games = games | 0;
    if (games <= 0 || wins <= 0) return 0;
    if (wins > games) wins = games;
    return Math.round((wins / games) * 1000) / 10;
  }
  function formatPercent(p) {
    var n = Math.round(Number(p) * 10) / 10;
    if (!isFinite(n) || n < 0) n = 0;
    var s = Math.round(n) === n ? String(Math.round(n)) : n.toFixed(1).replace('.', ',');
    return s + ' %';
  }
  // Én afsluttet kamp for denne telefon. games +1, wins +1 kun ved sejr. Navn er det, der blev spillet som.
  function nextCareer(prev, won, name) {
    var games = ((prev && prev.games) | 0) + 1;
    var wins = ((prev && prev.wins) | 0) + (won ? 1 : 0);
    if (wins > games) wins = games;
    if (wins < 0) wins = 0;
    name = String(name == null ? '' : name).trim().slice(0, 40);
    return { name: name, games: games, wins: wins };
  }
  function sortBoard(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var dw = (b.wins | 0) - (a.wins | 0);
      if (dw) return dw;
      var dp = winPercent(b.wins, b.games) - winPercent(a.wins, a.games);
      if (dp) return dp;
      return String(a.name || '').localeCompare(String(b.name || ''), 'da');
    });
  }

  var api = { buildDeck: buildDeck, shuffle: shuffle, label: label, roundScore: roundScore, tableCards: tableCards, createLobby: createLobby,
    addPlayer: addPlayer, startGame: startGame, startRound: startRound, nextRound: nextRound, act: act, process: process, endRound: endRound, resume: resume,
    canStop: canStop, activeIdx: activeIdx, backToLobby: backToLobby, countCards: countCards, publicView: publicView, drawCard: drawCard,
    normalizeRules: normalizeRules, defaultSpecials: defaultSpecials, MINUS_SETS: MINUS_SETS, SPEC_KEYS: SPEC_KEYS, aiDecide: aiDecide, pickAiNames: pickAiNames, renameAi: renameAi, AI_NAMES: AI_NAMES, gameRanking: gameRanking, winPercent: winPercent, formatPercent: formatPercent, nextCareer: nextCareer, sortBoard: sortBoard };
  api.eventsSince = function (S, id) { return (S.events || []).filter(function (e) { return e.id > id; }); };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EnTil = api;
})(this);
