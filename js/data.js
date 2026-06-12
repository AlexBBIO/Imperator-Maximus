/* Imperator Maximus — data.js
 * Static game data: houses, ships, buildings, techs, offices, missions,
 * senate actions, and tuning constants. Engine-safe (no DOM).
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});

  // ------------------------------------------------------------------ houses
  // The four Great Houses. Persona drives AI behavior and flavors bonuses.
  const HOUSES = [
    {
      id: 'drakos',
      name: 'House Drakos',
      epithet: 'The War-Forged',
      color: '#e25555',
      colorDim: '#7a2e2e',
      persona: 'warlord',
      blurb:
        'Hereditary marshals of the Rim Crusades. Drakos believes the ' +
        'Imperium is won by the sword and will be kept by it.',
      bonuses: { shipAttack: 0.1, legionCostMult: 0.8 },
      bonusText: '+10% ship attack · Legions cost −20%',
    },
    {
      id: 'meridian',
      name: 'House Meridian',
      epithet: 'The Gilded Hand',
      color: '#e8b440',
      colorDim: '#7d6122',
      persona: 'magnate',
      blurb:
        'Merchant princes who hold the Imperium’s purse strings. Every ' +
        'lane tithes them; every war is billed to someone else.',
      bonuses: { creditMult: 0.25, buildingCostMult: 0.85 },
      bonusText: '+25% credits · Buildings cost −15%',
    },
    {
      id: 'veyra',
      name: 'House Veyra',
      epithet: 'The Veiled Court',
      color: '#9a6ae0',
      colorDim: '#4f3675',
      persona: 'schemer',
      blurb:
        'Spymasters and kingmakers. Veyra has never won a battle and never ' +
        'lost a war.',
      bonuses: { influencePerTurn: 2, senateCostMult: 0.7 },
      bonusText: '+2 influence/turn · Senate actions cost −30%',
    },
    {
      id: 'oryn',
      name: 'House Oryn',
      epithet: 'The Ascendant Mind',
      color: '#4fc3a1',
      colorDim: '#2a6a57',
      persona: 'sage',
      blurb:
        'Heirs of the old science guilds. Oryn measures the other houses ' +
        'the way one measures dying stars: patiently.',
      bonuses: { scienceMult: 0.25, techDiscount: 0.1 },
      bonusText: '+25% science · Tech costs −10%',
    },
  ];

  const NPC_FACTIONS = {
    imperium: { id: 'imperium', name: 'The Eternal Senate', color: '#d8d8e8', colorDim: '#6a6a78' },
    independent: { id: 'independent', name: 'Independent Worlds', color: '#8a8f98', colorDim: '#4a4d53' },
    swarm: { id: 'swarm', name: 'The Vex Swarm', color: '#86e04f', colorDim: '#3f6a26' },
  };

  // ------------------------------------------------------------------- ships
  const SHIPS = {
    corvette: {
      key: 'corvette', name: 'Corvette', cost: 25, atk: 2, hp: 4, upkeep: 1,
      ground: 0, desc: 'Cheap escort. Dies in droves, screens for the line.',
    },
    frigate: {
      key: 'frigate', name: 'Frigate', cost: 50, atk: 5, hp: 10, upkeep: 2,
      ground: 0, desc: 'Backbone of early fleets.',
    },
    cruiser: {
      key: 'cruiser', name: 'Cruiser', cost: 110, atk: 12, hp: 24, upkeep: 4,
      ground: 0, needsShipyard: true, desc: 'Line warship. Requires a Shipyard.',
    },
    dreadnought: {
      key: 'dreadnought', name: 'Dreadnought', cost: 240, atk: 28, hp: 60,
      upkeep: 8, ground: 0, needsShipyard: true, needsTech: { track: 'war', tier: 3 },
      desc: 'Throneworld-cracker. Requires Shipyard and War III.',
    },
    legion: {
      key: 'legion', name: 'Legion', cost: 60, atk: 1, hp: 8, upkeep: 2,
      ground: 12, desc: 'Troop transport + ground legion. Takes worlds.',
    },
    // Swarm-only hulls
    swarmling: {
      key: 'swarmling', name: 'Swarmling', cost: 0, atk: 3, hp: 6, upkeep: 0,
      ground: 4, swarmOnly: true, desc: 'Chittering void-spawn.',
    },
    behemoth: {
      key: 'behemoth', name: 'Behemoth', cost: 0, atk: 18, hp: 50, upkeep: 0,
      ground: 15, swarmOnly: true, desc: 'A living siege engine.',
    },
  };
  const SHIP_ORDER = ['corvette', 'frigate', 'cruiser', 'dreadnought', 'legion'];

  // --------------------------------------------------------------- buildings
  const BUILDINGS = {
    tradehub: {
      key: 'tradehub', name: 'Trade Hub', cost: 60, credits: 6,
      desc: '+6 credits per turn.',
    },
    foundry: {
      key: 'foundry', name: 'Foundry', cost: 60, production: 4,
      desc: '+4 production per turn.',
    },
    lab: {
      key: 'lab', name: 'Research Lab', cost: 60, science: 4,
      desc: '+4 science per turn.',
    },
    fortress: {
      key: 'fortress', name: 'Fortress', cost: 80, garrisonMax: 25,
      defenseMult: 0.5,
      desc: '+25 max garrison, +50% ground defense.',
    },
    nexus: {
      key: 'nexus', name: 'Propaganda Nexus', cost: 80, influence: 2,
      desc: '+2 influence per turn.',
    },
    shipyard: {
      key: 'shipyard', name: 'Shipyard', cost: 100, shipDiscount: 0.15,
      desc: 'Unlocks Cruisers/Dreadnoughts here. Ships cost −15%.',
    },
  };
  const BUILDING_ORDER = ['tradehub', 'foundry', 'lab', 'fortress', 'nexus', 'shipyard'];

  // Starbase upgrade tiers (built through the queue like buildings).
  const STARBASE = [
    null,
    { cost: 80, atk: 6, hp: 30, name: 'Starbase I' },
    { cost: 150, atk: 14, hp: 70, name: 'Starbase II' },
    { cost: 250, atk: 24, hp: 120, name: 'Starbase III' },
  ];

  // ------------------------------------------------------------------- techs
  // Three tracks, four tiers. Effects are cumulative per tier.
  const TECH_COSTS = [0, 60, 140, 280, 480];
  const TECHS = {
    war: {
      name: 'War Doctrine',
      tiers: [
        null,
        { name: 'Mass Drivers', desc: '+8% ship attack, +2 legion strength.' },
        { name: 'Void Phalanx', desc: '+8% ship attack, +2 legion strength.' },
        { name: 'Dreadnought Hulls', desc: 'Unlocks Dreadnoughts. +8% attack, +2 legion.' },
        { name: 'Annihilation Arrays', desc: '+8% attack, +2 legion, starbases +25% power.' },
      ],
    },
    industry: {
      name: 'Industry',
      tiers: [
        null,
        { name: 'Orbital Refineries', desc: '+10% credits, +1 production all systems.' },
        { name: 'Auto-Foundries', desc: '+10% credits, +1 production, +1 building slot.' },
        { name: 'Stellar Lifting', desc: '+10% credits, +1 production all systems.' },
        { name: 'Worldforges', desc: '+10% credits, +1 production, +1 building slot.' },
      ],
    },
    logistics: {
      name: 'Logistics',
      tiers: [
        null,
        { name: 'Deep Lanes', desc: '−8% fleet upkeep, +10% science.' },
        { name: 'Warp Relays', desc: 'Fleets move 2 lanes per turn. −8% upkeep.' },
        { name: 'Whisper Network', desc: '+2 influence/turn, −8% upkeep, +10% science.' },
        { name: 'Drop Pod Doctrine', desc: '+25% invasion strength, −8% upkeep.' },
      ],
    },
  };
  const TECH_ORDER = ['war', 'industry', 'logistics'];

  // ----------------------------------------------------------------- offices
  // Elected every ELECTION_PERIOD turns via sealed influence bids.
  const OFFICES = {
    lordCommander: {
      key: 'lordCommander', name: 'Lord Commander',
      desc: '+15% fleet attack.', effect: { shipAttack: 0.15 },
    },
    highChancellor: {
      key: 'highChancellor', name: 'High Chancellor',
      desc: '+20% credit income.', effect: { creditMult: 0.2 },
    },
    masterOfWhispers: {
      key: 'masterOfWhispers', name: 'Master of Whispers',
      desc: '+3 influence/turn, senate actions cost −40%.',
      effect: { influencePerTurn: 3, senateCostMult: 0.6 },
    },
    archmagos: {
      key: 'archmagos', name: 'Archmagos Senatorial',
      desc: '+20% science.', effect: { scienceMult: 0.2 },
    },
  };
  const OFFICE_ORDER = ['lordCommander', 'highChancellor', 'masterOfWhispers', 'archmagos'];

  // ---------------------------------------------------------- senate actions
  const SENATE_ACTIONS = {
    curry: {
      key: 'curry', name: 'Curry Favor', cost: 20,
      desc: '+10 Senate favor. Gifts, banquets, strategic flattery.',
    },
    denounce: {
      key: 'denounce', name: 'Denounce Rival', cost: 25, needsTarget: true,
      desc: 'Target house loses 8 favor. They will know it was you.',
    },
    lobby: {
      key: 'lobby', name: 'Lobby for Mandate', cost: 15,
      desc: 'The Senate issues you a new mission immediately.',
    },
    sabotage: {
      key: 'sabotage', name: 'Sabotage', cost: 30, needsTarget: true,
      desc: 'Wreck the build queue of a rival system (loses all progress).',
    },
    incite: {
      key: 'incite', name: 'Incite Unrest', cost: 35, needsTarget: true,
      desc: '+3 unrest on a rival system, halving its output for turns.',
    },
  };

  // ---------------------------------------------------------------- missions
  // Templates; concrete targets are rolled when issued.
  const MISSION_TYPES = {
    conquer: {
      key: 'conquer',
      text: (m, sys) => `The Senate demands ${sys} be brought into the Imperium. Take it within ${m.deadline} turns.`,
      reward: { credits: 120, favor: 12, glory: 6, influence: 10 },
      failFavor: -10,
      declineFavor: -5,
      duration: 9,
    },
    muster: {
      key: 'muster',
      text: (m) => `Raise your fleet strength to ${m.amount} within ${m.deadline} turns. The Senate watches.`,
      reward: { credits: 80, favor: 10, glory: 3, influence: 8 },
      failFavor: -8,
      declineFavor: -4,
      duration: 8,
    },
    tribute: {
      key: 'tribute',
      text: (m) => `The Senate requires a tribute of ${m.amount} credits for the Throneworld fleet. Pay within ${m.deadline} turns.`,
      reward: { favor: 14, influence: 12, glory: 2 },
      failFavor: -10,
      declineFavor: -5,
      duration: 5,
    },
    purge: {
      key: 'purge',
      text: (m, sys) => `Vermin infest ${sys}. Destroy all hostile forces there within ${m.deadline} turns.`,
      reward: { credits: 150, favor: 14, glory: 8, influence: 10 },
      failFavor: -8,
      declineFavor: -4,
      duration: 8,
    },
  };

  // --------------------------------------------------------------- constants
  const C = {
    // Map
    NUM_SYSTEMS: 36,
    MAP_RADIUS: 1000, // abstract units; renderer scales

    // Economy
    START_CREDITS: 120,
    START_INFLUENCE: 25,
    BASE_INFLUENCE_PER_TURN: 3,
    BASE_BUILDING_SLOTS: 3,
    UNREST_OUTPUT_PENALTY: 0.5, // output multiplier while unrest > 0
    GARRISON_REGEN: 2,

    // Senate / civil war
    ELECTION_PERIOD: 10,
    FIRST_ELECTION: 8,
    GLORY_OUTLAW: 65, // glory >= this AND favor <= FAVOR_OUTLAW → outlawed
    FAVOR_OUTLAW: 25,
    GLORY_DECLARE: 45, // may voluntarily declare the Sundering
    AUTO_SUNDERING_TURN: 50, // the old Emperor dies heirless
    MISSION_INTERVAL: 6, // turns between offered missions

    // Glory awards
    GLORY_TAKE_INDEPENDENT: 5,
    GLORY_TAKE_HOUSE: 6,
    GLORY_TAKE_IMPERIUM: 8,
    GLORY_TAKE_SOL: 15,
    GLORY_WIN_BATTLE: 1,
    GLORY_OFFICE: 4,

    // Favor pressure: the Senate grows fearful of the glorious
    FAVOR_DECAY_GLORY_40: 1,
    FAVOR_DECAY_GLORY_60: 2,

    // Victory
    SOL_HOLD_TURNS: 3, // hold Sol this many consecutive round-starts to win
    SWARM_DOOM_SHARE: 0.45, // swarm owning this share of systems = everyone loses

    // Swarm
    SWARM_LATEST_TURN: 55, // activates by this turn even with no civil war
    SWARM_WAR_DELAY: 5, // activates this many turns after the Sundering
    SWARM_SPAWN_PERIOD_PEACE: 7,
    SWARM_SPAWN_PERIOD_WAR: 5,

    // Combat
    COMBAT_ROUNDS_MAX: 6,
    RETREAT_THRESHOLD: 0.35, // side below this fraction of start hp retreats

    // Turn limit safety for sims
    MAX_TURNS: 200,
  };

  IM.data = {
    HOUSES, NPC_FACTIONS, SHIPS, SHIP_ORDER, BUILDINGS, BUILDING_ORDER,
    STARBASE, TECH_COSTS, TECHS, TECH_ORDER, OFFICES, OFFICE_ORDER,
    SENATE_ACTIONS, MISSION_TYPES, C,
  };
})();
