// Run: node test/engine.test.js
const BG = require('../js/engine.js');
const assert = require('assert');
let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e.stack || e)); process.exitCode = 1; } }
function board(pts, bar, off) {
  const b = { points: new Array(24).fill(0), bar: { W: 0, B: 0 }, off: { W: 0, B: 0 } };
  for (const k in pts) b.points[+k] = pts[k];
  if (bar) Object.assign(b.bar, bar);
  if (off) Object.assign(b.off, off);
  return b;
}
function seq(vals) { let i = 0; return () => (vals[i++ % vals.length] - 0.5) / 6; }

t('initial setup has 15 checkers each', () => {
  const g = BG.newGame(BG.newMatch());
  let w = 0, b = 0; for (const v of g.points) { if (v > 0) w += v; else b -= v; }
  assert.strictEqual(w, 15); assert.strictEqual(b, 15);
  assert.strictEqual(BG.pipCount(g, 'W'), 167); assert.strictEqual(BG.pipCount(g, 'B'), 167);
});

t('opening roll: tie re-rolls, higher goes first', () => {
  const g = BG.newGame(BG.newMatch());
  BG.openingRoll(g, seq([3, 3]));
  assert.strictEqual(g.phase, 'opening'); assert.strictEqual(g.opening.ties, 1);
  BG.openingRoll(g, seq([2, 5]));
  assert.strictEqual(g.turn, 'B'); assert.deepStrictEqual(g.dice, [2, 5]); assert.strictEqual(g.phase, 'move');
});

t('opening: 8 unique plays for 3-1 style dice count sanity', () => {
  const g = BG.newGame(BG.newMatch());
  const plays = BG.legalPlays(g, 'W', [3, 1]);
  assert.ok(plays.length > 10);
  assert.ok(plays.every(p => p.moves.length === 2));
});

t('doubles give four moves', () => {
  const g = BG.newGame(BG.newMatch());
  const plays = BG.legalPlays(g, 'W', [6, 6]);
  // White 6-6 opening: 24/18(2) 13/7(2) is legal
  assert.ok(plays.every(p => p.moves.length === 4));
});

t('must enter from bar first; blocked entry means no moves', () => {
  const b = board({ 18: -2, 19: -2, 20: -2, 21: -2, 22: -2, 23: -2, 0: 1 }, { W: 1 });
  assert.deepStrictEqual(BG.legalPlays(b, 'W', [3, 4]), []);
  const b2 = board({ 18: -2, 19: -2, 20: -2, 21: -2, 22: 0, 23: -2, 0: 1 }, { W: 1 });
  const plays = BG.legalPlays(b2, 'W', [2, 4]); // enter on 22 with die 2 (point 24-2=22)
  assert.ok(plays.length >= 1);
  assert.ok(plays.every(p => p.moves[0].from === 'bar' && p.moves[0].to === 22));
});

t('must use larger die when only one can be played', () => {
  // White checker on point 7, black blocks point 3 (7-4) => die 4 blocked, die 2 -> 5 ok, die 6 -> 1 ok.
  // Case: dice [2,6], only one die playable in total if after moving one the other is blocked.
  const b = board({ 7: 1, 5: -2, 1: -2, 3: -2, 20: -2, 21: -2, 22: -2, 23: -2, 19: -2, 18: -2 });
  // dice 2: 7->5 blocked; dice 6: 7->1 blocked; dice 4: 7->3 blocked. Use [2,4]: nothing. Use [4,6]: nothing.
  // Set up: white on 10 only. dice [3,5]: 10->7 ok; then 7->2 ok? 2 empty => both playable. Make 2 blocked & 5 blocked
  const b2 = board({ 10: 1, 2: -2, 5: -2, 0: -2, 20: -2, 21: -2, 22: -2, 23: -2, 19: -2, 18: -2 });
  // die3: 10->7 ok; then die5: 7->2 blocked. die5: 10->5 blocked. So only die 3 playable => plays len 1 using 3.
  let plays = BG.legalPlays(b2, 'W', [3, 5]);
  assert.strictEqual(plays.length, 1); assert.strictEqual(plays[0].moves[0].die, 3);
  // Now both dice individually playable but not together: white on 8; die 2 -> 6 ok; die 4 -> 4 ok; 6->2 blocked; 4->2 blocked
  const b3 = board({ 8: 1, 2: -2, 0: -2, 20: -2, 21: -2, 22: -2, 23: -2, 19: -2, 18: -2 });
  plays = BG.legalPlays(b3, 'W', [2, 4]);
  assert.strictEqual(plays.length, 1); assert.strictEqual(plays[0].moves[0].die, 4);
});

