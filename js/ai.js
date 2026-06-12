/* Imperator Maximus — ai.js
 * House AI. Personas weight the same underlying machinery differently:
 *   warlord  — expands hard, declares the Sundering early, heads for Sol
 *   magnate  — builds economy, buys offices, fights late but rich
 *   schemer  — hoards influence, denounces leaders, sabotages, opportunist
 *   sage     — techs up, defends, strikes with superior fleets
 * The AI plays through IM.act exactly like a human player.
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const D = IM.data;
  const { C } = D;
  const R = () => IM.rules;
  const A = () => IM.act;

  const PERSONA = {
    warlord: { mil: 1.5, eco: 0.8, sci: 0.7, inf: 0.6, aggression: 1.4, declareAt: 50, track: ['war', 'industry', 'logistics'] },
    magnate: { mil: 0.9, eco: 1.5, sci: 0.9, inf: 1.1, aggression: 0.9, declareAt: 65, track: ['industry', 'logistics', 'war'] },
    schemer: { mil: 0.9, eco: 1.0, sci: 0.9, inf: 1.6, aggression: 1.0, declareAt: 58, track: ['logistics', 'industry', 'war'] },
    sage: { mil: 0.9, eco: 1.0, sci: 1.5, inf: 0.8, aggression: 0.8, declareAt: 70, track: ['industry', 'war', 'logistics'] },
  };

  // The Vex are everyone's problem: above this share of the galaxy, every
  // AI diverts fleets to the crusade no matter who it is knifing.
  const SWARM_PANIC_SHARE = 0.1;

  function takeTurn(state, hid) {
    if (state.gameOver || state.activeHouse !== hid) return;
    const h = state.houses[hid];
    if (h.eliminated) return;
    const hd = R().houseDef(hid);
    const P = PERSONA[hd.persona] || PERSONA.warlord;

    respondToMission(state, hid, P);
    doResearch(state, hid, P);
    doSenate(state, hid, P);
    doBids(state, hid, P);
    doBuild(state, hid, P);
    considerSundering(state, hid, P);
    doMilitary(state, hid, P);
  }

  // ----------------------------------------------------------------- missions
  function respondToMission(state, hid, P) {
    const h = state.houses[hid];
    const m = h.mission;
    if (!m || m.status !== 'offered') return;
    let accept = true;
    if (m.type === 'tribute') accept = h.credits >= m.amount * 1.2;
    if (m.type === 'conquer') {
      const sys = state.systems[m.targetId];
      accept = R().housePower(state, hid) > R().groundDefense(state, sys) * 1.2;
    }
    // schemer always accepts (favor is currency); warlord declines tributes
    if (P === PERSONA.warlord && m.type === 'tribute' && h.credits < m.amount * 2) accept = false;
    A().respondMission(state, hid, accept);
  }

  // ----------------------------------------------------------------- research
  function doResearch(state, hid, P) {
    const h = state.houses[hid];
    for (const tr of P.track) {
      if (h.techs[tr] < 4) {
        if (h.researchTrack !== tr) A().setResearch(state, hid, tr);
        return;
      }
    }
  }

  // ------------------------------------------------------------------- senate
  function doSenate(state, hid, P) {
    const h = state.houses[hid];
    if (state.civilWar) return;
    const costMult = R().senateCostMult(state, hid);

    // Stave off outlawry if we're not ready for war
    const danger = h.glory >= C.GLORY_OUTLAW - 8 && h.favor <= C.FAVOR_OUTLAW + 12;
    const wantWar = h.glory >= P.declareAt && isStrongest(state, hid);
    if (danger && !wantWar && h.influence >= Math.round(D.SENATE_ACTIONS.curry.cost * costMult)) {
      A().senateAction(state, hid, 'curry');
    }

    // Schemers (and the vengeful) denounce the glory leader
    const leader = gloryLeader(state, hid);
    if (leader) {
      const grudge = (h.grudges[leader] || 0) > 1;
      const wants = P.inf >= 1.5 || grudge;
      if (wants && h.influence >= Math.round(D.SENATE_ACTIONS.denounce.cost * costMult) + 30) {
        A().senateAction(state, hid, 'denounce', leader);
      }
    }

    // Schemers sabotage the strongest rival's busiest yard occasionally
    if (P.inf >= 1.5 && state.rng.chance(0.25)) {
      const rival = strongestRival(state, hid);
      if (rival) {
        const target = R()
          .systemsOf(state, rival)
          .filter((s) => s.buildQueue.length && s.buildQueue[0].progress > 30)
          .sort((a, b) => b.buildQueue[0].progress - a.buildQueue[0].progress)[0];
        if (target && h.influence >= Math.round(D.SENATE_ACTIONS.sabotage.cost * costMult) + 40) {
          A().senateAction(state, hid, 'sabotage', target.id);
        }
      }
    }

    // Lobby for work if idle and favor-hungry
    if (!h.mission && h.favor < 45 && h.influence >= Math.round(D.SENATE_ACTIONS.lobby.cost * costMult) + 20) {
      A().senateAction(state, hid, 'lobby');
    }

    // Manufacture triumphs: influence-rich houses (schemers especially)
    // convert surplus influence into glory — and houses on the cusp of
    // their declaration threshold buy the final push to war.
    const triumphCost = Math.round(D.SENATE_ACTIONS.triumph.cost * costMult);
    const cusp = h.glory >= P.declareAt - 6 && h.glory < C.GLORY_DECLARE + 6 && isStrongest(state, hid, 1.15);
    const surplus = P.inf >= 1.5 && h.glory >= 25 && h.influence > triumphCost + 80;
    if ((cusp || surplus) && h.influence >= triumphCost && !danger) {
      A().senateAction(state, hid, 'triumph');
    }
  }

  function doBids(state, hid, P) {
    const h = state.houses[hid];
    if (state.civilWar) return;
    const until = state.nextElectionTurn - state.turn;
    if (until > 3) return;
    // Persona-preferred office, bid a slice of influence
    const pref = {
      warlord: 'lordCommander',
      magnate: 'highChancellor',
      schemer: 'masterOfWhispers',
      sage: 'archmagos',
    }[R().houseDef(hid).persona];
    const amount = Math.floor(h.influence * (0.3 + 0.2 * P.inf * state.rng.f()));
    if (amount > 0) A().setBid(state, hid, pref, amount);
  }

  // -------------------------------------------------------------------- build
  function doBuild(state, hid, P) {
    const h = state.houses[hid];
    const systems = R().systemsOf(state, hid);
    const inc = R().houseIncome(state, hid);
    const power = R().housePower(state, hid);
    const threat = nearbyThreat(state, hid);
    const wantMil = threat > power * 0.7 || state.civilWar || h.glory >= P.declareAt - 10;

    for (const sys of systems) {
      if (sys.buildQueue.length >= 2) continue;
      const out = R().systemOutput(state, sys);

      // Building priority by persona & deficits
      const options = [];
      const slots = R().buildingSlots(state, hid);
      if (sys.buildings.length + sys.buildQueue.filter((q) => q.kind === 'building').length < slots) {
        if (!sys.buildings.includes('tradehub')) options.push(['building', 'tradehub', 12 * P.eco]);
        if (!sys.buildings.includes('foundry')) options.push(['building', 'foundry', 10 * P.eco]);
        if (!sys.buildings.includes('lab')) options.push(['building', 'lab', 9 * P.sci]);
        if (!sys.buildings.includes('nexus')) options.push(['building', 'nexus', 6 * P.inf]);
        if (!sys.buildings.includes('shipyard') && out.production >= 8) options.push(['building', 'shipyard', 8 * P.mil]);
        if (!sys.buildings.includes('fortress') && (state.civilWar || sys.isCapital)) options.push(['building', 'fortress', 7 * P.mil]);
      }
      // Starbases on the border once war looms
      if ((state.civilWar || state.swarm.active || h.glory > 40) && sys.starbase < 2) {
        options.push(['starbase', 'starbase', (sys.isCapital ? 9 : 5) * P.mil]);
      }
      // Ships where there's a yard (or corvettes/legions anywhere). Idle
      // wealth flows into hulls: the richer we are, the more we arm.
      if (wantMil || inc.net > 25) {
        const wealth = 1 + Math.min(3, h.credits / 400);
        const canCruiser = R().canBuildShip(state, sys, 'cruiser').ok;
        const canDread = R().canBuildShip(state, sys, 'dreadnought').ok;
        if (canDread && h.credits > 300) options.push(['ship', 'dreadnought', 9 * P.mil * wealth]);
        if (canCruiser && h.credits > 150) options.push(['ship', 'cruiser', 8 * P.mil * wealth]);
        options.push(['ship', 'frigate', 6 * P.mil * wealth]);
        options.push(['ship', 'corvette', 3 * P.mil]);
        if (totalLegions(state, hid) < 4 + (state.civilWar ? 3 : 1)) {
          options.push(['ship', 'legion', 8 * P.mil * wealth]);
        }
      }
      if (!options.length) continue;
      options.sort((a, b) => b[2] * (0.8 + state.rng.f() * 0.4) - a[2]);
      const [kind, key] = options[0];
      if (kind === 'building') A().queueBuilding(state, hid, sys.id, key);
      else if (kind === 'starbase') A().queueStarbase(state, hid, sys.id);
      else A().queueShip(state, hid, sys.id, key);
    }
  }

  // ---------------------------------------------------------------- sundering
  function considerSundering(state, hid, P) {
    if (state.civilWar) return;
    const h = state.houses[hid];
    if (h.glory < Math.max(C.GLORY_DECLARE, P.declareAt)) return;
    // Declare only when clearly the strongest house and solvent
    if (isStrongest(state, hid, 1.25) && h.credits > 150 && totalLegions(state, hid) >= 2) {
      A().declareSundering(state, hid);
    }
  }

  // ----------------------------------------------------------------- military
  function doMilitary(state, hid, P) {
    // Merge co-located fleets first (concentration of force)
    const bySys = {};
    for (const f of R().fleetsOf(state, hid)) {
      if (bySys[f.systemId]) {
        A().mergeFleets(state, hid, f.id, bySys[f.systemId]);
      } else {
        bySys[f.systemId] = f.id;
      }
    }
    let fids = Object.values(bySys);

    // Wartime doctrine: one doomstack. Lesser fleets rally to the main
    // fleet; scattered squadrons lose civil wars (and Vex crusades).
    if (state.civilWar || swarmPanic(state)) {
      let mainId = null;
      let mainPower = -1;
      for (const fid of fids) {
        const p = R().fleetPower(state, state.fleets[fid]);
        if (p > mainPower) {
          mainPower = p;
          mainId = fid;
        }
      }
      for (const fid of fids) {
        if (fid === mainId) continue;
        const f = state.fleets[fid];
        if (!f) continue;
        // small garrison squadrons stay home; real strength rallies
        if (R().fleetPower(state, f) < mainPower * 0.15) continue;
        let guard = 0;
        while (state.fleets[fid] && state.fleets[fid].movesLeft > 0 && guard++ < 4) {
          const main = state.fleets[mainId];
          if (!main || f.systemId === main.systemId) break;
          if (!moveToward(state, hid, fid, main.systemId)) break;
        }
      }
      fids = fids.filter((fid) => state.fleets[fid]);
      // re-merge after rallying
      const main = state.fleets[mainId];
      if (main) {
        for (const fid of fids) {
          if (fid !== mainId && state.fleets[fid] && state.fleets[fid].systemId === main.systemId) {
            A().mergeFleets(state, hid, fid, mainId);
          }
        }
      }
      fids = fids.filter((fid) => state.fleets[fid]);
    }

    for (const fid of fids) {
      const fleet = state.fleets[fid];
      if (!fleet) continue;
      let guard2 = 0;
      while (state.fleets[fid] && state.fleets[fid].movesLeft > 0 && guard2++ < 4) {
        if (!stepFleet(state, hid, fid, P)) break;
      }
      // Try invasion wherever we ended up
      const f2 = state.fleets[fid];
      if (f2) tryInvade(state, hid, f2);
    }
  }

  function swarmPanic(state) {
    if (!state.swarm.active) return false;
    const total = Object.keys(state.systems).length;
    const swarmCount = R().countSystems(state, 'swarm');
    return swarmCount / total >= SWARM_PANIC_SHARE;
  }

  function stepFleet(state, hid, fid, P) {
    const fleet = state.fleets[fid];
    const here = state.systems[fleet.systemId];
    const myPower = R().fleetPower(state, fleet);
    const sol = state.systems[state.solId];

    // 0) If standing on a takeable hostile world, stay (invade after)
    if (R().isHostile(state, hid, here.owner) && (fleet.ships.legion || 0) > 0) {
      const orbitClear =
        !R().fleetsAt(state, here.id).some((f) => f.id !== fid && R().isHostile(state, hid, f.owner)) &&
        (here.starbase === 0 || here.starbaseHP <= 0);
      if (orbitClear && R().groundStrength(state, fleet) > R().groundDefense(state, here) * 1.05) return false;
    }

    // 1) Home defense: if a swarm/hostile fleet sits on one of our worlds nearby, hit it
    const crisis = nearestCrisis(state, hid, fleet);
    if (crisis && myPower > crisis.power * 0.9) {
      return moveToward(state, hid, fid, crisis.systemId);
    }

    // 1.5) Vex panic: when the swarm holds too much of the galaxy, the
    // crusade outranks the throne. Cut the head off — the hive first; border
    // worlds are whack-a-mole while the hive spawns.
    if (state.swarm.active) {
      const total = Object.keys(state.systems).length;
      const swarmWorlds = Object.values(state.systems).filter((s) => s.owner === 'swarm');
      if (swarmWorlds.length / total >= SWARM_PANIC_SHARE) {
        const me = state.systems[fleet.systemId];
        const hive = swarmWorlds.find((s) => s.isHive);
        let target = null;
        if (hive && defensePower(state, hive.id) < myPower * 1.15) target = hive;
        if (!target) {
          target = swarmWorlds
            .filter((s) => defensePower(state, s.id) < myPower * 1.1)
            .sort((a, b) => IM.util.dist(a, me) - IM.util.dist(b, me))[0];
        }
        if (target) return moveToward(state, hid, fid, target.id);
      }
    }

    // 2) Civil war: march on Sol when strong, raid rivals otherwise. The
    // longer the war drags (and the Vex grow), the lower the bar — and if a
    // rival house is counting down to coronation, breaking the siege of Sol
    // is existential.
    if (state.civilWar) {
      const solDef = defensePower(state, sol.id);
      const warAge = state.turn - state.civilWarTurn;
      let need = Math.max(0.8, 1.25 - 0.03 * warAge);
      if (state.houses[sol.owner] && sol.owner !== hid) need = 0.7; // break the coronation!
      if (sol.owner !== hid && myPower > solDef * need && (fleet.ships.legion || 0) > 0) {
        return moveToward(state, hid, fid, sol.id);
      }
      const prey = bestPrey(state, hid, fleet, P);
      if (prey) return moveToward(state, hid, fid, prey);
      // otherwise fall back on capital defense
      return moveToward(state, hid, fid, state.houses[hid].capital);
    }

    // 3) Peace: expand into independents
    const target = bestExpansion(state, hid, fleet, P);
    if (target) return moveToward(state, hid, fid, target);

    // 4) Idle: sit on capital
    if (fleet.systemId !== state.houses[hid].capital) {
      return moveToward(state, hid, fid, state.houses[hid].capital);
    }
    return false;
  }

  function tryInvade(state, hid, fleet) {
    const sys = state.systems[fleet.systemId];
    if (!R().isHostile(state, hid, sys.owner)) return;
    if ((fleet.ships.legion || 0) < 1) return;
    if (R().groundStrength(state, fleet) < R().groundDefense(state, sys) * 1.05) return;
    A().invade(state, hid, fleet.id);
  }

  // One step along the shortest siege path (fights through defended
  // systems hop by hop); returns true if a move was made.
  function moveToward(state, hid, fid, targetId) {
    const fleet = state.fleets[fid];
    if (!fleet || fleet.systemId === targetId) return false;
    const next = R().nextHop(state, fleet, targetId, true);
    if (!next) return false;
    const res = A().moveFleet(state, hid, fleet.id, next);
    return res.ok;
  }

  // ---------------------------------------------------------------- analysis
  function totalLegions(state, hid) {
    return R().fleetsOf(state, hid).reduce((a, f) => a + (f.ships.legion || 0), 0);
  }

  function defensePower(state, sysId) {
    const sys = state.systems[sysId];
    let p = 0;
    for (const f of R().fleetsAt(state, sysId)) {
      if (f.owner === sys.owner) p += R().fleetPower(state, f);
    }
    const sb = R().starbasePower(state, sys);
    p += sb.atk + sb.hp / 2;
    return p;
  }

  function bestExpansion(state, hid, fleet, P) {
    const candidates = Object.values(state.systems).filter((s) => s.owner === 'independent' || s.owner === 'swarm');
    if (!candidates.length) return null;
    const myPower = R().fleetPower(state, fleet);
    const myGround = R().groundStrength(state, fleet);
    const cap = state.systems[state.houses[hid].capital];
    let best = null;
    for (const s of candidates) {
      const def = defensePower(state, s.id);
      const ground = R().groundDefense(state, s);
      if (def > myPower * 0.85 * P.aggression) continue;
      if (myGround < ground * 1.05 && (fleet.ships.legion || 0) > 0) {
        // can win orbit but not the ground — still okay to besiege if close
      }
      const value = s.baseCredits + s.baseProduction + s.baseScience;
      const d = IM.util.dist(s, cap) / 200 + IM.util.dist(s, state.systems[fleet.systemId]) / 150;
      const score = value / (1 + d) - def / 40;
      if (!best || score > best.score) best = { id: s.id, score };
    }
    // mission target gets priority
    const h = state.houses[hid];
    if (h.mission && h.mission.status === 'active' && h.mission.targetId) {
      const ms = state.systems[h.mission.targetId];
      if (ms && R().isHostile(state, hid, ms.owner) && defensePower(state, ms.id) < myPower) {
        return ms.id;
      }
    }
    return best ? best.id : null;
  }

  function bestPrey(state, hid, fleet, P) {
    const myPower = R().fleetPower(state, fleet);
    let best = null;
    for (const s of Object.values(state.systems)) {
      if (!R().isHostile(state, hid, s.owner)) continue;
      if (s.owner === 'swarm' && !state.civilWar) continue;
      const def = defensePower(state, s.id);
      if (def > myPower * P.aggression) continue;
      const grudge = state.houses[s.owner] ? (state.houses[hid].grudges[s.owner] || 0) : 0;
      const value = s.baseCredits + s.baseProduction + (s.isCapital ? 15 : 0) + (s.isSol ? 30 : 0) + grudge * 3;
      const d = IM.util.dist(s, state.systems[fleet.systemId]) / 150;
      const score = value / (1 + d) - def / 50;
      if (!best || score > best.score) best = { id: s.id, score };
    }
    return best ? best.id : null;
  }

  // Total hostile fleet power in or adjacent to our systems.
  function nearbyThreat(state, hid) {
    let threat = 0;
    const mine = new Set(R().systemsOf(state, hid).map((s) => s.id));
    for (const f of Object.values(state.fleets)) {
      if (!R().isHostile(state, hid, f.owner)) continue;
      const sys = state.systems[f.systemId];
      if (mine.has(sys.id) || sys.links.some((id) => mine.has(id))) {
        threat += R().fleetPower(state, f);
      }
    }
    return threat;
  }

  function nearestCrisis(state, hid, fleet) {
    // hostile fleets parked in/adjacent to our systems
    let best = null;
    for (const f of Object.values(state.fleets)) {
      if (!R().isHostile(state, hid, f.owner)) continue;
      const sys = state.systems[f.systemId];
      const mine = sys.owner === hid || sys.links.some((id) => state.systems[id].owner === hid);
      if (!mine) continue;
      const d = IM.util.dist(state.systems[fleet.systemId], sys);
      const power = R().fleetPower(state, f);
      if (!best || d < best.d) best = { systemId: f.systemId, d, power };
    }
    return best;
  }

  function isStrongest(state, hid, margin) {
    margin = margin || 1.0;
    const mine = R().housePower(state, hid) + R().countSystems(state, hid) * 15;
    for (const other of R().livingHouses(state)) {
      if (other === hid) continue;
      const theirs = R().housePower(state, other) + R().countSystems(state, other) * 15;
      if (mine < theirs * margin) return false;
    }
    return true;
  }

  function gloryLeader(state, hid) {
    let best = null;
    for (const other of R().livingHouses(state)) {
      if (other === hid) continue;
      const g = state.houses[other].glory;
      if (g > 30 && (!best || g > state.houses[best].glory)) best = other;
    }
    return best;
  }

  function strongestRival(state, hid) {
    let best = null;
    for (const other of R().livingHouses(state)) {
      if (other === hid) continue;
      const p = R().housePower(state, other);
      if (!best || p > best.p) best = { id: other, p };
    }
    return best ? best.id : null;
  }

  IM.ai = { takeTurn };
})();
