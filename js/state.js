/* Imperator Maximus — state.js
 * Game state creation and (de)serialization. The entire game is one JSON-
 * serializable object; all rules mutate it through IM.act / IM.turn. This is
 * deliberate: it makes hotseat, save/load, headless simulation, and a future
 * authoritative multiplayer server all share one engine.
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const { makeRng, attachRng } = IM.util;
  const D = IM.data;

  /**
   * config: {
   *   seed: number,
   *   players: { drakos:'human'|'ai', meridian:..., veyra:..., oryn:... }
   * }
   */
  function newGame(config) {
    const seed = config.seed >>> 0;
    const state = {
      v: 1,
      seed,
      rngDraws: 0,
      turn: 0, // incremented to 1 by the first startRound
      config: { seed, players: Object.assign({}, config.players) },
      gameOver: false,
      winner: null, // houseId
      defeat: null, // 'swarm' if everyone lost
      civilWar: false,
      civilWarTurn: null,
      civilWarCause: null,
      swarm: { active: false, activatedTurn: null, hiveId: null, wave: 0 },
      systems: {},
      fleets: {},
      nextFleetId: 1,
      houses: {},
      houseOrder: [],
      activeHouse: null, // whose turn within the round
      offices: { lordCommander: null, highChancellor: null, masterOfWhispers: null, archmagos: null },
      nextElectionTurn: D.C.FIRST_ELECTION,
      bids: {}, // houseId -> { officeKey: amount }
      solId: null,
      solHolder: null, // {houseId, sinceTurn} while a house holds Sol
      log: [],
      battleReports: [],
      pendingBattle: null, // last battle, for UI popup
      stats: {}, // houseId -> {conquests, battlesWon, legionsLost, shipsLost}
    };
    attachRng(state);

    // Galaxy
    const gen = IM.galaxy.generateGalaxy(state.rng, D.HOUSES.length);
    for (const s of gen.systems) state.systems[s.id] = s;
    state.solId = gen.solId;

    // Houses
    D.HOUSES.forEach((hd, i) => {
      const capId = gen.capitalIds[i];
      state.systems[capId].owner = hd.id;
      state.houses[hd.id] = {
        id: hd.id,
        control: config.players[hd.id] || 'ai',
        capital: capId,
        credits: D.C.START_CREDITS,
        influence: D.C.START_INFLUENCE,
        science: 0, // accumulated toward current research
        researchTrack: 'industry',
        techs: { war: 0, industry: 0, logistics: 0 },
        glory: 0,
        favor: 50,
        mission: null,
        nextMissionTurn: 2 + i, // stagger initial offers
        eliminated: false,
        outlawed: false,
        // diplomacy memory for AI flavor
        grudges: {},
      };
      state.houseOrder.push(hd.id);
      state.stats[hd.id] = { conquests: 0, battlesWon: 0, shipsLost: 0, missionsDone: 0 };
      // Starting fleet at the capital
      spawnFleet(state, hd.id, capId, { corvette: 3, frigate: 2, legion: 2 }, 'House Fleet');
    });

    // Imperium Praetor Fleet at Sol
    spawnFleet(state, 'imperium', state.solId, { cruiser: 4, frigate: 6, corvette: 4 }, 'Praetor Fleet');

    log(state, null, 'The Eternal Senate convenes. Four Great Houses swear the Oath of Expansion. The galaxy waits.', 'epoch');
    IM.turnEngine.startRound(state);
    return state;
  }

  function spawnFleet(state, owner, systemId, ships, name) {
    const id = 'f' + state.nextFleetId++;
    const fleet = {
      id,
      owner,
      systemId,
      ships: Object.assign({}, ships),
      name: name || 'Fleet ' + id.slice(1),
      moved: false,
      movesLeft: 0,
    };
    state.fleets[id] = fleet;
    return fleet;
  }

  function removeFleet(state, fleetId) {
    delete state.fleets[fleetId];
  }

  function log(state, houseId, text, type) {
    state.log.push({ turn: state.turn, houseId: houseId || null, text, type: type || 'info' });
    if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  }

  // --- Serialization: strip the live rng closure, keep the draw counter.
  function serialize(state) {
    const { rng, ...rest } = state;
    return JSON.stringify(rest);
  }

  function deserialize(json) {
    const state = JSON.parse(json);
    // migrations for saves from older builds
    if (!state.stats) {
      state.stats = {};
      for (const hid of state.houseOrder) {
        state.stats[hid] = { conquests: 0, battlesWon: 0, shipsLost: 0, missionsDone: 0 };
      }
    }
    attachRng(state);
    return state;
  }

  IM.state = { newGame, spawnFleet, removeFleet, log, serialize, deserialize };
})();
