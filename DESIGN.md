# IMPERATOR MAXIMUS — Design Document

> *Serve the Senate. Conquer the stars. Then march on the Throneworld.*

## 1. The Core Fantasy

This game is a love letter to one specific feeling from **Rome: Total War I**:
you are one of several great families serving the same state, nominally allies,
expanding the empire side by side — while everyone at the table knows exactly
how the story ends. One day the Senate will turn on the strongest of you, or
the strongest of you will turn on the Senate, and the empire will devour
itself. The end of every game is a **civil war between former allies**, fought
in the ruins of the thing you all built together.

Transposed to space:

- The **Terran Imperium** spans the inner systems. The **Eternal Senate** rules
  from **Sol**, the Throneworld.
- Four **Great Houses** swear the Oath of Expansion: push the frontier outward,
  bring the independent worlds into the Imperium, earn the Senate's mandates.
- Conquest brings **Glory** — and the Senate fears the glorious. Favor decays
  as fame grows. Eventually someone is declared *hostis* — outlaw — or someone
  decides they're strong enough and burns their Senate writ. Either way, the
  **Sundering** begins: all oaths void, every house for itself, and one prize —
  Sol.
- And while the houses knife each other, the **Vex Swarm** stirs at the rim.
  The longer the civil war rages, the stronger the Swarm grows. If it takes
  Sol or overruns the galaxy, **every house loses**. The game's central dread:
  *we will fight each other at the end — but if we fight too long, none of us
  inherits anything.*

## 2. Design Pillars

1. **Allies-but-rivals tension.** Pre-war, houses cannot attack each other —
   but they race for the same worlds, the same mandates, the same offices, and
   they can denounce, sabotage, and incite each other's worlds through the
   Senate's shadows. Cooperation with a countdown timer.
2. **Time your treason.** Glory is the victory resource *and* the doom clock.
   Expanding fast makes you the strongest house — and the first outlaw. Playing
   nice keeps the Senate happy while rivals out-grow you. The decision of
   *when* the war starts is itself the mid-game.
3. **Everyone can lose.** The Vex Swarm scales with the length of the civil
   war. A grinding stalemate is not a draw — it is collective death. This
   pushes endgame aggression and makes peace deals (in multiplayer table-talk)
   genuinely tense.
4. **Board-game readability.** Full information, no fog of war, numbers small
   enough to read at a glance, one screen. It should feel like a strategy
   board game you play with friends in a browser, not a spreadsheet.

## 3. Factions

| Faction | Persona | Bonuses |
|---|---|---|
| **House Drakos** — The War-Forged | warlord | +10% ship attack, legions −20% cost |
| **House Meridian** — The Gilded Hand | magnate | +25% credits, buildings −15% cost |
| **House Veyra** — The Veiled Court | schemer | +2 influence/turn, senate actions −30% cost |
| **House Oryn** — The Ascendant Mind | sage | +25% science, tech −10% cost |

Non-player factions:

- **The Eternal Senate (Imperium)** — holds Sol and 3 core worlds. Issues
  mandates, runs elections. Neutral until the Sundering, then its Praetor
  Fleet defends the Throneworld against all comers. Sol re-arms toward a
  capped strength — a hard target, but a finite one.
- **Independent Worlds** — the frontier. Garrisoned neutrals; richer and
  tougher the farther from Sol (the far provinces are where glory is won).
- **The Vex Swarm** — the crisis faction. Erupts at the rim a few turns after
  the Sundering begins (or by turn 55 regardless). Spawns brood-fleets at its
  hive on a cycle; wave size scales with how long the civil war has lasted.
  Killing the hive ends it permanently (+8 glory, +10 favor to the slayer).

## 4. The Map

Procedurally generated from a seed: ~36 systems on a disc, connected by warp
lanes (2–3 nearest neighbors, stitched into a single connected graph). Sol at
the center, ringed by Imperium core worlds; four house capitals evenly spaced
on an inner ring; independents fill the disc. Direct capital↔capital and
capital↔Sol lanes are pruned when possible — the road to the Throneworld
should be long.

