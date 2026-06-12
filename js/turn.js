/* Imperator Maximus — turn.js
 * Round sequencing and world simulation: income, build queues, research,
 * missions, elections, the Sundering (civil war), the Imperium, the Vex
 * Swarm, and victory/defeat checks.
 *
 * A round: startRound() → each living house acts in order (human via UI,
 * AI via IM.ai) → endRound() world step → next startRound().
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const D = IM.data;
  const { C } = D;
  const R = () => IM.rules;
  const log = (s, h, t, ty) => IM.state.log(s, h, t, ty);

  // ================================================================== round
  function startRound(state) {
    if (state.gameOver) return;
    state.turn++;

    // --- Victory: Sol hold countdown (checked before anything else moves)
    checkSolVictory(state);
    if (state.gameOver) return;

    // --- Per-house upkeep & production
    for (const hid of state.houseOrder) {
      const h = state.houses[hid];
      if (h.eliminated) continue;
      houseUpkeep(state, hid);
    }

    // --- System-level ticks for every faction
    for (const sys of Object.values(state.systems)) {
      if (sys.unrest > 0) sys.unrest--;
      sys.garrison = Math.min(sys.garrisonMax, sys.garrison + C.GARRISON_REGEN);
    }

    // --- Reset fleet action flags
    for (const f of Object.values(state.fleets)) {
      const owner = state.houses[f.owner];
      f.movesLeft = owner ? R().fleetRange(state, f.owner) : 1;
      f.invadedThisTurn = false;
    }

    // --- Senate: favor decay from glory (fear), missions, sundering checks
    if (!state.civilWar) {
      for (const hid of state.houseOrder) {
        const h = state.houses[hid];
        if (h.eliminated) continue;
        if (h.glory >= 60) h.favor = Math.max(0, h.favor - C.FAVOR_DECAY_GLORY_60);
        else if (h.glory >= 40) h.favor = Math.max(0, h.favor - C.FAVOR_DECAY_GLORY_40);
      }
      checkOutlaw(state);
      if (!state.civilWar && state.turn >= C.AUTO_SUNDERING_TURN) {
        beginSundering(state, null, 'succession');
      }
    }

    // --- Missions: offers + deadline checks
    for (const hid of state.houseOrder) {
      const h = state.houses[hid];
      if (h.eliminated) continue;
      tickMission(state, hid);
      if (!h.mission && state.turn >= h.nextMissionTurn && !state.civilWar) {
        issueMission(state, hid);
      }
    }

    // --- Elections
    if (state.turn === state.nextElectionTurn && !state.civilWar) {
      holdElection(state);
      state.nextElectionTurn = state.turn + C.ELECTION_PERIOD;
    }

    // --- Swarm activation clock
    tickSwarmClock(state);

    // --- Elimination check + start with first living house
    checkEliminations(state);
    checkLastHouseStanding(state);
    if (state.gameOver) return;

    state.activeHouse = firstLiving(state);
  }

  function firstLiving(state) {
    for (const hid of state.houseOrder) {
      if (!state.houses[hid].eliminated) return hid;
    }
    return null;
  }

  /** Advance to the next house, or run the world step + new round.
   *  Returns 'house' | 'round' to tell callers what happened. */
  function endHouseTurn(state) {
    if (state.gameOver) return 'over';
    const order = state.houseOrder;
    let idx = order.indexOf(state.activeHouse);
    for (idx++; idx < order.length; idx++) {
      if (!state.houses[order[idx]].eliminated) {
        state.activeHouse = order[idx];
        return 'house';
      }
    }
    endRound(state);
    if (!state.gameOver) startRound(state);
    return state.gameOver ? 'over' : 'round';
  }

  function endRound(state) {
    state.activeHouse = null;
    imperiumStep(state);
    solRearm(state);
    swarmStep(state);
    checkEliminations(state);
    checkLastHouseStanding(state);
    checkSwarmDoom(state);
  }

  // ================================================================ economy
  function houseUpkeep(state, hid) {
    const h = state.houses[hid];
    const inc = R().houseIncome(state, hid);
    h.credits += inc.net;
    h.influence += inc.influence;

    // Bankruptcy: ships desert until the books balance
    while (h.credits < 0) {
      const fleets = R().fleetsOf(state, hid);
      if (!fleets.length) {
        h.credits = 0;
        break;
      }
      const f = state.rng.pick(fleets);
      const keys = Object.keys(f.ships);
      if (!keys.length) {
        IM.state.removeFleet(state, f.id);
        continue;
      }
      const k = state.rng.pick(keys);
      f.ships[k]--;
      if (f.ships[k] <= 0) delete f.ships[k];
      if (R().fleetShipCount(f) === 0) IM.state.removeFleet(state, f.id);
      h.credits += D.SHIPS[k].upkeep * 3; // sold for scrap
      log(state, hid, `${R().factionName(hid)} cannot pay its fleets — a ${D.SHIPS[k].name} crew deserts.`, 'warn');
    }

    // Research (auto-switches to an unfinished track when one completes)
    h.science += inc.science;
    for (;;) {
      let track = h.researchTrack;
      if (h.techs[track] >= 4) {
        const open = D.TECH_ORDER.filter((tr) => h.techs[tr] < 4);
        if (!open.length) break;
        h.researchTrack = track = open[0];
      }
      const cost = R().techCost(state, hid, track);
      if (cost === null || h.science < cost) break;
      h.science -= cost;
      h.techs[track]++;
      const t = D.TECHS[track].tiers[h.techs[track]];
      log(state, hid, `${R().factionName(hid)} completes ${t.name} (${D.TECHS[track].name} ${['', 'I', 'II', 'III', 'IV'][h.techs[track]]}).`, 'tech');
    }

    // Build queues
    for (const sys of R().systemsOf(state, hid)) {
      if (!sys.buildQueue.length) continue;
      const out = R().systemOutput(state, sys);
      let pts = out.production;
      while (pts > 0 && sys.buildQueue.length) {
        const item = sys.buildQueue[0];
        const need = item.prodCost - item.progress;
        const spend = Math.min(pts, need);
        item.progress += spend;
        pts -= spend;
        if (item.progress >= item.prodCost) {
          sys.buildQueue.shift();
          completeBuild(state, sys, item);
        }
      }
    }
  }

  function completeBuild(state, sys, item) {
    const hid = sys.owner;
    if (item.kind === 'building') {
      sys.buildings.push(item.key);
      log(state, hid, `${sys.name} completes a ${D.BUILDINGS[item.key].name}.`, 'build');
      if (item.key === 'fortress') {
        sys.garrisonMax += D.BUILDINGS.fortress.garrisonMax;
      }
    } else if (item.kind === 'starbase') {
      sys.starbase = Math.min(3, sys.starbase + 1);
      sys.starbaseHP = D.STARBASE[sys.starbase].hp;
      log(state, hid, `${sys.name} completes ${D.STARBASE[sys.starbase].name}.`, 'build');
    } else if (item.kind === 'ship') {
      // merge into a friendly fleet here, else spawn one
      const mine = R().fleetsAt(state, sys.id).filter((f) => f.owner === hid);
      if (mine.length) {
        mine[0].ships[item.key] = (mine[0].ships[item.key] || 0) + 1;
      } else {
        const nf = IM.state.spawnFleet(state, hid, sys.id, { [item.key]: 1 });
        nf.movesLeft = 0;
      }
    }
  }

  // =============================================================== missions
  function issueMission(state, hid) {
    const h = state.houses[hid];
    if (h.mission) return;
    const rng = state.rng;
    const candidates = [];

    // conquer: a reachable independent system, preferring nearby ones
    const indies = Object.values(state.systems).filter((s) => s.owner === 'independent');
    if (indies.length) {
      const cap = state.systems[h.capital];
      indies.sort((a, b) => IM.util.dist(a, cap) - IM.util.dist(b, cap));
      const target = indies[rng.i(0, Math.min(4, indies.length - 1))];
      candidates.push({ type: 'conquer', targetId: target.id });
    }
    // muster
    candidates.push({ type: 'muster', amount: Math.max(80, Math.round(R().housePower(state, hid) * 1.35)) });
    // tribute
    candidates.push({ type: 'tribute', amount: 60 + 15 * Math.floor(state.turn / 5) });
    // purge: a swarm- or independent-held system with a hostile fleet
    const swarmSys = Object.values(state.systems).filter((s) => s.owner === 'swarm');
    if (swarmSys.length) candidates.push({ type: 'purge', targetId: rng.pick(swarmSys).id });

    const pick = rng.pick(candidates);
    const tpl = D.MISSION_TYPES[pick.type];
    h.mission = {
      type: pick.type,
      targetId: pick.targetId || null,
      amount: pick.amount || 0,
      deadline: tpl.duration,
      expiresTurn: state.turn + tpl.duration,
      status: 'offered',
    };
    h.nextMissionTurn = state.turn + C.MISSION_INTERVAL;
    log(state, hid, `The Senate offers ${R().factionName(hid)} a mandate.`, 'senate');
  }

  function missionText(state, h) {
    const m = h.mission;
    if (!m) return '';
    const tpl = D.MISSION_TYPES[m.type];
    const sysName = m.targetId ? state.systems[m.targetId].name : '';
    return tpl.text({ amount: m.amount, deadline: Math.max(0, m.expiresTurn - state.turn) }, sysName);
  }

  function tickMission(state, hid) {
    const h = state.houses[hid];
    const m = h.mission;
    if (!m || m.status !== 'active') return;
    // completion checks
    if (m.type === 'conquer' && state.systems[m.targetId].owner === hid) return completeMission(state, hid);
    if (m.type === 'muster' && R().housePower(state, hid) >= m.amount) return completeMission(state, hid);
    if (m.type === 'tribute' && h.credits >= m.amount) {
      h.credits -= m.amount;
      return completeMission(state, hid);
    }
    if (m.type === 'purge') {
      const sys = state.systems[m.targetId];
      const hostiles = R().fleetsAt(state, sys.id).filter((f) => R().isHostile(state, hid, f.owner));
      if (sys.owner !== 'swarm' && sys.owner !== 'independent' && !hostiles.length) return completeMission(state, hid);
      if (sys.owner === hid && !hostiles.length) return completeMission(state, hid);
    }
    // expiry
    if (state.turn >= m.expiresTurn) {
      const tpl = D.MISSION_TYPES[m.type];
      h.favor = Math.max(0, h.favor + tpl.failFavor);
      h.mission = null;
      h.nextMissionTurn = state.turn + 2;
      log(state, hid, `${R().factionName(hid)} fails the Senate's mandate (${tpl.failFavor} favor). The Senate remembers.`, 'warn');
    }
  }

  function completeMission(state, hid) {
    const h = state.houses[hid];
    if (state.stats[hid]) state.stats[hid].missionsDone++;
    const tpl = D.MISSION_TYPES[h.mission.type];
    const rw = tpl.reward;
    h.credits += rw.credits || 0;
    h.influence += rw.influence || 0;
    h.favor = Math.min(100, h.favor + (rw.favor || 0));
    h.glory = Math.min(100, h.glory + (rw.glory || 0));
    log(state, hid, `${R().factionName(hid)} fulfills the Senate mandate. Reward: ${rw.credits ? rw.credits + ' credits, ' : ''}+${rw.favor} favor, +${rw.glory} glory.`, 'senate');
    h.mission = null;
    h.nextMissionTurn = state.turn + C.MISSION_INTERVAL;
  }

  // ============================================================== elections
  function holdElection(state) {
    log(state, null, `— SENATE ELECTIONS, TURN ${state.turn} —`, 'epoch');
    for (const ok of D.OFFICE_ORDER) {
      let best = null;
      for (const hid of state.houseOrder) {
        const h = state.houses[hid];
        if (h.eliminated) continue;
        const bid = (state.bids[hid] && state.bids[hid][ok]) || 0;
        if (bid <= 0 || bid > h.influence) continue;
        if (!best || bid > best.bid || (bid === best.bid && h.favor > state.houses[best.hid].favor)) {
          best = { hid, bid };
        }
      }
      const prev = state.offices[ok];
      if (best) {
        const h = state.houses[best.hid];
        h.influence -= best.bid;
        state.offices[ok] = best.hid;
        h.glory = Math.min(100, h.glory + C.GLORY_OFFICE);
        log(state, best.hid, `${R().factionName(best.hid)} wins the office of ${D.OFFICES[ok].name} (bid ${best.bid} influence).`, 'senate');
      } else if (prev) {
        state.offices[ok] = null;
        log(state, null, `The office of ${D.OFFICES[ok].name} falls vacant.`, 'senate');
      }
    }
    state.bids = {};
  }

  // ============================================================== sundering
  function checkOutlaw(state) {
    for (const hid of state.houseOrder) {
      const h = state.houses[hid];
      if (h.eliminated) continue;
      if (h.glory >= C.GLORY_OUTLAW && h.favor <= C.FAVOR_OUTLAW) {
        h.outlawed = true;
        beginSundering(state, hid, 'outlawed');
        return;
      }
    }
  }

  function beginSundering(state, hid, cause) {
    if (state.civilWar) return;
    state.civilWar = true;
    state.civilWarTurn = state.turn;
    state.civilWarCause = cause;
    if (cause === 'outlawed') {
      log(state, hid, `THE SENATE DECLARES ${R().factionName(hid).toUpperCase()} HOSTIS — ENEMY OF THE IMPERIUM. The other houses see their chance. THE SUNDERING BEGINS.`, 'epoch');
    } else if (cause === 'declared') {
      state.houses[hid].outlawed = true;
      state.houses[hid].glory = Math.min(100, state.houses[hid].glory + 10);
      log(state, hid, `${R().factionName(hid).toUpperCase()} BURNS ITS SENATE WRIT AND MARCHES ON SOL. THE SUNDERING BEGINS.`, 'epoch');
    } else {
      log(state, null, 'THE OLD EMPEROR DIES WITHOUT AN HEIR. EVERY HOUSE CLAIMS THE THRONE. THE SUNDERING BEGINS.', 'epoch');
    }
    log(state, null, `All oaths are void. House may attack house; the Senate's Praetor Fleet defends Sol. Take the Throneworld and hold it for ${C.SOL_HOLD_TURNS} turns — but beware: the Vex stir at the rim.`, 'epoch');
    // Missions are void
    for (const h of Object.values(state.houses)) h.mission = null;
    // The Imperium musters
    const sol = state.systems[state.solId];
    if (sol.owner === 'imperium') {
      IM.state.spawnFleet(state, 'imperium', state.solId, { cruiser: 2, frigate: 3 }, 'Praetor Reserve');
    }
  }

  // ================================================================== world
  function imperiumStep(state) {
    // Pre-war: garrison repairs only. Post-war: Praetor fleets defend the
    // core and counterattack adjacent house worlds.
    const impSystems = R().systemsOf(state, 'imperium');
    for (const sys of impSystems) {
      if (sys.starbase > 0) {
        sys.starbaseHP = Math.min(D.STARBASE[sys.starbase].hp, sys.starbaseHP + 8);
      }
    }
    if (!state.civilWar) return;

    for (const f of R().fleetsOf(state, 'imperium')) {
      const here = state.systems[f.systemId];
      // If a house fleet is in an imperium system, the Praetors already fought
      // when it entered. Imperium moves: retake lost core worlds or strike out.
      const targets = here.links
        .map((id) => state.systems[id])
        .filter((s) => state.houses[s.owner]);
      const lostCore = Object.values(state.systems).filter(
        (s) => s.ring === 0 && s.owner !== 'imperium' && state.houses[s.owner]
      );
      let dest = null;
      if (lostCore.length) {
        // move toward the nearest lost core world (1 step greedy)
        const tgt = lostCore[0];
        dest = here.links
          .map((id) => state.systems[id])
          .sort((a, b) => IM.util.dist(a, tgt) - IM.util.dist(b, tgt))[0];
      } else if (targets.length && R().fleetPower(state, f) > 80) {
        dest = state.rng.pick(targets);
      }
      if (dest && dest.id !== f.systemId) {
        npcMove(state, f, dest);
      }
    }
  }

  // The Throneworld rearms every round — a hard target, but a finite one:
  // the Praetor fleet rebuilds toward a cap, never beyond it. A committed
  // house CAN crack Sol; a half-hearted one cannot.
  function solRearm(state) {
    const sol = state.systems[state.solId];
    if (sol.owner !== 'imperium') return;
    if (state.turn % 3 !== 0) return;
    const cap = 170;
    const fleets = R().fleetsAt(state, state.solId).filter((f) => f.owner === 'imperium');
    const power = fleets.reduce((a, f) => a + R().fleetPower(state, f), 0);
    if (power < cap) {
      if (fleets.length) {
        fleets[0].ships.frigate = (fleets[0].ships.frigate || 0) + 1;
        if (state.turn % 6 === 0) fleets[0].ships.cruiser = (fleets[0].ships.cruiser || 0) + 1;
      } else {
        IM.state.spawnFleet(state, 'imperium', state.solId, { frigate: 2, cruiser: 1 }, 'Praetor Patrol');
      }
    }
    if (sol.starbase < 2 && state.turn % 6 === 0) {
      sol.starbase++;
      sol.starbaseHP = D.STARBASE[sol.starbase].hp;
    }
  }

  function tickSwarmClock(state) {
    if (state.swarm.active || state.gameOver) return;
    if (state.swarm.activatedTurn !== null) return; // eradicated for good
    const due =
      state.turn >= C.SWARM_LATEST_TURN ||
      (state.civilWar && state.turn >= state.civilWarTurn + C.SWARM_WAR_DELAY);
    if (!due) return;
    // pick a rim system, preferring independents
    const rim = Object.values(state.systems)
      .filter((s) => s.ring === 3 && !s.isSol)
      .sort((a, b) => b.ring - a.ring);
    const nest = rim.find((s) => s.owner === 'independent') || rim[0] || Object.values(state.systems).find((s) => !s.isSol);
    state.swarm.active = true;
    state.swarm.activatedTurn = state.turn;
    state.swarm.hiveId = nest.id;
    nest.owner = 'swarm';
    nest.isHive = true;
    nest.garrison = 30;
    nest.garrisonMax = 45;
    nest.buildQueue = [];
    IM.state.spawnFleet(state, 'swarm', nest.id, { swarmling: 8, behemoth: 1 }, 'Vex Brood');
    log(state, null, `LONG-RANGE BEACONS FALL SILENT. The VEX SWARM erupts from ${nest.name}. While the houses scheme, something hungrier moves.`, 'epoch');
  }

  function swarmStep(state) {
    if (!state.swarm.active || state.gameOver) return;
    const sw = state.swarm;
    const age = state.turn - sw.activatedTurn;

    // Spawn waves at the hive (or any swarm world if hive falls). The Vex
    // grow slowly in peacetime and feed on a galaxy at war: the longer the
    // Sundering rages, the worse the tide.
    const period = state.civilWar ? C.SWARM_SPAWN_PERIOD_WAR : C.SWARM_SPAWN_PERIOD_PEACE;
    if (age > 0 && age % period === 0) {
      const swarmWorlds = R().systemsOf(state, 'swarm');
      if (swarmWorlds.length) {
        sw.wave++;
        const at = swarmWorlds.find((s) => s.isHive) || state.rng.pick(swarmWorlds);
        const warBonus = state.civilWar ? Math.floor((state.turn - state.civilWarTurn) / 5) : 0;
        const size = Math.min(12, 3 + sw.wave + warBonus);
        const behemoths = Math.min(2, Math.floor(sw.wave / 3));
        IM.state.spawnFleet(state, 'swarm', at.id, { swarmling: size, behemoth: behemoths }, 'Vex Brood');
        log(state, null, `The Vex spawn a new brood at ${at.name} (wave ${sw.wave}).`, 'warn');
      }
    }
    const worlds = R().systemsOf(state, 'swarm');
    if (!worlds.length && R().fleetsOf(state, 'swarm').length === 0) {
      sw.active = false;
      log(state, null, 'The last of the Vex burn in the void. The galaxy breathes again — and remembers who let them in.', 'epoch');
      return;
    }

    // Each swarm fleet: attack adjacent inhabited world, preferring the
    // direction of Sol (the Vex smell dense biomass).
    const sol = state.systems[state.solId];
    for (const f of R().fleetsOf(state, 'swarm')) {
      const here = state.systems[f.systemId];
      // consume the world we sit on if hostile and orbit clear
      if (here.owner !== 'swarm') {
        const defenders = R().fleetsAt(state, here.id).filter((x) => x.owner !== 'swarm');
        if (!defenders.length && (here.starbase === 0 || here.starbaseHP <= 0)) {
          const gs = R().groundStrength(state, f);
          if (gs > R().groundDefense(state, here) * 0.9) {
            IM.combat.captureSystem(state, here, 'swarm', null);
            here.isHive = false;
            continue;
          }
        }
      }
      const options = here.links.map((id) => state.systems[id]);
      options.sort((a, b) => IM.util.dist(a, sol) - IM.util.dist(b, sol));
      let dest = options.find((s) => s.owner !== 'swarm');
      if (!dest) dest = state.rng.pick(options);
      if (dest) npcMove(state, f, dest);
    }
  }

  // NPC fleet move with immediate combat, mirroring act.moveFleet.
  function npcMove(state, fleet, target) {
    fleet.systemId = target.id;
    const enemies = R()
      .fleetsAt(state, target.id)
      .filter((x) => x.id !== fleet.id && R().isHostile(state, fleet.owner, x.owner));
    const hostileSystem = R().isHostile(state, fleet.owner, target.owner) && target.owner !== fleet.owner;
    if (enemies.length || (hostileSystem && target.starbase > 0 && target.starbaseHP > 0)) {
      const defOwner = enemies.length ? enemies[0].owner : target.owner;
      IM.combat.spaceBattle(state, target, [fleet], enemies.filter((x) => x.owner === defOwner));
    }
    // After combat, if swarm/imperium holds orbit over a hostile world, try invasion
    const f2 = state.fleets[fleet.id];
    if (!f2) return;
    const sys = state.systems[f2.systemId];
    if (sys.owner !== f2.owner && R().isHostile(state, f2.owner, sys.owner)) {
      const stillHostile = R().fleetsAt(state, sys.id).filter((x) => x.owner !== f2.owner && R().isHostile(state, f2.owner, x.owner));
      if (!stillHostile.length && (sys.starbase === 0 || sys.starbaseHP <= 0)) {
        const gs = R().groundStrength(state, f2);
        if (gs > 0 && f2.owner === 'swarm') {
          if (gs > R().groundDefense(state, sys) * 0.9) {
            IM.combat.captureSystem(state, sys, 'swarm', null);
          }
        }
      }
    }
  }

  // ================================================================ victory
  function checkSolVictory(state) {
    const sol = state.systems[state.solId];
    if (state.solHolder && sol.owner === state.solHolder.houseId) {
      const held = state.turn - state.solHolder.sinceTurn;
      const h = state.houses[state.solHolder.houseId];
      if (held >= C.SOL_HOLD_TURNS && !h.eliminated) {
        state.gameOver = true;
        state.winner = state.solHolder.houseId;
        log(state, state.winner, `${R().factionName(state.winner).toUpperCase()} IS CROWNED. A new dynasty takes the Throne of Sol. IMPERATOR MAXIMUS.`, 'epoch');
      } else if (!h.eliminated) {
        log(state, sol.owner, `${R().factionName(sol.owner)} holds the Throneworld. Coronation in ${C.SOL_HOLD_TURNS - held} turn(s).`, 'epoch');
      }
    } else if (state.solHolder && sol.owner !== state.solHolder.houseId) {
      state.solHolder = state.houses[sol.owner] ? { houseId: sol.owner, sinceTurn: state.turn } : null;
    }
  }

  function checkEliminations(state) {
    for (const hid of state.houseOrder) {
      const h = state.houses[hid];
      if (h.eliminated) continue;
      if (R().countSystems(state, hid) === 0) {
        h.eliminated = true;
        // fleets disband to rebels (vanish, for simplicity)
        for (const f of R().fleetsOf(state, hid)) IM.state.removeFleet(state, f.id);
        for (const ok of D.OFFICE_ORDER) {
          if (state.offices[ok] === hid) state.offices[ok] = null;
        }
        log(state, hid, `${R().factionName(hid).toUpperCase()} IS DESTROYED. Its name is struck from the Senate rolls.`, 'epoch');
      }
    }
  }

  function checkLastHouseStanding(state) {
    if (state.gameOver) return;
    const living = R().livingHouses(state);
    if (living.length === 1 && state.civilWar) {
      state.gameOver = true;
      state.winner = living[0];
      log(state, living[0], `${R().factionName(living[0]).toUpperCase()} STANDS ALONE. The Senate kneels. IMPERATOR MAXIMUS.`, 'epoch');
    } else if (living.length === 0) {
      state.gameOver = true;
      state.defeat = 'swarm';
      log(state, null, 'No house survives. The Imperium is a tomb.', 'epoch');
    }
  }

  function checkSwarmDoom(state) {
    if (state.gameOver) return;
    const total = Object.keys(state.systems).length;
    const swarmCount = R().countSystems(state, 'swarm');
    if (swarmCount / total >= C.SWARM_DOOM_SHARE) {
      state.gameOver = true;
      state.defeat = 'swarm';
      log(state, null, 'THE VEX TIDE IS UNSTOPPABLE. The houses fought each other while the galaxy burned. ALL HOUSES LOSE.', 'epoch');
    }
  }

  IM.turnEngine = {
    startRound, endHouseTurn, endRound, issueMission, completeMission,
    missionText, beginSundering, holdElection,
  };
})();
