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

/** @typedef {import('./types.js').Anchor} Anchor */
/** @typedef {import('./types.js').Segment} Segment */
/** @typedef {import('./types.js').AxisPos} AxisPos */
/** @typedef {import('./types.js').AxisSize} AxisSize */
/** @typedef {import('./types.js').MapData} MapData */
/** @typedef {import('./types.js').ScrollPane} ScrollPane */
/** @typedef {import('./types.js').WheelBrakeOptions} WheelBrakeOptions */
/** @typedef {import('./types.js').WheelOptions} WheelOptions */
/** @typedef {import('./types.js').SyncOptions} SyncOptions */

// ─── Pump threshold ───

/** Remaining wheel delta below this value (px) ends the pump loop. */
const PUMP_STOP_PX = 5;

/** Threshold (px) for absorbing programmatic scroll echoes. */
const ECHO_GUARD_PX = 2;

// ─── Axis helpers ───

/** @type {Readonly<Record<AxisPos, AxisSize>>} */
const SIZE_KEY = { aPx: "aS", bPx: "bS", vPx: "vS" };

// ─── Core ───

/**
 * Build a virtual-axis scroll map from anchors.
 *
 * @param {Anchor[]} anchors
 * @param {number} sMaxA - scrollHeight − clientHeight of pane A.
 * @param {number} sMaxB - scrollHeight − clientHeight of pane B.
 * @returns {MapData}
 */
export function buildMap(anchors, sMaxA, sMaxB) {
  sMaxA = Math.max(0, sMaxA);
  sMaxB = Math.max(0, sMaxB);
  const sorted = anchors
    .map((e) => ({
      aPx: Math.max(0, Math.min(sMaxA, Math.round(e.aPx))),
      bPx: Math.max(0, Math.min(sMaxB, Math.round(e.bPx))),
      snap: e.snap,
    }))
    .sort((x, y) => x.aPx - y.aPx);

  /** @type {Anchor[]} */
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
  let hasSnap = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const aS = pts[i + 1].aPx - pts[i].aPx;
    const bS = pts[i + 1].bPx - pts[i].bPx;
    const vS = Math.max(aS, bS);
    /** @type {Segment} */
    const seg = { aPx: pts[i].aPx, bPx: pts[i].bPx, vPx: vCum, aS, bS, vS };
    if (pts[i].snap) { seg.snap = true; hasSnap = true; }
    map.push(seg);
    vCum += vS;
  }

  return {
    segments: map,
    vTotal: vCum,
    droppedCount,
    hasSnap,
  };
}

/**
 * Look up a position on one axis given a position on another.
 * Binary search + linear interpolation within the segment.
 *
 * @param {Segment[]} segments
 * @param {AxisPos} from - Source axis.
 * @param {AxisPos} to   - Target axis.
 * @param {number} value  - Position on source axis (px). Caller must clamp
 *   to valid range; out-of-range values are extrapolated, not clamped.
 * @returns {number} Position on target axis (px).
 */
export function lookup(segments, from, to, value) {
  if (segments.length === 0) return 0;

  const fromS = SIZE_KEY[from];
  const toS = SIZE_KEY[to];

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
 *   wheel: { smooth: 0.08, snap: 60, brake: { factor: 0.2, zone: 100 } },
 * });
 */