Every system has: credit/production/science output, building slots (3 base,
+2 from Industry tech), a garrison (regenerates to max), optional starbase
(I–III), and unrest (halves output, decays 1/turn).

## 5. Economy

- **Credits** — the sinew of war. All construction is paid in credits up
  front; fleets cost upkeep per turn. Bankruptcy makes crews desert.
- **Production** — per-system build *speed* (queue progress per turn).
- **Science** — global pool; buys tech tiers on a chosen track.
- **Influence** — Senate currency: missions, intrigue, election bids.

Buildings: Trade Hub (+6⬡), Foundry (+4⚒), Research Lab (+4⚗), Fortress
(+25 garrison cap, +50% ground defense), Propaganda Nexus (+2❖), Shipyard
(unlocks Cruiser/Dreadnought locally, −15% ship cost).

## 6. Military

| Hull | Cost | Atk | HP | Upkeep | Notes |
|---|---|---|---|---|---|
| Corvette | 25 | 2 | 4 | 1 | screen fodder |
| Frigate | 50 | 5 | 10 | 2 | backbone |
| Cruiser | 110 | 12 | 24 | 4 | needs Shipyard |
| Dreadnought | 240 | 28 | 60 | 8 | needs Shipyard + War III |
| Legion | 60 | 1 | 8 | 2 | ground strength 12 (+2/War tier) |

- Fleets move 1 lane/turn (2 with Logistics II). Entering a hostile system
  resolves a **space battle** immediately: simultaneous fire in up to 6
  rounds, damage soaked cheapest-hull-first (escorts screen), defender adds
  starbase attack/HP, a side under 35% strength breaks off. Losers retreat to
  friendly space (or limp home if cornered).
- **Invasion**: orbit clear + starbase down + legions aboard → one ground
  battle roll (legion strength vs garrison×fortress). Capture loots credits,
  awards glory, sets unrest, and wipes the local starbase/queue.
- Pre-Sundering, house and Imperium space is **closed** to rival fleets — you
  literally cannot attack your peers until the war comes.

## 7. The Senate Game

- **Mandates (missions)**: conquer X / muster a fleet / pay tribute / purge
  hostiles — accept or decline; rewards in credits, favor, glory, influence;
  failure and refusal cost favor. The Senate remembers.
- **Offices** (election every 10 turns, sealed influence bids): Lord Commander
  (+15% fleet attack), High Chancellor (+20% credits), Master of Whispers
  (+3❖/turn, intrigue −40%), Archmagos (+20% science). Ties go to the favored.
