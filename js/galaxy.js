/* Imperator Maximus — galaxy.js
 * Procedural galaxy generation: star systems, warp lanes, starting positions.
 * Layout: Sol at the center (Imperium core), four house capitals on an inner
 * ring, independent worlds filling the disc — richer and better defended the
 * farther out you go (the frontier is where glory is won).
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const { dist, makeNamePool } = IM.util;
  const { C } = IM.data;

  function generateGalaxy(rng, numHouses) {
    const R = C.MAP_RADIUS;
    const systems = [];
    let nextId = 0;

    function addSystem(props) {
      const s = Object.assign(
        {
          id: 'sys' + nextId++,
          name: '',
          x: 0,
          y: 0,
          ring: 0, // 0 core, 1 inner, 2 mid, 3 rim
          owner: 'independent',
          baseCredits: 4,
          baseProduction: 3,
          baseScience: 1,
          buildings: [],
          buildQueue: [],
          starbase: 0,
          starbaseHP: 0,
          garrison: 10,
          garrisonMax: 10,
          unrest: 0,
          links: [],
          isSol: false,
          isCapital: false,
          isHive: false,
        },
        props
      );
      systems.push(s);
      return s;
    }

    // --- Sol: the Throneworld
    addSystem({
      name: 'Sol',
      x: 0,
      y: 0,
      ring: 0,
      owner: 'imperium',
      baseCredits: 20,
      baseProduction: 14,
      baseScience: 8,
      buildings: ['tradehub', 'foundry', 'fortress', 'shipyard'],
      starbase: 3,
      starbaseHP: IM.data.STARBASE[3].hp,
      garrison: 60,
      garrisonMax: 60,
      isSol: true,
    });

    // --- Imperium core worlds around Sol
    const coreCount = 3;
    for (let i = 0; i < coreCount; i++) {
      const ang = (i / coreCount) * Math.PI * 2 + rng.r(-0.3, 0.3);
      const r = R * rng.r(0.13, 0.18);
      addSystem({
        x: Math.cos(ang) * r,
        y: Math.sin(ang) * r,
        ring: 0,
        owner: 'imperium',
        baseCredits: 10,
        baseProduction: 6,
        baseScience: 3,
        buildings: ['fortress'],
        starbase: 2,
        starbaseHP: IM.data.STARBASE[2].hp,
        garrison: 35,
        garrisonMax: 35,
      });
    }

    // --- House capitals on the inner ring, evenly spaced
    const capitals = [];
    const baseAng = rng.r(0, Math.PI * 2);
    for (let i = 0; i < numHouses; i++) {
      const ang = baseAng + (i / numHouses) * Math.PI * 2;
      const r = R * 0.38;
      const s = addSystem({
        x: Math.cos(ang) * r,
        y: Math.sin(ang) * r,
        ring: 1,
        baseCredits: 14,
        baseProduction: 10,
        baseScience: 5,
        buildings: ['tradehub', 'shipyard'],
        starbase: 1,
        starbaseHP: IM.data.STARBASE[1].hp,
        garrison: 25,
        garrisonMax: 25,
        isCapital: true,
      });
      capitals.push(s);
    }

    // --- Independent worlds fill the disc with minimum spacing
    const target = C.NUM_SYSTEMS;
    let guard = 0;
    while (systems.length < target && guard < 4000) {
      guard++;
      const ang = rng.r(0, Math.PI * 2);
      const r = R * Math.sqrt(rng.r(0.06, 1)) * rng.r(0.55, 1.0);
      if (r < R * 0.2) continue; // keep the core uncrowded
      const p = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
      const minD = R * 0.13;
      if (systems.some((s) => dist(s, p) < minD)) continue;

      const ring = r < R * 0.5 ? 1 : r < R * 0.78 ? 2 : 3;
      // Frontier worlds are richer but tougher (RTW: the far provinces).
      const rich = [0, 0.8, 1.15, 1.5][ring];
      const baseCredits = Math.round(rng.i(4, 9) * rich);
      const baseProduction = Math.round(rng.i(3, 7) * rich);
      const baseScience = Math.round(rng.i(1, 4) * rich);
      const garrison = Math.round(rng.i(8, 16) * [0, 1, 1.6, 2.4][ring]);
      const hasBase = ring >= 3 && rng.chance(0.5);
      addSystem({
        x: p.x,
        y: p.y,
        ring,
        baseCredits: Math.max(3, baseCredits),
        baseProduction: Math.max(2, baseProduction),
        baseScience,
        garrison,
        garrisonMax: garrison,
        starbase: hasBase ? 1 : 0,
        starbaseHP: hasBase ? IM.data.STARBASE[1].hp : 0,
      });
    }

    // --- Names
    const pool = makeNamePool(rng, systems.length);
    let pi = 0;
    for (const s of systems) {
      if (!s.name) s.name = pool[pi++];
    }

    // --- Warp lanes: connect each system to its 2–3 nearest neighbors,
    // then stitch any disconnected components together via closest pairs.
    for (const s of systems) {
      const others = systems
        .filter((o) => o !== s)
        .sort((a, b) => dist(s, a) - dist(s, b));
      const want = rng.chance(0.45) ? 3 : 2;
      for (let i = 0; i < want && i < others.length; i++) {
        link(s, others[i]);
      }
    }
    stitchComponents(systems);

    // Guarantee capitals are not adjacent to Sol or to each other (the long
    // road to the Throneworld is the point), by pruning those direct lanes
    // when alternatives exist.
    const sol = systems[0];
    for (const cap of capitals) {
      if (cap.links.includes(sol.id) && cap.links.length > 1 && sol.links.length > 1) {
        unlink(cap, sol);
        if (!isConnected(systems)) link(cap, sol);
      }
      for (const other of capitals) {
        if (other === cap) continue;
        if (cap.links.includes(other.id) && cap.links.length > 1 && other.links.length > 1) {
          unlink(cap, other);
          if (!isConnected(systems)) link(cap, other);
        }
      }
    }

    function link(a, b) {
      if (!a.links.includes(b.id)) a.links.push(b.id);
      if (!b.links.includes(a.id)) b.links.push(a.id);
    }
    function unlink(a, b) {
      a.links = a.links.filter((id) => id !== b.id);
      b.links = b.links.filter((id) => id !== a.id);
    }
    function isConnected(list) {
      const seen = new Set([list[0].id]);
      const byId = Object.fromEntries(list.map((s) => [s.id, s]));
      const stack = [list[0]];
      while (stack.length) {
        const s = stack.pop();
        for (const lid of s.links) {
          if (!seen.has(lid)) {
            seen.add(lid);
            stack.push(byId[lid]);
          }
        }
      }
      return seen.size === list.length;
    }
    function stitchComponents(list) {
      const byId = Object.fromEntries(list.map((s) => [s.id, s]));
      for (;;) {
        const seen = new Set();
        const stack = [list[0]];
        seen.add(list[0].id);
        while (stack.length) {
          const s = stack.pop();
          for (const lid of s.links) {
            if (!seen.has(lid)) {
              seen.add(lid);
              stack.push(byId[lid]);
            }
          }
        }
        if (seen.size === list.length) return;
        // find closest pair across the cut
        let best = null;
        for (const a of list) {
          if (!seen.has(a.id)) continue;
          for (const b of list) {
            if (seen.has(b.id)) continue;
            const d = dist(a, b);
            if (!best || d < best.d) best = { a, b, d };
          }
        }
        link(best.a, best.b);
      }
    }

    return { systems, capitalIds: capitals.map((c) => c.id), solId: sol.id };
  }

  IM.galaxy = { generateGalaxy };
})();
