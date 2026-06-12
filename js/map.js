/* Imperator Maximus — map.js
 * Canvas star map: starfield, warp lanes, systems, fleets, selection
 * highlights, pan/zoom, hover tooltips. Pure view — reports clicks to ui.js.
 */
(function () {
  'use strict';
  const IM = (globalThis.IM = globalThis.IM || {});
  const R = () => IM.rules;

  let canvas, ctx, state;
  let cam = { x: 0, y: 0, scale: 0.35 };
  let drag = null;
  let hoverSys = null;
  let onClickSystem = null; // cb(systemId | null)
  let starfield = null;
  let highlight = { selectedSystem: null, selectedFleet: null, targets: [] };
  let dpr = 1;

  function init(canvasEl, callbacks) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    onClickSystem = callbacks.onClickSystem;
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mouseleave', () => { hoverSys = null; draw(); });
    resize();
  }

  function setState(s) {
    state = s;
    buildStarfield();
    fit();
  }

  function resize() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    draw();
  }

  function fit() {
    if (!state) return;
    const xs = Object.values(state.systems);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const s of xs) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pad = 90;
    cam.scale = Math.min((w - pad * 2) / (maxX - minX + 1), (h - pad * 2) / (maxY - minY + 1));
    cam.scale = Math.max(0.1, Math.min(1.2, cam.scale));
    cam.x = (minX + maxX) / 2;
    cam.y = (minY + maxY) / 2;
    draw();
  }

  function setHighlight(h) {
    highlight = Object.assign({ selectedSystem: null, selectedFleet: null, targets: [] }, h);
    draw();
  }

  // world<->screen
  function sx(x) { return (x - cam.x) * cam.scale + canvas.clientWidth / 2; }
  function sy(y) { return (y - cam.y) * cam.scale + canvas.clientHeight / 2; }
  function wx(px) { return (px - canvas.clientWidth / 2) / cam.scale + cam.x; }
  function wy(py) { return (py - canvas.clientHeight / 2) / cam.scale + cam.y; }

  function systemAt(px, py) {
    if (!state) return null;
    let best = null, bestD = 22; // px radius
    for (const s of Object.values(state.systems)) {
      const d = Math.hypot(sx(s.x) - px, sy(s.y) - py);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------ interaction
  function onDown(e) {
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    canvas.classList.add('dragging');
  }
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      cam.x = drag.cx - dx / cam.scale;
      cam.y = drag.cy - dy / cam.scale;
      draw();
    } else {
      const h = systemAt(px, py);
      if (h !== hoverSys) { hoverSys = h; draw(); }
    }
  }
  function onUp(e) {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    canvas.classList.remove('dragging');
    if (!wasDrag && e.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      const s = systemAt(e.clientX - rect.left, e.clientY - rect.top);
      if (onClickSystem) onClickSystem(s ? s.id : null);
    }
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const wxBefore = wx(px), wyBefore = wy(py);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    cam.scale = Math.max(0.08, Math.min(3, cam.scale * f));
    // keep point under cursor fixed
    cam.x = wxBefore - (px - canvas.clientWidth / 2) / cam.scale;
    cam.y = wyBefore - (py - canvas.clientHeight / 2) / cam.scale;
    draw();
  }

  // -------------------------------------------------------------- starfield
  function buildStarfield() {
    starfield = document.createElement('canvas');
    starfield.width = 1600;
    starfield.height = 1000;
    const c = starfield.getContext('2d');
    const rng = IM.util.makeRng((state ? state.seed : 1) ^ 0x5f3759df);
    c.fillStyle = '#07090f';
    c.fillRect(0, 0, 1600, 1000);
    for (let i = 0; i < 700; i++) {
      const x = rng.f() * 1600, y = rng.f() * 1000;
      const r = rng.f() * 1.1 + 0.2;
      const a = rng.f() * 0.5 + 0.12;
      c.fillStyle = `rgba(${180 + rng.i(0, 60)},${180 + rng.i(0, 60)},${200 + rng.i(0, 55)},${a})`;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    // nebulae
    for (let i = 0; i < 5; i++) {
      const x = rng.f() * 1600, y = rng.f() * 1000;
      const rad = 140 + rng.f() * 240;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      const hues = ['rgba(90,70,160,', 'rgba(40,90,120,', 'rgba(120,70,60,'];
      const h = hues[rng.i(0, hues.length - 1)];
      g.addColorStop(0, h + '0.10)');
      g.addColorStop(1, h + '0)');
      c.fillStyle = g;
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }

  // ------------------------------------------------------------------- draw
  function draw() {
    if (!ctx || !state) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (starfield) ctx.drawImage(starfield, 0, 0, w, h);

    const systems = Object.values(state.systems);

    // lanes
    ctx.lineWidth = 1;
    for (const s of systems) {
      for (const lid of s.links) {
        if (lid < s.id) continue; // draw each lane once
        const o = state.systems[lid];
        ctx.strokeStyle = 'rgba(90,110,160,0.22)';
        ctx.beginPath();
        ctx.moveTo(sx(s.x), sy(s.y));
        ctx.lineTo(sx(o.x), sy(o.y));
        ctx.stroke();
      }
    }

    // movement target highlights
    for (const tid of highlight.targets) {
      const s = state.systems[tid];
      if (!s) continue;
      ctx.strokeStyle = 'rgba(232,180,64,0.85)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(sx(s.x), sy(s.y), 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // systems
    for (const s of systems) {
      drawSystem(s);
    }

    // fleets
    drawFleets();

    // hover tooltip
    if (hoverSys) drawTooltip(hoverSys);
  }

  function ownerColor(owner) {
    return R().factionColor(owner);
  }

  function drawSystem(s) {
    const x = sx(s.x), y = sy(s.y);
    const col = ownerColor(s.owner);
    const isSel = highlight.selectedSystem === s.id;
    const r = s.isSol ? 9 : s.isCapital ? 7 : 5;

    // ownership glow
    if (s.owner !== 'independent') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, hexA(col, 0.28));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // star core
    ctx.fillStyle = s.isSol ? '#ffe9b0' : '#e8ecf8';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
    ctx.fill();

    // owner ring
    ctx.strokeStyle = col;
    ctx.lineWidth = s.isSol ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    // capital tick
    if (s.isCapital) {
      ctx.fillStyle = col;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', x, y - r - 6);
    }
    if (s.isSol) {
      ctx.fillStyle = '#ffe9b0';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👑', x, y - r - 8);
    }
    if (s.isHive) {
      ctx.fillStyle = '#86e04f';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☣', x, y - r - 8);
    }

    // starbase pips
    for (let i = 0; i < s.starbase; i++) {
      ctx.fillStyle = s.starbaseHP > 0 ? '#9fb4e8' : '#444';
      ctx.fillRect(x - 8 + i * 6, y + r + 4, 4, 3);
    }

    // selection
    if (isSel) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // name
    ctx.fillStyle = s.owner === 'independent' ? 'rgba(170,178,200,0.75)' : hexA(col, 0.95);
    ctx.font = (s.isSol || s.isCapital ? '600 ' : '') + '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.name, x, y + r + (s.starbase ? 18 : 14));
  }

  function drawFleets() {
    // group fleets by system
    const bySys = {};
    for (const f of Object.values(state.fleets)) {
      (bySys[f.systemId] = bySys[f.systemId] || []).push(f);
    }
    for (const [sid, fleets] of Object.entries(bySys)) {
      const s = state.systems[sid];
      const x = sx(s.x), y = sy(s.y);
      fleets.sort((a, b) => a.owner.localeCompare(b.owner));
      fleets.forEach((f, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(4, fleets.length);
        const fx = x + Math.cos(ang) * 18;
        const fy = y + Math.sin(ang) * 18;
        const col = ownerColor(f.owner);
        const isSel = highlight.selectedFleet === f.id;
        // triangle
        ctx.fillStyle = col;
        ctx.strokeStyle = isSel ? '#fff' : 'rgba(0,0,0,0.6)';
        ctx.lineWidth = isSel ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(fx, fy - 6);
        ctx.lineTo(fx + 5, fy + 4);
        ctx.lineTo(fx - 5, fy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // ship count
        const n = R().fleetShipCount(f);
        ctx.fillStyle = '#0a0d16';
        ctx.font = '600 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n > 99 ? '99' : String(n), fx, fy + 3);
      });
    }
  }

  function drawTooltip(s) {
    const x = sx(s.x), y = sy(s.y);
    const out = R().systemOutput(state, s);
    const lines = [
      `${s.name}${s.isSol ? ' — THE THRONEWORLD' : ''}`,
      `${R().factionName(s.owner)}${s.isCapital ? ' (capital)' : ''}`,
      `⬡${out.credits}  ⚒${out.production}  ⚗${out.science}  garrison ${Math.round(s.garrison)}`,
    ];
    if (s.starbase > 0) lines.push(`${IM.data.STARBASE[s.starbase].name} (${Math.max(0, Math.round(s.starbaseHP))} hp)`);
    if (s.unrest > 0) lines.push(`⚠ unrest ${s.unrest}`);
    const fleets = R().fleetsAt(state, s.id);
    for (const f of fleets) {
      lines.push(`▲ ${R().factionName(f.owner)} — ${R().fleetShipCount(f)} ships (power ${R().fleetPower(state, f)})`);
    }
    ctx.font = '12px "Segoe UI", sans-serif';
    let wMax = 0;
    for (const l of lines) wMax = Math.max(wMax, ctx.measureText(l).width);
    const bw = wMax + 18, bh = lines.length * 16 + 10;
    let bx = x + 16, by = y - bh / 2;
    if (bx + bw > canvas.clientWidth - 8) bx = x - bw - 16;
    by = Math.max(8, Math.min(canvas.clientHeight - bh - 8, by));
    ctx.fillStyle = 'rgba(10,14,26,0.93)';
    ctx.strokeStyle = '#3a4668';
    ctx.lineWidth = 1;
    roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#e8d9a8' : '#aeb8d6';
      ctx.fillText(l, bx + 9, by + 19 + i * 16);
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  IM.map = {
    init, setState, draw, fit, setHighlight, resize,
    // for console debugging / driving tests
    worldToScreen: (x, y) => ({ x: sx(x), y: sy(y) }),
  };
})();
