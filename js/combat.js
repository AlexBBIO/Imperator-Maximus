/* Imperator Maximus — combat.js
 * Space battle and ground invasion resolution. Battles resolve in rounds of
 * simultaneous fire; damage is distributed across hulls cheapest-first
 * (escorts screen the line). Produces human-readable battle reports.
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const D = IM.data;
  const R = () => IM.rules;
  const { C } = D;

  // Build a mutable side from one or more fleets (+ optional starbase).
  function makeSide(state, fleets, sys, isDefender) {
    const ships = {};
    for (const f of fleets) {
      for (const [k, n] of Object.entries(f.ships)) ships[k] = (ships[k] || 0) + n;
    }
    const owner = fleets.length ? fleets[0].owner : sys.owner;
    let sbAtk = 0, sbHP = 0;
    if (isDefender && sys && sys.owner === owner) {
      const sb = R().starbasePower(state, sys);
      sbAtk = sb.atk;
      sbHP = sb.hp;
    }
    return { owner, ships, sbAtk, sbHP, startHP: totalHP(ships) + sbHP, fleets };
  }

  function totalHP(ships) {
    let hp = 0;
    for (const [k, n] of Object.entries(ships)) hp += D.SHIPS[k].hp * n;
    return hp;
  }
  function totalAtk(state, owner, ships) {
    let atk = 0;
    for (const [k, n] of Object.entries(ships)) atk += D.SHIPS[k].atk * n;
    if (state.houses[owner]) atk *= 1 + R().mod(state, owner, 'shipAttack');
    return atk;
  }

  // Apply damage: kill cheapest hulls first (screening), starbase takes
  // damage last. Returns ships destroyed by class.
  function applyDamage(side, dmg) {
    const losses = {};
    const order = Object.keys(side.ships).sort((a, b) => D.SHIPS[a].hp - D.SHIPS[b].hp);
    for (const k of order) {
      if (dmg <= 0) break;
      const hpEach = D.SHIPS[k].hp;
      let n = side.ships[k];
      const kills = Math.min(n, Math.floor(dmg / hpEach));
      if (kills > 0) {
        side.ships[k] -= kills;
        losses[k] = (losses[k] || 0) + kills;
        dmg -= kills * hpEach;
      }
      // partial damage has a chance to claim one more hull
      if (side.ships[k] > 0 && dmg > 0 && dmg >= hpEach * 0.5) {
        side.ships[k] -= 1;
        losses[k] = (losses[k] || 0) + 1;
        dmg = 0;
      }
      if (side.ships[k] <= 0) delete side.ships[k];
    }
    if (dmg > 0 && side.sbHP > 0) {
      side.sbHP = Math.max(0, side.sbHP - dmg);
    }
    return losses;
  }

  function sideAlive(side) {
    return totalHP(side.ships) + side.sbHP > 0;
  }

  /**
   * Resolve a space battle at `sys` between attacker fleets and defender
   * fleets (defender gets the starbase if they own the system; an empty
   * defender fleet list with a live starbase still fights).
   * Returns a report; mutates the real fleets/system afterward.
   */
  function spaceBattle(state, sys, atkFleets, defFleets) {
    const A = makeSide(state, atkFleets, sys, false);
    const B = makeSide(state, defFleets, sys, true);
    const report = {
      type: 'space', turn: state.turn, systemId: sys.id, systemName: sys.name,
      attacker: A.owner, defender: B.owner, rounds: [],
      lossesA: {}, lossesB: {}, sbDestroyed: false, winner: null, retreated: null,
    };

    let round = 0;
    while (round < C.COMBAT_ROUNDS_MAX && sideAlive(A) && sideAlive(B)) {
      round++;
      const rollA = state.rng.r(0.8, 1.2);
      const rollB = state.rng.r(0.8, 1.2);
      const dmgToB = (totalAtk(state, A.owner, A.ships)) * rollA;
      const dmgToA = (totalAtk(state, B.owner, B.ships) + B.sbAtk) * rollB;
      const lb = applyDamage(B, dmgToB);
      const la = applyDamage(A, dmgToA);
      mergeLosses(report.lossesB, lb);
      mergeLosses(report.lossesA, la);
      report.rounds.push({ n: round, dmgToA: Math.round(dmgToA), dmgToB: Math.round(dmgToB) });

      // Retreat check: a side reduced below threshold withdraws (attacker
      // falls back to where it came from is abstracted: survivors stay but
      // battle ends; ownership of orbit goes to the stronger side).
      const fracA = (totalHP(A.ships) + A.sbHP) / Math.max(1, A.startHP);
      const fracB = (totalHP(B.ships) + B.sbHP) / Math.max(1, B.startHP);
      if (fracA < C.RETREAT_THRESHOLD && fracB >= fracA) {
        report.retreated = A.owner;
        break;
      }
      if (fracB < C.RETREAT_THRESHOLD && totalHP(B.ships) > 0 && fracA > fracB) {
        report.retreated = B.owner;
        break;
      }
    }

    const aAlive = sideAlive(A) && report.retreated !== A.owner;
    const bAlive = sideAlive(B) && report.retreated !== B.owner;
    report.winner = aAlive && !bAlive ? A.owner : bAlive && !aAlive ? B.owner : totalHP(A.ships) >= totalHP(B.ships) + B.sbHP ? A.owner : B.owner;

    // --- Write results back to the world.
    writeBack(state, atkFleets, A, report.winner === A.owner, sys, false, report);
    writeBack(state, defFleets, B, report.winner === B.owner, sys, true, report);
    if (B.sbHP <= 0 && sys.starbase > 0 && sys.owner === B.owner) {
      sys.starbase = 0;
      sys.starbaseHP = 0;
      report.sbDestroyed = true;
    } else if (sys.owner === B.owner) {
      sys.starbaseHP = B.sbHP;
    }

    state.battleReports.push(report);
    if (state.battleReports.length > 60) state.battleReports.shift();
    state.pendingBattle = report;
    return report;
  }

  function mergeLosses(into, losses) {
    for (const [k, n] of Object.entries(losses)) into[k] = (into[k] || 0) + n;
  }

  // Survivors keep fighting another day; a retreating/losing side that still
  // has hulls falls back to an adjacent friendly system, or disbands.
  function writeBack(state, fleets, side, won, sys, isDefender, report) {
    // distribute surviving hulls back into the first fleet, drop the rest
    const survivors = side.ships;
    let first = null;
    for (const f of fleets) {
      if (!first) {
        first = f;
        f.ships = Object.assign({}, survivors);
      } else {
        IM.state.removeFleet(state, f.id);
      }
    }
    if (first) {
      if (R().fleetShipCount(first) === 0) {
        IM.state.removeFleet(state, first.id);
      } else if (!won) {
        // retreat to nearest friendly adjacent system if any
        const here = state.systems[first.systemId];
        const friendly = here.links
          .map((id) => state.systems[id])
          .filter((s) => s.owner === first.owner);
        if (friendly.length) {
          first.systemId = state.rng.pick(friendly).id;
          report.fledTo = first.systemId;
        } else {
          // cornered far from home: the battered remnant limps to the
          // nearest owned system anywhere (or scatters if none remain)
          const owned = Object.values(state.systems).filter((s) => s.owner === first.owner);
          if (owned.length) {
            owned.sort((a, b) => IM.util.dist(a, here) - IM.util.dist(b, here));
            first.systemId = owned[0].id;
            first.movesLeft = 0;
            report.fledTo = first.systemId;
          } else {
            IM.state.removeFleet(state, first.id);
            report.scattered = report.scattered || [];
            report.scattered.push(side.owner);
          }
        }
      }
    }
  }

  /**
   * Ground invasion. Caller has verified orbit is clear and starbase down.
   * Mutates fleet legions + system ownership.
   */
  function invade(state, fleet, sys) {
    const atkStr = R().groundStrength(state, fleet) * state.rng.r(0.85, 1.25);
    const defStr = R().groundDefense(state, sys) * state.rng.r(0.8, 1.2);
    const report = {
      type: 'ground', turn: state.turn, systemId: sys.id, systemName: sys.name,
      attacker: fleet.owner, defender: sys.owner,
      atkStr: Math.round(atkStr), defStr: Math.round(defStr),
      success: false, legionsLost: 0, captured: false,
    };
    const legions = fleet.ships.legion || 0;
    if (atkStr > defStr) {
      // victory: casualties proportional to resistance
      const lost = Math.min(legions - 1, Math.ceil((legions * defStr) / (2 * atkStr)));
      fleet.ships.legion = legions - Math.max(0, lost);
      report.legionsLost = Math.max(0, lost);
      report.success = true;
      report.captured = true;
      captureSystem(state, sys, fleet.owner, report);
    } else {
      const lost = Math.max(1, Math.ceil(legions * 0.5));
      fleet.ships.legion = Math.max(0, legions - lost);
      if (R().fleetShipCount(fleet) === 0) IM.state.removeFleet(state, fleet.id);
      report.legionsLost = lost;
      sys.garrison = Math.max(3, Math.floor(sys.garrison * 0.7));
    }
    state.battleReports.push(report);
    if (state.battleReports.length > 60) state.battleReports.shift();
    state.pendingBattle = report;
    return report;
  }

  function captureSystem(state, sys, newOwner, report) {
    const oldOwner = sys.owner;
    const wasHive = sys.isHive;
    sys.owner = newOwner;
    sys.garrison = 8;
    sys.unrest = 3;
    sys.buildQueue = [];
    sys.starbase = 0;
    sys.starbaseHP = 0;
    if (sys.isHive) sys.isHive = false;

    const h = state.houses[newOwner];
    if (h) {
      // Loot + glory
      const loot = 20 + sys.baseCredits * 3;
      h.credits += loot;
      let glory = C.GLORY_TAKE_INDEPENDENT;
      if (state.houses[oldOwner]) glory = C.GLORY_TAKE_HOUSE;
      else if (oldOwner === 'imperium') glory = sys.isSol ? C.GLORY_TAKE_SOL : C.GLORY_TAKE_IMPERIUM;
      if (wasHive) {
        // Slaying the hive is the stuff of legend
        glory += 8;
        h.favor = Math.min(100, h.favor + 10);
        IM.state.log(state, newOwner, `${R().factionName(newOwner)} burns out the Vex hive at ${sys.name}! Songs will be sung. (+8 glory, +10 favor)`, 'epoch');
      }
      h.glory = Math.min(100, h.glory + glory);
      if (report) {
        report.loot = loot;
        report.glory = glory;
      }
    }

    if (sys.isSol) {
      if (state.houses[newOwner]) {
        state.solHolder = { houseId: newOwner, sinceTurn: state.turn };
        IM.state.log(state, newOwner, `${R().factionName(newOwner)} has stormed the Throneworld! They must hold Sol for ${C.SOL_HOLD_TURNS} turns to claim the throne.`, 'epoch');
      } else {
        state.solHolder = null;
        if (newOwner === 'swarm') {
          state.gameOver = true;
          state.defeat = 'swarm';
          IM.state.log(state, null, 'The Vex Swarm has devoured Sol. The light of humanity gutters out. ALL HOUSES LOSE.', 'epoch');
        }
      }
    } else if (state.solHolder && oldOwner === state.solHolder.houseId && sys.isSol) {
      state.solHolder = null;
    }

    // Losing your last system = elimination (checked centrally each round too)
    IM.state.log(
      state,
      state.houses[newOwner] ? newOwner : null,
      `${R().factionName(newOwner)} captures ${sys.name}${sys.isSol ? ' — THE THRONEWORLD' : ''} from ${R().factionName(oldOwner)}.`,
      'conquest'
    );
  }

  IM.combat = { spaceBattle, invade, captureSystem };
})();
