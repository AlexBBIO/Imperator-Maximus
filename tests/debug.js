#!/usr/bin/env node
/* Debug probe: dump per-house military picture each round. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const f of ['util.js', 'data.js', 'galaxy.js', 'state.js', 'rules.js', 'combat.js', 'actions.js', 'turn.js', 'ai.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const IM = globalThis.IM;
const seed = parseInt(process.argv[2] || '1', 10);
const from = parseInt(process.argv[3] || '48', 10);
const to = parseInt(process.argv[4] || '70', 10);

const state = IM.state.newGame({ seed, players: { drakos: 'ai', meridian: 'ai', veyra: 'ai', oryn: 'ai' } });

let guard = 0;
let lastTurn = 0;
while (!state.gameOver && guard++ < 5000 && state.turn <= to) {
  if (state.turn !== lastTurn && state.turn >= from) {
    lastTurn = state.turn;
    const solDef = (() => {
      const sol = state.systems[state.solId];
      let p = 0;
      for (const f of IM.rules.fleetsAt(state, sol.id)) if (f.owner === sol.owner) p += IM.rules.fleetPower(state, f);
      const sb = IM.rules.starbasePower(state, sol);
      return Math.round(p + sb.atk + sb.hp / 2);
    })();
    console.log(`\n== T${state.turn} civilWar=${state.civilWar} solOwner=${state.systems[state.solId].owner} solDef=${solDef} swarmSys=${IM.rules.countSystems(state, 'swarm')}`);
    for (const hid of state.houseOrder) {
      const h = state.houses[hid];
      if (h.eliminated) { console.log(`  ${hid}: ELIMINATED`); continue; }
      const fleets = IM.rules.fleetsOf(state, hid);
      const fstr = fleets
        .map((f) => `${f.id}@${state.systems[f.systemId].name}(p${Math.round(IM.rules.fleetPower(state, f))},L${f.ships.legion || 0})`)
        .join(' ');
      console.log(
        `  ${hid}: sys=${IM.rules.countSystems(state, hid)} cr=${Math.round(h.credits)} pow=${Math.round(IM.rules.housePower(state, hid))} glory=${h.glory} favor=${h.favor} fleets: ${fstr}`
      );
    }
  } else if (state.turn !== lastTurn) {
    lastTurn = state.turn;
  }
  IM.ai.takeTurn(state, state.activeHouse);
  IM.turnEngine.endHouseTurn(state);
}
