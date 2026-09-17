/* App controller: screens, game loop, bot orchestration, local & network PvP. */
(function () {
  'use strict';
  const BG = window.BG, AI = window.BGAI, UI = window.BGUI, Net = window.BGNet;
  const W = 'W', B = 'B';
  const $ = id => document.getElementById(id);
  const VERSION = 1;

  // ---------------- settings & persistence ----------------
  const settings = Object.assign({ sound: true, vibrate: true, hints: false, autodone: false, pips: true, speed: 'normal', names: {}, v: 0, fullscreen: true },
    load('bg.settings') || {});
  // v1: legal-move highlights default to off (existing installs that never touched the toggle follow the new default)
  if ((settings.v || 0) < 1) { settings.hints = false; settings.v = 1; }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function saveSettings() { save('bg.settings', settings); }
  function speedMs(base) { return settings.speed === 'fast' ? base * 0.4 : settings.speed === 'slow' ? base * 1.8 : base; }

  // ---------------- sound ----------------
  let actx = null;
  function beep(type) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
      if (type === 'click') { o.type = 'triangle'; o.frequency.value = 520; g.gain.setValueAtTime(.18, t); g.gain.exponentialRampToValueAtTime(.001, t + .08); o.start(t); o.stop(t + .09); }
      else if (type === 'hit') { o.type = 'sawtooth'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(90, t + .2); g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.001, t + .22); o.start(t); o.stop(t + .23); }
      else if (type === 'dice') { for (let i = 0; i < 4; i++) { const o2 = actx.createOscillator(), g2 = actx.createGain(); o2.connect(g2); g2.connect(actx.destination); o2.type = 'square'; o2.frequency.value = 800 + Math.random() * 600; const s = t + i * .06; g2.gain.setValueAtTime(.06, s); g2.gain.exponentialRampToValueAtTime(.001, s + .05); o2.start(s); o2.stop(s + .06); } }
      else if (type === 'win') { [523, 659, 784, 1046].forEach((f, i) => { const o2 = actx.createOscillator(), g2 = actx.createGain(); o2.connect(g2); g2.connect(actx.destination); o2.frequency.value = f; const s = t + i * .12; g2.gain.setValueAtTime(.15, s); g2.gain.exponentialRampToValueAtTime(.001, s + .3); o2.start(s); o2.stop(s + .32); }); }
      else if (type === 'lose') { o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(120, t + .5); g.gain.setValueAtTime(.15, t); g.gain.exponentialRampToValueAtTime(.001, t + .5); o.start(t); o.stop(t + .5); }
      else if (type === 'alert') { o.frequency.value = 880; g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.001, t + .25); o.start(t); o.stop(t + .26); }
    } catch (_) {}
  }
  let userGestured = false;
  document.addEventListener('pointerdown', () => { userGestured = true; }, { capture: true, passive: true });
  function buzz(ms) { if (userGestured && settings.vibrate && navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} } }

  // ---------------- screens ----------------
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
    if (id === 'menu') { $('resume-note').hidden = !load('bg.session'); }
    if (id === 'game') { requestAnimationFrame(() => board.layout()); if (typeof autoFullscreen === 'function') autoFullscreen(); }
    if (id === 'menu' && typeof exitFullscreen === 'function') exitFullscreen();
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { beep('click'); show(b.dataset.go); }));
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); beep('click');
    if (seg.id === 'set-speed') { settings.speed = b.dataset.v; saveSettings(); }
  }));
  const segVal = id => { const on = document.querySelector('#' + id + ' button.on'); return on ? on.dataset.v : null; };

  // modal
  let modalOpen = false;
  function showModal(title, body, buttons) {
    $('modal-title').textContent = title; $('modal-body').innerHTML = body;
    const bx = $('modal-buttons'); bx.innerHTML = '';
    (buttons || [{ label: 'OK' }]).forEach(b => {
      const el = document.createElement('button'); el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
      el.addEventListener('click', () => { beep('click'); if (!b.keep) hideModal(); b.cb && b.cb(); });
      bx.appendChild(el);
    });
    $('modal').hidden = false; modalOpen = true;
  }
  function hideModal() { $('modal').hidden = true; modalOpen = false; }
  let toastT = null;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms || 2200); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------------- session ----------------
  let S = null; // current session
  const board = new UI.BoardView($('board'), {
    canPick: loc => S && !S.busy && S.game.phase === 'move' && isLocalHuman(S.game.turn) && sources().includes(loc),
    onTap: onBoardTap,
    onDragStart: from => selectFrom(from),
    onDrop: (from, to) => tryMove(from, to),
    onDragCancel: () => { },
  });

  function isLocalHuman(side) { return !!(S && side && S.players[side] && S.players[side].type === 'human'); }
  function controller(side) { return side && S.players[side] ? S.players[side].type : null; }
  function isAuthority() { return !S.net || S.isHost; }
  function myName(side) { return S.players[side].name; }
  function rng() { return Math.random(); }

  function newSession(cfg) {
    S = {
      mode: cfg.mode, level: cfg.level || null,
      match: BG.newMatch({ target: cfg.target, cubeEnabled: cfg.cube, nameW: cfg.players.W.name, nameB: cfg.players.B.name }),
      game: null, players: cfg.players, rotate: !!cfg.rotate, net: cfg.net || null, isHost: cfg.isHost !== false,
      busy: false, selected: null, mySide: cfg.mySide || W, gameOverShown: false,
    };
    S.game = BG.newGame(S.match);
    return S;
  }

  // ---------------- rendering ----------------
  function sources() {
    const g = S.game; if (g.phase !== 'move') return [];
    const set = new Set(); for (const m of BG.legalNextMoves(g)) set.add(m.from); return Array.from(set);
  }
  function directDests(from) {
    const set = new Set(); for (const m of BG.legalNextMoves(S.game)) if (m.from === from) set.add(m.to); return Array.from(set);
  }
  // Direct destinations plus multi-step ("full roll") destinations for the same checker.
  function destsFor(from) {
    const direct = directDests(from);
    const chains = BG.chainMoves(S.game, from);
    const far = Object.keys(chains).map(k => (k === 'off' ? 'off' : +k)).filter(d => !direct.includes(d));
    return direct.concat(far);
  }
  function farDestsFor(from) { const d = directDests(from); return destsFor(from).filter(x => !d.includes(x)); }
  function perspective() {
    if (!S) return W;
    if (S.mode === 'local') return S.rotate && S.game.turn ? S.game.turn : W;
    return S.mySide;
  }

  function render(opts) {
    if (!S) return;
    const g = S.game, m = S.match;
    board.showHints = settings.hints;
    board.setPerspective(perspective());
    const srcs = (!S.busy && g.phase === 'move' && isLocalHuman(g.turn)) ? sources() : [];
    board.setSelection(S.selected, S.selected !== null ? destsFor(S.selected) : [], srcs, S.selected !== null ? farDestsFor(S.selected) : []);
    board.render(g, opts);
    // scoreboard
    const bottom = perspective(), top = BG.other(bottom);
    for (const [id, side] of [['sb-top', top], ['sb-bottom', bottom]]) {
      const el = $(id);
      el.querySelector('.sb-dot').className = 'sb-dot ' + side;
      el.querySelector('.sb-name').textContent = myName(side);
      el.querySelector('.sb-pips').textContent = settings.pips ? BG.pipCount(g, side) + (window.innerWidth < 480 ? 'p' : ' pips') : '';
      el.querySelector('.sb-score').textContent = m.scores[side];
      el.classList.toggle('active', g.turn === side && g.phase !== 'over');
    }
    const narrow = window.innerWidth < 480;
    $('sb-mid').textContent = m.target ? (narrow ? 'to ' : 'match to ') + m.target + (m.crawfordGame ? (narrow ? ' ·C' : ' · Crawford') : '') : (narrow ? '∞' : 'money game');
    const cube = $('cube');
    cube.classList.toggle('hidden', !m.cubeEnabled);
    cube.textContent = g.cube.value === 1 ? '64' : g.cube.value;
    cube.className = 'cube' + (!m.cubeEnabled ? ' hidden' : '') + (g.cube.owner ? (g.cube.owner === bottom ? ' bottom' : ' top') : '');
    cube.style.opacity = g.cube.value === 1 ? .55 : 1;
    // dice + buttons + status
    UI.renderDice($('dice'), g, opts && opts.rollAnim);
    const human = isLocalHuman(g.turn) && !S.busy;
    const openPend = g.phase === 'opening' && !S.busy ? openingPending() : [];
    $('btn-roll').hidden = !((g.phase === 'roll' && human) || openPend.length);
    $('btn-roll').textContent = openPend.length ? '🎲 ' + (S.mode === 'local' ? myName(openPend[0]) + ': roll' : 'Roll for first move') : '🎲 Roll';
    $('btn-double').hidden = !(g.phase === 'roll' && human && BG.canDouble(g, g.turn));
    $('btn-undo').hidden = !(g.phase === 'move' && human && g.moves.length > 0);
    $('btn-done').hidden = !(g.phase === 'move' && human && BG.canEndTurn(g) && (BG.legalNextMoves(g).length === 0 || true));
    if (g.phase === 'move' && human) $('btn-done').disabled = !BG.canEndTurn(g);
    $('status').innerHTML = statusText();
  }

  function statusText() {
    const g = S.game; const n = s => '<b>' + escapeHTML(myName(s)) + '</b>';
    if (g.phase === 'opening') {
      const pend = openingPending();
      if (pend.length) return (S.mode === 'local' ? n(pend[0]) + ' — ' : '') + 'roll for first move';
      const waiting = [W, B].filter(s => !g.opening[s]);
      return waiting.length ? 'Waiting for ' + waiting.map(n).join(' and ') + ' to roll…' : 'Higher die starts…';
    }
    if (g.phase === 'over') return g.winner ? n(g.winner) + ' wins the game' : 'Game over';
    const ctl = controller(g.turn);
    if (g.phase === 'roll') return ctl === 'human' ? n(g.turn) + ' — roll the dice' : ctl === 'bot' ? n(g.turn) + ' is thinking…' : 'Waiting for ' + n(g.turn) + ' to roll…';
    if (g.phase === 'double') { const r = BG.other(g.turn); return n(g.turn) + ' offers a double to ' + (g.cube.value * 2) + ' — ' + (controller(r) === 'human' ? n(r) + ' decides' : 'waiting for ' + n(r)); }
    if (g.phase === 'move') {
      if (ctl !== 'human') return n(g.turn) + ' is moving…';
      if (BG.legalNextMoves(g).length === 0) return g.moves.length ? n(g.turn) + ' — tap <b>Done</b>' : n(g.turn) + ' — no legal moves';
      return n(g.turn) + ' — move ' + (g.remaining.length === g.dice.length || g.dice[0] === g.dice[1] ? '' : '') + (S.selected !== null ? 'to a highlighted point' : 'a checker');
    }
    return '';
  }
  function escapeHTML(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------------- input ----------------
  function selectFrom(from) {
    if (!S || S.busy || S.game.phase !== 'move' || !isLocalHuman(S.game.turn)) return;
    if (!sources().includes(from)) return;
    S.selected = from; render();
  }
  function onBoardTap(t) {
    if (!S || S.busy || modalOpen) return;
    const g = S.game;
    if (g.phase !== 'move' || !isLocalHuman(g.turn)) return;
    const loc = t.type === 'point' ? t.pt : t.type;
    if (S.selected !== null) {
      const dests = destsFor(S.selected);
      if (dests.includes(loc)) { tryMove(S.selected, loc); return; }
      if (loc === S.selected) {
        // tapping the selected checker again: move it if there is a single destination
        if (dests.length === 1) { tryMove(S.selected, dests[0]); return; }
        S.selected = null; render(); return;
      }
    }
    if (loc !== 'off' && sources().includes(loc)) { S.selected = loc; beep('click'); render(); return; }
    // tap a destination directly when exactly one source can reach it (directly or in several steps)
    const cands = BG.legalNextMoves(g).filter(m => m.to === loc);
    let froms = Array.from(new Set(cands.map(m => m.from)));
    if (!froms.length) froms = sources().filter(s => destsFor(s).includes(loc));
    if (froms.length === 1) { tryMove(froms[0], loc); return; }
    S.selected = null; render();
  }
  function tryMove(from, to) {
    const g = S.game;
    if (S.busy || g.phase !== 'move' || !isLocalHuman(g.turn)) return false;
    let m;
    try { m = BG.move(g, from, to); } catch (e) { m = null; }
    if (m) {
      S.selected = null;
      beep(m.hit ? 'hit' : 'click'); if (m.hit) buzz(30);
      netSend({ t: 'action', a: 'move', from, to, die: m.die });
      afterMove();
      return true;
    }
    // Not a single move: maybe the same checker can get there in several steps (full roll in one go)
    const chain = BG.chainMoves(g, from)[to];
    if (!chain) return false;
    S.selected = null;
    playChain(g, chain);
    return true;
  }
  // Play a multi-step move of one checker, animating every hop so the path is visible.
  async function playChain(g, chain) {
    S.busy = true;
    const turn = g.turn;
    board.render(g, { immediate: true }); // if the checker was dragged, snap it back to its origin first
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      if (S.game !== g || g.phase !== 'move' || g.turn !== turn) break;
      await board.animateMove(turn, step.from, step.to, step.hit);
      let m; try { m = BG.move(g, step.from, step.to, step.die); } catch (e) { break; }
      beep(m.hit ? 'hit' : 'click'); if (m.hit) buzz(30);
      netSend({ t: 'action', a: 'move', from: step.from, to: step.to, die: m.die });
      render();
      if (g.phase === 'over') break;
      if (i < chain.length - 1) await sleep(speedMs(120));
    }
    S.busy = false;
    afterMove();
  }
  function afterMove() {
    const g = S.game;
    render();
    if (g.phase === 'over') { tick(); return; }
    if (BG.legalNextMoves(g).length === 0) {
      if (settings.autodone || g.remaining.length === 0) {
        const turn = g.turn, n = g.moves.length; S.busy = true; render();
        setTimeout(() => {
          if (!S) return; S.busy = false;
          const cur = S.game;
          if (cur.phase === 'move' && cur.turn === turn && cur.moves.length === n && BG.legalNextMoves(cur).length === 0) doEndTurn(); else render();
        }, speedMs(450));
      }
    }
    persist();
  }
  function doEndTurn() {
    const g = S.game; if (g.phase !== 'move' || !BG.canEndTurn(g)) return;
    BG.endTurn(g); S.selected = null;
    netSend({ t: 'action', a: 'end' });
    tick();
  }
  $('btn-done').addEventListener('click', () => { if (S && !S.busy && isLocalHuman(S.game.turn)) { beep('click'); doEndTurn(); } });
  $('btn-undo').addEventListener('click', () => { if (S && !S.busy && S.game.phase === 'move' && isLocalHuman(S.game.turn)) { if (BG.undo(S.game)) { beep('click'); S.selected = null; netSend({ t: 'action', a: 'undo' }); render(); persist(); } } });
  $('btn-roll').addEventListener('click', () => {
    if (S && !S.busy && S.game.phase === 'opening') { humanOpeningRoll(); return; }
    if (!S || S.busy || S.game.phase !== 'roll' || !isLocalHuman(S.game.turn)) return;
    if (isAuthority()) doRoll(); else { netSend({ t: 'action', a: 'roll' }); S.busy = true; render(); }
  });
  $('btn-double').addEventListener('click', () => {
    if (!S || S.busy || !BG.canDouble(S.game, S.game.turn) || !isLocalHuman(S.game.turn)) return;
    beep('alert'); BG.offerDouble(S.game); netSend({ t: 'action', a: 'double' }); tick();
  });

  async function doRoll() {
    const g = S.game; S.busy = true;
    BG.roll(g, rng); beep('dice'); buzz(15);
    render({ rollAnim: true }); broadcastState();
    await sleep(speedMs(500));
    S.busy = false;
    tick();
  }

  // ---------------- main loop ----------------
  let tickToken = 0;
  async function tick() {
    if (!S) return;
    const g = S.game; const token = ++tickToken;
    render();
    persist();
    if (g.phase === 'over') { onGameOver(); return; }
    if (g.phase === 'opening') {
      // each player rolls one die: humans tap the button, bots roll by themselves, remote players send an action
      if (isAuthority()) for (const side of [W, B]) if (!g.opening[side] && controller(side) === 'bot') { botOpeningRoll(side, token); break; }
      return;
    }
    const ctl = controller(g.turn);
    if (g.phase === 'roll') {
      if (S.mode === 'local' || (S.mode !== 'bot' && ctl === 'human')) announceTurn();
      if (ctl === 'bot') await botPreRoll(token);
      else if (ctl === 'human' && S.mode === 'local' && g.lastAction && g.lastAction.type === 'endturn') { /* announce handled */ }
    } else if (g.phase === 'move') {
      if (ctl === 'bot') await botPlay(token);
      else if (ctl === 'human') {
        if (BG.legalNextMoves(g).length === 0 && g.moves.length === 0) {
          board.flashBanner('No legal moves', myName(g.turn) + ' cannot move', 1300); beep('alert');
          S.busy = true; render(); await sleep(speedMs(1300)); S.busy = false;
          if (tickToken !== token || S.game !== g) return;
          doEndTurn();
        }
      }
    } else if (g.phase === 'double') {
      const r = BG.other(g.turn);
      if (controller(r) === 'bot') await botRespondDouble(token);
      else if (controller(r) === 'human') askTake(r);
    }
  }

  let lastAnnounced = null;
  function announceTurn() {
    const g = S.game; const key = S.match.gameNo + ':' + g.turn + ':' + (g.lastAction && g.lastAction.type);
    if (lastAnnounced === key) return; lastAnnounced = key;
    if (g.lastAction && (g.lastAction.type === 'endturn' || g.lastAction.type === 'take')) {
      const mine = isLocalHuman(g.turn);
      board.flashBanner(escapeHTML(myName(g.turn)) + (S.mode === 'local' ? "'s turn" : mine ? ' — your turn' : "'s turn"), mine ? 'Roll the dice' : '', 1200);
      if (mine && S.mode !== 'local') buzz(20);
    }
  }

  // sides that a local human still has to roll for in the opening
  function openingPending() {
    const g = S.game; if (g.phase !== 'opening') return [];
    return [W, B].filter(side => !g.opening[side] && isLocalHuman(side));
  }
  function humanOpeningRoll() {
    const pend = openingPending(); if (!pend.length || S.busy) return;
    const side = pend[0];
    if (isAuthority()) applyOpeningRoll(side);
    else netSend({ t: 'action', a: 'openroll' });
  }
  async function botOpeningRoll(side, token) {
    await sleep(speedMs(700));
    if (tickToken !== token || !S || S.game.phase !== 'opening' || S.game.opening[side]) return;
    applyOpeningRoll(side);
  }
  // Authority only: roll one die for `side`, show it, resolve when both are in.
  async function applyOpeningRoll(side) {
    const g = S.game; if (g.phase !== 'opening' || g.opening[side]) return;
    BG.openingRollFor(g, side, rng); beep('dice');
    S.busy = true; render();
    $('dice').innerHTML = UI.openingDiceHTML(g.opening.W || g.lastAction.W, g.opening.B || g.lastAction.B, side);
    broadcastState();
    const la = g.lastAction;
    if (la.type === 'opening-die') { await sleep(speedMs(500)); S.busy = false; tick(); return; }
    if (la.type === 'opening-tie') { board.flashBanner('Tie! Roll again', `${la.W} – ${la.B}`, 1200); await sleep(speedMs(1200)); if (S.game === g) { S.busy = false; tick(); } return; }
    board.flashBanner(escapeHTML(myName(g.turn)) + ' starts', `${myName(W)} rolled ${la.W}, ${myName(B)} rolled ${la.B}`, 1600);
    await sleep(speedMs(1400));
    if (S.game !== g) return;
    S.busy = false; lastAnnounced = null; tick();
  }

  // ---------------- bot ----------------
  async function botPreRoll(token) {
    const g = S.game; S.busy = true; render();
    await sleep(speedMs(600));
    if (tickToken !== token || S.game !== g) return;
    if (AI.shouldDouble(g, g.turn, S.level, S.match)) {
      BG.offerDouble(g); S.busy = false; beep('alert'); board.flashBanner(escapeHTML(myName(g.turn)) + ' doubles!', 'Cube to ' + g.cube.value * 2, 1400);
      await sleep(speedMs(900)); if (tickToken !== token) return;
      tick(); return;
    }
    S.busy = false; doRoll();
  }
  async function botPlay(token) {
    const g = S.game; S.busy = true; render();
    await sleep(speedMs(350));
    if (tickToken !== token || S.game !== g) return;
    const moves = AI.choosePlay(g, S.level, rng);
    if (moves.length === 0) { board.flashBanner('No legal moves', escapeHTML(myName(g.turn)) + ' cannot move', 1200); await sleep(speedMs(1200)); }
    for (const m of moves) {
      if (tickToken !== token || S.game !== g) return;
      await board.animateMove(g.turn, m.from, m.to, m.hit);
      BG.move(g, m.from, m.to, m.die); beep(m.hit ? 'hit' : 'click');
      render();
      if (g.phase === 'over') break;
      await sleep(speedMs(260));
    }
    if (tickToken !== token || S.game !== g) return;
    await sleep(speedMs(500));
    S.busy = false;
    if (g.phase !== 'over') BG.endTurn(g);
    lastAnnounced = null;
    tick();
  }
  async function botRespondDouble(token) {
    const g = S.game; S.busy = true; render();
    await sleep(speedMs(900));
    if (tickToken !== token || S.game !== g) return;
    const r = BG.other(g.turn);
    const take = AI.shouldTake(g, r, S.level);
    S.busy = false;
    if (take) { BG.acceptDouble(g); board.flashBanner(escapeHTML(myName(r)) + ' takes', 'Cube is now ' + g.cube.value, 1300); beep('click'); }
    else { BG.declineDouble(g); board.flashBanner(escapeHTML(myName(r)) + ' passes', myName(g.turn) + ' wins ' + g.result.points, 1300); }
    await sleep(speedMs(700));
    tick();
  }

  function askTake(r) {
    const g = S.game;
    beep('alert'); buzz(40);
    showModal(escapeHTML(myName(g.turn)) + ' doubles!', `<b>${escapeHTML(myName(r))}</b>, do you accept the cube at <b>${g.cube.value * 2}</b>?<br>Passing loses ${g.cube.value} point${g.cube.value > 1 ? 's' : ''} now.`, [
      { label: 'Take (play on at ' + g.cube.value * 2 + ')', cls: 'primary', cb: () => { BG.acceptDouble(S.game); netSend({ t: 'action', a: 'take' }); lastAnnounced = null; tick(); } },
      { label: 'Pass (concede ' + g.cube.value + ')', cls: 'danger', cb: () => { BG.declineDouble(S.game); netSend({ t: 'action', a: 'pass' }); tick(); } },
    ]);
  }

  // ---------------- game over ----------------

  // ---------------- royal taunts ----------------
  const TAUNTS = {
    natasha: [
      "You're playing in my kingdom now. 👑",
      "Bow before the queen of the board.",
      "My kingdom, my dice, my rules.",
      "Another loyal subject added to the realm.",
      "The crown stays exactly where it belongs.",
      "Did you really think you could take the throne?",
      "Checkers off, crown on. Long live the queen.",
      "That wasn't a game — that was a coronation.",
      "Kneel. It's less embarrassing than what just happened.",
      "Every point on this board answers to me.",
      "The queen has spoken. The board agrees.",
      "Welcome to Natasha's kingdom. Population: you, defeated.",
    ],
    noah: [
      "This may be your kingdom, but it's me who truly rules.",
      "A kingdom is only as strong as its king. Bow.",
      "Queens wear the crown. Kings win the games.",
      "Your kingdom just got a new landlord.",
      "The throne was never yours — I was just letting you sit in it.",
      "Rebellion successful. The crown changes hands.",
      "You can keep the castle. I'll take the victory.",
      "History remembers who ruled, not who reigned.",
      "Kingdom? I prefer to call it my back garden.",
      "Turns out the king still outranks the queen on this board.",
      "Long live the king — and it's not even close.",
      "Your reign was lovely. My checkmate was lovelier.",
    ],
  };
  // Deterministic pick (same phrase on both phones): walks the list based on how many games were played.
  function tauntFor(name, seed) {
    const key = String(name || '').trim().toLowerCase();
    const list = TAUNTS[key]; if (!list) return null;
    return list[Math.abs(seed | 0) % list.length];
  }

  function onGameOver() {
    if (S.gameOverShown) return;
    const g = S.game, m = S.match;
    let r;
    if (isAuthority()) { r = ensureRecorded(); broadcastState(); }
    else { if (!g.recorded) return; r = g.matchResult; } // guest waits for the host's recorded result
    S.gameOverShown = true;
    const winnerLocal = isLocalHuman(g.winner);
    beep(winnerLocal || S.mode === 'local' ? 'win' : 'lose'); buzz([60, 40, 60]);
    const typeTxt = g.result.type === 'backgammon' ? 'Backgammon! ' : g.result.type === 'gammon' ? 'Gammon! ' : '';
    const reason = g.result.reason === 'pass' ? ' (double declined)' : g.result.reason === 'resign' ? ' (resignation)' : '';
    let body = `${typeTxt}<b>${escapeHTML(myName(g.winner))}</b> wins <b>${g.result.points}</b> point${g.result.points > 1 ? 's' : ''}${reason}.<br><br>` +
      `Score: <b>${escapeHTML(myName(W))} ${m.scores.W}</b> – <b>${m.scores.B} ${escapeHTML(myName(B))}</b>` + (m.target ? ` (match to ${m.target})` : '');
    const buttons = [];
    const taunt = tauntFor(myName(r.matchOver ? r.matchWinner : g.winner), m.gameNo * 7 + m.scores.W * 3 + m.scores.B + (r.matchOver ? 5 : 0));
    if (taunt) { body = `<div class="taunt">“${escapeHTML(taunt)}”<small>— ${escapeHTML(myName(r.matchOver ? r.matchWinner : g.winner))}</small></div>` + body; board.flashBanner(escapeHTML(taunt), escapeHTML(myName(g.winner)), 2400); }
    if (r.matchOver) {
      body = `🏆 <b>${escapeHTML(myName(r.matchWinner))}</b> wins the match ${m.scores.W}–${m.scores.B}!<br><br>` + body;
      buttons.push({ label: 'Rematch', cls: 'primary', cb: () => startNextGame(true) });
    } else buttons.push({ label: 'Next game', cls: 'primary', cb: () => startNextGame(false) });
    buttons.push({ label: 'Back to menu', cb: leaveToMenu });
    setTimeout(() => showModal(r.matchOver ? 'Match over' : 'Game over', body, buttons), 600);
    localStorage.removeItem('bg.session');
  }
  function startNextGame(rematch) {
    if (!isAuthority()) { netSend({ t: 'action', a: 'newgame', rematch }); toast('Asking host to start the next game…'); return; }
    if (rematch) { S.match.scores = { W: 0, B: 0 }; S.match.history = []; S.match.crawfordGame = false; S.match.crawfordPlayed = false; S.match.gameNo = 0; }
    S.game = BG.newGame(S.match); S.gameOverShown = false; S.selected = null; S.busy = false; lastAnnounced = null;
    board.setLastMove(null);
    broadcastState();
    tick();
  }

  // ---------------- fullscreen (hides the browser's URL bar) ----------------
  function fsSupported() { const d = document.documentElement; return !!(d.requestFullscreen || d.webkitRequestFullscreen); }
  function enterFullscreen() {
    const d = document.documentElement; const req = d.requestFullscreen || d.webkitRequestFullscreen; if (!req) return;
    try { const r = req.call(d, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); } catch (_) {}
  }
  function exitFullscreen() { const ex = document.exitFullscreen || document.webkitExitFullscreen; if (ex && (document.fullscreenElement || document.webkitFullscreenElement)) try { ex.call(document); } catch (_) {} }
  function toggleFullscreen() { if (document.fullscreenElement || document.webkitFullscreenElement) exitFullscreen(); else enterFullscreen(); }
  // On phones, go fullscreen when a game starts (this runs inside the Start button's tap, which browsers
  // require). iOS Safari has no fullscreen API for pages — install to the home screen there instead.
  const isTouchPhone = matchMedia('(pointer: coarse)').matches && !matchMedia('(display-mode: standalone)').matches;
  function autoFullscreen() { if (settings.fullscreen !== false && isTouchPhone) enterFullscreen(); }

  // ---------------- game menu ----------------
  $('game-menu').addEventListener('click', () => {
    if (!S) return; beep('click');
    const m = S.match;
    const hist = m.history.length ? '<div class="history">' + m.history.map(h => `<div><span>Game ${h.game}</span><span>${escapeHTML(myName(h.winner))} +${h.points}${h.type !== 'single' ? ' (' + h.type + ')' : ''}</span></div>`).join('') + '</div>' : '<p>No games finished yet.</p>';
    const buttons = [];
    if (fsSupported()) buttons.push({ label: document.fullscreenElement ? 'Exit fullscreen' : '⛶ Fullscreen (hide browser bar)', cb: toggleFullscreen });
    const canResign = S.game.phase !== 'over' && S.game.phase !== 'opening' && (isLocalHuman(W) || isLocalHuman(B));
    if (canResign) buttons.push({ label: 'Resign this game', cls: 'danger', cb: confirmResign });
    buttons.push({ label: 'Leave game', cls: 'danger', cb: () => showModal('Leave game?', S.net ? 'Your opponent will be disconnected.' : 'You can resume a bot or local game later from the menu.', [{ label: 'Leave', cls: 'danger', cb: leaveToMenu }, { label: 'Stay' }]) });
    buttons.push({ label: 'Continue' });
    showModal('Match: ' + escapeHTML(myName(W)) + ' ' + m.scores.W + ' – ' + m.scores.B + ' ' + escapeHTML(myName(B)), hist, buttons);
  });
  function confirmResign() {
    const g = S.game;
    const side = S.mode === 'local' ? g.turn : (isLocalHuman(W) ? W : B);
    const cube = g.cube.value;
    showModal('Resign as ' + escapeHTML(myName(side)) + '?', 'Choose what to concede:', [
      { label: `Single game (${cube} pt)`, cls: 'danger', cb: () => doResign(side, 'single') },
      { label: `Gammon (${cube * 2} pts)`, cls: 'danger', cb: () => doResign(side, 'gammon') },
      { label: `Backgammon (${cube * 3} pts)`, cls: 'danger', cb: () => doResign(side, 'backgammon') },
      { label: 'Cancel' },
    ]);
  }
  function doResign(side, type) { BG.resign(S.game, side, type); netSend({ t: 'action', a: 'resign', side, type }); tickToken++; S.busy = false; tick(); }

  function leaveToMenu() {
    hideModal(); tickToken++;
    if (S && S.net) { try { S.net.send({ t: 'bye' }); } catch (_) {} setTimeout(() => S && S.net && S.net.close(), 200); localStorage.removeItem('bg.session'); }
    if (S && (S.mode === 'bot' || S.mode === 'local') && S.game.phase !== 'over') persist(true);
    S = null; $('conn').hidden = true;
    show('menu');
  }

  // ---------------- persistence of a running local/bot game ----------------
  function persist(force) {
    if (!S || S.net) return;
    if (S.game.phase === 'over') return;
    save('bg.session', { v: VERSION, mode: S.mode, level: S.level, match: S.match, game: JSON.parse(BG.serialize(S.game)), players: S.players, rotate: S.rotate, mySide: S.mySide });
  }
  $('btn-resume').addEventListener('click', () => {
    const d = load('bg.session'); if (!d) return;
    S = { mode: d.mode, level: d.level, match: d.match, game: d.game, players: d.players, rotate: d.rotate, net: null, isHost: true, busy: false, selected: null, mySide: d.mySide || W, gameOverShown: false };
    S.game._plays = null;
    if (S.game.phase === 'double') { /* re-ask */ }
    show('game'); lastAnnounced = null; tick();
  });

  // ---------------- start modes ----------------
  function nameOr(v, d) { v = (v || '').trim(); return v || d; }
  $('bot-start').addEventListener('click', () => {
    const me = nameOr($('bot-name').value, 'You'); settings.names.me = me; saveSettings();
    const level = segVal('bot-level'); const color = segVal('bot-color');
    const botName = { easy: 'Bot (Easy)', medium: 'Bot (Medium)', hard: 'Bot (Hard)' }[level];
    const players = color === W ? { W: { name: me, type: 'human' }, B: { name: botName, type: 'bot' } } : { W: { name: botName, type: 'bot' }, B: { name: me, type: 'human' } };
    newSession({ mode: 'bot', level, target: +segVal('bot-target'), cube: $('bot-cube').checked, players, mySide: color });
    show('game'); lastAnnounced = null; tick();
  });
  $('local-start').addEventListener('click', () => {
    const w = nameOr($('local-w').value, 'Player 1'), b = nameOr($('local-b').value, 'Player 2');
    settings.names.w = w; settings.names.b = b; saveSettings();
    newSession({ mode: 'local', target: +segVal('local-target'), cube: $('local-cube').checked, rotate: $('local-rotate').checked,
      players: { W: { name: w, type: 'human' }, B: { name: b, type: 'human' } }, mySide: W });
    show('game'); lastAnnounced = null; tick();
  });

  // ---------------- networking (shared by online & nearby) ----------------
  // Guest sends actions to the host; the host answers every action (its own included) with a full state snapshot.
  function netSend(msg) {
    if (!S || !S.net || !S.net.connected) return;
    if (S.isHost) { broadcastState(); return; }
    S.net.send(msg);
  }
  function ensureRecorded() {
    const g = S.game;
    if (g.phase === 'over' && !g.recorded) { g.recorded = true; g.matchResult = BG.recordResult(S.match, g); }
    return g.matchResult;
  }
  function broadcastState() {
    if (!S || !S.net || !S.isHost || !S.net.connected) return;
    ensureRecorded();
    S.net.send({ t: 'state', game: BG.serialize(S.game), match: S.match });
  }
  function attachNet(net, isHost, cfg) {
    // cfg: {myName, target, cube}
    net.onmessage = msg => handleNet(msg, net);
    net.onclose = reason => {
      if (!S || S.net !== net) return;
      $('conn').textContent = '⚠ ' + reason; $('conn').hidden = false;
      if (!modalOpen) showModal('Connection lost', escapeHTML(reason) + '.<br>The game cannot continue without your opponent.', [{ label: 'Back to menu', cls: 'primary', cb: leaveToMenu }, { label: 'Stay on this screen' }]);
    };
    if (isHost) {
      // wait for hello
    } else {
      net.send({ t: 'hello', name: cfg.myName, v: VERSION });
    }
  }
  function handleNet(msg, net) {
    if (!msg || typeof msg !== 'object') return;
    if (S && S.net !== net) return;
    switch (msg.t) {
      case 'hello': { // host receives guest's name -> start session
        if (!S || !S.isHost || !S.pending) return;
        const cfg = S.pending; delete S.pending;
        const guestName = String(msg.name || 'Guest').slice(0, 16);
        const players = { W: { name: cfg.myName, type: 'human' }, B: { name: guestName, type: 'remote' } };
        S.match = BG.newMatch({ target: cfg.target, cubeEnabled: cfg.cube, nameW: cfg.myName, nameB: guestName });
        S.players = players; S.game = BG.newGame(S.match); S.mySide = W;
        net.send({ t: 'welcome', side: B, players, match: S.match, game: BG.serialize(S.game), v: VERSION });
        show('game'); lastAnnounced = null; toast(guestName + ' joined!'); tick();
        break;
      }
      case 'welcome': { // guest gets initial state
        S.players = msg.players; S.match = msg.match; S.game = BG.deserialize(msg.game); S.mySide = msg.side;
        S.players[S.mySide].type = 'human'; S.players[BG.other(S.mySide)].type = 'remote';
        show('game'); lastAnnounced = null; tick();
        break;
      }
      case 'state': {
        if (!S || S.isHost) return;
        applyRemoteState(msg);
        break;
      }
      case 'action': {
        if (!S || !S.isHost) return;
        hostApplyAction(msg);
        break;
      }
      case 'bye': {
        $('conn').textContent = 'Opponent left the game'; $('conn').hidden = false;
        showModal('Opponent left', 'Your opponent has left the game.', [{ label: 'Back to menu', cb: leaveToMenu }]);
        break;
      }
    }
  }
  function hostApplyAction(msg) {
    const g = S.game, guest = BG.other(S.mySide);
    try {
      switch (msg.a) {
        case 'roll': if (g.phase === 'roll' && g.turn === guest) { tickToken++; doRoll(); return; } break;
        case 'openroll': if (g.phase === 'opening' && !g.opening[guest]) { applyOpeningRoll(guest); return; } break;
        case 'move': if (g.phase === 'move' && g.turn === guest) { const m = BG.move(g, msg.from, msg.to, msg.die); board.animateMove(guest, m.from, m.to, m.hit).then(() => { render(); beep(m.hit ? 'hit' : 'click'); if (g.phase === 'over') tick(); }); } break;
        case 'undo': if (g.phase === 'move' && g.turn === guest) BG.undo(g); break;
        case 'end': if (g.phase === 'move' && g.turn === guest && BG.canEndTurn(g)) { BG.endTurn(g); lastAnnounced = null; broadcastState(); tick(); return; } break;
        case 'double': if (g.turn === guest && BG.canDouble(g, guest)) { BG.offerDouble(g); broadcastState(); tick(); return; } break;
        case 'take': if (g.phase === 'double' && g.turn === S.mySide) { BG.acceptDouble(g); hideModal(); lastAnnounced = null; board.flashBanner(escapeHTML(myName(guest)) + ' takes', 'Cube is now ' + g.cube.value, 1300); broadcastState(); tick(); return; } break;
        case 'pass': if (g.phase === 'double' && g.turn === S.mySide) { BG.declineDouble(g); broadcastState(); tick(); return; } break;
        case 'resign': if (g.phase !== 'over') { BG.resign(g, guest, msg.type || 'single'); tickToken++; S.busy = false; broadcastState(); tick(); return; } break;
        case 'newgame': if (g.phase === 'over') { hideModal(); startNextGame(!!msg.rematch); return; } break;
      }
    } catch (e) { console.warn('rejected guest action', msg, e); }
    broadcastState(); render();
  }
  function applyRemoteState(msg) {
    const prev = S.game;
    const g = BG.deserialize(msg.game);
    S.match = msg.match;
    const la = g.lastAction;
    const remote = BG.other(S.mySide);
    S.busy = false; S.selected = null;
    const newGame = prev && g.phase === 'opening' && prev.phase !== 'opening';
    if (newGame) { S.gameOverShown = false; hideModal(); }
    // animate remote move
    if (la && la.type === 'move' && la.player === remote && prev && prev.phase !== 'over') {
      S.game = prev; board.render(prev);
      board.animateMove(remote, la.move.from, la.move.to, la.move.hit).then(() => { S.game = g; beep(la.move.hit ? 'hit' : 'click'); tick(); });
      return;
    }
    if (la && la.type === 'roll' && la.player === remote) beep('dice');
    if (la && la.type === 'roll' && la.player === S.mySide) { beep('dice'); S.game = g; render({ rollAnim: true }); setTimeout(tick, 100); return; }
    if (la && la.type === 'opening-die') { beep('dice'); S.game = g; render(); $('dice').innerHTML = UI.openingDiceHTML(g.opening.W, g.opening.B, la.player); return; }
    if (la && la.type === 'opening' && prev && prev.phase === 'opening') { beep('dice'); S.game = g; render(); $('dice').innerHTML = UI.openingDiceHTML(la.W, la.B, la.first); board.flashBanner(escapeHTML(g.turn === S.mySide ? 'You start' : myName(g.turn) + ' starts'), `${la.W} – ${la.B}`, 1600); S.busy = true; setTimeout(() => { if (S && S.game === g) { S.busy = false; tick(); } }, speedMs(1400)); return; }
    if (la && la.type === 'opening-tie') { beep('dice'); S.game = g; render(); $('dice').innerHTML = UI.openingDiceHTML(la.W, la.B); board.flashBanner('Tie! Roll again', `${la.W} – ${la.B}`, 1200); return; }
    if (la && la.type === 'double' && la.player === remote) beep('alert');
    if (la && la.type === 'take' && la.player === remote) board.flashBanner(escapeHTML(myName(remote)) + ' takes', 'Cube is now ' + g.cube.value, 1300);
    if (la && la.type === 'endturn') lastAnnounced = null;
    S.game = g;
    if (g.phase !== 'double') hideModalIfTake();
    tick();
  }
  function hideModalIfTake() { if (modalOpen && $('modal-title').textContent.includes('doubles')) hideModal(); }

  // ---------------- online (PeerJS) ----------------
  let pendingNet = null;
  $('online-create').addEventListener('click', async () => {
    const me = nameOr($('online-name').value, 'Host'); settings.names.me = me; saveSettings();
    const net = new Net.PeerTransport(); pendingNet = net;
    show('wait'); $('wait-code').textContent = '······'; $('wait-status').textContent = 'Connecting to matchmaking service…'; $('wait-qr').innerHTML = '';
    net.onstatus = s => {
      if (s === 'waiting') $('wait-status').innerHTML = 'Share this code. Waiting for your opponent to join…' + (net.hasTurn ? '' : '<br><small>⚠ No relay (TURN) server configured — two phones on mobile data may fail to connect. See js/config.js.</small>');
      if (s === 'connected') $('wait-status').textContent = 'Opponent connected!';
    };
    try {
      const code = await net.host();
      $('wait-code').textContent = code;
      const link = location.origin + location.pathname + '?join=' + code;
      $('wait-share').onclick = () => shareText('Join my backgammon game', link);
      try { new QRCode($('wait-qr'), { text: link, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M }); } catch (_) {}
      S = { mode: 'online', net, isHost: true, pending: { myName: me, target: +segVal('online-target'), cube: $('online-cube').checked }, busy: false, selected: null, players: { W: { name: me, type: 'human' }, B: { name: '…', type: 'remote' } }, match: BG.newMatch({ nameW: me }), game: null, mySide: W, gameOverShown: false };
      S.game = BG.newGame(S.match);
      attachNet(net, true);
    } catch (e) { showModal('Could not create room', escapeHTML(e.message), [{ label: 'OK', cb: () => show('online') }]); net.close(); }
  });
  $('wait-cancel').addEventListener('click', () => { if (pendingNet) pendingNet.close(); pendingNet = null; S = null; show('online'); });
  $('online-join').addEventListener('click', () => joinOnline($('online-code').value));
  async function joinOnline(codeRaw) {
    const code = (codeRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { toast('Enter the 6-character room code'); return; }
    const me = nameOr($('online-name').value, 'Guest'); settings.names.me = me; saveSettings();
    const net = new Net.PeerTransport(); pendingNet = net;
    show('wait'); $('wait-code').textContent = code; $('wait-qr').innerHTML = ''; $('wait-status').textContent = 'Contacting matchmaking server…'; $('wait-share').onclick = null;
    net.onstatus = s => {
      const el = $('wait-status');
      if (s === 'negotiating') el.textContent = 'Found the server — looking for the room…';
      else if (s === 'ice:checking') el.textContent = 'Room found! Connecting the two phones… (can take up to 30 s)';
      else if (s === 'ice:connected' || s === 'ice:completed') el.textContent = 'Connected! Starting…';
      else if (s === 'ice:failed') el.textContent = 'Direct connection failed…';
    };
    try {
      S = { mode: 'online', net, isHost: false, busy: false, selected: null, players: { W: { name: '…', type: 'remote' }, B: { name: me, type: 'human' } }, match: BG.newMatch(), game: null, mySide: B, gameOverShown: false };
      S.game = BG.newGame(S.match);
      await net.join(code);
      attachNet(net, false, { myName: me });
      $('wait-status').textContent = 'Connected! Starting…';
    } catch (e) { showModal('Could not join', escapeHTML(e.message), [{ label: 'OK', cb: () => show('online') }]); net.close(); S = null; }
  }
  function shareText(title, text) {
    if (navigator.share) navigator.share({ title, text, url: text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Link copied')).catch(() => toast(text, 5000));
    else toast(text, 6000);
  }

  // ---------------- nearby (manual WebRTC over hotspot) ----------------
  let rtc = null, scanner = null, pairRole = null;
  function showQR(el, text) { el.innerHTML = ''; try { new QRCode(el, { text: text.replace(/-/g, ''), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { el.textContent = ''; } }
  function showMyCode(code, label) {
    S.myCode = code;
    showQR($('pair-qr'), code);
    const plain = code.replace(/-/g, '');
    $('pair-code').textContent = code; $('pair-code-len').textContent = plain.length;
    $('pair-code-label').textContent = label || 'My code';
    $('pair-code-wrap').hidden = false;
  }
  // Watch the WebRTC connection while pairing and explain what is happening / what went wrong.
  function watchPairing() {
    const pc = rtc && rtc.pc; if (!pc) return;
    const el = $('pair-status');
    const started = Date.now();
    const upd = () => {
      if (!rtc || rtc.pc !== pc) return;
      const st = pc.iceConnectionState;
      if (st === 'checking') el.textContent = '🔄 Codes exchanged — connecting the two phones… (usually a few seconds)';
      else if (st === 'connected' || st === 'completed') el.textContent = 'Connected!';
      else if (st === 'failed' || (st === 'disconnected' && Date.now() - started > 8000)) {
        el.innerHTML = '⚠ The phones could not reach each other. Check that <b>both are on the same Wi-Fi / hotspot</b> (the phone that is NOT hosting the hotspot must be joined to it), then go back and pair again. If it keeps failing, both phones should grant camera permission — that lets the browser share its real Wi-Fi address.';
        beep('alert');
      }
    };
    pc.addEventListener('iceconnectionstatechange', upd); upd();
    // if nothing happens for 25 s after both codes are in, say so
    setTimeout(() => { if (rtc && rtc.pc === pc && !rtc.connected && ['new', 'checking'].includes(pc.iceConnectionState)) el.innerHTML = '⚠ Still connecting… Make sure both phones are on the <b>same</b> hotspot / Wi-Fi and that neither has a VPN on. You can go back and try again.'; }, 25000);
  }
  function copyText(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(msg || 'Copied')).catch(() => fallbackCopy(text, msg));
    else fallbackCopy(text, msg);
  }
  function fallbackCopy(text, msg) {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(msg || 'Copied'); }
    catch (_) { toast('Long-press the code to copy it', 3000); }
  }
  async function ensureCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      const s = await Promise.race([navigator.mediaDevices.getUserMedia({ video: true }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      s.getTracks().forEach(t => t.stop()); return true;
    } catch (_) { return false; }
  }
  function resetPairScreen(title, instr) {
    $('pair-title').textContent = title; $('pair-instr').innerHTML = instr; $('pair-status').textContent = '';
    $('pair-qr').innerHTML = ''; $('pair-code-wrap').hidden = true; $('pair-code').textContent = ''; $('pair-scan').hidden = true;
    $('pair-paste').value = ''; $('pair-paste-details').open = false; $('pair-paste-details').hidden = false; $('pair-scan-btn').hidden = false;
  }
  $('nearby-host').addEventListener('click', async () => {
    const me = nameOr($('nearby-name').value, 'Host'); settings.names.me = me; saveSettings();
    pairRole = 'host'; rtc = new Net.LocalRTC(); show('pair');
    resetPairScreen('Host · Step 1 of 2', 'Both phones on the same Wi-Fi / hotspot (no internet needed).<br>1️⃣ Give the other phone this <b>HOST CODE</b> — let them scan the QR, or Copy/Share it, or read it out.<br>2️⃣ Their phone then shows a <b>REPLY CODE</b>: scan it or type it below.');
    $('pair-status').textContent = 'Preparing your code…';
    await ensureCamera(); // permission also unlocks real local IP candidates (shorter code, more reliable)
    try {
      S = { mode: 'nearby', net: rtc, isHost: true, pending: { myName: me, target: +segVal('nearby-target'), cube: $('nearby-cube').checked }, busy: false, selected: null, players: { W: { name: me, type: 'human' }, B: { name: '…', type: 'remote' } }, match: BG.newMatch({ nameW: me }), game: null, mySide: W, gameOverShown: false };
      S.game = BG.newGame(S.match);
      const offer = await rtc.createOffer();
      showMyCode(offer, 'HOST CODE');
      $('pair-status').textContent = 'Waiting for the other phone\'s reply code…';
      rtc.onopen = () => { $('pair-status').textContent = 'Connected!'; stopScan(); attachNet(rtc, true); };
      rtc.onclose = r => $('pair-status').textContent = '⚠ ' + r;
    } catch (e) { $('pair-status').textContent = 'Error: ' + e.message; }
  });
  $('nearby-join').addEventListener('click', async () => {
    const me = nameOr($('nearby-name').value, 'Guest'); settings.names.me = me; saveSettings();
    pairRole = 'join'; rtc = new Net.LocalRTC(); show('pair');
    resetPairScreen('Join · Step 1 of 2', '1️⃣ Enter the <b>HOST CODE</b> from the other phone: scan their QR, or type/paste it below.<br>2️⃣ Your <b>REPLY CODE</b> will appear — give it back to the host the same way.');
    S = { mode: 'nearby', net: rtc, isHost: false, busy: false, selected: null, players: { W: { name: '…', type: 'remote' }, B: { name: me, type: 'human' } }, match: BG.newMatch(), game: null, mySide: B, gameOverShown: false, myName: me };
    S.game = BG.newGame(S.match);
    $('pair-paste-details').open = true;
    await ensureCamera();
    startScan();
  });
  async function onPairCode(text) {
    text = (text || '').trim();
    if (!text) return;
    try {
      if (pairRole === 'host') {
        $('pair-status').textContent = 'Reply code accepted — connecting…';
        $('pair-paste-details').open = false; stopScan();
        await rtc.acceptAnswer(text);
        $('pair-title').textContent = 'Host · Connecting';
        watchPairing();
      } else {
        $('pair-status').textContent = 'Host code accepted — creating your reply code…';
        const answer = await rtc.createAnswer(text);
        $('pair-title').textContent = 'Join · Step 2 of 2';
        $('pair-instr').innerHTML = '✅ Host code accepted. Now give this <b>REPLY CODE</b> back to the host: they scan this QR, or you Copy/Share it, or read it out. The game starts on both phones as soon as they enter it.';
        showMyCode(answer, 'REPLY CODE');
        $('pair-scan-btn').hidden = true;
        $('pair-paste-details').hidden = true;
        $('pair-status').textContent = 'Waiting for the host to enter your reply code…';
        rtc.onopen = () => { $('pair-status').textContent = 'Connected!'; attachNet(rtc, false, { myName: S.myName }); };
        rtc.onclose = r => $('pair-status').textContent = '⚠ ' + r;
        watchPairing();
      }
    } catch (e) { $('pair-status').textContent = '⚠ ' + e.message; beep('alert'); }
  }
  function startScan() {
    if (!scanner) scanner = new Net.QRScanner($('pair-video'), $('pair-canvas'));
    $('pair-scan').hidden = false; $('pair-status').textContent = 'Point the camera at the other phone\'s QR code…';
    scanner.start(code => { $('pair-scan').hidden = true; beep('click'); onPairCode(code); }).catch(e => {
      $('pair-scan').hidden = true;
      const denied = /NotAllowed|Permission|denied|dismissed/i.test(e.name + ' ' + e.message);
      $('pair-paste-details').open = true;
      $('pair-status').innerHTML = denied
        ? 'No camera permission — no problem: <b>type or paste their code</b> below instead. (If the browser said it <b>can\'t ask for permission</b>, close floating bubbles/overlays from other apps and tap Scan again.)'
        : 'Camera unavailable — type or paste their code below instead.';
    });
  }
  function stopScan() { if (scanner) scanner.stop(); $('pair-scan').hidden = true; }
  $('pair-scan-btn').addEventListener('click', startScan);
  $('pair-copy-btn').addEventListener('click', () => { if (!S || !S.myCode) { toast('No code yet'); return; } copyText(S.myCode, 'Code copied — send it any way you like'); });
  $('pair-code').addEventListener('click', () => { if (S && S.myCode) copyText(S.myCode, 'Code copied'); });
  $('pair-share-btn').addEventListener('click', () => {
    if (!S || !S.myCode) { toast('No code yet'); return; }
    if (navigator.share) navigator.share({ title: 'Backgammon pairing code', text: 'Backgammon pairing code:\n' + S.myCode }).catch(() => {});
    else copyText(S.myCode, 'Sharing not available here — code copied instead');
  });
  $('pair-paste-btn').addEventListener('click', () => { const v = $('pair-paste').value.trim(); if (v) onPairCode(v); });
  $('pair-paste').addEventListener('input', () => {
    // auto-submit when a complete-looking code has been pasted/typed (checksum decides)
    const v = $('pair-paste').value; const plain = v.replace(/[^0-9A-Za-z]/g, '');
    if (plain.length >= 64 && /\n$/.test(v)) { $('pair-paste').value = v.trim(); onPairCode(v); }
  });
  $('pair-cancel').addEventListener('click', () => { stopScan(); if (rtc) rtc.close(); rtc = null; S = null; show('nearby'); });

  // ---------------- settings ----------------
  for (const [id, key] of [['set-sound', 'sound'], ['set-vibrate', 'vibrate'], ['set-hints', 'hints'], ['set-autodone', 'autodone'], ['set-pips', 'pips'], ['set-fullscreen', 'fullscreen']]) {
    $(id).checked = !!settings[key];
    $(id).addEventListener('change', () => { settings[key] = $(id).checked; saveSettings(); if (S) render(); });
  }
  document.querySelectorAll('#set-speed button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.speed));
  if (settings.names.me) { $('bot-name').value = settings.names.me; $('online-name').value = settings.names.me; $('nearby-name').value = settings.names.me; }
  if (settings.names.w) $('local-w').value = settings.names.w;
  if (settings.names.b) $('local-b').value = settings.names.b;

  // keyboard shortcuts (desktop)
  document.addEventListener('keydown', e => {
    if (!S || modalOpen) return;
    if (e.key === 'r' || e.key === ' ') { if (!$('btn-roll').hidden) $('btn-roll').click(); else if (!$('btn-done').hidden && !$('btn-done').disabled) $('btn-done').click(); }
    if (e.key === 'u' || e.key === 'z') { if (!$('btn-undo').hidden) $('btn-undo').click(); }
    if (e.key === 'd') { if (!$('btn-double').hidden) $('btn-double').click(); }
  });

  // deep link ?join=CODE
  const params = new URLSearchParams(location.search);
  if (params.get('join')) { $('online-code').value = params.get('join').toUpperCase(); show('online'); history.replaceState(null, '', location.pathname); }
  else show('menu');

  // unlock audio on first interaction
  document.addEventListener('pointerdown', () => { if (settings.sound && !actx) beep('none'); }, { once: true });

  // PWA
  // ---------------- updates / cache busting ----------------
  // Assets carry ?v=N (see index.html) and the service worker revalidates with the server, so a new
  // deploy is picked up on the next load. On top of that we poll version.json: when a newer version is
  // live we reload automatically while on the menu, or offer a one-tap update during a game.
  let swReg = null, updateOffered = false;
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !params.has('nosw')) {
    navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; if (!S) location.reload(); });
  }
  async function applyUpdateCheck() {
    try {
      const res = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const { v } = await res.json();
      if (!v || v === window.APP_VERSION) return;
      if (swReg) swReg.update().catch(() => {});
      const onMenu = !S && document.querySelector('.screen.active').id === 'screen-menu';
      if (onMenu) { location.reload(); return; }
      if (updateOffered) return; updateOffered = true;
      const t = $('toast'); t.innerHTML = '🆕 New version available — <b>tap to update</b>'; t.hidden = false; t.style.cursor = 'pointer';
      t.onclick = () => { t.hidden = true; location.reload(); };
      clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; t.onclick = null; t.style.cursor = ''; }, 8000);
    } catch (_) {}
  }
  setTimeout(applyUpdateCheck, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyUpdateCheck(); });
  setInterval(applyUpdateCheck, 15 * 60 * 1000);

  // expose for debugging/testing
  window.BGApp = { get session() { return S; }, tick, render, tryMove, doEndTurn, newSession, show, settings };
})();