- **Intrigue**: Curry Favor (+10⚖), Denounce (−8⚖ to a rival), Lobby for a
  mandate, Sabotage (wreck a rival queue's progress), Incite Unrest. Targets
  know *someone* did it; the AI holds grudges.

### Glory vs Favor — the doom clock

- Glory: +5 per independent world, +6/+8 per house/Imperium world, +15 for
  Sol, +1 per battle, +4 per office, + mission rewards.
- Favor decays 1/turn at ★40+, 2/turn at ★60+ (the Senate fears you).
- **Outlawry**: ★65 glory with ⚖25 favor or less → the Sundering begins, with
  you as the declared enemy of the Imperium.
- **Voluntary**: any house at ★45+ may declare the Sundering itself.
- **Succession crisis**: if nobody moves by turn 50, the Emperor dies heirless
  and the war comes anyway.

## 8. Victory & Defeat

- **Coronation**: after the Sundering, capture **Sol** and hold it for **3
  consecutive turns** (every rival sees the countdown and converges).
- **Last house standing**: destroy every rival house.
- **Collective defeat**: the Vex take Sol, or hold 45% of the galaxy. Nobody
  wins. The log makes sure you know whose fault it was.

## 9. Validated Balance (headless simulation)

`node tests/sim.js` runs 12 full AI-vs-AI games plus determinism and
save/load-equivalence checks. Current tuning produces, across seeds:

- **~90% house victories, ~10% collective Vex defeats** — the doom is real
  but not dominant.
- Sundering erupts organically around **turn 30–40** (mostly via outlawry,
  occasionally voluntary), games end around **turn 70–130**.
- Multiple different houses win across seeds (economy and war personas both
  viable). Veyra's schemer kit is influence-centric and underperforms in pure
  AI hands; in human hands sabotage/elections are considerably stronger.

Notable tuning levers (all in `js/data.js` → `C`): `GLORY_OUTLAW`,
`AUTO_SUNDERING_TURN`, `SWARM_SPAWN_PERIOD_*`, `SWARM_DOOM_SHARE`,
`SOL_HOLD_TURNS`.

## 10. Architecture

Zero-dependency vanilla JS, no build step. The engine is strictly separated
from the view:

```
js/util.js     seeded RNG (replayable draw counter), helpers
js/data.js     all static data + tuning constants
js/galaxy.js   procedural map generation
js/state.js    game-state creation, save/load (pure JSON)
js/rules.js    derived values (pure reads)
js/combat.js   space battles, invasions
js/actions.js  the ONLY write-path for player/AI commands (validated)
js/turn.js     round sequencing, senate, sundering, swarm, victory
js/ai.js       persona-driven AI (plays through actions.js like a human)
---
js/map.js      canvas renderer (pure view)
js/ui.js       DOM panels, modals, turn flow, hotseat, saves
tests/sim.js   headless full-game simulation + invariants
```

Determinism: every random draw goes through a counted, seeded stream stored in
the state; serialize → deserialize → continue produces an identical future.
This is what makes the next step cheap:

## 11. Multiplayer Roadmap

- **Now (v1)**: hotseat for 1–4 humans + AI, with a pass-the-device privacy
  screen. Export/import saves enables **play-by-mail** (send the JSON after
  your turn — works today).
- **Next (server)**: because all mutations flow through `IM.act.*` on a
  deterministic state, an authoritative Node server is a thin wrapper:
  validate `{houseId, action, args}` messages, apply to the canonical state,
  broadcast either the action stream or state snapshots over WebSocket. The
  client UI already only *reads* state and *calls* actions.
- **Design intent for online play**: sequential turns with a turn timer;
  Senate phases (elections, outlawry) are server events. Table-talk diplomacy
  stays out-of-band — the game deliberately has no formal treaties, because
  the whole point is that promises between houses aren't enforceable.

## 12. UX Design Notes (from the polish pass)

- **One click to anywhere in range.** Selecting a fleet highlights every
  system reachable this turn (marching-ant rings; fainter = farther); a click
  walks the whole path via shared BFS pathing. The same `fleetBFS` powers the
  AI's siege marches (`throughHostile` mode fights through defended systems)
  and the human range preview (strict mode predicts where battles stop you).
- **Surface state, don't bury it.** The top bar carries a live mission chip,
  an OUTLAW RISK pulse when glory/favor near the threshold, an idle-fleet
  badge on End Turn, and a pulsing Senate button when a mandate is offered.
- **"Since your last turn."** Between your turns, three rivals, the Senate,
  and the Vex all act. A digest panel lists exactly what happened to *you* —
  systems lost, battles fought against you, denouncements, epochs — instead
  of making players scrape the log.
- **Epoch splashes.** The Sundering, the Vex eruption, a hive burned, a house
  destroyed: full-screen interstitials, because the game's drama beats
  deserve more than a log line.
- **Phase-aware objectives card** teaches the loop (expand → manage
  glory/favor → war → crusade) and dismisses per phase.
- **Game-over chronicle**: conquests, battles won, ships lost, mandates per
  house — the after-action story players retell.

## 13. Future Work (post-prototype)

- Online multiplayer server (the engine is ready — see §11).
- Formal non-aggression pacts with public breaking (shame mechanics) — maybe.
- Rebellions: high-unrest worlds defecting to independents.
- More crisis variety (Vex variants, rogue Praetor remnant if Sol falls).
- Espionage visibility: Master of Whispers seeing rival mission targets.
- Tactical battle choices (formations/stances) instead of pure auto-resolve.
- Mobile layout pass; sound; animated fleet movement.
