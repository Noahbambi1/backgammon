/* Backgammon rules engine — pure, deterministic, JSON-serializable state.
 * Works in browser (window.BG) and Node (module.exports).
 *
 * Board convention:
 *   points[0..23]: positive = White checkers, negative = Black checkers.
 *   White moves 23 -> 0 and bears off past 0 (home board = points 0..5).
 *   Black moves 0 -> 23 and bears off past 23 (home board = points 18..23).
 *   bar.W / bar.B and off.W / off.B hold counts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 'W', B = 'B';
  const other = p => (p === W ? B : W);
  const sign = p => (p === W ? 1 : -1);

  function initialPoints() {
    const pts = new Array(24).fill(0);
    // White (moves toward 0)
    pts[23] = 2; pts[12] = 5; pts[7] = 3; pts[5] = 5;
    // Black (moves toward 23)
    pts[0] = -2; pts[11] = -5; pts[16] = -3; pts[18] = -5;
    return pts;
  }

  function newMatch(opts) {
    opts = opts || {};
    return {
      target: opts.target || 0,          // 0 = money game / unlimited
      crawford: opts.crawford !== false,  // Crawford rule for match play
      scores: { W: 0, B: 0 },
      names: { W: opts.nameW || 'White', B: opts.nameB || 'Black' },
      crawfordGame: false,               // current game is the Crawford game
      crawfordPlayed: false,
      history: [],                       // {winner, points, type, cube}
      gameNo: 0,
      cubeEnabled: opts.cubeEnabled !== false,
    };
  }

  function newGame(match, rng) {
    rng = rng || Math.random;
    match.gameNo++;
    // Crawford handling
    if (match.target > 0 && match.crawford) {
      const oneAway = (match.scores.W === match.target - 1) || (match.scores.B === match.target - 1);
      if (oneAway && !match.crawfordPlayed) {
        match.crawfordGame = true;
        match.crawfordPlayed = true;
      } else {
        match.crawfordGame = false;
      }
    }
    const g = {
      points: initialPoints(),
      bar: { W: 0, B: 0 },
      off: { W: 0, B: 0 },
      turn: null,
      phase: 'opening',      // opening | roll | move | double | over
      dice: [0, 0],
      remaining: [],
      moves: [],             // moves made this turn
      turnStart: null,       // snapshot {points,bar,off} at start of move phase
      cube: { value: 1, owner: null },
      cubeEnabled: match.cubeEnabled && !match.crawfordGame,
      opening: { W: 0, B: 0, ties: 0 },
      winner: null,
      result: null,          // {points, type, reason}
      lastAction: null,
    };
    return g;
  }

  // ---------- helpers ----------
  function snapshot(g) {
    return { points: g.points.slice(), bar: { W: g.bar.W, B: g.bar.B }, off: { W: g.off.W, B: g.off.B } };
  }
  function restore(g, s) {
    g.points = s.points.slice(); g.bar = { W: s.bar.W, B: s.bar.B }; g.off = { W: s.off.W, B: s.off.B };
  }
  function cloneBoard(b) {
    return { points: b.points.slice(), bar: { W: b.bar.W, B: b.bar.B }, off: { W: b.off.W, B: b.off.B } };
  }
  function countAt(b, p, pt) { const v = b.points[pt]; return sign(p) * v > 0 ? Math.abs(v) : 0; }
  function isBlocked(b, p, pt) { const v = b.points[pt]; return sign(p) * v < -1; } // opponent has 2+
  function entryPoint(p, die) { return p === W ? 24 - die : die - 1; }
  function homeRange(p) { return p === W ? [0, 5] : [18, 23]; }

  function allHome(b, p) {
    if (b.bar[p] > 0) return false;
    const [lo, hi] = homeRange(p);
    for (let i = 0; i < 24; i++) {
      if (i >= lo && i <= hi) continue;
      if (countAt(b, p, i) > 0) return false;
    }
    return true;
  }

  function pipCount(b, p) {
    let pips = b.bar[p] * 25;
    for (let i = 0; i < 24; i++) {
      const c = countAt(b, p, i);
      if (c) pips += c * (p === W ? i + 1 : 24 - i);
    }
    return pips;
  }

  // Legal single moves for player p with die d on board b
  function singleMoves(b, p, d) {
    const res = [];
    if (b.bar[p] > 0) {
      const to = entryPoint(p, d);
      if (!isBlocked(b, p, to)) res.push({ from: 'bar', to, die: d, hit: countAt(b, other(p), to) === 1 });
      return res;
    }
    const dir = p === W ? -1 : 1;
    const home = allHome(b, p);
    for (let i = 0; i < 24; i++) {
      if (countAt(b, p, i) === 0) continue;
      const to = i + dir * d;
      if (to >= 0 && to <= 23) {
        if (!isBlocked(b, p, to)) res.push({ from: i, to, die: d, hit: countAt(b, other(p), to) === 1 });
      } else if (home) {
        const dist = p === W ? i + 1 : 24 - i; // pips to bear off exactly
        if (d === dist) res.push({ from: i, to: 'off', die: d, hit: false });
        else if (d > dist) {
          // allowed only if no checker farther from off
          let farther = false;
          if (p === W) { for (let j = i + 1; j <= 5; j++) if (countAt(b, p, j)) { farther = true; break; } }
          else { for (let j = i - 1; j >= 18; j--) if (countAt(b, p, j)) { farther = true; break; } }
          if (!farther) res.push({ from: i, to: 'off', die: d, hit: false });
        }
      }
    }
    return res;
  }

  function applyMove(b, p, m) {
    const s = sign(p);
    if (m.from === 'bar') b.bar[p]--; else b.points[m.from] -= s;
    if (m.to === 'off') { b.off[p]++; return; }
    if (m.hit) { b.points[m.to] = 0; b.bar[other(p)]++; }
    b.points[m.to] += s;
  }

  // All legal complete plays for dice. Returns array of {moves:[], board}
  function legalPlays(b, p, dice) {
    const d1 = dice[0], d2 = dice[1];
    const seqs = d1 === d2 ? [[d1, d1, d1, d1]] : [[d1, d2], [d2, d1]];
    let plays = [];
    let maxLen = 0;
    function rec(board, seq, idx, moves) {
      if (idx === seq.length) { record(moves, board); return; }
      const ms = singleMoves(board, p, seq[idx]);
      if (ms.length === 0) { record(moves, board); return; }
      for (const m of ms) {
        const nb = cloneBoard(board);
        applyMove(nb, p, m);
        rec(nb, seq, idx + 1, moves.concat([m]));
      }
    }
    function record(moves, board) {
      if (moves.length > maxLen) maxLen = moves.length;
      plays.push({ moves, board });
    }
    for (const seq of seqs) rec(cloneBoard(b), seq, 0, []);
    plays = plays.filter(pl => pl.moves.length === maxLen);
    if (maxLen === 1 && d1 !== d2) {
      const hi = Math.max(d1, d2);
      const withHi = plays.filter(pl => pl.moves[0].die === hi);
      if (withHi.length) plays = withHi;
    }
    if (maxLen === 0) return [];
    // de-duplicate identical move sequences (from different seq orderings that coincide)
    const seen = new Set();
    const out = [];
    for (const pl of plays) {
      const k = pl.moves.map(m => m.from + '>' + m.to + ':' + m.die).join(',');
      if (!seen.has(k)) { seen.add(k); out.push(pl); }
    }
    return out;
  }

  // Unique plays by resulting board (for AI)
  function uniquePlays(plays) {
    const seen = new Map();
    for (const pl of plays) {
      const k = boardKey(pl.board);
      if (!seen.has(k)) seen.set(k, pl);
    }
    return Array.from(seen.values());
  }
  function boardKey(b) { return b.points.join(',') + '|' + b.bar.W + ',' + b.bar.B + '|' + b.off.W + ',' + b.off.B; }

  // ---------- game flow ----------
  function rollDie(rng) { return 1 + Math.floor((rng || Math.random)() * 6); }

  // Opening: each player rolls one die; higher starts and plays both dice. Ties re-roll.
  function openingRoll(g, rng) {
    if (g.phase !== 'opening') throw new Error('not opening');
    g.opening.W = 0; g.opening.B = 0;
    openingRollFor(g, W, rng); openingRollFor(g, B, rng);
    return g;
  }
  function openingRollFor(g, side, rng) {
    if (g.phase !== 'opening') throw new Error('not opening');
    if (g.opening[side]) return g; // already rolled
    g.opening[side] = rollDie(rng);
    g.lastAction = { type: 'opening-die', player: side, die: g.opening[side] };
    if (g.opening.W && g.opening.B) resolveOpening(g);
    return g;
  }
  function resolveOpening(g) {
    const a = g.opening.W, b = g.opening.B;
    if (a === b) { g.opening = { W: 0, B: 0, ties: g.opening.ties + 1 }; g.lastAction = { type: 'opening-tie', W: a, B: b }; return g; }
    g.turn = a > b ? W : B;
    g.dice = [a, b];
    startMovePhase(g);
    g.lastAction = { type: 'opening', W: a, B: b, first: g.turn };
    return g;
  }

  function startMovePhase(g) {
    g.phase = 'move';
    const [a, b] = g.dice;
    g.remaining = a === b ? [a, a, a, a] : [a, b];
    g.moves = [];
    g.turnStart = snapshot(g);
    g._plays = legalPlays(g, g.turn, g.dice);
    if (g._plays.length === 0) g.remaining = [];
  }

  function roll(g, rng) {
    if (g.phase !== 'roll') throw new Error('cannot roll now');
    g.dice = [rollDie(rng), rollDie(rng)];
    startMovePhase(g);
    g.lastAction = { type: 'roll', player: g.turn, dice: g.dice.slice() };
    return g;
  }

  // Plays consistent with moves made so far this turn
  function consistentPlays(g) {
    if (!g._plays) g._plays = legalPlays(g.turnStart || g, g.turn, g.dice);
    const done = g.moves;
    return g._plays.filter(pl => {
      if (pl.moves.length < done.length) return false;
      for (let i = 0; i < done.length; i++) {
        const a = pl.moves[i], b = done[i];
        if (a.from !== b.from || a.to !== b.to || a.die !== b.die) return false;
      }
      return true;
    });
  }

  // Next legal single moves from current partial state
  function legalNextMoves(g) {
    if (g.phase !== 'move') return [];
    const plays = consistentPlays(g);
    const n = g.moves.length;
    const seen = new Set(); const out = [];
    for (const pl of plays) {
      if (pl.moves.length > n) {
        const m = pl.moves[n];
        const k = m.from + '>' + m.to + ':' + m.die;
        if (!seen.has(k)) { seen.add(k); out.push(m); }
      }
    }
    return out;
  }

  // Multi-step moves of ONE checker: every destination reachable from `from` by playing 2+ consecutive
  // legal moves with the same checker (e.g. 8/13 with a 5 then 13/18 with another 5). Returns
  // { dest: [move, move, ...] } — the shortest chain per destination. Single-step moves are excluded.
  function chainMoves(g, from) {
    const out = {};
    if (g.phase !== 'move') return out;
    const maxSteps = g.remaining.length;
    const rec = (state, chain) => {
      if (chain.length >= maxSteps) return;
      const cur = chain.length ? chain[chain.length - 1].to : from;
      if (cur === 'off') return;
      for (const m of legalNextMoves(state)) {
        if (m.from !== cur) continue;
        const next = deserialize(serialize(state));
        move(next, m.from, m.to, m.die);
        const nc = chain.concat([m]);
        if (nc.length >= 2 && (!out[m.to] || out[m.to].length > nc.length)) out[m.to] = nc;
        rec(next, nc);
      }
    };
    rec(g, []);
    return out;
  }

  function canEndTurn(g) {
    if (g.phase !== 'move') return false;
    const plays = consistentPlays(g);
    if (plays.length === 0) return true; // no legal plays at all
    return plays.some(pl => pl.moves.length === g.moves.length);
  }

  function isTurnComplete(g) { return g.phase === 'move' && legalNextMoves(g).length === 0; }

  // Perform a move. from: 0..23|'bar', to: 0..23|'off'. die optional (auto-picked).
  function move(g, from, to, die) {
    if (g.phase !== 'move') throw new Error('not in move phase');
    const cands = legalNextMoves(g).filter(m => m.from === from && m.to === to && (die == null || m.die === die));
    if (!cands.length) throw new Error('illegal move');
    // prefer the smaller die when ambiguous (keeps bigger die for later)
    cands.sort((a, b) => a.die - b.die);
    const m = cands[0];
    applyMove(g, g.turn, m);
    g.moves.push(m);
    const idx = g.remaining.indexOf(m.die);
    if (idx >= 0) g.remaining.splice(idx, 1);
    g.lastAction = { type: 'move', player: g.turn, move: m };
    checkWin(g);
    return m;
  }

  // Apply a whole play (list of moves), used by AI and network
  function playMoves(g, moves) {
    for (const m of moves) move(g, m.from, m.to, m.die);
  }

  function undo(g) {
    if (g.phase !== 'move' || g.moves.length === 0) return false;
    const m = g.moves.pop();
    restore(g, g.turnStart);
    const ms = g.moves.slice(); g.moves = [];
    for (const mm of ms) { applyMove(g, g.turn, mm); g.moves.push(mm); }
    const [a, b] = g.dice;
    g.remaining = a === b ? [a, a, a, a] : [a, b];
    for (const mm of g.moves) { const i = g.remaining.indexOf(mm.die); if (i >= 0) g.remaining.splice(i, 1); }
    g.lastAction = { type: 'undo', player: g.turn, move: m };
    return true;
  }

  function endTurn(g) {
    if (g.phase !== 'move') throw new Error('not in move phase');
    if (!canEndTurn(g)) throw new Error('must play all possible dice');
    if (g.phase === 'over') return g;
    g.turn = other(g.turn);
    g.phase = 'roll';
    g.remaining = []; g.moves = []; g._plays = null;
    g.lastAction = { type: 'endturn', player: g.turn };
    return g;
  }

  function canDouble(g, p) {
    return g.phase === 'roll' && g.turn === p && g.cubeEnabled && g.cube.value < 64 &&
      (g.cube.owner === null || g.cube.owner === p);
  }
  function offerDouble(g) {
    if (!canDouble(g, g.turn)) throw new Error('cannot double');
    g.phase = 'double';
    g.lastAction = { type: 'double', player: g.turn, value: g.cube.value * 2 };
    return g;
  }
  function acceptDouble(g) {
    if (g.phase !== 'double') throw new Error('no double offered');
    g.cube.value *= 2; g.cube.owner = other(g.turn);
    g.phase = 'roll';
    g.lastAction = { type: 'take', player: other(g.turn), value: g.cube.value };
    return g;
  }
  function declineDouble(g) {
    if (g.phase !== 'double') throw new Error('no double offered');
    finish(g, g.turn, g.cube.value, 'single', 'pass');
    g.lastAction = { type: 'pass', player: other(g.turn) };
    return g;
  }
  function resign(g, p, type) {
    type = type || 'single';
    const mult = type === 'backgammon' ? 3 : type === 'gammon' ? 2 : 1;
    finish(g, other(p), g.cube.value * mult, type, 'resign');
    g.lastAction = { type: 'resign', player: p };
    return g;
  }

  function checkWin(g) {
    for (const p of [W, B]) {
      if (g.off[p] === 15) {
        const o = other(p);
        let type = 'single', mult = 1;
        if (g.off[o] === 0) {
          type = 'gammon'; mult = 2;
          const [lo, hi] = homeRange(p);
          let inWinnerHome = g.bar[o] > 0;
          for (let i = lo; i <= hi && !inWinnerHome; i++) if (countAt(g, o, i)) inWinnerHome = true;
          if (inWinnerHome) { type = 'backgammon'; mult = 3; }
        }
        finish(g, p, g.cube.value * mult, type, 'bearoff');
        return true;
      }
    }
    return false;
  }

  function finish(g, winner, points, type, reason) {
    g.phase = 'over'; g.winner = winner;
    g.result = { points, type, reason, cube: g.cube.value };
    g.remaining = [];
  }

  function recordResult(match, g) {
    if (g.phase !== 'over') return null;
    match.scores[g.winner] += g.result.points;
    match.history.push({ game: match.gameNo, winner: g.winner, points: g.result.points, type: g.result.type, reason: g.result.reason, cube: g.result.cube });
    const done = match.target > 0 && (match.scores.W >= match.target || match.scores.B >= match.target);
    return { matchOver: done, matchWinner: done ? (match.scores.W >= match.target ? W : B) : null };
  }

  // Strip transient caches for network transfer
  function serialize(g) { const c = Object.assign({}, g); delete c._plays; return JSON.stringify(c); }
  function deserialize(s) { const g = JSON.parse(s); g._plays = null; return g; }

  // Standardized description of a move for UI
  function pointLabel(p, pt) { // 1..24 from the mover's perspective
    if (pt === 'bar') return 'bar'; if (pt === 'off') return 'off';
    return String(p === W ? pt + 1 : 24 - pt);
  }
  function describeMove(p, m) { return pointLabel(p, m.from) + '/' + pointLabel(p, m.to) + (m.hit ? '*' : ''); }

  return {
    W, B, other, sign, newMatch, newGame, openingRoll, openingRollFor, roll, move, playMoves, undo, endTurn,
    legalNextMoves, legalPlays, uniquePlays, consistentPlays, canEndTurn, isTurnComplete, chainMoves,
    canDouble, offerDouble, acceptDouble, declineDouble, resign, recordResult,
    pipCount, allHome, countAt, cloneBoard, applyMove, singleMoves, boardKey,
    serialize, deserialize, describeMove, pointLabel, snapshot, entryPoint, homeRange, initialPoints,
  };
});
