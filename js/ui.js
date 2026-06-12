/* Imperator Maximus — ui.js
 * DOM panels, modals, selection, turn flow, hotseat handoff, save/load.
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const D = IM.data;
  const { C } = D;
  const R = () => IM.rules;

  const SAVE_KEY = 'imperator_maximus_save_v1';

  // localStorage can throw (private mode, quota) — never let that kill a turn
  const store = {
    get(k) {
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); } catch (e) { /* best effort */ }
    },
    del(k) {
      try { localStorage.removeItem(k); } catch (e) { /* best effort */ }
    },
  };

  let state = null;
  let sel = { systemId: null, fleetId: null, splitOpen: false };
  let aiRunning = false;
  let shownMissionOffers = new Set();
  let lastHumanSeen = null;
  let lastLogIdxByHouse = {};
  let lastTurnByHouse = {};
  let epochQueue = [];
  let lastEpochIdx = 0;

  const $ = (id) => document.getElementById(id);

  // ============================================================== bootstrap
  function init() {
    buildSetupScreen();
    $('btn-start').onclick = startNewGame;
    $('btn-reroll').onclick = () => { $('setup-seed').value = String(Math.floor(Math.random() * 1e9)); };
    $('btn-rules').onclick = () => openHelp();
    $('btn-continue').onclick = continueSaved;
    if (store.get(SAVE_KEY)) $('btn-continue').style.display = '';

    $('btn-endturn').onclick = onEndTurn;
    $('btn-senate').onclick = () => openSenate();
    $('btn-research').onclick = () => openResearch();
    $('btn-domains').onclick = () => openDomains();
    $('btn-houses').onclick = () => openHouses();
    $('btn-help').onclick = () => openHelp();
    $('btn-menu').onclick = () => openMenu();
    $('btn-handoff').onclick = hideHandoff;
    $('btn-nextfleet').onclick = nextIdleFleet;
    $('mission-chip').onclick = () => openSenate();
    $('btn-epoch').onclick = nextEpochSplash;

    IM.map.init($('map-canvas'), { onClickSystem: onMapClick });
    document.addEventListener('keydown', (e) => {
      const inGame = state && $('game').style.display !== 'none';
      const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA';
      if (e.key === 'Escape') {
        if ($('epoch').style.display !== 'none') { nextEpochSplash(); return; }
        if (modalOpen()) { closeModal(); return; }
        sel = { systemId: null, fleetId: null, splitOpen: false };
        if (inGame) render();
        return;
      }
      if (!inGame || typing || $('handoff').style.display !== 'none' || $('epoch').style.display !== 'none') return;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (!modalOpen() && !aiRunning) nextIdleFleet();
      }
      if ((e.key === 'f' || e.key === 'F') && !modalOpen()) IM.map.fit();
      if (e.key === 'Enter' && !modalOpen() && !aiRunning) {
        const h = state.houses[state.activeHouse];
        if (h && h.control === 'human') onEndTurn();
      }
    });
  }

  // cycle through your fleets that can still move
  function nextIdleFleet() {
    if (!state || !isMyTurnHuman() || aiRunning || state.gameOver) return;
    const idle = R().fleetsOf(state, state.activeHouse).filter((f) => f.movesLeft > 0);
    if (!idle.length) { hint('No fleets with moves left.'); return; }
    idle.sort((a, b) => a.id.localeCompare(b.id));
    const cur = idle.findIndex((f) => f.id === sel.fleetId);
    const next = idle[(cur + 1) % idle.length];
    sel.fleetId = next.id;
    sel.systemId = next.systemId;
    sel.splitOpen = false;
    const s = state.systems[next.systemId];
    IM.map.centerOn(s.x, s.y);
    render();
  }

  function buildSetupScreen() {
    const root = $('setup-houses');
    root.innerHTML = '';
    D.HOUSES.forEach((hd, i) => {
      const div = document.createElement('div');
      div.className = 'house-card';
      div.style.setProperty('--hc', hd.color);
      div.innerHTML = `
        <h3>${hd.name}</h3>
        <span class="epithet">${hd.epithet}</span>
        <div class="blurb">${hd.blurb}</div>
        <div class="bonus">⭑ ${hd.bonusText}</div>
        <select id="setup-control-${hd.id}">
          <option value="human" ${i === 0 ? 'selected' : ''}>Human</option>
          <option value="ai" ${i !== 0 ? 'selected' : ''}>AI</option>
        </select>`;
      root.appendChild(div);
    });
  }

  function startNewGame() {
    const seedRaw = $('setup-seed').value.trim();
    const seed = seedRaw ? (parseInt(seedRaw, 10) >>> 0) : Math.floor(Math.random() * 1e9);
    const players = {};
    let humans = 0;
    for (const hd of D.HOUSES) {
      players[hd.id] = $(`setup-control-${hd.id}`).value;
      if (players[hd.id] === 'human') humans++;
    }
    if (humans === 0) {
      openConfirm('Observer mode?', 'No human houses are selected — you will watch four AIs fight for the throne.', 'Watch the fall', false, () => launchGame(seed, players));
      return;
    }
    launchGame(seed, players);
  }

  function launchGame(seed, players) {
    state = IM.state.newGame({ seed, players });
    IM.game = state; // exposed for console debugging / driving tests
    shownMissionOffers = new Set();
    lastHumanSeen = null;
    lastLogIdxByHouse = {};
    lastTurnByHouse = {};
    epochQueue = [];
    lastEpochIdx = state.log.length;
    sel = { systemId: null, fleetId: null, splitOpen: false };
    $('setup').style.display = 'none';
    $('game').style.display = 'flex';
    IM.map.setState(state);
    IM.map.resize();
    beginActiveTurn();
  }

  function continueSaved() {
    try {
      state = IM.state.deserialize(store.get(SAVE_KEY));
      IM.game = state;
    } catch (e) {
      alert('Save file is corrupted.');
      return;
    }
    shownMissionOffers = new Set();
    lastHumanSeen = null;
    lastLogIdxByHouse = {};
    lastTurnByHouse = {};
    epochQueue = [];
    lastEpochIdx = state.log.length;
    sel = { systemId: null, fleetId: null, splitOpen: false };
    $('setup').style.display = 'none';
    $('game').style.display = 'flex';
    IM.map.setState(state);
    IM.map.resize();
    beginActiveTurn();
  }

  function saveGame() {
    if (!state) return;
    store.set(SAVE_KEY, IM.state.serialize(state));
  }

  // ============================================================== turn flow
  function beginActiveTurn() {
    render();
    if (state.gameOver) { maybeShowEpochs(); openGameOver(); return; }
    const hid = state.activeHouse;
    const h = state.houses[hid];
    if (!h) return;
    if (h.control === 'ai') {
      runAITurns();
      return;
    }
    // human turn: hotseat handoff if a different human than last
    if (lastHumanSeen !== hid && countHumans() > 1) {
      showHandoff(hid);
    }
    lastHumanSeen = hid;
    maybeShowEpochs();
    showTurnReport(hid);
    // auto-open senate if a mandate offer is pending
    const offerKey = hid + ':' + state.turn + ':' + (h.mission ? h.mission.type : '');
    if (h.mission && h.mission.status === 'offered' && !shownMissionOffers.has(offerKey)) {
      shownMissionOffers.add(offerKey);
      openSenate();
    }
  }

  // ------------------------------------------------- since-your-last-turn
  function showTurnReport(hid) {
    const el = $('turn-report');
    el.style.display = 'none';
    const fromIdx = lastLogIdxByHouse[hid];
    const fromTurn = lastTurnByHouse[hid];
    if (fromIdx === undefined) return;
    const myName = R().factionName(hid);
    const items = [];
    for (const e of state.log.slice(fromIdx)) {
      const mentionsMe = e.text.includes(myName);
      if (e.type === 'epoch' || e.type === 'warn' || (e.type === 'conquest' && mentionsMe) || (e.type === 'senate' && mentionsMe)) {
        let cls = e.type === 'epoch' ? 'epoch' : '';
        if (e.type === 'conquest') cls = e.houseId === hid ? 'good' : 'bad';
        if (e.type === 'warn' && !mentionsMe && !/Vex/.test(e.text)) continue;
        items.push({ cls, text: e.text });
      }
    }
    for (const r of state.battleReports) {
      if (fromTurn !== undefined && r.turn >= fromTurn && (r.attacker === hid || r.defender === hid)) {
        const mineLosses = r.attacker === hid ? r.lossesA : r.lossesB;
        const n = Object.values(mineLosses || {}).reduce((a, b) => a + b, 0);
        if (r.type === 'space') {
          items.push({ cls: r.winner === hid ? 'good' : 'bad', text: `⚔ Battle of ${r.systemName}: ${R().factionName(r.winner)} holds the orbit${n ? ` (you lost ${n} ship${n > 1 ? 's' : ''})` : ''}.` });
        } else {
          items.push({ cls: r.captured ? (r.attacker === hid ? 'good' : 'bad') : '', text: `⬇ ${R().factionName(r.attacker)} ${r.captured ? 'took' : 'failed to take'} ${r.systemName}.` });
        }
      }
    }
    if (!items.length) return;
    el.innerHTML = `<h4>Since your last turn<button title="Close" id="tr-close">✕</button></h4>` +
      items.slice(-14).map((i) => `<div class="tr-entry ${i.cls}">${esc(i.text)}</div>`).join('');
    el.style.display = '';
    $('tr-close').onclick = () => { el.style.display = 'none'; renderObjectives(); };
    renderObjectives();
  }

  // ------------------------------------------------------- epoch splashes
  function classifyEpoch(text) {
    if (/SUNDERING BEGINS/.test(text)) {
      return { kicker: 'THE OATH IS BROKEN', title: 'THE SUNDERING', color: '#ff9d9d', text };
    }
    if (/VEX SWARM erupts/.test(text)) {
      return { kicker: 'FROM THE OUTER DARK', title: 'THE VEX SWARM RISES', color: '#86e04f', text };
    }
    if (/burns out the Vex hive/.test(text)) {
      return { kicker: 'THE CRUSADE IS WON', title: 'THE HIVE IS BURNED', color: '#9fd8c5', text };
    }
    if (/IS DESTROYED/.test(text)) {
      const m = text.match(/^(HOUSE \w+)/i);
      return { kicker: 'A NAME IS STRUCK FROM THE ROLLS', title: m ? m[1].toUpperCase() + ' FALLS' : 'A HOUSE FALLS', color: '#e8b440', text };
    }
    if (/stormed the Throneworld/.test(text)) {
      return { kicker: 'THE THRONEWORLD', title: 'SOL HAS FALLEN', color: '#ffe9b0', text };
    }
    return null;
  }

  function maybeShowEpochs() {
    while (lastEpochIdx < state.log.length) {
      const e = state.log[lastEpochIdx++];
      if (e.type === 'epoch') {
        const c = classifyEpoch(e.text);
        if (c) epochQueue.push(c);
      }
    }
    if (epochQueue.length && $('epoch').style.display === 'none') {
      const c = epochQueue.shift();
      $('epoch-kicker').textContent = c.kicker;
      $('epoch-title').textContent = c.title;
      $('epoch-title').style.color = c.color;
      $('epoch-text').textContent = c.text;
      $('epoch').style.display = 'flex';
    }
  }

  function nextEpochSplash() {
    $('epoch').style.display = 'none';
    maybeShowEpochs();
  }

  function countHumans() {
    return Object.values(state.houses).filter((h) => h.control === 'human' && !h.eliminated).length;
  }

  function onEndTurn() {
    if (!state || state.gameOver || aiRunning) return;
    const h = state.houses[state.activeHouse];
    if (!h || h.control !== 'human') return;
    lastLogIdxByHouse[state.activeHouse] = state.log.length;
    lastTurnByHouse[state.activeHouse] = state.turn;
    $('turn-report').style.display = 'none';
    sel.fleetId = null;
    sel.splitOpen = false;
    IM.turnEngine.endHouseTurn(state);
    saveGame();
    beginActiveTurn();
  }

  function runAITurns() {
    aiRunning = true;
    showAIBanner();
    const step = () => {
      if (state.gameOver) {
        aiRunning = false;
        hideAIBanner();
        render();
        openGameOver();
        return;
      }
      const hid = state.activeHouse;
      const h = state.houses[hid];
      if (!h || h.control === 'human') {
        aiRunning = false;
        hideAIBanner();
        saveGame();
        beginActiveTurn();
        return;
      }
      updateAIBanner(hid);
      IM.ai.takeTurn(state, hid);
      IM.turnEngine.endHouseTurn(state);
      render();
      maybeShowEpochs();
      setTimeout(step, 90);
    };
    setTimeout(step, 60);
  }

  function showAIBanner() {
    let b = $('ai-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'ai-banner';
      $('main').appendChild(b);
    }
    b.style.display = '';
  }
  function updateAIBanner(hid) {
    const b = $('ai-banner');
    if (b) {
      b.textContent = `${R().factionName(hid)} is moving…`;
      b.style.color = R().factionColor(hid);
    }
  }
  function hideAIBanner() {
    const b = $('ai-banner');
    if (b) b.style.display = 'none';
  }

  function showHandoff(hid) {
    const hd = R().houseDef(hid);
    $('handoff-title').textContent = `Pass to ${hd.name}`;
    $('handoff-title').style.color = hd.color;
    $('handoff-sub').textContent = `${hd.epithet} — Turn ${state.turn}. No peeking, rivals.`;
    $('handoff').style.display = 'flex';
  }
  function hideHandoff() {
    $('handoff').style.display = 'none';
  }

  // ================================================================ map sel
  function onMapClick(systemId) {
    if (!state || aiRunning) return;
    if (systemId === null) {
      sel.systemId = null;
      sel.fleetId = null;
      sel.splitOpen = false;
      render();
      return;
    }
    // fleet move? (click any reachable highlighted system — multi-hop paths
    // are walked automatically; battles halt the march)
    if (sel.fleetId) {
      const fleet = state.fleets[sel.fleetId];
      const h = state.houses[state.activeHouse];
      if (fleet && h && h.control === 'human' && fleet.owner === state.activeHouse && fleet.movesLeft > 0) {
        const reach = R().reachable(state, fleet);
        if (systemId in reach) {
          const res = IM.act.moveFleetPath(state, state.activeHouse, sel.fleetId, systemId);
          if (res.ok) {
            sel.systemId = state.fleets[sel.fleetId] ? state.fleets[sel.fleetId].systemId : systemId;
            if (!state.fleets[sel.fleetId]) sel.fleetId = null;
            render();
            if (res.battle) openBattle(res.battle);
            maybeShowEpochs();
            return;
          } else {
            hint(res.reason);
          }
        }
      }
    }
    sel.systemId = systemId;
    sel.fleetId = null;
    sel.splitOpen = false;
    // auto-select own single fleet for convenience
    const myFleets = R().fleetsAt(state, systemId).filter((f) => f.owner === state.activeHouse);
    if (myFleets.length === 1 && isMyTurnHuman()) sel.fleetId = myFleets[0].id;
    render();
  }

  function isMyTurnHuman() {
    const h = state.houses[state.activeHouse];
    return h && h.control === 'human';
  }

  let hintTimer = null;
  function hint(text) {
    const el = $('map-hint');
    el.textContent = text || '';
    el.style.color = '#ffb86b';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { el.style.color = ''; defaultHint(); }, 2600);
  }
  function defaultHint() {
    const el = $('map-hint');
    if (!state) return;
    if (sel.fleetId && state.fleets[sel.fleetId] && state.fleets[sel.fleetId].movesLeft > 0) {
      el.textContent = 'Click any highlighted system to move there · Tab: next fleet · Esc: deselect';
    } else {
      el.textContent = 'Click a system to inspect · Tab: cycle fleets · F: fit view · drag to pan, scroll to zoom';
    }
  }

  // ================================================================= render
  function render() {
    if (!state) return;
    IM.map.queueMoves(IM.bus.drainMoves());
    renderTopbar();
    renderSide();
    renderLog();
    renderObjectives();
    let reachable = {};
    if (sel.fleetId && state.fleets[sel.fleetId] && isMyTurnHuman()) {
      const fleet = state.fleets[sel.fleetId];
      if (fleet.movesLeft > 0) reachable = R().reachable(state, fleet);
    }
    IM.map.setHighlight({ selectedSystem: sel.systemId, selectedFleet: sel.fleetId, reachable });
    defaultHint();
  }

  function renderTopbar() {
    const hid = state.activeHouse;
    const h = state.houses[hid];
    const hd = R().houseDef(hid);
    if (hd && h) {
      $('banner-name').textContent = hd.name;
      $('banner-name').style.color = hd.color;
      $('banner-epithet').textContent = hd.epithet + (h.control === 'ai' ? ' (AI)' : '');
      const inc = R().houseIncome(state, hid);
      $('res-turn').innerHTML = `Turn <b>${state.turn}</b>`;
      $('res-credits').innerHTML = `⬡ <b>${Math.floor(h.credits)}</b> <span style="color:${inc.net >= 0 ? '#7fd6a8' : '#ff8a8a'}">(${inc.net >= 0 ? '+' : ''}${inc.net})</span>`;
      $('res-influence').innerHTML = `❖ <b>${Math.floor(h.influence)}</b> <span style="color:#9aa">+${inc.influence}</span>`;
      $('res-science').innerHTML = `⚗ <b>+${inc.science}</b>`;
      $('res-glory').innerHTML = `★ <b style="color:#e8c050">${h.glory}</b>`;
      $('res-favor').innerHTML = `⚖ <b style="color:${h.favor <= C.FAVOR_OUTLAW + 10 ? '#ff8a8a' : '#9fd8c5'}">${h.favor}</b>`;
    }
    const era = $('era-status');
    if (state.gameOver) {
      era.textContent = state.winner ? `${R().factionName(state.winner)} REIGNS` : 'THE GALAXY HAS FALLEN';
      era.className = state.winner ? '' : 'vex';
    } else if (state.civilWar) {
      era.textContent = '⚔ THE SUNDERING';
      era.className = 'war';
      if (state.solHolder) {
        const held = state.turn - state.solHolder.sinceTurn;
        era.textContent = `⚔ ${R().factionName(state.solHolder.houseId)} HOLDS SOL (${C.SOL_HOLD_TURNS - held} to coronation)`;
      }
    } else {
      era.textContent = 'PAX IMPERIA';
      era.className = '';
    }
    if (state.swarm.active && !state.gameOver) {
      era.textContent += ` · ☣ VEX×${R().countSystems(state, 'swarm')}`;
      if (!state.civilWar) era.className = 'vex';
    }

    // mission chip + senate pulse
    const chip = $('mission-chip');
    const h2 = state.houses[state.activeHouse];
    if (h2 && h2.mission && !state.gameOver) {
      const m = h2.mission;
      chip.style.display = '';
      if (m.status === 'offered') {
        chip.className = 'offered';
        chip.textContent = '⚖ The Senate offers a mandate — view';
      } else {
        chip.className = '';
        const left = Math.max(0, m.expiresTurn - state.turn);
        const what = { conquer: m.targetId ? 'Take ' + state.systems[m.targetId].name : 'Conquer', muster: `Muster power ${m.amount}`, tribute: `Tribute ⬡${m.amount}`, purge: m.targetId ? 'Purge ' + state.systems[m.targetId].name : 'Purge' }[m.type];
        chip.textContent = `⚖ ${what} · ${left}t left`;
      }
    } else {
      chip.style.display = 'none';
    }
    $('btn-senate').className = h2 && h2.mission && h2.mission.status === 'offered' ? 'pulse' : '';

    // outlaw-risk warning
    let risk = $('outlaw-chip');
    const inDanger = h2 && !state.civilWar && !state.gameOver &&
      h2.glory >= C.GLORY_OUTLAW - 10 && h2.favor <= C.FAVOR_OUTLAW + 12;
    if (inDanger) {
      if (!risk) {
        risk = document.createElement('span');
        risk.id = 'outlaw-chip';
        risk.className = 'warn-chip';
        risk.title = `At ★${C.GLORY_OUTLAW} glory and ⚖${C.FAVOR_OUTLAW} favor or less, the Senate declares you OUTLAW. Curry favor — or arm for the war you are about to start.`;
        era.insertAdjacentElement('afterend', risk);
      }
      risk.textContent = '⚠ OUTLAW RISK';
    } else if (risk) {
      risk.remove();
    }

    // end-turn idle fleet badge
    const endBtn = $('btn-endturn');
    let idleN = 0;
    if (isMyTurnHuman() && !state.gameOver) {
      idleN = R().fleetsOf(state, state.activeHouse).filter((f) => f.movesLeft > 0).length;
    }
    endBtn.innerHTML = 'End Turn ⏵' + (idleN ? `<span class="badge" title="Fleets that can still move">▲${idleN}</span>` : '');
    $('btn-nextfleet').style.display = idleN ? '' : 'none';
    endBtn.disabled = aiRunning || state.gameOver || !isMyTurnHuman();

    // idle build queues nudge on the Domains button
    let idleYards = 0;
    if (isMyTurnHuman() && !state.gameOver) {
      idleYards = R().systemsOf(state, state.activeHouse).filter((s) => !s.buildQueue.length).length;
    }
    $('btn-domains').innerHTML = 'Domains' + (idleYards ? `<span class="badge" style="background:rgba(255,159,67,.18);color:#ff9f43" title="Worlds with empty build queues">${idleYards}</span>` : '');
  }

  // phase-aware objectives card (dismissible per phase)
  function objectivesPhase() {
    if (state.gameOver) return null;
    if (state.civilWar && state.swarm.active) return 'vex';
    if (state.civilWar) return 'war';
    if (state.turn < 12) return 'early';
    return 'mid';
  }
  function objectiveText(phase) {
    return {
      early: ['<li>Take nearby <b>independent worlds</b> — fleets win the orbit, <b>Legions</b> take the ground.</li>',
        '<li>Build <b>Trade Hubs & Foundries</b>; queue ships at your capital.</li>',
        '<li>Accept Senate <b>mandates</b> for favor, credits and glory.</li>'].join(''),
      mid: [`<li>Watch <b>★glory vs ⚖favor</b> — at ★${C.GLORY_OUTLAW}/⚖${C.FAVOR_OUTLAW} you are outlawed and the war begins.</li>`,
        '<li>Bid <b>influence</b> in elections; sabotage whoever grows too strong.</li>',
        `<li>Stockpile a war chest. The Sundering comes by turn ${C.AUTO_SUNDERING_TURN}, ready or not.</li>`].join(''),
      war: [`<li>Take <b>Sol</b> and hold it ${C.SOL_HOLD_TURNS} turns to be crowned — or destroy every rival.</li>`,
        '<li>Concentrate your fleets; scattered squadrons die alone.</li>',
        '<li>End it quickly. Something is stirring at the rim.</li>'].join(''),
      vex: [`<li>The <b>Vex</b> grow while houses fight. At ${Math.round(C.SWARM_DOOM_SHARE * 100)}% of the galaxy, <b>everyone loses</b>.</li>`,
        '<li>Burning the <b>hive ☣</b> ends them — and is worth great glory.</li>',
        '<li>Sol still decides the throne. Balance crusade and conquest.</li>'].join(''),
    }[phase];
  }
  function renderObjectives() {
    const el = $('objectives');
    const phase = objectivesPhase();
    const reportOpen = $('turn-report').style.display !== 'none';
    if (!phase || reportOpen || store.get('im_obj_dismiss') === phase || !isMyTurnHuman()) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const titles = { early: 'The Oath of Expansion', mid: 'The Long Game', war: 'THE SUNDERING', vex: 'THE GALAXY BURNS' };
    el.innerHTML = `<h4>${titles[phase]}<button title="Dismiss" data-dismiss="${phase}">✕</button></h4><ul>${objectiveText(phase)}</ul>`;
    el.querySelector('[data-dismiss]').onclick = (e) => {
      store.set('im_obj_dismiss', e.target.dataset.dismiss);
      el.style.display = 'none';
    };
  }

  function renderLog() {
    const el = $('log');
    const recent = state.log.slice(-80);
    el.innerHTML = recent
      .map((e) => `<div class="entry ${e.type}"><span class="t">T${e.turn}</span>${esc(e.text)}</div>`)
      .join('');
    el.scrollTop = el.scrollHeight;
  }

  // ============================================================ side panel
  function renderSide() {
    const side = $('side');
    if (!sel.systemId || !state.systems[sel.systemId]) {
      side.className = '';
      side.innerHTML = '';
      return;
    }
    const sys = state.systems[sel.systemId];
    side.className = 'open';
    const out = R().systemOutput(state, sys);
    const ownCol = R().factionColor(sys.owner);
    const mine = sys.owner === state.activeHouse && isMyTurnHuman() && !aiRunning && !state.gameOver;

    let html = `
      <h2 style="color:${ownCol}">${esc(sys.name)}${sys.isSol ? ' 👑' : ''}${sys.isHive ? ' ☣' : ''}</h2>
      <div class="sub">${R().factionName(sys.owner)}${sys.isCapital ? ' — house capital' : ''}${sys.isSol ? ' — THE THRONEWORLD' : ''}</div>
      <div class="statline">
        <span>⬡ ${out.credits}</span><span>⚒ ${out.production}</span><span>⚗ ${out.science}</span>
        ${out.influence ? `<span>❖ ${out.influence}</span>` : ''}
        <span>🛡 ${Math.round(sys.garrison)}/${sys.garrisonMax}</span>
        ${sys.unrest > 0 ? `<span style="color:#ff9f43">⚠ unrest ${sys.unrest}</span>` : ''}
      </div>`;

    if (sys.starbase > 0) {
      html += `<div class="sub">${D.STARBASE[sys.starbase].name} — ${Math.max(0, Math.round(sys.starbaseHP))}/${D.STARBASE[sys.starbase].hp} hp</div>`;
    }

    html += `<h3>Buildings (${sys.buildings.length}/${R().buildingSlots(state, sys.owner)})</h3><div>`;
    html += sys.buildings.length
      ? sys.buildings.map((b) => `<span class="chip" title="${esc(D.BUILDINGS[b].desc)}">${D.BUILDINGS[b].name}</span>`).join('')
      : '<span class="sub">None</span>';
    html += '</div>';

    if (sys.buildQueue.length) {
      html += '<h3>Build queue</h3>';
      let backlog = 0;
      sys.buildQueue.forEach((q, i) => {
        const nm = q.kind === 'ship' ? D.SHIPS[q.key].name : q.kind === 'starbase' ? 'Starbase upgrade' : D.BUILDINGS[q.key].name;
        const pct = Math.round((q.progress / q.prodCost) * 100);
        backlog += q.prodCost - q.progress;
        const eta = out.production > 0 ? Math.ceil(backlog / out.production) : '∞';
        html += `<div class="queue-item"><span style="width:104px">${nm}</span>
          <span class="bar"><i style="width:${pct}%"></i></span><span class="eta" title="Turns until complete">${eta}t</span>
          ${mine ? `<button data-cancel="${i}" title="Cancel (refund credits)">✕</button>` : ''}</div>`;
      });
    }

    if (mine) {
      const h = state.houses[state.activeHouse];
      html += '<h3>Construct</h3>';
      for (const bk of D.BUILDING_ORDER) {
        const chk = R().canBuildBuilding(state, sys, bk);
        if (!chk.ok) continue;
        const cost = R().buildingCost(state, sys, bk);
        html += `<div class="row"><span class="nm" title="${esc(D.BUILDINGS[bk].desc)}">${D.BUILDINGS[bk].name}</span>
          <span class="cost">⬡${cost}</span>
          <button data-build="${bk}" ${h.credits < cost ? 'disabled' : ''}>Build</button></div>`;
      }
      if (sys.starbase + sys.buildQueue.filter((q) => q.kind === 'starbase').length < 3) {
        const lvl = sys.starbase + sys.buildQueue.filter((q) => q.kind === 'starbase').length + 1;
        const cost = D.STARBASE[lvl].cost;
        html += `<div class="row"><span class="nm">Starbase ${'I'.repeat(lvl) || 'I'} <span class="cost">(atk ${D.STARBASE[lvl].atk}, ${D.STARBASE[lvl].hp}hp)</span></span>
          <span class="cost">⬡${cost}</span>
          <button data-starbase="1" ${h.credits < cost ? 'disabled' : ''}>Build</button></div>`;
      }
      html += '<h3>Recruit</h3>';
      for (const sk of D.SHIP_ORDER) {
        const chk = R().canBuildShip(state, sys, sk);
        const sd = D.SHIPS[sk];
        const cost = R().shipCost(state, sys, sk);
        if (!chk.ok) {
          html += `<div class="row" style="opacity:.5"><span class="nm" title="${esc(sd.desc)}">${sd.name}</span><span class="cost">${esc(chk.reason)}</span></div>`;
          continue;
        }
        html += `<div class="row"><span class="nm" title="${esc(sd.desc)}">${sd.name} <span class="cost">⚔${sd.atk} ♥${sd.hp}${sd.ground ? ' ⬇' + sd.ground : ''} · ${sd.upkeep}⬡/t</span></span>
          <span class="cost">⬡${cost}</span>
          <button data-ship="${sk}" ${h.credits < cost ? 'disabled' : ''}>Build</button></div>`;
      }
    }

    // fleets at system
    const fleets = R().fleetsAt(state, sys.id);
    if (fleets.length) {
      html += '<h3>Fleets in orbit</h3>';
      for (const f of fleets) {
        const col = R().factionColor(f.owner);
        const ships = Object.entries(f.ships)
          .map(([k, n]) => `${n}× ${D.SHIPS[k].name}`)
          .join(', ');
        const isSel = sel.fleetId === f.id;
        const gs = Math.round(R().groundStrength(state, f));
        html += `<div class="fleet-card ${isSel ? 'sel' : ''}" data-fleet="${f.id}">
          <div class="fname" style="color:${col}">▲ ${esc(f.name)} <span style="color:var(--dim);font-weight:400">(${R().factionName(f.owner)})</span></div>
          <div class="fships">${ships}</div>
          <div class="fships">⚔ power ${R().fleetPower(state, f)}${gs ? ` · ⬇ ground ${gs}` : ''}${state.houses[f.owner] ? ` · moves ${'●'.repeat(f.movesLeft) || '—'}` : ''}</div>`;
        if (isSel && f.owner === state.activeHouse && isMyTurnHuman() && !state.gameOver) {
          html += renderFleetActions(f, sys);
        }
        html += '</div>';
      }
    }

    side.innerHTML = html;

    // --- wire events
    side.querySelectorAll('[data-build]').forEach((b) => {
      b.onclick = () => { const r = IM.act.queueBuilding(state, state.activeHouse, sys.id, b.dataset.build); if (!r.ok) hint(r.reason); render(); };
    });
    side.querySelectorAll('[data-ship]').forEach((b) => {
      b.onclick = () => { const r = IM.act.queueShip(state, state.activeHouse, sys.id, b.dataset.ship); if (!r.ok) hint(r.reason); render(); };
    });
    side.querySelectorAll('[data-starbase]').forEach((b) => {
      b.onclick = () => { const r = IM.act.queueStarbase(state, state.activeHouse, sys.id); if (!r.ok) hint(r.reason); render(); };
    });
    side.querySelectorAll('[data-cancel]').forEach((b) => {
      b.onclick = () => { IM.act.cancelQueueItem(state, state.activeHouse, sys.id, parseInt(b.dataset.cancel, 10)); render(); };
    });
    side.querySelectorAll('.fleet-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        sel.fleetId = sel.fleetId === card.dataset.fleet ? null : card.dataset.fleet;
        sel.splitOpen = false;
        render();
      };
    });
    wireFleetActionButtons(sys);
  }

  function renderFleetActions(f, sys) {
    let html = '<div class="fleet-actions">';
    // invade
    const canInvade =
      R().isHostile(state, f.owner, sys.owner) &&
      (f.ships.legion || 0) > 0 &&
      (sys.starbase === 0 || sys.starbaseHP <= 0) &&
      !R().fleetsAt(state, sys.id).some((x) => x.id !== f.id && R().isHostile(state, f.owner, x.owner));
    if (R().isHostile(state, f.owner, sys.owner)) {
      const gs = Math.round(R().groundStrength(state, f));
      const gd = Math.round(R().groundDefense(state, sys));
      html += `<button data-invade="${f.id}" ${canInvade ? '' : 'disabled'} title="Your ground strength ${gs} vs defense ${gd}">⬇ Invade (${gs} vs ${gd})</button>`;
    }
    // merge
    const others = R().fleetsAt(state, sys.id).filter((x) => x.id !== f.id && x.owner === f.owner);
    if (others.length) html += `<button data-merge="${f.id}">⇗ Merge all here</button>`;
    // split
    if (R().fleetShipCount(f) > 1) html += `<button data-splittoggle="${f.id}">⇄ Split…</button>`;
    html += '</div>';
    if (sel.splitOpen) {
      html += '<div class="split-grid">';
      for (const [k, n] of Object.entries(f.ships)) {
        html += `<span>${D.SHIPS[k].name} (${n})</span><input type="number" min="0" max="${n}" value="0" data-splitship="${k}">`;
      }
      html += `</div><button data-splitgo="${f.id}" class="primary">Detach</button>`;
    }
    return html;
  }

  function wireFleetActionButtons(sys) {
    const side = $('side');
    side.querySelectorAll('[data-invade]').forEach((b) => {
      b.onclick = () => {
        const r = IM.act.invade(state, state.activeHouse, b.dataset.invade);
        if (!r.ok) hint(r.reason);
        else if (r.battle) openBattle(r.battle);
        if (!state.fleets[sel.fleetId]) sel.fleetId = null;
        render();
        maybeShowEpochs();
      };
    });
    side.querySelectorAll('[data-merge]').forEach((b) => {
      b.onclick = () => {
        const into = b.dataset.merge;
        for (const f of R().fleetsAt(state, sys.id)) {
          if (f.id !== into && f.owner === state.activeHouse) IM.act.mergeFleets(state, state.activeHouse, f.id, into);
        }
        sel.fleetId = into;
        render();
      };
    });
    side.querySelectorAll('[data-splittoggle]').forEach((b) => {
      b.onclick = () => { sel.splitOpen = !sel.splitOpen; render(); };
    });
    side.querySelectorAll('[data-splitgo]').forEach((b) => {
      b.onclick = () => {
        const counts = {};
        side.querySelectorAll('[data-splitship]').forEach((inp) => {
          counts[inp.dataset.splitship] = parseInt(inp.value, 10) || 0;
        });
        const r = IM.act.splitFleet(state, state.activeHouse, b.dataset.splitgo, counts);
        if (!r.ok) hint(r.reason);
        else sel.splitOpen = false;
        render();
      };
    });
  }

  // ================================================================= modals
  function modalOpen() {
    return $('modal-root').style.display !== 'none';
  }
  function openModal(html) {
    $('modal').innerHTML = `<button class="close-x" onclick="IM.ui.closeModal()">✕</button>` + html;
    $('modal-root').style.display = '';
    $('modal-backdrop').onclick = closeModal;
  }
  function closeModal() {
    $('modal-root').style.display = 'none';
    if (state && state.pendingBattle) state.pendingBattle = null;
  }

  // styled in-UI confirm
  let confirmCb = null;
  function openConfirm(title, body, okLabel, danger, onOk) {
    confirmCb = onOk;
    openModal(`<h2>${esc(title)}</h2><div class="sub" style="font-size:14px;line-height:1.6">${body}</div>
      <div class="modal-actions">
        <button class="${danger ? 'danger' : 'primary'}" onclick="IM.ui.confirmOk()">${esc(okLabel)}</button>
        <button onclick="IM.ui.closeModal()">Not yet</button>
      </div>`);
  }
  function confirmOk() {
    const cb = confirmCb;
    confirmCb = null;
    closeModal();
    if (cb) cb();
  }

  // ---- Senate
  function openSenate() {
    const hid = state.activeHouse;
    const h = state.houses[hid];
    if (!h) return;
    const my = isMyTurnHuman() && !aiRunning && !state.gameOver;
    let html = `<h2>The Eternal Senate</h2>`;
    if (state.civilWar) {
      html += `<div class="sub" style="color:#ff9d9d">THE SUNDERING — turn ${state.civilWarTurn}. The Senate's writ is ash. Take Sol and hold it for ${C.SOL_HOLD_TURNS} turns, or stand alone among the houses.</div>`;
    } else {
      html += `<div class="sub">Glory wins the throne, but the Senate fears the glorious. At <b>★${C.GLORY_OUTLAW}</b> glory and <b>⚖${C.FAVOR_OUTLAW}</b> favor or less, a house is declared outlaw — and the Sundering begins. The Emperor's health fails: succession crisis no later than turn ${C.AUTO_SUNDERING_TURN}.</div>`;
    }

    // mission
    if (h.mission) {
      const m = h.mission;
      html += `<div class="mission-box"><h3 style="margin-top:0">Senate Mandate ${m.status === 'offered' ? '— OFFERED' : '— ACTIVE'}</h3>
        <div class="mtext">“${esc(IM.turnEngine.missionText(state, h))}”</div>
        <div class="sub">Reward: ${fmtReward(D.MISSION_TYPES[m.type].reward)} · Deadline: turn ${m.expiresTurn}</div>`;
      if (m.status === 'offered' && my) {
        html += `<div class="modal-actions">
          <button class="primary" onclick="IM.ui.missionRespond(true)">Accept the mandate</button>
          <button onclick="IM.ui.missionRespond(false)">Decline (${D.MISSION_TYPES[m.type].declineFavor} favor)</button></div>`;
      }
      html += '</div>';
    } else if (!state.civilWar) {
      html += `<div class="sub">No mandate. The Senate will offer one soon — or Lobby for one below.</div>`;
    }

    // senate actions
    if (!state.civilWar) {
      html += '<h3>Petitions & Intrigue</h3>';
      const mult = R().senateCostMult(state, hid);
      for (const [k, a] of Object.entries(D.SENATE_ACTIONS)) {
        const cost = Math.round(a.cost * mult);
        let control = '';
        if (my) {
          if (k === 'denounce') {
            const opts = R().livingHouses(state).filter((x) => x !== hid)
              .map((x) => `<option value="${x}">${R().factionName(x)}</option>`).join('');
            control = `<select id="sa-target-${k}">${opts}</select><button ${h.influence < cost ? 'disabled' : ''} onclick="IM.ui.senateAct('${k}')">Do it (❖${cost})</button>`;
          } else if (k === 'sabotage' || k === 'incite') {
            const opts = Object.values(state.systems)
              .filter((s) => state.houses[s.owner] && s.owner !== hid && (k === 'incite' || s.buildQueue.length))
              .map((s) => `<option value="${s.id}">${esc(s.name)} (${R().factionName(s.owner)})</option>`).join('');
            control = opts
              ? `<select id="sa-target-${k}">${opts}</select><button ${h.influence < cost ? 'disabled' : ''} onclick="IM.ui.senateAct('${k}')">Do it (❖${cost})</button>`
              : `<span class="sub">no valid target</span>`;
          } else {
            control = `<button ${h.influence < cost ? 'disabled' : ''} onclick="IM.ui.senateAct('${k}')">Do it (❖${cost})</button>`;
          }
        }
        html += `<div class="senate-action"><b style="width:120px">${a.name}</b><span class="desc">${esc(a.desc)}</span>${control}</div>`;
      }

      // election
      html += `<h3>Offices of the Imperium — election turn ${state.nextElectionTurn}</h3>
        <div class="sub">Sealed bids in influence. Highest bid takes the office (+${C.GLORY_OFFICE} glory). Ties favor the favored.</div><table>
        <tr><th>Office</th><th>Effect</th><th>Holder</th>${my ? '<th>Your bid</th>' : ''}</tr>`;
      for (const ok of D.OFFICE_ORDER) {
        const od = D.OFFICES[ok];
        const holder = state.offices[ok];
        const bid = (state.bids[hid] && state.bids[hid][ok]) || 0;
        html += `<tr><td><b>${od.name}</b></td><td>${esc(od.desc)}</td>
          <td style="color:${holder ? R().factionColor(holder) : 'var(--dim)'}">${holder ? R().factionName(holder) : '—'}</td>
          ${my ? `<td><input type="number" min="0" style="width:70px" value="${bid}" data-bid="${ok}"></td>` : ''}</tr>`;
      }
      html += '</table>';
      if (my) html += `<div class="modal-actions"><button onclick="IM.ui.saveBids()">Set bids</button></div>`;

      // sundering
      if (my) {
        const can = h.glory >= C.GLORY_DECLARE;
        html += `<h3 style="color:#ff9d9d">The Unthinkable</h3>
          <div class="sub">Burn your Senate writ and march on Sol. Every house becomes your enemy; the Praetor Fleet bars the Throneworld; the Vex will smell blood. Requires ★${C.GLORY_DECLARE} glory.</div>
          <button class="danger" ${can ? '' : 'disabled'} onclick="IM.ui.declareWar()">⚔ DECLARE THE SUNDERING</button>`;
      }
    }
    openModal(html);
  }

  function fmtReward(rw) {
    const parts = [];
    if (rw.credits) parts.push(`⬡${rw.credits}`);
    if (rw.favor) parts.push(`⚖+${rw.favor}`);
    if (rw.glory) parts.push(`★+${rw.glory}`);
    if (rw.influence) parts.push(`❖+${rw.influence}`);
    return parts.join(' ');
  }

  function missionRespond(accept) {
    const r = IM.act.respondMission(state, state.activeHouse, accept);
    if (!r.ok) hint(r.reason);
    closeModal();
    render();
  }

  function senateAct(key) {
    const tgtEl = $(`sa-target-${key}`);
    const r = IM.act.senateAction(state, state.activeHouse, key, tgtEl ? tgtEl.value : null);
    if (!r.ok) hint(r.reason);
    openSenate(); // refresh
    renderTopbar();
    renderLog();
  }

  function saveBids() {
    document.querySelectorAll('[data-bid]').forEach((inp) => {
      IM.act.setBid(state, state.activeHouse, inp.dataset.bid, parseInt(inp.value, 10) || 0);
    });
    hint('Bids sealed.');
    closeModal();
    render();
  }

  function declareWar() {
    openConfirm(
      'Declare the Sundering?',
      'Your Senate writ burns. Every house becomes your enemy, the Praetor Fleet bars Sol, and the Vex will smell the blood. <b>There is no going back.</b>',
      '⚔ BURN THE WRIT', true,
      () => {
        const r = IM.act.declareSundering(state, state.activeHouse);
        if (!r.ok) hint(r.reason);
        render();
        maybeShowEpochs();
      }
    );
  }

  // ---- Research
  function openResearch() {
    const hid = state.activeHouse;
    const h = state.houses[hid];
    const my = isMyTurnHuman() && !aiRunning && !state.gameOver;
    const inc = R().houseIncome(state, hid);
    let html = `<h2>Research</h2><div class="sub">⚗ ${inc.science} science per turn. Click a track to direct your scholars.</div>`;
    for (const tr of D.TECH_ORDER) {
      const td = D.TECHS[tr];
      const cur = h.techs[tr];
      const cost = R().techCost(state, hid, tr);
      const active = h.researchTrack === tr;
      html += `<div class="track ${active ? 'active' : ''}" ${my ? `onclick="IM.ui.pickTrack('${tr}')"` : ''}>
        <h4>${td.name} ${active ? '— researching' : ''}</h4><div class="tiers">`;
      for (let t = 1; t <= 4; t++) {
        const cls = cur >= t ? 'done' : cur + 1 === t ? 'next' : '';
        html += `<div class="tier ${cls}" title="${esc(td.tiers[t].desc)}"><b>${['', 'I', 'II', 'III', 'IV'][t]}</b> ${td.tiers[t].name}</div>`;
      }
      html += '</div>';
      if (cost !== null && active) {
        const pct = Math.min(100, Math.round((h.science / cost) * 100));
        html += `<div class="sub">${h.science}/${cost} science</div><div class="bar-outer"><i style="width:${pct}%"></i></div>`;
      } else if (cost === null) {
        html += `<div class="sub" style="color:var(--green)">Track complete.</div>`;
      }
      html += '</div>';
    }
    openModal(html);
  }

  function pickTrack(tr) {
    IM.act.setResearch(state, state.activeHouse, tr);
    openResearch();
  }

  // ---- Domains: your empire at a glance
  function openDomains() {
    const hid = state.activeHouse;
    const mine = R().systemsOf(state, hid);
    if (!mine.length) { hint('You hold no worlds.'); return; }
    mine.sort((a, b) => (b.isCapital - a.isCapital) || (R().systemOutput(state, b).production - R().systemOutput(state, a).production));
    let rows = '';
    for (const s of mine) {
      const out = R().systemOutput(state, s);
      let queue;
      if (s.buildQueue.length) {
        const q = s.buildQueue[0];
        const nm = q.kind === 'ship' ? D.SHIPS[q.key].name : q.kind === 'starbase' ? 'Starbase' : D.BUILDINGS[q.key].name;
        const backlog = s.buildQueue.reduce((a, x) => a + x.prodCost - x.progress, 0);
        const eta = out.production > 0 ? Math.ceil(backlog / out.production) : '∞';
        queue = `${nm}${s.buildQueue.length > 1 ? ` +${s.buildQueue.length - 1}` : ''} <span style="color:var(--dim)">(${eta}t)</span>`;
      } else {
        queue = '<span style="color:#ff9f43">IDLE</span>';
      }
      rows += `<tr class="domain-row" data-sys="${s.id}" style="cursor:pointer" title="Click to view on map">
        <td><b>${esc(s.name)}</b>${s.isCapital ? ' ★' : ''}${s.unrest > 0 ? ' <span style="color:#ff9f43">⚠</span>' : ''}</td>
        <td class="num">${out.credits}</td><td class="num">${out.production}</td><td class="num">${out.science}</td>
        <td class="num">${Math.round(s.garrison)}/${s.garrisonMax}</td>
        <td class="num">${s.starbase ? 'I'.repeat(s.starbase) : '—'}</td>
        <td>${queue}</td>
        <td class="num">${s.buildings.length}/${R().buildingSlots(state, hid)}</td></tr>`;
    }
    const inc = R().houseIncome(state, hid);
    openModal(`<h2>Your Domains</h2>
      <div class="sub">${mine.length} world${mine.length > 1 ? 's' : ''} · net ⬡${inc.net >= 0 ? '+' : ''}${inc.net}/turn (upkeep ${inc.upkeep}) · ⚗${inc.science}/turn · idle yards glow orange. Click a row to jump there.</div>
      <table>
        <tr><th>World</th><th>⬡</th><th>⚒</th><th>⚗</th><th>🛡</th><th>SB</th><th>Building</th><th>Slots</th></tr>
        ${rows}
      </table>`);
    document.querySelectorAll('.domain-row').forEach((row) => {
      row.onclick = () => {
        const s = state.systems[row.dataset.sys];
        closeModal();
        sel.systemId = s.id;
        sel.fleetId = null;
        IM.map.centerOn(s.x, s.y);
        render();
      };
    });
  }

  // ---- Houses overview
  function openHouses() {
    let html = `<h2>The Great Houses</h2><div class="sub">Know your rivals. They are watching you too.</div><table>
      <tr><th>House</th><th>Systems</th><th>Power</th><th>★ Glory</th><th>⚖ Favor</th><th>Offices</th></tr>`;
    for (const hid of state.houseOrder) {
      const h = state.houses[hid];
      const hd = R().houseDef(hid);
      const offices = R().officesOf(state, hid).map((o) => D.OFFICES[o].name).join(', ') || '—';
      if (h.eliminated) {
        html += `<tr style="opacity:.4"><td style="color:${hd.color}">${hd.name}</td><td colspan="5">DESTROYED</td></tr>`;
        continue;
      }
      html += `<tr>
        <td style="color:${hd.color}"><b>${hd.name}</b>${h.outlawed ? ' <span style="color:#ff8a8a">[OUTLAW]</span>' : ''}<br><span style="color:var(--dim);font-size:11px">${hd.bonusText}</span></td>
        <td class="num">${R().countSystems(state, hid)}</td>
        <td class="num">${R().housePower(state, hid)}</td>
        <td><div class="meter"><span class="num">${h.glory}</span><span class="m"><i style="width:${h.glory}%;background:#e8c050"></i></span></div></td>
        <td><div class="meter"><span class="num">${h.favor}</span><span class="m"><i style="width:${h.favor}%;background:${h.favor <= C.FAVOR_OUTLAW ? '#e25555' : '#4fc3a1'}"></i></span></div></td>
        <td style="font-size:12px">${offices}</td></tr>`;
    }
    html += `</table>
      <h3>The board</h3>
      <div class="sub">
        The Eternal Senate holds <b>${R().countSystems(state, 'imperium')}</b> core worlds including Sol.
        Independents: <b>${R().countSystems(state, 'independent')}</b>.
        ${state.swarm.active ? `<span style="color:#86e04f">Vex Swarm: <b>${R().countSystems(state, 'swarm')}</b> worlds (${Math.round((R().countSystems(state, 'swarm') / Object.keys(state.systems).length) * 100)}% — at ${Math.round(C.SWARM_DOOM_SHARE * 100)}% all houses lose).</span>` : 'The rim is quiet. Too quiet.'}
      </div>
      <div class="sub">Victory: take <b>Sol</b> after the Sundering and hold it ${C.SOL_HOLD_TURNS} turns, or be the last house standing.</div>`;
    openModal(html);
  }

  // ---- Battle report
  function openBattle(rep) {
    if (!rep) return;
    state.pendingBattle = null;
    const aCol = R().factionColor(rep.attacker);
    const dCol = R().factionColor(rep.defender);
    let html = '';
    if (rep.type === 'space') {
      // survivors: whatever fleets remain at the system now
      const survivors = R().fleetsAt(state, rep.systemId)
        .filter((f) => f.owner === rep.winner)
        .map((f) => Object.entries(f.ships).map(([k, n]) => `${n}× ${D.SHIPS[k].name}`).join(', '))
        .join(' + ');
      html = `<h2>Battle of ${esc(rep.systemName)}</h2>
        <div class="battle-side">
          <div><h4 style="color:${aCol}">${R().factionName(rep.attacker)}</h4>${lossList(rep.lossesA)}</div>
          <div class="battle-vs">⚔</div>
          <div style="text-align:right"><h4 style="color:${dCol}">${R().factionName(rep.defender)}</h4>${lossList(rep.lossesB)}</div>
        </div>
        <div class="sub" style="text-align:center">${rep.rounds.length} round(s) of fire${rep.sbDestroyed ? ' · starbase destroyed' : ''}${rep.retreated ? ` · ${R().factionName(rep.retreated)} broke off` : ''}</div>
        <div class="battle-result" style="color:${R().factionColor(rep.winner)}">${R().factionName(rep.winner)} holds the orbit</div>
        ${survivors ? `<div class="sub" style="text-align:center">Survivors: ${esc(survivors)}</div>` : ''}`;
    } else {
      html = `<h2>Invasion of ${esc(rep.systemName)}</h2>
        <div class="battle-side">
          <div><h4 style="color:${aCol}">${R().factionName(rep.attacker)}</h4><div class="sub">Ground force ${rep.atkStr}</div><div class="sub">Legions lost: ${rep.legionsLost}</div></div>
          <div class="battle-vs">⬇</div>
          <div style="text-align:right"><h4 style="color:${dCol}">${R().factionName(rep.defender)}</h4><div class="sub">Defense ${rep.defStr}</div></div>
        </div>
        <div class="battle-result" style="color:${rep.success ? aCol : dCol}">
          ${rep.success ? `${esc(rep.systemName)} has fallen${rep.loot ? ` — looted ⬡${rep.loot}, ★+${rep.glory} glory` : ''}` : 'The invasion is repulsed'}</div>`;
    }
    html += `<div class="modal-actions"><button class="primary" onclick="IM.ui.closeModal()">Continue</button></div>`;
    openModal(html);
  }

  function lossList(losses) {
    const e = Object.entries(losses);
    if (!e.length) return '<div class="sub">No losses</div>';
    return '<div class="sub">Lost: ' + e.map(([k, n]) => `${n}× ${D.SHIPS[k].name}`).join(', ') + '</div>';
  }

  // ---- Menu / help / game over
  function openMenu() {
    let html = `<h2>Imperator Maximus</h2>
      <div class="modal-actions" style="flex-direction:column;align-items:stretch">
        <button onclick="IM.ui.menuSave()">💾 Save game</button>
        <button onclick="IM.ui.menuExport()">⬇ Export save (JSON)</button>
        <button onclick="IM.ui.menuImport()">⬆ Import save</button>
        <button class="danger" onclick="IM.ui.menuNew()">✦ New game (abandon current)</button>
      </div>
      <div class="sub" style="margin-top:10px">Seed: <span style="font-family:var(--font-mono)">${state ? state.seed : '—'}</span> · autosaves at end of each turn</div>`;
    openModal(html);
  }
  function menuSave() { saveGame(); hint('Saved.'); closeModal(); }
  function menuExport() {
    const blob = new Blob([IM.state.serialize(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `imperator-maximus-t${state.turn}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function menuImport() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = () => {
      const file = inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          state = IM.state.deserialize(reader.result);
          IM.game = state;
          sel = { systemId: null, fleetId: null, splitOpen: false };
          IM.map.setState(state);
          closeModal();
          beginActiveTurn();
        } catch (e) {
          alert('Could not read that save.');
        }
      };
      reader.readAsText(file);
    };
    inp.click();
  }
  function menuNew() {
    openConfirm('Abandon this game?', 'The current campaign will remain in your autosave until you start a new one.', 'Abandon', true, () => {
      $('game').style.display = 'none';
      $('setup').style.display = 'flex';
      if (store.get(SAVE_KEY)) $('btn-continue').style.display = '';
    });
  }

  function openHelp() {
    openModal(`<h2>How to Play</h2>
      <h3>The premise</h3>
      <div class="sub">You lead one of four Great Houses of a stellar Imperium. For now you are allies in name — conquering the frontier in the Senate's name, trading favors, rigging elections. But there is one throne, and everyone knows how this ends. When the <b>Sundering</b> comes, all oaths burn, and the houses march on <b>Sol</b>.</div>
      <h3>Each turn</h3>
      <div class="sub">
        • Click a system → build economy (<b>Trade Hubs, Foundries, Labs</b>), defenses, and ships. Items cost ⬡credits up front; ⚒production sets the speed.<br>
        • Select a fleet (▲), then click <b>any highlighted system</b> — it travels the whole path automatically. Battles halt the march.<br>
        • To take a world: win the orbit, destroy any starbase, then <b>Invade</b> with Legions aboard.<br>
        • Visit the <b>Senate</b>: mandates (missions) earn ⚖favor and ★glory; spend ❖influence to curry favor, denounce rivals, sabotage their shipyards, stage triumphs, or rig elections for powerful offices.
      </div>
      <h3>Controls</h3>
      <div class="sub">
        <b>Tab</b> — cycle fleets with moves left · <b>Enter</b> — end turn · <b>F</b> — fit map · <b>Esc</b> — close/deselect · drag to pan, scroll to zoom
      </div>
      <h3>Glory vs Favor — the heart of the game</h3>
      <div class="sub">Conquest brings ★glory; glory wins the throne but terrifies the Senate (your ⚖favor decays faster as glory rises). At <b>★${C.GLORY_OUTLAW} / ⚖${C.FAVOR_OUTLAW} or less</b> you are declared OUTLAW and the Sundering begins immediately — ready or not. You may also declare it yourself at ★${C.GLORY_DECLARE}. If no one moves first, the Emperor dies by turn ${C.AUTO_SUNDERING_TURN} and the war comes anyway. <b>Time your treason.</b></div>
      <h3>Winning — and losing together</h3>
      <div class="sub">After the Sundering: capture <b>Sol</b> (guarded by the Praetor Fleet) and hold it ${C.SOL_HOLD_TURNS} consecutive turns to be crowned — or destroy every rival house. But the <b>Vex Swarm</b> erupts at the rim once blood is spilled, and grows as the war drags on. If the Vex take Sol or ${Math.round(C.SWARM_DOOM_SHARE * 100)}% of the galaxy, <b>every house loses</b>. The longer you fight each other, the closer the dark comes.</div>
      <h3>Pro tips</h3>
      <div class="sub">• Shipyards unlock Cruisers/Dreadnoughts and discount hulls.<br>
        • Legions decide wars — orbits are won by fleets, worlds by boots.<br>
        • <b>Corsairs</b> raid undefended trade worlds in peacetime. A starbase or a picket squadron pays for itself.<br>
        • The <b>Domains</b> screen shows every world and flags idle build queues — an idle yard is a wasted turn.<br>
        • Watch rivals' glory in the <b>Houses</b> screen: when someone nears ★${C.GLORY_OUTLAW}, the storm is close. Curry favor or build fleets accordingly.<br>
        • The Master of Whispers makes intrigue 40% cheaper. Denounce the leader. Sabotage their dreadnought. Deny everything.</div>`);
  }

  function openGameOver() {
    let title, sub, col;
    if (state.winner) {
      const hd = R().houseDef(state.winner);
      col = hd.color;
      title = `${hd.name.toUpperCase()} IS CROWNED`;
      sub = `Imperator Maximus of the Second Imperium — turn ${state.turn}. ${state.civilWarTurn ? `The Sundering began on turn ${state.civilWarTurn}.` : ''}`;
    } else {
      col = '#86e04f';
      title = 'THE GALAXY FALLS';
      sub = `The houses fought for a throne while the Vex devoured the stars. There is no Imperium left to rule. All houses lose. (Turn ${state.turn})`;
    }
    // chronicle of the war
    let rows = '';
    for (const hid of state.houseOrder) {
      const h = state.houses[hid];
      const hd = R().houseDef(hid);
      const st = state.stats[hid] || {};
      rows += `<tr ${h.eliminated && hid !== state.winner ? 'style="opacity:.45"' : ''}>
        <td style="color:${hd.color}"><b>${hd.name}</b>${hid === state.winner ? ' 👑' : h.eliminated ? ' ✝' : ''}</td>
        <td class="num">${R().countSystems(state, hid)}</td>
        <td class="num">${st.conquests || 0}</td>
        <td class="num">${st.battlesWon || 0}</td>
        <td class="num">${st.shipsLost || 0}</td>
        <td class="num">${st.missionsDone || 0}</td>
        <td class="num">${h.glory}</td></tr>`;
    }
    openModal(`<div class="gameover-title" style="color:${col}">${title}</div>
      <div class="gameover-sub">${sub}</div>
      <h3>Chronicle of the war</h3>
      <table>
        <tr><th>House</th><th>Worlds</th><th>Conquests</th><th>Battles won</th><th>Ships lost</th><th>Mandates</th><th>★</th></tr>
        ${rows}
      </table>
      <div class="modal-actions" style="justify-content:center;margin-top:18px">
        <button class="primary big" onclick="IM.ui.menuNewConfirmed()">New Game</button>
        <button onclick="IM.ui.closeModal()">Survey the wreckage</button>
      </div>`);
  }
  function menuNewConfirmed() {
    closeModal();
    $('game').style.display = 'none';
    $('setup').style.display = 'flex';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  IM.ui = {
    init, render, closeModal, missionRespond, senateAct, saveBids, declareWar,
    pickTrack, menuSave, menuExport, menuImport, menuNew, menuNewConfirmed,
    confirmOk,
  };
})();
