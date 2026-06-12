/* Imperator Maximus — rules.js
 * Derived values: incomes, modifiers, fleet stats, legality checks.
 * Pure reads — nothing in here mutates state.
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const D = IM.data;
  const { C } = D;

  function houseDef(houseId) {
    return D.HOUSES.find((h) => h.id === houseId) || null;
  }

  function factionColor(ownerId) {
    const hd = houseDef(ownerId);
    if (hd) return hd.color;
    return (D.NPC_FACTIONS[ownerId] || { color: '#888' }).color;
  }
  function factionName(ownerId) {
    const hd = houseDef(ownerId);
    if (hd) return hd.name;
    return (D.NPC_FACTIONS[ownerId] || { name: ownerId }).name;
  }

  function officesOf(state, houseId) {
    return D.OFFICE_ORDER.filter((k) => state.offices[k] === houseId);
  }

  // Aggregate a numeric modifier across house bonus + offices + techs.
  function mod(state, houseId, key) {
    let v = 0;
    const hd = houseDef(houseId);
    if (hd && hd.bonuses[key]) v += hd.bonuses[key];
    for (const ok of officesOf(state, houseId)) {
      const eff = D.OFFICES[ok].effect;
      if (eff[key]) v += eff[key];
    }
    const h = state.houses[houseId];
    if (h) {
      if (key === 'shipAttack') v += 0.08 * h.techs.war;
      if (key === 'creditMult') v += 0.1 * h.techs.industry;
      if (key === 'scienceMult') v += 0.1 * Math.min(h.techs.logistics, 1) + 0.1 * (h.techs.logistics >= 3 ? 1 : 0);
      if (key === 'upkeepMult') v -= 0.08 * h.techs.logistics;
      if (key === 'influencePerTurn') v += h.techs.logistics >= 3 ? 2 : 0;
      if (key === 'invasionMult') v += h.techs.logistics >= 4 ? 0.25 : 0;
    }
    return v;
  }

  function senateCostMult(state, houseId) {
    let m = 1;
    const hd = houseDef(houseId);
    if (hd && hd.bonuses.senateCostMult) m *= hd.bonuses.senateCostMult;
    if (state.offices.masterOfWhispers === houseId) m *= D.OFFICES.masterOfWhispers.effect.senateCostMult;
    return m;
  }

  function buildingSlots(state, houseId) {
    const h = state.houses[houseId];
    let slots = C.BASE_BUILDING_SLOTS;
    if (h) {
      if (h.techs.industry >= 2) slots++;
      if (h.techs.industry >= 4) slots++;
    }
    return slots;
  }

  function fleetRange(state, houseId) {
    const h = state.houses[houseId];
    return h && h.techs.logistics >= 2 ? 2 : 1;
  }

  function systemsOf(state, ownerId) {
    return Object.values(state.systems).filter((s) => s.owner === ownerId);
  }
  function fleetsOf(state, ownerId) {
    return Object.values(state.fleets).filter((f) => f.owner === ownerId);
  }
  function fleetsAt(state, systemId) {
    return Object.values(state.fleets).filter((f) => f.systemId === systemId);
  }

  function systemOutput(state, sys) {
    const h = state.houses[sys.owner];
    let credits = sys.baseCredits;
    let production = sys.baseProduction;
    let science = sys.baseScience;
    let influence = 0;
    for (const bk of sys.buildings) {
      const b = D.BUILDINGS[bk];
      credits += b.credits || 0;
      production += b.production || 0;
      science += b.science || 0;
      influence += b.influence || 0;
    }
    if (h) production += h.techs.industry; // +1 per tier
    if (sys.unrest > 0) {
      credits = Math.floor(credits * C.UNREST_OUTPUT_PENALTY);
      production = Math.floor(production * C.UNREST_OUTPUT_PENALTY);
      science = Math.floor(science * C.UNREST_OUTPUT_PENALTY);
    }
    return { credits, production, science, influence };
  }

  function houseIncome(state, houseId) {
    const out = { credits: 0, production: 0, science: 0, influence: C.BASE_INFLUENCE_PER_TURN, upkeep: 0 };
    for (const sys of systemsOf(state, houseId)) {
      const o = systemOutput(state, sys);
      out.credits += o.credits;
      out.science += o.science;
      out.influence += o.influence;
    }
    out.credits = Math.floor(out.credits * (1 + mod(state, houseId, 'creditMult')));
    out.science = Math.floor(out.science * (1 + mod(state, houseId, 'scienceMult')));
    out.influence += mod(state, houseId, 'influencePerTurn');
    // Fleet upkeep
    let upkeep = 0;
    for (const f of fleetsOf(state, houseId)) {
      for (const [k, n] of Object.entries(f.ships)) upkeep += D.SHIPS[k].upkeep * n;
    }
    upkeep = Math.ceil(upkeep * (1 + mod(state, houseId, 'upkeepMult')));
    out.upkeep = upkeep;
    out.net = out.credits - upkeep;
    return out;
  }

  // --- Fleet math
  function fleetShipCount(fleet) {
    return Object.values(fleet.ships).reduce((a, b) => a + b, 0);
  }
  function fleetAttack(state, fleet) {
    let atk = 0;
    for (const [k, n] of Object.entries(fleet.ships)) atk += D.SHIPS[k].atk * n;
    if (state.houses[fleet.owner]) atk *= 1 + mod(state, fleet.owner, 'shipAttack');
    return atk;
  }
  function fleetHP(fleet) {
    let hp = 0;
    for (const [k, n] of Object.entries(fleet.ships)) hp += D.SHIPS[k].hp * n;
    return hp;
  }
  function fleetPower(state, fleet) {
    return Math.round(fleetAttack(state, fleet) + fleetHP(fleet) / 2);
  }
  function housePower(state, houseId) {
    return fleetsOf(state, houseId).reduce((a, f) => a + fleetPower(state, f), 0);
  }
  function fleetLegions(fleet) {
    return fleet.ships.legion || 0;
  }
  function groundStrength(state, fleet) {
    const h = state.houses[fleet.owner];
    let per = D.SHIPS.legion.ground;
    if (h) per += 2 * h.techs.war;
    let str = (fleet.ships.legion || 0) * per;
    if (h) str *= 1 + mod(state, fleet.owner, 'invasionMult');
    // Swarm ground strength comes from its hulls
    if (fleet.owner === 'swarm') {
      str = (fleet.ships.swarmling || 0) * D.SHIPS.swarmling.ground + (fleet.ships.behemoth || 0) * D.SHIPS.behemoth.ground;
    }
    return str;
  }

  function starbasePower(state, sys) {
    if (sys.starbase <= 0 || sys.starbaseHP <= 0) return { atk: 0, hp: 0 };
    const sb = D.STARBASE[sys.starbase];
    let atk = sb.atk;
    const h = state.houses[sys.owner];
    if (h && h.techs.war >= 4) atk *= 1.25;
    return { atk, hp: sys.starbaseHP };
  }

  function groundDefense(state, sys) {
    let def = sys.garrison;
    if (sys.buildings.includes('fortress')) def *= 1 + D.BUILDINGS.fortress.defenseMult;
    return def;
  }

  // --- Hostility model.
  // Pre-Sundering: houses fight independents/swarm only; house and imperium
  // space is closed to rival fleets. Post-Sundering: everyone is fair game.
  function isHostile(state, a, b) {
    if (a === b) return false;
    const aHouse = !!state.houses[a];
    const bHouse = !!state.houses[b];
    if (a === 'swarm' || b === 'swarm') return true;
    if (a === 'independent' || b === 'independent') return true;
    if (aHouse && bHouse) return state.civilWar;
    if ((aHouse && b === 'imperium') || (bHouse && a === 'imperium')) return state.civilWar;
    return false;
  }

  // Can a fleet enter this system at all?
  function canEnter(state, fleet, sys) {
    if (sys.owner === fleet.owner) return true;
    if (isHostile(state, fleet.owner, sys.owner)) return true;
    return false; // closed space (pre-war rivals / imperium)
  }

  function moveTargets(state, fleet) {
    const here = state.systems[fleet.systemId];
    return here.links
      .map((id) => state.systems[id])
      .filter((s) => canEnter(state, fleet, s));
  }

  // --- Build legality
  function canBuildShip(state, sys, key) {
    const sd = D.SHIPS[key];
    if (!sd || sd.swarmOnly) return { ok: false, reason: 'Unknown hull.' };
    if (sd.needsShipyard && !sys.buildings.includes('shipyard')) {
      return { ok: false, reason: 'Requires a Shipyard here.' };
    }
    if (sd.needsTech) {
      const h = state.houses[sys.owner];
      if (!h || h.techs[sd.needsTech.track] < sd.needsTech.tier) {
        return { ok: false, reason: `Requires ${D.TECHS[sd.needsTech.track].name} ${['', 'I', 'II', 'III', 'IV'][sd.needsTech.tier]}.` };
      }
    }
    return { ok: true };
  }

  function shipCost(state, sys, key) {
    const sd = D.SHIPS[key];
    let cost = sd.cost;
    if (sys.buildings.includes('shipyard')) cost *= 1 - D.BUILDINGS.shipyard.shipDiscount;
    const hd = houseDef(sys.owner);
    if (key === 'legion' && hd && hd.bonuses.legionCostMult) cost *= hd.bonuses.legionCostMult;
    return Math.round(cost);
  }

  function buildingCost(state, sys, key) {
    let cost = D.BUILDINGS[key].cost;
    const hd = houseDef(sys.owner);
    if (hd && hd.bonuses.buildingCostMult) cost *= hd.bonuses.buildingCostMult;
    return Math.round(cost);
  }

  function canBuildBuilding(state, sys, key) {
    if (!D.BUILDINGS[key]) return { ok: false, reason: 'Unknown building.' };
    if (sys.buildings.includes(key)) return { ok: false, reason: 'Already built.' };
    const queued = sys.buildQueue.filter((q) => q.kind === 'building').length;
    const slots = buildingSlots(state, sys.owner);
    if (sys.buildings.length + queued >= slots) return { ok: false, reason: `All ${slots} building slots used.` };
    if (sys.buildQueue.some((q) => q.kind === 'building' && q.key === key)) {
      return { ok: false, reason: 'Already in queue.' };
    }
    return { ok: true };
  }

  function techCost(state, houseId, track) {
    const h = state.houses[houseId];
    const tier = h.techs[track] + 1;
    if (tier > 4) return null;
    let cost = D.TECH_COSTS[tier];
    const hd = houseDef(houseId);
    if (hd && hd.bonuses.techDiscount) cost *= 1 - hd.bonuses.techDiscount;
    return Math.round(cost);
  }

  // Victory-relevant counts
  function livingHouses(state) {
    return state.houseOrder.filter((id) => !state.houses[id].eliminated);
  }
  function countSystems(state, ownerId) {
    return systemsOf(state, ownerId).length;
  }

  IM.rules = {
    houseDef, factionColor, factionName, officesOf, mod, senateCostMult,
    buildingSlots, fleetRange, systemsOf, fleetsOf, fleetsAt, systemOutput,
    houseIncome, fleetShipCount, fleetAttack, fleetHP, fleetPower, housePower,
    fleetLegions, groundStrength, starbasePower, groundDefense, isHostile,
    canEnter, moveTargets, canBuildShip, shipCost, buildingCost,
    canBuildBuilding, techCost, livingHouses, countSystems,
  };
})();