export class DualScrollSync {
  /**
   * @param {ScrollPane} paneA
   * @param {ScrollPane} paneB
   * @param {SyncOptions} opts
   */
  constructor(paneA, paneB, opts) {
    this.paneA = paneA;
    this.paneB = paneB;
    this.getAnchors = opts.getAnchors;
    this.onSync = opts.onSync || null;
    this.onMapBuilt = opts.onMapBuilt || null;
    this.onError = opts.onError || null;
    this.alignOffset = opts.alignOffset ?? 0;
    this.enabled = true;

    const wh = opts.wheel;
    const brake = wh?.brake;
    const rawSmooth = wh?.smooth;
    this.wheel = {
      smooth: typeof rawSmooth === "number" && isFinite(rawSmooth) ? rawSmooth : 0.1,
      snap: wh?.snap ?? 0,
      brake: brake ? { factor: brake.factor, zone: brake.zone } : null,
    };

    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    /** @internal */
    this._requestFrame =
      opts.requestFrame || (raf ? raf.bind(globalThis) : (/** @type {() => void} */ fn) => setTimeout(fn, 16));
    /** @internal */
    this._cancelFrame = opts.cancelFrame || (caf ? caf.bind(globalThis) : clearTimeout);

    /** @internal @type {MapData | null} */
    this._data = null;
    /** @internal */
    this._dirty = true;
    /** @internal */
    this._vCurrent = 0;
    /** @internal @type {number | null} */
    this._expectedA = null;
    /** @internal @type {number | null} */
    this._expectedB = null;
    /** @internal */
    this._wheelRemaining = 0;
    /** @internal @type {number | null} */
    this._pumpRafId = null;
    /** @internal */
    this._snapping = false;
    /** @internal */
    this._applying = false;

    /** @internal */
    this._onScrollA = () => {
      this._handleScroll("a");
    };
    /** @internal */
    this._onScrollB = () => {
      this._handleScroll("b");
    };
    /** @internal @type {(e: WheelEvent) => void} */
    this._onWheel = (e) => {
      this._onWheelEvent(e);
    };

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
   * @returns {MapData}
   */
  ensureMap() {
    if (this._dirty || !this._data) {
      const sA = Math.max(0, this.paneA.scrollHeight - this.paneA.clientHeight);
      const sB = Math.max(0, this.paneB.scrollHeight - this.paneB.clientHeight);
      try {
        this._data = buildMap(this.getAnchors(), sA, sB);
      } catch (err) {
        this._data = { segments: [], vTotal: 0, droppedCount: 0, hasSnap: false };
        if (this.onError) this.onError(err);
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
    this._snapping = false;
    if (this._pumpRafId !== null) {
      this._cancelFrame(this._pumpRafId);
      this._pumpRafId = null;
    }
    this.paneA.removeEventListener("scroll", this._onScrollA);
    this.paneB.removeEventListener("scroll", this._onScrollB);
    this.paneA.removeEventListener("wheel", this._onWheel);
    this.paneB.removeEventListener("wheel", this._onWheel);
  }

  /**
   * @internal
   * Set both panes from _vCurrent.
   */
  _applyV() {
    this._applying = true;
    const segs = this.ensureMap().segments;
    const off = this.alignOffset;
    this.paneA.scrollTop = lookup(segs, "vPx", "aPx", this._vCurrent) - off;
    this.paneB.scrollTop = lookup(segs, "vPx", "bPx", this._vCurrent) - off;
    this._expectedA = this.paneA.scrollTop;
    this._expectedB = this.paneB.scrollTop;
    this._applying = false;
    if (this.onSync) this.onSync();
  }

  /**
   * @internal
   * Handle native scroll event; absorb echoes and sync the opposite pane.
   * @param {"a" | "b"} source
   */
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

    const off = this.alignOffset;
    if (source === "a") {
      this._vCurrent = lookup(segs, "aPx", "vPx", this.paneA.scrollTop + off);
      this.paneB.scrollTop = lookup(segs, "vPx", "bPx", this._vCurrent) - off;
      this._expectedB = this.paneB.scrollTop;
    } else {
      this._vCurrent = lookup(segs, "bPx", "vPx", this.paneB.scrollTop + off);
      this.paneA.scrollTop = lookup(segs, "vPx", "aPx", this._vCurrent) - off;
      this._expectedA = this.paneA.scrollTop;
    }
    if (this.onSync) this.onSync();
  }

  /**
   * @internal
   * Validate wheel event, preventDefault, and dispatch delta.
   * @param {WheelEvent} e
   */
  _onWheelEvent(e) {
    if (!this.enabled || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.deltaX !== 0 && e.deltaY === 0) return;
    if (this.wheel.smooth <= 0) return;
    e.preventDefault();
    this._snapping = false;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.paneA.clientHeight;
    if (this.wheel.smooth >= 1) {
      this._handleWheel(dy);
      return;
    }
    this._wheelRemaining += dy;
    if (this._pumpRafId === null) this._pumpWheel();
  }

  /**
   * @internal
   * Compute anchor-proximity damping factor.
   */
  _anchorDamping() {
    if (this._snapping) return 1;
    const brake = this.wheel.brake;
    if (!brake || brake.factor >= 1 || brake.zone <= 0) return 1;
    const { segments } = this.ensureMap();
    const v = this._vCurrent;
    let minDist = Infinity;
    for (let i = 0; i < segments.length; i++) {
      minDist = Math.min(minDist, Math.abs(v - segments[i].vPx));
    }
    const t = Math.min(minDist / brake.zone, 1);
    const s = t * t * (3 - 2 * t);
    return brake.factor + (1 - brake.factor) * s;
  }

  /**
   * @internal
   * Drain _wheelRemaining across rAF frames.
   */
  _pumpWheel() {
    this._pumpRafId = this._requestFrame(() => {
      if (!this.enabled) {
        this._pumpRafId = null;
        return;
      }
      const drain = this._wheelRemaining * this.wheel.smooth;
      const delta = drain * this._anchorDamping();
      this._wheelRemaining -= drain;
      this._handleWheel(delta);
      if (Math.abs(this._wheelRemaining) >= PUMP_STOP_PX) this._pumpWheel();
      else {
        this._pumpRafId = null;
        this._trySnap();
      }
    });
  }

  /**
   * @internal
   * Snap to nearest anchor if within range; reuses pump with damping bypass.
   */
  _trySnap() {
    if (this._snapping) { this._snapping = false; return; }
    const { snap } = this.wheel;
    if (!snap || !this._data) return;
    const { segments, hasSnap } = this._data;
    let nearest = 0, minDist = Infinity;
    for (let i = 0; i < segments.length; i++) {
      if (hasSnap && !segments[i].snap) continue;
      const d = Math.abs(this._vCurrent - segments[i].vPx);
      if (d < minDist) { minDist = d; nearest = segments[i].vPx; }
    }
    if (minDist > 0 && minDist <= snap) {
      this._snapping = true;
      this._wheelRemaining = nearest - this._vCurrent;
      this._pumpWheel();
    }
  }

  /**
   * @internal
   * Apply delta to vCurrent, sync panes.
   * @param {number} delta
   */
  _handleWheel(delta) {
    const d = this.ensureMap();
    this._vCurrent = Math.max(0, Math.min(d.vTotal, this._vCurrent + delta));
    this._applyV();
  }
}

export default DualScrollSync;
