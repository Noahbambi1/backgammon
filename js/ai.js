/* Backgammon bot: three levels.
 *  easy   – random legal play, never doubles, always takes.
 *  medium – 1-ply heuristic evaluation with a little noise; simple pip-count cube.
 *  hard   – 2-ply expectimax (best reply over all 21 opponent rolls) with a richer
 *           evaluator; equity-based cube decisions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BGAI = factory(root.BG);
})(typeof self !== 'undefined' ? self : this, function (BG) {
  'use strict';
  const W = 'W', B = 'B';
  const ROLLS = []; // 21 distinct rolls with probabilities
  for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push({ dice: [a, b], p: a === b ? 1 / 36 : 2 / 36 });

  // Probability a blot at `distance` pips from an opponent checker can be hit (approx direct/indirect shots)
  const HIT_PROB = [0, 11 / 36, 12 / 36, 14 / 36, 15 / 36, 15 / 36, 17 / 36, 6 / 36, 6 / 36, 5 / 36, 3 / 36, 2 / 36, 3 / 36, 0, 0, 1 / 36, 1 / 36, 0, 1 / 36, 0, 1 / 36, 0, 0, 0, 1 / 36];

  function isContact(b) {
    // contact exists if any white checker is "behind" any black checker
    let lastW = -1, firstB = 24; // white farthest back = highest index; black farthest back = lowest index
    if (b.bar.W) lastW = 24; if (b.bar.B) firstB = -1;
    for (let i = 0; i < 24; i++) { if (b.points[i] > 0) lastW = Math.max(lastW, i); if (b.points[i] < 0) firstB = Math.min(firstB, i); }
    return lastW > firstB;
  }

  // Evaluate board from perspective of player p (higher is better). Roughly scaled so that
  // ~ +/-100 is a big advantage.
  function evaluate(b, p, level) {
    const o = BG.other(p);
    if (b.off[p] === 15) return 1000;
    if (b.off[o] === 15) return -1000;
    const myPips = BG.pipCount(b, p), opPips = BG.pipCount(b, o);
    const contact = isContact(b);
    let score = 0;
    // race
    score += (opPips - myPips) * (contact ? 1.0 : 2.0);
    // bear-off progress
    score += (b.off[p] - b.off[o]) * 6;
    if (!contact) return score + (b.bar[o] - b.bar[p]) * 10;

    const s = BG.sign(p);
    // Bar checkers
    score -= b.bar[p] * 22; score += b.bar[o] * 22;

    if (level === 'medium') {
      // Simplified positional sense: count blots and made points only (no shot odds, primes, anchors)
      let blots = 0, made = 0;
      for (let i = 0; i < 24; i++) { const v = b.points[i] * s; if (v === 1) blots++; else if (v >= 2) made++; }
      return score - blots * 6 + made * 3;
    }

    // Blots exposure & points
    const myHome = BG.homeRange(p), opHome = BG.homeRange(o);
    let myHomePoints = 0, opHomePoints = 0, myBlotRisk = 0, opBlotRisk = 0, myAnchors = 0;
    let primeRun = 0, bestPrime = 0;
    for (let i = 0; i < 24; i++) {
      const v = b.points[i] * s; // positive = mine
      if (v >= 2) {
        primeRun++; bestPrime = Math.max(bestPrime, primeRun);
        if (i >= myHome[0] && i <= myHome[1]) myHomePoints++;
        if (i >= opHome[0] && i <= opHome[1]) myAnchors++;
        if (v > 4) score -= (v - 4) * 1.5; // stacking penalty
      } else primeRun = 0;
      if (v <= -2 && i >= opHome[0] && i <= opHome[1]) opHomePoints++;
      if (v === 1) myBlotRisk += blotRisk(b, p, i);
      if (v === -1) opBlotRisk += blotRisk(b, o, i);
    }
    score += myHomePoints * 7 - opHomePoints * 7;
    score += Math.max(0, bestPrime - 2) * 6;
    score += myAnchors > 0 ? 4 : 0;
    // A hit blot costs pips (distance already travelled) and tempo; cost scales with opp home strength
    score -= myBlotRisk * (14 + opHomePoints * 4);
    score += opBlotRisk * (14 + myHomePoints * 4) * (level === 'hard' ? 0.7 : 0.5);
    return score;
  }

  // Risk (probability) a blot of player p at point i is hit next roll, ignoring blocked paths (approx)
  function blotRisk(b, p, i) {
    const o = BG.other(p); const so = BG.sign(o);
    let risk = 0;
    // opponent checkers that could reach i
    if (b.bar[o]) { const d = o === W ? 24 - i : i + 1; if (d <= 6) risk = Math.max(risk, HIT_PROB[d]); }
    for (let j = 0; j < 24; j++) {
      if (b.points[j] * so > 0) {
        const d = o === W ? j - i : i - j;
        if (d > 0 && d <= 24) risk = Math.max(risk, HIT_PROB[d] || 0);
      }
    }
    return risk;
  }

  function chooseRandom(arr, rng) { return arr[Math.floor((rng || Math.random)() * arr.length)]; }

  // Choose a play. Returns array of moves (possibly empty when no legal plays).
  function choosePlay(g, level, rng) {
    rng = rng || Math.random;
    const p = g.turn;
    const plays = BG.uniquePlays(BG.legalPlays(g.turnStart || g, p, g.dice));
    if (plays.length === 0) return [];
    if (plays.length === 1) return plays[0].moves;
    if (level === 'easy') return chooseRandom(plays, rng).moves;

    const scored = plays.map(pl => ({ pl, v: evaluate(pl.board, p, level) }));
    scored.sort((a, b) => b.v - a.v);
    if (level === 'medium') {
      // pick best with mild noise
      const top = scored.slice(0, 3);
      const noisy = top.map(s => ({ s, v: s.v + (rng() - 0.5) * 8 }));
      noisy.sort((a, b) => b.v - a.v);
      return noisy[0].s.pl.moves;
    }
    // hard: 2-ply over top candidates
    const cands = scored.slice(0, 7);
    let best = null, bestV = -Infinity;
    for (const c of cands) {
      let exp = 0;
      const o = BG.other(p);
      for (const r of ROLLS) {
        const replies = BG.uniquePlays(BG.legalPlays(c.pl.board, o, r.dice));
        let worst;
        if (replies.length === 0) worst = evaluate(c.pl.board, p, level);
        else {
          worst = Infinity;
          for (const rp of replies) { const v = evaluate(rp.board, p, level); if (v < worst) worst = v; }
        }
        exp += r.p * worst;
      }
      const v = 0.35 * c.v + 0.65 * exp;
      if (v > bestV) { bestV = v; best = c; }
    }
    return best.pl.moves;
  }

  // Estimate win probability for p from evaluation (logistic)
  function winProb(b, p, level) {
    const v = evaluate(b, p, level);
    return 1 / (1 + Math.exp(-v / 45));
  }

  // Should bot (player p, about to roll) offer a double?
  function shouldDouble(g, p, level, match) {
    if (!BG.canDouble(g, p)) return false;
    if (level === 'easy') return false;
    const wp = winProb(g, p, level);
    // match-aware: don't double when it would overshoot pointlessly (still fine), avoid doubling when far behind
    if (level === 'medium') {
      const my = BG.pipCount(g, p), op = BG.pipCount(g, BG.other(p));
      if (!isContact(g)) return my <= op - Math.max(2, Math.round(my * 0.08)); // race formula
      return wp >= 0.72 && wp <= 0.93;
    }
    // hard
    if (!isContact(g)) {
      const my = BG.pipCount(g, p), op = BG.pipCount(g, BG.other(p));
      const lead = op - my; return lead >= Math.max(2, Math.round(my * 0.08)) && lead <= Math.round(my * 0.13) + 6;
    }
    return wp >= 0.68 && wp <= 0.92;
  }

  // Should bot (player p) accept a double?
  function shouldTake(g, p, level) {
    if (level === 'easy') return true;
    const wp = winProb(g, p, level);
    if (!isContact(g)) {
      const my = BG.pipCount(g, p), op = BG.pipCount(g, BG.other(p));
      return my - op <= Math.round(op * 0.12) + 1;
    }
    return wp >= (level === 'hard' ? 0.24 : 0.22);
  }

  // Opening winner's choice: play the opening dice or roll again? Based on the well-known ranking of
  // opening rolls (3-1, 4-2, 6-1, 5-3 are the best; 6-5, 4-3, 6-4 are fine; the rest are below a
  // random re-roll, which may also produce doubles).
  const GOOD_OPENINGS = { medium: ['31', '42', '61', '53', '65'], hard: ['31', '42', '61', '53', '65', '43', '64'] };
  function keepOpening(dice, level, rng) {
    if (level === 'easy') return (rng || Math.random)() < 0.6;
    const key = '' + Math.max(dice[0], dice[1]) + Math.min(dice[0], dice[1]);
    return (GOOD_OPENINGS[level] || GOOD_OPENINGS.hard).includes(key);
  }

  return { choosePlay, evaluate, winProb, shouldDouble, shouldTake, isContact, keepOpening, ROLLS };
});
