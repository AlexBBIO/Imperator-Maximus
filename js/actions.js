/* Imperator Maximus — actions.js
 * The command interface. Humans (via UI) and AI both act through these
 * functions; each validates, mutates state, logs, and returns {ok, reason?}.
 * Keeping this the single write-path makes a future multiplayer server a
 * thin wrapper: serialize the action, validate on the host, broadcast.
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const D = IM.data;
  const { C } = D;
  const R = () => IM.rules;
  const log = (s, h, t, ty) => IM.state.log(s, h, t, ty);

  function err(reason) {
    return { ok: false, reason };
  }

  function guardTurn(state, houseId) {
    if (state.gameOver) return 'The game is over.';
    if (state.activeHouse !== houseId) return 'Not your turn.';
    const h = state.houses[houseId];
    if (!h || h.eliminated) return 'House is eliminated.';
    return null;
  }

  // ------------------------------------------------------------------- move
  function moveFleet(state, houseId, fleetId, targetId) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const fleet = state.fleets[fleetId];
    if (!fleet || fleet.owner !== houseId) return err('Not your fleet.');
    if (fleet.movesLeft <= 0) return err('Fleet has already moved this turn.');
    const here = state.systems[fleet.systemId];
    if (!here.links.includes(targetId)) return err('No warp lane to that system.');
    const target = state.systems[targetId];
    if (!R().canEnter(state, fleet, target)) {
      return err(`${R().factionName(target.owner)} space is closed to you until the Sundering.`);
    }

    fleet.systemId = targetId;
    fleet.movesLeft -= 1;

    // Hostile fleets present? Space battle resolves immediately.
    const enemies = R()
      .fleetsAt(state, targetId)
      .filter((f) => f.id !== fleet.id && R().isHostile(state, fleet.owner, f.owner));
    const hostileSystem = R().isHostile(state, fleet.owner, target.owner) && target.owner !== fleet.owner;
    let battle = null;
    if (enemies.length || (hostileSystem && target.starbase > 0 && target.starbaseHP > 0)) {
      const defFleets = enemies.filter((f) => f.owner === (enemies[0] ? enemies[0].owner : target.owner));
      battle = IM.combat.spaceBattle(state, target, [fleet], defFleets);
      if (battle.winner === houseId) {
        const h = state.houses[houseId];
        h.glory = Math.min(100, h.glory + C.GLORY_WIN_BATTLE);
      }
      fleet.movesLeft = 0; // battle ends the fleet's turn
    }
    return { ok: true, battle };
  }

  // Move along the shortest legal path toward target, spending as many moves
  // as available; halts on battle. Returns the last hop's result.
  function moveFleetPath(state, houseId, fleetId, targetId) {
    const fleet = state.fleets[fleetId];
    if (!fleet || fleet.owner !== houseId) return err('Not your fleet.');
    let last = err('No path to that system.');
    let guard = 0;
    while (state.fleets[fleetId] && state.fleets[fleetId].movesLeft > 0 && state.fleets[fleetId].systemId !== targetId && guard++ < 8) {
      const hop = R().nextHop(state, state.fleets[fleetId], targetId);
      if (!hop) break;
      last = moveFleet(state, houseId, fleetId, hop);
      if (!last.ok || last.battle) break;
    }
    return last;
  }

  // ----------------------------------------------------------------- invade
  function invade(state, houseId, fleetId) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const fleet = state.fleets[fleetId];
    if (!fleet || fleet.owner !== houseId) return err('Not your fleet.');
    const sys = state.systems[fleet.systemId];
    if (!R().isHostile(state, houseId, sys.owner)) return err('System is not hostile.');
    if ((fleet.ships.legion || 0) < 1) return err('No legions in this fleet.');
    if (sys.starbase > 0 && sys.starbaseHP > 0) return err('The starbase must be destroyed first.');
    const enemies = R()
      .fleetsAt(state, sys.id)
      .filter((f) => R().isHostile(state, houseId, f.owner));
    if (enemies.length) return err('Hostile fleets hold the orbit.');
    if (fleet.movesLeft <= 0 && fleet.invadedThisTurn) return err('Already acted this turn.');

    fleet.invadedThisTurn = true;
    const report = IM.combat.invade(state, fleet, sys);
    return { ok: true, battle: report };
  }

  // ------------------------------------------------------------ fleet admin
  function mergeFleets(state, houseId, fromId, intoId) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const a = state.fleets[fromId];
    const b = state.fleets[intoId];
    if (!a || !b || a.owner !== houseId || b.owner !== houseId) return err('Not your fleets.');
    if (a.systemId !== b.systemId) return err('Fleets are not in the same system.');
    for (const [k, n] of Object.entries(a.ships)) b.ships[k] = (b.ships[k] || 0) + n;
    b.movesLeft = Math.min(a.movesLeft, b.movesLeft);
    IM.state.removeFleet(state, fromId);
    return { ok: true };
  }

  function splitFleet(state, houseId, fleetId, shipCounts) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const fleet = state.fleets[fleetId];
    if (!fleet || fleet.owner !== houseId) return err('Not your fleet.');
    const taken = {};
    let total = 0;
    for (const [k, n] of Object.entries(shipCounts || {})) {
      const want = Math.max(0, Math.floor(n || 0));
      if (want === 0) continue;
      if ((fleet.ships[k] || 0) < want) return err('Not enough ships to split.');
      taken[k] = want;
      total += want;
    }
    if (total === 0) return err('Select ships to split off.');
    if (total >= R().fleetShipCount(fleet)) return err('Cannot split off the whole fleet.');
    for (const [k, n] of Object.entries(taken)) {
      fleet.ships[k] -= n;
      if (fleet.ships[k] === 0) delete fleet.ships[k];
    }
    const nf = IM.state.spawnFleet(state, houseId, fleet.systemId, taken, 'Detachment');
    nf.movesLeft = fleet.movesLeft;
    return { ok: true, fleetId: nf.id };
  }

  // ------------------------------------------------------------------ build
  // Items cost credits up front; production points determine build speed.
  function queueShip(state, houseId, systemId, key) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const sys = state.systems[systemId];
    if (!sys || sys.owner !== houseId) return err('Not your system.');
    const chk = R().canBuildShip(state, sys, key);
    if (!chk.ok) return chk;
    if (sys.buildQueue.length >= 6) return err('Queue is full.');
    const h = state.houses[houseId];
    const cost = R().shipCost(state, sys, key);
    if (h.credits < cost) return err(`Needs ${cost} credits.`);
    h.credits -= cost;
    sys.buildQueue.push({ kind: 'ship', key, cost, prodCost: Math.ceil(cost * 0.5), progress: 0 });
    return { ok: true };
  }

  function queueBuilding(state, houseId, systemId, key) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const sys = state.systems[systemId];
    if (!sys || sys.owner !== houseId) return err('Not your system.');
    const chk = R().canBuildBuilding(state, sys, key);
    if (!chk.ok) return chk;
    if (sys.buildQueue.length >= 6) return err('Queue is full.');
    const h = state.houses[houseId];
    const cost = R().buildingCost(state, sys, key);
    if (h.credits < cost) return err(`Needs ${cost} credits.`);
    h.credits -= cost;
    sys.buildQueue.push({ kind: 'building', key, cost, prodCost: Math.ceil(cost * 0.6), progress: 0 });
    return { ok: true };
  }

  function queueStarbase(state, houseId, systemId) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const sys = state.systems[systemId];
    if (!sys || sys.owner !== houseId) return err('Not your system.');
    const queued = sys.buildQueue.filter((q) => q.kind === 'starbase').length;
    const lvl = sys.starbase + queued + 1;
    if (lvl > 3) return err('Starbase is at maximum level.');
    if (sys.buildQueue.length >= 6) return err('Queue is full.');
    const h = state.houses[houseId];
    const cost = D.STARBASE[lvl].cost;
    if (h.credits < cost) return err(`Needs ${cost} credits.`);
    h.credits -= cost;
    sys.buildQueue.push({ kind: 'starbase', key: 'starbase', cost, prodCost: Math.ceil(cost * 0.6), progress: 0 });
    return { ok: true };
  }

  function cancelQueueItem(state, houseId, systemId, index) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const sys = state.systems[systemId];
    if (!sys || sys.owner !== houseId) return err('Not your system.');
    if (index < 0 || index >= sys.buildQueue.length) return err('No such item.');
    const item = sys.buildQueue.splice(index, 1)[0];
    state.houses[houseId].credits += item.cost; // full refund; progress is lost
    return { ok: true };
  }

  // --------------------------------------------------------------- research
  function setResearch(state, houseId, track) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    if (!D.TECHS[track]) return err('Unknown track.');
    const h = state.houses[houseId];
    if (h.techs[track] >= 4) return err('Track complete.');
    h.researchTrack = track;
    return { ok: true };
  }

  // ----------------------------------------------------------------- senate
  function senateAction(state, houseId, actionKey, target) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const h = state.houses[houseId];
    const a = D.SENATE_ACTIONS[actionKey];
    if (!a) return err('Unknown action.');
    if (state.civilWar && actionKey !== 'lobby') return err('The Senate hears no petitions during the Sundering.');
    const cost = Math.round(a.cost * R().senateCostMult(state, houseId));
    if (h.influence < cost) return err(`Needs ${cost} influence.`);

    if (actionKey === 'curry') {
      h.influence -= cost;
      h.favor = Math.min(100, h.favor + 10);
      log(state, houseId, `${R().factionName(houseId)} curries favor with the Senate (+10 favor).`, 'senate');
      return { ok: true };
    }
    if (actionKey === 'denounce') {
      const t = state.houses[target];
      if (!t || t.eliminated || target === houseId) return err('Pick a rival house.');
      h.influence -= cost;
      t.favor = Math.max(0, t.favor - 8);
      t.grudges[houseId] = (t.grudges[houseId] || 0) + 1;
      log(state, houseId, `${R().factionName(houseId)} denounces ${R().factionName(target)} before the Senate (−8 favor).`, 'senate');
      return { ok: true };
    }
    if (actionKey === 'lobby') {
      if (h.mission) return err('You already have an active mandate.');
      h.influence -= cost;
      IM.turnEngine.issueMission(state, houseId);
      return { ok: true };
    }
    if (actionKey === 'triumph') {
      h.influence -= cost;
      h.glory = Math.min(100, h.glory + 6);
      log(state, houseId, `${R().factionName(houseId)} stages a triumph: parades, medals, and very creative war dispatches (+6 glory).`, 'senate');
      return { ok: true };
    }
    if (actionKey === 'sabotage') {
      const sys = state.systems[target];
      if (!sys || !state.houses[sys.owner] || sys.owner === houseId) return err('Pick a rival system.');
      if (!sys.buildQueue.length) return err('Nothing to sabotage there.');
      h.influence -= cost;
      sys.buildQueue.forEach((q) => (q.progress = 0));
      const t = state.houses[sys.owner];
      t.grudges[houseId] = (t.grudges[houseId] || 0) + 2;
      log(state, null, `Saboteurs wreck the shipworks at ${sys.name}. ${R().factionName(sys.owner)} suspects a rival hand.`, 'senate');
      return { ok: true };
    }
    if (actionKey === 'incite') {
      const sys = state.systems[target];
      if (!sys || !state.houses[sys.owner] || sys.owner === houseId) return err('Pick a rival system.');
      h.influence -= cost;
      sys.unrest = Math.min(8, sys.unrest + 3);
      const t = state.houses[sys.owner];
      t.grudges[houseId] = (t.grudges[houseId] || 0) + 2;
      log(state, null, `Riots erupt on ${sys.name}. Agitators melt back into the crowds.`, 'senate');
      return { ok: true };
    }
    return err('Unhandled action.');
  }

  function setBid(state, houseId, officeKey, amount) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    if (!D.OFFICES[officeKey]) return err('Unknown office.');
    const h = state.houses[houseId];
    amount = Math.max(0, Math.floor(amount || 0));
    state.bids[houseId] = state.bids[houseId] || {};
    const totalOther = Object.entries(state.bids[houseId])
      .filter(([k]) => k !== officeKey)
      .reduce((a, [, v]) => a + v, 0);
    if (totalOther + amount > h.influence) return err('Total bids exceed your influence.');
    state.bids[houseId][officeKey] = amount;
    return { ok: true };
  }

  // ---------------------------------------------------------------- mission
  function respondMission(state, houseId, accept) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    const h = state.houses[houseId];
    if (!h.mission || h.mission.status !== 'offered') return err('No mission offer pending.');
    const m = h.mission;
    if (accept) {
      m.status = 'active';
      log(state, houseId, `${R().factionName(houseId)} accepts the Senate mandate.`, 'senate');
      // Tribute is resolved instantly if affordable at accept-time
      if (m.type === 'tribute') {
        if (h.credits >= m.amount) {
          h.credits -= m.amount;
          IM.turnEngine.completeMission(state, houseId);
        }
        // else: stays active; pay before the deadline via turn checks
      }
    } else {
      const tpl = D.MISSION_TYPES[m.type];
      h.favor = Math.max(0, h.favor + tpl.declineFavor);
      h.mission = null;
      h.nextMissionTurn = state.turn + C.MISSION_INTERVAL;
      log(state, houseId, `${R().factionName(houseId)} declines the Senate's mandate (${tpl.declineFavor} favor).`, 'senate');
    }
    return { ok: true };
  }

  // -------------------------------------------------------------- sundering
  function declareSundering(state, houseId) {
    const g = guardTurn(state, houseId);
    if (g) return err(g);
    if (state.civilWar) return err('The Sundering has already begun.');
    const h = state.houses[houseId];
    if (h.glory < C.GLORY_DECLARE) return err(`Requires ${C.GLORY_DECLARE} glory to defy the Senate.`);
    IM.turnEngine.beginSundering(state, houseId, 'declared');
    return { ok: true };
  }

  IM.act = {
    moveFleet, moveFleetPath, invade, mergeFleets, splitFleet, queueShip,
    queueBuilding, queueStarbase, cancelQueueItem, setResearch, senateAction,
    setBid, respondMission, declareSundering,
  };
})();
