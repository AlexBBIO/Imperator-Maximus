#!/usr/bin/env node
/* Imperator Maximus — headless engine simulation.
 * Runs full AI-vs-AI games to validate the engine: no crashes, invariants
 * hold, games end, and the pacing (sundering turn, game length) is sane.
 *
 *   node tests/sim.js            # batch of games, summary stats
 *   node tests/sim.js --seed 7   # single verbose game
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the engine (UI files excluded) into this context.
const ENGINE = ['util.js', 'data.js', 'galaxy.js', 'state.js', 'rules.js', 'combat.js', 'actions.js', 'turn.js', 'ai.js'];
for (const f of ENGINE) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInThisContext(src, { filename: f });
}
const IM = globalThis.IM;

function newAIGame(seed) {
  return IM.state.newGame({
    seed,
    players: { drakos: 'ai', meridian: 'ai', veyra: 'ai', oryn: 'ai' },
  });
}

function checkInvariants(state, seed) {
  const problems = [];
  for (const [id, f] of Object.entries(state.fleets)) {
    if (IM.rules.fleetShipCount(f) <= 0) problems.push(`empty fleet ${id}`);
    if (!state.systems[f.systemId]) problems.push(`fleet ${id} in missing system`);
    for (const [k, n] of Object.entries(f.ships)) {
      if (n < 0) problems.push(`fleet ${id} negative ${k}`);
    }
  }
  for (const [hid, h] of Object.entries(state.houses)) {
    if (h.credits < 0) problems.push(`${hid} negative credits ${h.credits}`);
    if (h.influence < 0) problems.push(`${hid} negative influence`);
    if (h.glory < 0 || h.glory > 100) problems.push(`${hid} glory out of range`);
    if (h.favor < 0 || h.favor > 100) problems.push(`${hid} favor out of range`);
  }
  for (const s of Object.values(state.systems)) {
    if (s.garrison < 0) problems.push(`${s.id} negative garrison`);
    if (s.starbase > 0 && s.starbaseHP < 0) problems.push(`${s.id} negative starbase hp`);
  }
  if (problems.length) {
    throw new Error(`Invariant violations (seed ${seed}, turn ${state.turn}):\n  ` + problems.join('\n  '));
  }
}

function runGame(seed, verbose) {
  const state = newAIGame(seed);
  let logIdx = 0;
  const flushLog = () => {
    if (!verbose) return;
    while (logIdx < state.log.length) {
      const e = state.log[logIdx++];
      console.log(`  [T${String(e.turn).padStart(3)}] ${e.text}`);
    }
  };

  let guard = 0;
  while (!state.gameOver && guard++ < 5000) {
    const hid = state.activeHouse;
    if (!hid) break;
    IM.ai.takeTurn(state, hid);
    IM.turnEngine.endHouseTurn(state);
    checkInvariants(state, seed);
    flushLog();
    if (state.turn > IM.data.C.MAX_TURNS) break;
  }
  flushLog();
  return state;
}

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
if (seedArg >= 0) {
  const seed = parseInt(args[seedArg + 1], 10);
  console.log(`=== Verbose game, seed ${seed} ===`);
  const s = runGame(seed, true);
  console.log(`\nResult: turn ${s.turn}, winner=${s.winner || 'none'}, defeat=${s.defeat || 'none'}, civilWarTurn=${s.civilWarTurn}`);
  process.exit(0);
}

// --- Batch mode
const N = 12;
const results = [];
console.log(`Running ${N} AI-vs-AI games...`);
for (let seed = 1; seed <= N; seed++) {
  const t0 = Date.now();
  const s = runGame(seed, false);
  const houses = Object.values(s.houses);
  results.push({
    seed,
    turns: s.turn,
    winner: s.winner,
    defeat: s.defeat,
    cw: s.civilWarTurn,
    cause: s.civilWarCause,
    swarmAt: s.swarm.activatedTurn,
    eliminated: houses.filter((h) => h.eliminated).length,
    battles: s.battleReports.length,
    ms: Date.now() - t0,
  });
  const r = results[results.length - 1];
  console.log(
    `seed ${String(seed).padStart(2)}: turns=${String(r.turns).padStart(3)} sundering@${String(r.cw).padStart(3)} (${r.cause || '-'}) swarm@${r.swarmAt} winner=${r.winner || (r.defeat ? 'ALL LOSE (' + r.defeat + ')' : 'TIMEOUT')} dead=${r.eliminated} ${r.ms}ms`
  );
}

const finished = results.filter((r) => r.winner || r.defeat);
const timeouts = results.filter((r) => !r.winner && !r.defeat);
console.log(`\nFinished: ${finished.length}/${N}  (timeouts: ${timeouts.length})`);
if (finished.length) {
  const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  console.log(`Avg game length: ${avg(finished.map((r) => r.turns))} turns; avg sundering: ${avg(finished.filter((r) => r.cw).map((r) => r.cw))}`);
  const wins = {};
  for (const r of finished) {
    const k = r.winner || 'ALL_LOSE';
    wins[k] = (wins[k] || 0) + 1;
  }
  console.log('Outcomes:', JSON.stringify(wins));
}

// --- Determinism check: same seed must produce identical history
console.log('\nDeterminism check (seed 3, two runs)...');
const a = runGame(3, false);
const b = runGame(3, false);
const ha = JSON.stringify({ t: a.turn, w: a.winner, d: a.defeat, log: a.log.length, draws: a.rngDraws });
const hb = JSON.stringify({ t: b.turn, w: b.winner, d: b.defeat, log: b.log.length, draws: b.rngDraws });
if (ha === hb) console.log('OK: identical outcomes —', ha);
else {
  console.log('MISMATCH:\n  ' + ha + '\n  ' + hb);
  process.exit(1);
}

// --- Serialization round-trip mid-game
console.log('\nSave/load round-trip check...');
const s1 = newAIGame(5);
for (let i = 0; i < 40 && !s1.gameOver; i++) {
  IM.ai.takeTurn(s1, s1.activeHouse);
  IM.turnEngine.endHouseTurn(s1);
}
const json = IM.state.serialize(s1);
const s2 = IM.state.deserialize(json);
// run both forward 40 half-turns and compare
for (let i = 0; i < 40 && !s1.gameOver; i++) {
  IM.ai.takeTurn(s1, s1.activeHouse);
  IM.turnEngine.endHouseTurn(s1);
}
for (let i = 0; i < 40 && !s2.gameOver; i++) {
  IM.ai.takeTurn(s2, s2.activeHouse);
  IM.turnEngine.endHouseTurn(s2);
}
const k1 = JSON.stringify({ t: s1.turn, w: s1.winner, draws: s1.rngDraws, f: Object.keys(s1.fleets).length });
const k2 = JSON.stringify({ t: s2.turn, w: s2.winner, draws: s2.rngDraws, f: Object.keys(s2.fleets).length });
if (k1 === k2) console.log('OK: save/load preserves simulation —', k1);
else {
  console.log('MISMATCH:\n  ' + k1 + '\n  ' + k2);
  process.exit(1);
}

if (timeouts.length > N / 2) {
  console.log('\nWARNING: too many timeouts — pacing needs tuning.');
  process.exit(1);
}
console.log('\nAll engine checks passed.');
