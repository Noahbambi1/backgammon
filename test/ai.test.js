// Run: node test/ai.test.js  — plays bot-vs-bot matches and reports win rates + timing
const BG = require('../js/engine.js');
const AI = require('../js/ai.js');

function playGame(levelW, levelB) {
  const m = BG.newMatch({ cubeEnabled: false }); const g = BG.newGame(m);
  while (g.phase === 'opening') BG.openingRoll(g);
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 1000) {
    if (g.phase === 'roll') BG.roll(g);
    const lvl = g.turn === 'W' ? levelW : levelB;
    const moves = AI.choosePlay(g, lvl);
    BG.playMoves(g, moves);
    if (g.phase !== 'over') BG.endTurn(g);
  }
  return g.winner;
}
function series(a, b, n) {
  let wa = 0; const t0 = Date.now();
  for (let i = 0; i < n; i++) { if (playGame(a, b) === 'W') wa++; if (playGame(b, a) === 'B') wa++; }
  console.log(`${a} vs ${b}: ${a} wins ${wa}/${2 * n} (${((Date.now() - t0) / (2 * n)).toFixed(0)} ms/game)`);
  return wa / (2 * n);
}
const r1 = series('medium', 'easy', 25);
const r2 = series('hard', 'easy', 10);
const r3 = series('hard', 'medium', 10);
if (r1 < 0.7 || r2 < 0.7) { console.log('FAIL: bot strength ordering'); process.exitCode = 1; } else console.log('ok bot strength ordering');
