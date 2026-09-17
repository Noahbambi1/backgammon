/* Board view: renders game state into DOM, handles tap & drag input, animations. */
(function (root) {
  'use strict';
  const BG = root.BG;
  const W = 'W', B = 'B';
  const UNITS_W = 13.7; // 12 points + bar (0.8) + tray (0.9)

  class BoardView {
    constructor(el, handlers) {
      this.el = el;
      this.ptsEl = el.querySelector('#points');
      this.chkEl = el.querySelector('#checkers');
      this.hlEl = el.querySelector('#hl');
      this.bannerEl = el.querySelector('#banner');
      this.handlers = handlers || {};
      this.perspective = W;
      this.game = null;
      this.selected = null;   // 'bar' | point index
      this.dests = [];        // legal destinations for selected
      this.sources = [];      // points that can be picked
      this.lastMove = null;
      this.elems = { W: [], B: [] };
      this.loc = new Map();   // element -> location key
      for (const p of [W, B]) for (let i = 0; i < 15; i++) {
        const d = document.createElement('div'); d.className = 'checker ' + p; d.dataset.p = p;
        this.chkEl.appendChild(d); this.elems[p].push(d);
      }
      this._bindPointer();
      this.layout();
      new ResizeObserver(() => this.layout()).observe(el.parentElement);
    }

    // ---------- geometry ----------
    layout() {
      const wrap = this.el.parentElement;
      const ww = wrap.clientWidth - 12, wh = wrap.clientHeight - 8;
      if (ww <= 0 || wh <= 0) return;
      let bw = ww, bh = Math.min(wh, bw * (15.5 / UNITS_W));
      const minH = bw * (10.5 / UNITS_W);
      if (bh < minH) { bh = wh; bw = bh / (10.5 / UNITS_W); }
      this.bw = bw; this.bh = bh;
      this.u = bw / UNITS_W;
      this.c = Math.min(this.u * 0.94, bh / 11.2); // checker diameter
      this.el.style.width = bw + 'px'; this.el.style.height = bh + 'px';
      this._drawStatic();
      if (this.game) this.render(this.game, { immediate: true });
    }
    colX(slot) { return slot < 6 ? slot * this.u : 6.8 * this.u + (slot - 6) * this.u; }
    // point index -> {row:'top'|'bottom', slot}
    pointPos(pt) {
      let p = this.perspective === W ? pt : 23 - pt;
      if (p <= 11) return { row: 'bottom', slot: 11 - p };
      return { row: 'top', slot: p - 12 };
    }
    // {row, slot} -> point index
    posPoint(row, slot) {
      let p = row === 'bottom' ? 11 - slot : 12 + slot;
      return this.perspective === W ? p : 23 - p;
    }
    // side of the board (top/bottom) for a player
    side(p) { return p === this.perspective ? 'bottom' : 'top'; }
    // Position (center) of k-th checker at location for player p, with n checkers total
    checkerXY(loc, p, k, n) {
      const c = this.c, H = this.bh;
      if (loc === 'bar') {
        const x = 6.4 * this.u;
        const step = Math.min(c * 0.75, (H * 0.42 - c) / Math.max(1, n - 1));
        const y = this.side(p) === 'bottom' ? H / 2 + c * 0.85 + k * step : H / 2 - c * 0.85 - k * step;
        return { x, y };
      }
      if (loc === 'off') {
        const x = 13.25 * this.u; const h = c * 0.3;
        const y = this.side(p) === 'bottom' ? H - 6 - h / 2 - k * (h + 1) : 6 + h / 2 + k * (h + 1);
        return { x, y, flat: true };
      }
      const { row, slot } = this.pointPos(loc);
      const x = this.colX(slot) + this.u / 2;
      const maxStack = H * 0.44;
      const step = n <= 5 ? c : Math.min(c, (maxStack - c) / (n - 1));
      const y = row === 'bottom' ? H - c / 2 - 2 - k * step : c / 2 + 2 + k * step;
      return { x, y };
    }
    hitTest(x, y) {
      const u = this.u;
      if (x < 0 || y < 0 || x > this.bw || y > this.bh) return null;
      if (x >= 12.8 * u) return { type: 'off' };
      if (x >= 6 * u && x < 6.8 * u) return { type: 'bar' };
      const slot = x < 6 * u ? Math.floor(x / u) : 6 + Math.floor((x - 6.8 * u) / u);
      const row = y < this.bh / 2 ? 'top' : 'bottom';
      return { type: 'point', pt: this.posPoint(row, Math.max(0, Math.min(11, slot))) };
    }
    rectFor(loc, p) {
      const u = this.u, H = this.bh;
      if (loc === 'off') { const top = this.side(p) === 'bottom'; return { x: 12.8 * u, y: top ? H / 2 : 0, w: 0.9 * u, h: H / 2 }; }
      if (loc === 'bar') { const top = this.side(p) === 'bottom'; return { x: 6 * u, y: top ? H / 2 : 0, w: 0.8 * u, h: H / 2 }; }
      const { row, slot } = this.pointPos(loc);
      return { x: this.colX(slot), y: row === 'top' ? 0 : H / 2, w: u, h: H / 2 };
    }

    _drawStatic() {
      const u = this.u, H = this.bh;
      if (!u || !H) return;
      let html = '';
      html += `<div class="felt" style="left:${2}px;top:${2}px;width:${6 * u - 4}px;height:${H - 4}px"></div>`;
      html += `<div class="felt" style="left:${6.8 * u + 2}px;top:${2}px;width:${6 * u - 4}px;height:${H - 4}px"></div>`;
      html += `<div class="bar" style="left:${6 * u}px;top:0;width:${0.8 * u}px;height:${H}px"></div>`;
      html += `<div class="tray" style="left:${12.8 * u + 3}px;top:3px;width:${0.9 * u - 6}px;height:${H / 2 - 6}px"></div>`;
      html += `<div class="tray" style="left:${12.8 * u + 3}px;top:${H / 2 + 3}px;width:${0.9 * u - 6}px;height:${H / 2 - 6}px"></div>`;
      const ph = H * 0.42;
      for (let pt = 0; pt < 24; pt++) {
        const { row, slot } = this.pointPos(pt);
        const x = this.colX(slot);
        const colorA = (slot % 2 === 0) === (row === 'bottom');
        const fill = colorA ? 'var(--pt-a)' : 'var(--pt-b)';
        const tri = row === 'bottom' ? `M0,${ph} L${u},${ph} L${u / 2},0 Z` : `M0,0 L${u},0 L${u / 2},${ph} Z`;
        const y = row === 'bottom' ? H - ph : 0;
        const label = this.perspective === W ? pt + 1 : 24 - pt;
        html += `<div class="point ${row}" style="left:${x}px;top:${y}px;width:${u}px;height:${ph}px"><svg viewBox="0 0 ${u} ${ph}" preserveAspectRatio="none"><path d="${tri}" fill="${fill}" opacity=".9"/></svg><span class="lbl">${label}</span></div>`;
      }
      this.ptsEl.innerHTML = html;
    }

    setPerspective(p) {
      if (this.perspective === p) return;
      this.perspective = p; this._drawStatic();
      if (this.game) this.render(this.game, { immediate: true });
    }

    // ---------- rendering ----------
    render(game, opts) {
      opts = opts || {};
      this.game = game;
      // Build needed locations per player
      const need = { W: new Map(), B: new Map() };
      for (let i = 0; i < 24; i++) {
        const v = game.points[i]; if (!v) continue;
        need[v > 0 ? W : B].set(i, Math.abs(v));
      }
      for (const p of [W, B]) { if (game.bar[p]) need[p].set('bar', game.bar[p]); if (game.off[p]) need[p].set('off', game.off[p]); }
      for (const p of [W, B]) {
        const remaining = new Map(need[p]);
        const assigned = new Map(); // loc -> [els]
        const free = [];
        // keep elements already at a still-needed location
        for (const el of this.elems[p]) {
          const loc = this.loc.get(el);
          if (loc !== undefined && remaining.get(loc) > 0) {
            remaining.set(loc, remaining.get(loc) - 1);
            if (!assigned.has(loc)) assigned.set(loc, []); assigned.get(loc).push(el);
          } else free.push(el);
        }
        for (const [loc, n] of remaining) for (let i = 0; i < n; i++) {
          const el = free.pop(); this.loc.set(el, loc);
          if (!assigned.has(loc)) assigned.set(loc, []); assigned.get(loc).push(el);
        }
        for (const el of free) { el.style.display = 'none'; this.loc.delete(el); }
        for (const [loc, els] of assigned) {
          const n = els.length;
          els.forEach((el, k) => {
            const { x, y, flat } = this.checkerXY(loc, p, k, n);
            const c = this.c;
            el.style.display = '';
            if (opts.immediate) el.style.transition = 'none';
            if (flat) { el.className = 'checker offchip ' + p; el.style.width = (0.9 * this.u - 10) + 'px'; el.style.height = (c * 0.3) + 'px'; el.style.left = (x - (0.9 * this.u - 10) / 2) + 'px'; el.style.top = (y - c * 0.15) + 'px'; el.textContent = ''; }
            else {
              el.className = 'checker ' + p; el.style.width = c + 'px'; el.style.height = c + 'px'; el.style.fontSize = (c * 0.42) + 'px';
              el.style.left = (x - c / 2) + 'px'; el.style.top = (y - c / 2) + 'px';
              el.textContent = (k === n - 1 && n > 5) ? String(n) : '';
              el.style.zIndex = k + 1;
              if (this.selected !== null && loc === this.selected && k === n - 1 && p === game.turn) el.classList.add('selected');
            }
            if (opts.immediate) requestAnimationFrame(() => { el.style.transition = ''; });
          });
        }
      }
      this._renderHighlights();
    }

    setSelection(selected, dests, sources, farDests) {
      this.selected = selected; this.dests = dests || []; this.sources = sources || []; this.farDests = farDests || [];
      if (this.game) this.render(this.game);
    }
    setLastMove(m) { this.lastMove = m; }

    _renderHighlights() {
      const g = this.game; if (!g) return;
      let html = '';
      const rect = (loc, p, cls) => { const r = this.rectFor(loc, p); return `<div class="hlpt ${cls}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div>`; };
      if (this.showHints !== false) {
        for (const s of this.sources) if (s !== this.selected) html += rect(s, g.turn, 'src');
        for (const d of this.dests) html += rect(d, g.turn, (this.farDests || []).includes(d) ? 'dest far' : 'dest');
      }
      this.hlEl.innerHTML = html;
    }

    // Animate top checker of player p from `from` to `to`, then the caller re-renders.
    animateMove(p, from, to, hit) {
      return new Promise(resolve => {
        const els = this.elems[p].filter(el => this.loc.get(el) === from);
        if (!els.length) return resolve();
        els.sort((a, b) => (+a.style.zIndex || 0) - (+b.style.zIndex || 0));
        const el = els[els.length - 1];
        const nTo = to === 'off' ? this.game.off[p] : to === 'bar' ? this.game.bar[p] : (hit ? 0 : Math.abs(this.game.points[to]));
        const { x, y } = this.checkerXY(to, p, nTo, nTo + 1);
        const c = this.c;
        el.classList.add('flying'); el.style.zIndex = 30;
        el.style.left = (x - c / 2) + 'px'; el.style.top = (y - c / 2) + 'px';
        setTimeout(() => { el.classList.remove('flying'); resolve(); }, 300);
      });
    }

    flashBanner(text, sub, ms) {
      this.bannerEl.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
      this.bannerEl.classList.add('show');
      clearTimeout(this._bt);
      if (ms !== 0) this._bt = setTimeout(() => this.bannerEl.classList.remove('show'), ms || 1400);
    }
    hideBanner() { this.bannerEl.classList.remove('show'); }

    // ---------- pointer input ----------
    _bindPointer() {
      let start = null, dragEl = null, dragFrom = null, moved = false, origLT = null;
      const pos = e => { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      this.el.addEventListener('pointerdown', e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const p = pos(e); const t = this.hitTest(p.x, p.y);
        start = { ...p, t, time: Date.now() }; moved = false; dragEl = null; dragFrom = null;
        if (t && this.handlers.canPick) {
          const loc = t.type === 'point' ? t.pt : t.type === 'bar' ? 'bar' : null;
          if (loc !== null && this.handlers.canPick(loc)) {
            const g = this.game; const els = this.elems[g.turn].filter(el => this.loc.get(el) === loc);
            if (els.length) {
              els.sort((a, b) => (+a.style.zIndex || 0) - (+b.style.zIndex || 0));
              dragEl = els[els.length - 1]; dragFrom = loc; origLT = { l: dragEl.style.left, t: dragEl.style.top };
            }
          }
        }
        this.el.setPointerCapture(e.pointerId);
      });
      this.el.addEventListener('pointermove', e => {
        if (!start) return;
        const p = pos(e);
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > 8) {
          moved = true;
          if (dragEl) { dragEl.classList.add('dragging'); if (this.handlers.onDragStart) this.handlers.onDragStart(dragFrom); }
        }
        if (moved && dragEl) { dragEl.style.left = (p.x - this.c / 2) + 'px'; dragEl.style.top = (p.y - this.c / 2) + 'px'; }
      });
      const finish = e => {
        if (!start) return;
        const p = pos(e); const t = this.hitTest(p.x, p.y);
        if (moved && dragEl) {
          dragEl.classList.remove('dragging');
          const to = t ? (t.type === 'point' ? t.pt : t.type === 'off' ? 'off' : null) : null;
          let ok = false;
          if (to !== null && this.handlers.onDrop) ok = this.handlers.onDrop(dragFrom, to);
          if (!ok) { dragEl.style.transition = 'none'; dragEl.style.left = origLT.l; dragEl.style.top = origLT.t; requestAnimationFrame(() => { dragEl.style.transition = ''; }); if (this.handlers.onDragCancel) this.handlers.onDragCancel(); }
        } else if (!moved && start.t && this.handlers.onTap) {
          this.handlers.onTap(start.t);
        }
        start = null; dragEl = null;
      };
      this.el.addEventListener('pointerup', finish);
      this.el.addEventListener('pointercancel', () => { if (dragEl) { dragEl.classList.remove('dragging'); dragEl.style.left = origLT.l; dragEl.style.top = origLT.t; } start = null; dragEl = null; });
    }
  }

  // ----- dice -----
  const PIPS = { 1: [[50, 50]], 2: [[25, 25], [75, 75]], 3: [[25, 25], [50, 50], [75, 75]], 4: [[25, 25], [75, 25], [25, 75], [75, 75]],
    5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]], 6: [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]] };
  function dieHTML(v, cls) {
    return `<div class="die ${cls || ''}">${(PIPS[v] || []).map(([x, y]) => `<span class="pip" style="left:${x - 9}%;top:${y - 9}%"></span>`).join('')}</div>`;
  }
  function renderDice(el, game, animate) {
    if (!game) { el.innerHTML = ''; return; }
    if (game.phase === 'opening') { el.innerHTML = openingDiceHTML(game.opening.W, game.opening.B); return; }
    if (game.phase === 'roll' || game.phase === 'double') { el.innerHTML = ''; return; }
    if (game.phase === 'openchoice') { el.innerHTML = dieHTML(game.dice[0], game.turn + (animate ? ' rolling' : '')) + dieHTML(game.dice[1], game.turn + (animate ? ' rolling' : '')); return; }
    if (game.phase === 'over' && !game.dice[0]) { el.innerHTML = ''; return; }
    const [a, b] = game.dice; const p = game.turn;
    const rem = game.remaining.slice();
    const list = a === b ? [a, a, a, a] : [a, b];
    let html = '';
    for (const v of list) {
      const i = rem.indexOf(v); const used = i < 0; if (!used) rem.splice(i, 1);
      html += dieHTML(v, p + (used ? ' used' : '') + (animate ? ' rolling' : ''));
    }
    el.innerHTML = html;
  }
  function openingDiceHTML(w, b, justRolled) {
    const one = (v, p) => v ? dieHTML(v, p + (justRolled === p ? ' rolling' : '')) : `<div class="die ${p} empty"></div>`;
    return one(w, 'W') + one(b, 'B');
  }

  root.BGUI = { BoardView, renderDice, dieHTML, openingDiceHTML };
})(window);
