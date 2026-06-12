/* Imperator Maximus — util.js
 * Seeded RNG, helpers, and name generators. Engine-safe (no DOM).
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});

  // --- Seeded RNG (mulberry32). All engine randomness flows through state.rng
  // so games are reproducible from (seed, action sequence).
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const next = mulberry32(seed);
    return {
      seed,
      // uniform [0,1)
      f() {
        return next();
      },
      // integer in [lo, hi] inclusive
      i(lo, hi) {
        return lo + Math.floor(next() * (hi - lo + 1));
      },
      // float in [lo, hi)
      r(lo, hi) {
        return lo + next() * (hi - lo);
      },
      pick(arr) {
        return arr[Math.floor(next() * arr.length)];
      },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      },
      chance(p) {
        return next() < p;
      },
    };
  }

  // Rebuild a live rng on a (de)serialized state. We store the seed plus a
  // draw counter; replaying draws restores the exact stream position.
  function attachRng(state) {
    const base = mulberry32(state.seed);
    for (let k = 0; k < state.rngDraws; k++) base();
    let next = base;
    const draw = () => {
      state.rngDraws++;
      return next();
    };
    state.rng = {
      f: draw,
      i(lo, hi) {
        return lo + Math.floor(draw() * (hi - lo + 1));
      },
      r(lo, hi) {
        return lo + draw() * (hi - lo);
      },
      pick(arr) {
        return arr[Math.floor(draw() * arr.length)];
      },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(draw() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      },
      chance(p) {
        return draw() < p;
      },
    };
    return state;
  }

  // --- Generic helpers
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function sum(arr, fn) {
    let s = 0;
    for (const v of arr) s += fn ? fn(v) : v;
    return s;
  }
  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // --- Star name generator. Mixes real-ish catalog roots with Latin flavor.
  const NAME_A = [
    'Acheron', 'Bellator', 'Cygnus', 'Drusus', 'Elysia', 'Ferrum', 'Gallia',
    'Hadria', 'Ilium', 'Juno', 'Kasius', 'Lucan', 'Maxima', 'Nerva', 'Ostia',
    'Pyrrhus', 'Quirinal', 'Ravenna', 'Severus', 'Tarquin', 'Umbra', 'Vesta',
    'Wexar', 'Xanthe', 'Ypres', 'Zama', 'Aquila', 'Brutus', 'Cato', 'Decima',
    'Erebus', 'Falx', 'Gradiva', 'Hyperia', 'Iantha', 'Korvath', 'Lyra',
    'Massilia', 'Numidia', 'Ophion', 'Palatine', 'Rubicon', 'Solenne',
    'Thracia', 'Utica', 'Vorta', 'Virelia', 'Tycho', 'Sirona',
    'Calder', 'Noxia', 'Praxis', 'Veii', 'Capua', 'Arpina', 'Brundis',
  ];
  const NAME_B = [
    'Prime', 'Secundus', 'Tertius', 'Reach', 'Gate', 'Verge', 'Deep',
    'Station', 'Cluster', 'Minor', 'Major', 'Spire', 'Drift', 'Anchorage',
    'Bastion', 'Expanse', 'Fall', 'Crown', 'Hold', 'Forge',
  ];

  function makeNamePool(rng, count) {
    const pool = [];
    const used = new Set();
    const roots = rng.shuffle(NAME_A.slice());
    let i = 0;
    while (pool.length < count) {
      let name;
      if (i < roots.length) {
        name = roots[i];
      } else {
        name = rng.pick(NAME_A) + ' ' + rng.pick(NAME_B);
      }
      i++;
      if (!used.has(name)) {
        used.add(name);
        pool.push(name);
      }
    }
    return pool;
  }

  IM.util = { makeRng, attachRng, clamp, dist, sum, deepClone, makeNamePool };
})();
