/**
 * dual-scroll-sync v0.6.0
 *
 * Synchronized scrolling for two panes with different content heights.
 *
 * Each segment's virtual length is `vS = max(aS, bS)` — the pane with
 * more content scrolls at normal speed; the other follows proportionally.
 * Wheel input moves along the virtual axis in pixels: one notch moves
 * the dominant pane exactly `deltaY` pixels, like normal browser scrolling.
 *
 * @module dual-scroll-sync
 * @version 0.6.0
 * @license MIT
 */

// ─── Pump threshold ───

/** Remaining wheel delta below this value (px) ends the pump loop. */
const PUMP_STOP_PX = 0.5;

/** Threshold (px) for absorbing programmatic scroll echoes. */
const ECHO_GUARD_PX = 2;

// ─── Core ───

/**
 * Build a virtual-axis scroll map from anchors.
 *
 * @param {import('./index.d.ts').Anchor[]} anchors
 * @param {number} sMaxA - scrollHeight − clientHeight of pane A.
 * @param {number} sMaxB - scrollHeight − clientHeight of pane B.
 * @returns {import('./index.d.ts').MapData}
 */
export function buildMap(anchors, sMaxA, sMaxB) {
  const sorted = anchors
    .map((e) => ({
      aPx: Math.max(0, Math.min(sMaxA, Math.round(e.aPx))),
      bPx: Math.max(0, Math.min(sMaxB, Math.round(e.bPx))),
    }))
    .sort((x, y) => x.aPx - y.aPx);

  const pts = [{ aPx: 0, bPx: 0 }];
  let lastB = 0;
  let droppedCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.bPx >= lastB && e.aPx > pts[pts.length - 1].aPx) {
      pts.push(e);
      lastB = e.bPx;
    } else {
      droppedCount++;
    }
  }
  pts.push({ aPx: sMaxA, bPx: sMaxB });

  let vCum = 0;
  const map = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const aS = pts[i + 1].aPx - pts[i].aPx;
    const bS = pts[i + 1].bPx - pts[i].bPx;
    const vS = Math.max(aS, bS);
    map.push({
      aPx: pts[i].aPx,
      bPx: pts[i].bPx,
      vPx: vCum,
      aS: aS,
      bS: bS,
      vS: vS,
    });
    vCum += vS;
  }

  return {
    segments: map,
    vTotal: vCum,
    droppedCount: droppedCount,
  };
}

/**
 * Look up a position on one axis given a position on another.
 * Binary search + linear interpolation within the segment.
 *
 * @param {import('./index.d.ts').Segment[]} segments
 * @param {"aPx"|"bPx"|"vPx"} from - Source axis.
 * @param {"aPx"|"bPx"|"vPx"} to   - Target axis.
 * @param {number} value  - Position on source axis (px). Caller must clamp
 *   to valid range; out-of-range values are extrapolated, not clamped.
 * @returns {number} Position on target axis (px).
 */
export function lookup(segments, from, to, value) {
  if (segments.length === 0) return 0;

  const fromS = from.charAt(0) + "S";
  const toS = to.charAt(0) + "S";

  let lo = 0,
    hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid][from] <= value) lo = mid;
    else hi = mid - 1;
  }

  const seg = segments[lo];
  if (seg[fromS] <= 0) return seg[to];
  const t = (value - seg[from]) / seg[fromS];
  return seg[to] + t * seg[toS];
}

// ─── Controller ───

/**
 * Synchronized scrolling controller for two scrollable elements.
 *
 * @example
 * const sync = new DualScrollSync(editor, preview, {
 *   getAnchors: () => headingAnchors(),
 * });
 */
export class DualScrollSync {
  /**
   * @param {import('./index.d.ts').ScrollPane} paneA
   * @param {import('./index.d.ts').ScrollPane} paneB
   * @param {import('./index.d.ts').SyncOptions} opts
   */
  constructor(paneA, paneB, opts) {
    this.paneA = paneA;
    this.paneB = paneB;
    this.getAnchors = opts.getAnchors;
    this.onSync = opts.onSync || null;
    this.onMapBuilt = opts.onMapBuilt || null;
    this.wheelSmooth = opts.wheelSmooth ?? 0.05;
    this.enabled = true;

    const g = typeof globalThis !== "undefined" ? globalThis : {};
    const raf = g.requestAnimationFrame;
    const caf = g.cancelAnimationFrame;
    this._requestFrame =
      opts.requestFrame || (raf ? raf.bind(g) : (fn) => setTimeout(fn, 16));
    this._cancelFrame =
      opts.cancelFrame || (caf ? caf.bind(g) : clearTimeout);

    this._data = null;
    this._dirty = true;
    this._vCurrent = 0;
    this._expectedA = null;
    this._expectedB = null;
    this._wheelRemaining = 0;
    this._pumpRafId = null;
    this._applying = false;

    this._onScrollA = () => { this._handleScroll("a"); };
    this._onScrollB = () => { this._handleScroll("b"); };
    this._onWheel = (e) => { this._onWheelEvent(e); };

    paneA.addEventListener("scroll", this._onScrollA);
    paneB.addEventListener("scroll", this._onScrollB);
    paneA.addEventListener("wheel", this._onWheel, { passive: false });
    paneB.addEventListener("wheel", this._onWheel, { passive: false });
  }