t('bearing off: exact, higher die when no checker farther, and blocked when not all home', () => {
  const b = board({ 3: 2, 0: 1, 20: -3 }, null, { W: 12 });
  let ms = BG.singleMoves(b, 'W', 6); // from 3 (dist 4) with 6 -> allowed since nothing on 4,5
  assert.ok(ms.some(m => m.from === 3 && m.to === 'off'));
  ms = BG.singleMoves(b, 'W', 1);
  assert.ok(ms.some(m => m.from === 0 && m.to === 'off'));
  const b2 = board({ 3: 2, 0: 1, 8: 1, 20: -3 }, null, { W: 11 });
  ms = BG.singleMoves(b2, 'W', 6);
  assert.ok(!ms.some(m => m.to === 'off'));
  // higher die cannot bear off lower point while a farther checker exists
  const b3 = board({ 1: 1, 4: 1, 20: -3 }, null, { W: 13 });
  ms = BG.singleMoves(b3, 'W', 3);
  assert.ok(!ms.some(m => m.from === 1 && m.to === 'off'));
  assert.ok(ms.some(m => m.from === 4 && m.to === 1));
});

t('hitting sends checker to bar', () => {
  const g = BG.newGame(BG.newMatch());
  g.points = board({ 10: 1, 7: -1, 0: -2, 23: 2 }).points;
  g.turn = 'W'; g.dice = [3, 1]; g.phase = 'roll';
  BG.roll(g, seq([3, 1]));
  BG.move(g, 10, 7);
  assert.strictEqual(g.bar.B, 1); assert.strictEqual(g.points[7], 1);
  assert.deepStrictEqual(g.remaining, [1]);
  BG.undo(g);
  assert.strictEqual(g.bar.B, 0); assert.strictEqual(g.points[7], -1); assert.deepStrictEqual(g.remaining, [3, 1]);
});

t('win detection: gammon and backgammon', () => {
  const g = BG.newGame(BG.newMatch());
  g.points = board({ 0: 1, 12: -15 }).points; g.off.W = 14; g.turn = 'W'; g.phase = 'roll';
  BG.roll(g, seq([1, 2]));
  BG.move(g, 0, 'off');
  assert.strictEqual(g.phase, 'over'); assert.strictEqual(g.result.type, 'gammon'); assert.strictEqual(g.result.points, 2);
  const g2 = BG.newGame(BG.newMatch());
  g2.points = board({ 0: 1, 3: -15 }).points; g2.off.W = 14; g2.turn = 'W'; g2.phase = 'roll';
  BG.roll(g2, seq([1, 2])); BG.move(g2, 0, 'off');
  assert.strictEqual(g2.result.type, 'backgammon'); assert.strictEqual(g2.result.points, 3);
});

t('doubling cube flow and match scoring with Crawford', () => {
  const m = BG.newMatch({ target: 3 });
  let g = BG.newGame(m);
  g.turn = 'W'; g.phase = 'roll';
  assert.ok(BG.canDouble(g, 'W')); assert.ok(!BG.canDouble(g, 'B'));
  BG.offerDouble(g); assert.strictEqual(g.phase, 'double');
  BG.acceptDouble(g); assert.strictEqual(g.cube.value, 2); assert.strictEqual(g.cube.owner, 'B'); assert.strictEqual(g.phase, 'roll');
  assert.ok(!BG.canDouble(g, 'W'));
  // B redoubles later
  g.turn = 'B'; assert.ok(BG.canDouble(g, 'B')); BG.offerDouble(g); BG.declineDouble(g);
  assert.strictEqual(g.phase, 'over'); assert.strictEqual(g.winner, 'B'); assert.strictEqual(g.result.points, 2);
  let r = BG.recordResult(m, g); assert.strictEqual(m.scores.B, 2); assert.ok(!r.matchOver);
  g = BG.newGame(m); assert.ok(m.crawfordGame); assert.ok(!g.cubeEnabled);
  g.turn = 'W'; g.phase = 'roll'; assert.ok(!BG.canDouble(g, 'W'));
  BG.resign(g, 'B', 'single'); r = BG.recordResult(m, g); assert.strictEqual(m.scores.W, 1);
  g = BG.newGame(m); assert.ok(!m.crawfordGame); assert.ok(g.cubeEnabled); // post-Crawford
  BG.resign(g, 'W'); r = BG.recordResult(m, g); assert.ok(r.matchOver); assert.strictEqual(r.matchWinner, 'B');
});

t('full random game plays to completion with legal moves', () => {
  for (let n = 0; n < 30; n++) {
    const m = BG.newMatch(); const g = BG.newGame(m);
    while (g.phase === 'opening') BG.openingRoll(g);
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 2000) {
      if (g.phase === 'roll') BG.roll(g);
      while (g.phase === 'move') {
        const nm = BG.legalNextMoves(g);
        if (nm.length === 0) { assert.ok(BG.canEndTurn(g)); BG.endTurn(g); break; }
        const mv = nm[Math.floor(Math.random() * nm.length)];
        BG.move(g, mv.from, mv.to, mv.die);
        if (g.phase === 'over') break;
      }
    }
    assert.strictEqual(g.phase, 'over');
    assert.strictEqual(g.off[g.winner], 15);
  }
});

t('serialize/deserialize roundtrip keeps play working', () => {
  const g = BG.newGame(BG.newMatch()); while (g.phase === 'opening') BG.openingRoll(g);
  const g2 = BG.deserialize(BG.serialize(g));
  assert.ok(BG.legalNextMoves(g2).length > 0);
});

console.log(passed + ' tests passed');