  /** Mark the scroll map for rebuild on next access. */
  invalidate() {
    this._dirty = true;
  }

  /**
   * Ensure the scroll map is current.
   * @returns {import('./index.d.ts').MapData}
   */
  ensureMap() {
    if (this._dirty || !this._data) {
      const sA = Math.max(0, this.paneA.scrollHeight - this.paneA.clientHeight);
      const sB = Math.max(0, this.paneB.scrollHeight - this.paneB.clientHeight);
      try {
        this._data = buildMap(this.getAnchors(), sA, sB);
      } catch {
        this._data = { segments: [], vTotal: 0, droppedCount: 0 };
      }
      this._dirty = false;
      if (this.onMapBuilt) this.onMapBuilt(this._data);
    }
    return this._data;
  }

  /** Remove all event listeners and timers. */
  destroy() {
    this.enabled = false;
    this._wheelRemaining = 0;
    if (this._pumpRafId !== null) {
      this._cancelFrame(this._pumpRafId);
      this._pumpRafId = null;
    }
    this.paneA.removeEventListener("scroll", this._onScrollA);
    this.paneB.removeEventListener("scroll", this._onScrollB);
    this.paneA.removeEventListener("wheel", this._onWheel);
    this.paneB.removeEventListener("wheel", this._onWheel);
  }

  /** @private Set both panes from _vCurrent. */
  _applyV() {
    this._applying = true;
    const segs = this._data.segments;
    this.paneA.scrollTop = lookup(segs, "vPx", "aPx", this._vCurrent);
    this.paneB.scrollTop = lookup(segs, "vPx", "bPx", this._vCurrent);
    this._expectedA = this.paneA.scrollTop;
    this._expectedB = this.paneB.scrollTop;
    this._applying = false;
    if (this.onSync) this.onSync();
  }

  /** @private Handle native scroll event; absorb echoes and sync the opposite pane. */
  _handleScroll(source) {
    if (!this.enabled || this._applying) return;

    if (source === "a" && this._expectedA !== null) {
      if (Math.abs(this.paneA.scrollTop - this._expectedA) < ECHO_GUARD_PX) {
        this._expectedA = null;
        return;
      }
      this._expectedA = null;
    }
    if (source === "b" && this._expectedB !== null) {
      if (Math.abs(this.paneB.scrollTop - this._expectedB) < ECHO_GUARD_PX) {
        this._expectedB = null;
        return;
      }
      this._expectedB = null;
    }

    const segs = this.ensureMap().segments;
    if (segs.length === 0) return;

    if (source === "a") {
      this._vCurrent = lookup(segs, "aPx", "vPx", this.paneA.scrollTop);
      this.paneB.scrollTop = lookup(segs, "vPx", "bPx", this._vCurrent);
      this._expectedB = this.paneB.scrollTop;
    } else {
      this._vCurrent = lookup(segs, "bPx", "vPx", this.paneB.scrollTop);
      this.paneA.scrollTop = lookup(segs, "vPx", "aPx", this._vCurrent);
      this._expectedA = this.paneA.scrollTop;
    }
    if (this.onSync) this.onSync();
  }

  /** @private Validate wheel event, preventDefault, and dispatch delta. */
  _onWheelEvent(e) {
    if (!this.enabled || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.deltaX !== 0 && e.deltaY === 0) return;
    if (this.wheelSmooth <= 0) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.paneA.clientHeight;
    if (this.wheelSmooth >= 1) {
      this._handleWheel(dy);
      return;
    }
    this._wheelRemaining += dy;
    if (this._pumpRafId === null) this._pumpWheel();
  }

  /** @private Drain _wheelRemaining across rAF frames. */
  _pumpWheel() {
    this._pumpRafId = this._requestFrame(() => {
      if (!this.enabled) { this._pumpRafId = null; return; }
      const delta = this._wheelRemaining * this.wheelSmooth;
      this._wheelRemaining -= delta;
      this._handleWheel(delta);
      if (Math.abs(this._wheelRemaining) >= PUMP_STOP_PX) this._pumpWheel();
      else this._pumpRafId = null;
    });
  }

  /** @private Apply delta to vCurrent, sync panes. */
  _handleWheel(delta) {
    const d = this.ensureMap();
    this._vCurrent = Math.max(0, Math.min(d.vTotal, this._vCurrent + delta));
    this._applyV();
  }
}

export default DualScrollSync;
