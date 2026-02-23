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
const ECHO_GUARD_PX = 3;

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
  /** @type {(callback: () => void) => number} */
  #requestFrame;
  /** @type {(id: number) => void} */
  #cancelFrame;
  /** @type {MapData | null} */
  #data = null;
  #dirty = true;
  #vCurrent = 0;
  /** @type {number | null} */
  #expectedA = null;
  /** @type {number | null} */
  #expectedB = null;
  #wheelRemaining = 0;
  /** @type {number | null} */
  #pumpRafId = null;
  #snapping = false;
  #applying = false;
  /** @type {() => void} */
  #onScrollA;
  /** @type {() => void} */
  #onScrollB;
  /** @type {(e: WheelEvent) => void} */
  #onWheel;

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
    /** @type {(callback: () => void) => number} */
    const fallbackRaf = (fn) => setTimeout(fn, 16);
    this.#requestFrame = opts.requestFrame || (raf ? raf.bind(globalThis) : fallbackRaf);
    this.#cancelFrame = opts.cancelFrame || (caf ? caf.bind(globalThis) : clearTimeout);

    this.#onScrollA = () => this.#handleScroll("a");
    this.#onScrollB = () => this.#handleScroll("b");
    this.#onWheel = (e) => this.#onWheelEvent(e);

    paneA.addEventListener("scroll", this.#onScrollA);
    paneB.addEventListener("scroll", this.#onScrollB);
    paneA.addEventListener("wheel", this.#onWheel, { passive: false });
    paneB.addEventListener("wheel", this.#onWheel, { passive: false });
  }

  /** Mark the scroll map for rebuild on next access. */
  invalidate() {
    this.#dirty = true;
  }

  /**
   * Ensure the scroll map is current.
   * @returns {MapData}
   */
  ensureMap() {
    if (this.#dirty || !this.#data) {
      const sA = Math.max(0, this.paneA.scrollHeight - this.paneA.clientHeight);
      const sB = Math.max(0, this.paneB.scrollHeight - this.paneB.clientHeight);
      try {
        this.#data = buildMap(this.getAnchors(), sA, sB);
      } catch (err) {
        this.#data = { segments: [], vTotal: 0, droppedCount: 0, hasSnap: false };
        if (this.onError) this.onError(err);
      }
      this.#dirty = false;
      if (this.onMapBuilt) this.onMapBuilt(this.#data);
    }
    return this.#data;
  }

  /**
   * Scroll both panes to a virtual-axis position.
   * @param {number} v - Virtual axis position (px). Clamped to [0, vTotal].
   */
  scrollTo(v) {
    const d = this.ensureMap();
    this.#vCurrent = Math.max(0, Math.min(d.vTotal, v));
    this.#applyV();
  }

  /** Remove all event listeners and timers. */
  destroy() {
    this.enabled = false;
    this.#wheelRemaining = 0;
    this.#snapping = false;
    if (this.#pumpRafId !== null) {
      this.#cancelFrame(this.#pumpRafId);
      this.#pumpRafId = null;
    }
    this.paneA.removeEventListener("scroll", this.#onScrollA);
    this.paneB.removeEventListener("scroll", this.#onScrollB);
    this.paneA.removeEventListener("wheel", this.#onWheel);
    this.paneB.removeEventListener("wheel", this.#onWheel);
    this.paneA = /** @type {any} */ (null);
    this.paneB = /** @type {any} */ (null);
    this.#data = null;
    this.getAnchors = /** @type {any} */ (null);
    this.onSync = null;
    this.onMapBuilt = null;
    this.onError = null;
  }

  /** Set both panes from #vCurrent. */
  #applyV() {
    this.#applying = true;
    const segs = this.ensureMap().segments;
    const off = this.alignOffset;
    this.paneA.scrollTop = lookup(segs, "vPx", "aPx", this.#vCurrent) - off;
    this.paneB.scrollTop = lookup(segs, "vPx", "bPx", this.#vCurrent) - off;
    this.#expectedA = this.paneA.scrollTop;
    this.#expectedB = this.paneB.scrollTop;
    this.#applying = false;
    if (this.onSync) this.onSync();
  }

  /**
   * Handle native scroll event; absorb echoes and sync the opposite pane.
   * @param {"a" | "b"} source
   */
  #handleScroll(source) {
    if (!this.enabled || this.#applying) return;

    const isA = source === "a";
    const srcPane = isA ? this.paneA : this.paneB;
    const expected = isA ? this.#expectedA : this.#expectedB;
    if (expected !== null) {
      if (isA) this.#expectedA = null; else this.#expectedB = null;
      if (Math.abs(srcPane.scrollTop - expected) < ECHO_GUARD_PX) return;
    }

    const { segments: segs, vTotal } = this.ensureMap();
    if (segs.length === 0) return;

    const off = this.alignOffset;
    const tgtPane = isA ? this.paneB : this.paneA;
    this.#vCurrent = Math.max(0, Math.min(vTotal,
      lookup(segs, isA ? "aPx" : "bPx", "vPx", srcPane.scrollTop + off)));
    tgtPane.scrollTop = lookup(segs, "vPx", isA ? "bPx" : "aPx", this.#vCurrent) - off;
    if (isA) this.#expectedB = tgtPane.scrollTop;
    else this.#expectedA = tgtPane.scrollTop;
    if (this.onSync) this.onSync();
  }

  /** Sanitise mutable wheel properties before each use. */
  #validateWheel() {
    const w = this.wheel;
    if (typeof w.smooth !== "number" || !isFinite(w.smooth)) w.smooth = 0.1;
    if (typeof w.snap !== "number" || !isFinite(w.snap) || w.snap < 0) w.snap = 0;
    if (w.brake) {
      if (typeof w.brake.factor !== "number" || !isFinite(w.brake.factor)) w.brake.factor = 1;
      if (typeof w.brake.zone !== "number" || !isFinite(w.brake.zone)) w.brake.zone = 0;
    }
  }

  /**
   * Validate wheel event, preventDefault, and dispatch delta.
   * @param {WheelEvent} e
   */
  #onWheelEvent(e) {
    if (!this.enabled || e.shiftKey || e.ctrlKey || e.metaKey) return;
    this.#validateWheel();
    if (e.deltaX !== 0 && e.deltaY === 0) return;
    if (this.wheel.smooth <= 0) return;
    e.preventDefault();
    this.#snapping = false;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.paneA.clientHeight;
    if (this.wheel.smooth >= 1) {
      this.#handleWheel(dy);
      return;
    }
    this.#wheelRemaining += dy;
    if (this.#pumpRafId === null) this.#pumpWheel();
  }

  /**
   * Binary search for the segment containing a virtual-axis position.
   * @param {Segment[]} segs
   * @param {number} v
   * @returns {number}
   */
  #findSegment(segs, v) {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].vPx <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Compute anchor-proximity damping factor. */
  #anchorDamping() {
    if (this.#snapping) return 1;
    const brake = this.wheel.brake;
    if (!brake || brake.factor >= 1 || brake.zone <= 0) return 1;
    const { segments } = this.ensureMap();
    if (segments.length === 0) return 1;
    const v = this.#vCurrent;
    const i = this.#findSegment(segments, v);
    let minDist = Math.abs(v - segments[i].vPx);
    if (i + 1 < segments.length) {
      minDist = Math.min(minDist, Math.abs(v - segments[i + 1].vPx));
    }
    const t = Math.min(minDist / brake.zone, 1);
    const s = t * t * (3 - 2 * t);
    return brake.factor + (1 - brake.factor) * s;
  }

  /** Drain #wheelRemaining across rAF frames. */
  #pumpWheel() {
    this.#pumpRafId = this.#requestFrame(() => {
      if (!this.enabled) {
        this.#pumpRafId = null;
        return;
      }
      const drain = this.#wheelRemaining * this.wheel.smooth;
      const delta = drain * this.#anchorDamping();
      this.#wheelRemaining -= drain;
      this.#handleWheel(delta);
      if (Math.abs(this.#wheelRemaining) >= PUMP_STOP_PX) this.#pumpWheel();
      else {
        this.#pumpRafId = null;
        this.#trySnap();
      }
    });
  }

  /** Snap to nearest anchor if within range; reuses pump with damping bypass. */
  #trySnap() {
    if (this.#snapping) { this.#snapping = false; return; }
    const { snap } = this.wheel;
    if (!snap || !this.#data) return;
    const { segments, hasSnap } = this.#data;
    if (segments.length === 0) return;
    const v = this.#vCurrent;
    const idx = this.#findSegment(segments, v);
    let nearest = 0, minDist = Infinity;
    for (let i = idx; i >= 0; i--) {
      const d = Math.abs(v - segments[i].vPx);
      if (d > snap && d > minDist) break;
      if (hasSnap && !segments[i].snap) continue;
      if (d < minDist) { minDist = d; nearest = segments[i].vPx; }
    }
    for (let i = idx + 1; i < segments.length; i++) {
      const d = Math.abs(v - segments[i].vPx);
      if (d > snap && d > minDist) break;
      if (hasSnap && !segments[i].snap) continue;
      if (d < minDist) { minDist = d; nearest = segments[i].vPx; }
    }
    if (minDist > 0 && minDist <= snap) {
      this.#snapping = true;
      this.#wheelRemaining = nearest - this.#vCurrent;
      this.#pumpWheel();
    }
  }

  /**
   * Apply delta to vCurrent, sync panes.
   * @param {number} delta
   */
  #handleWheel(delta) {
    const d = this.ensureMap();
    this.#vCurrent = Math.max(0, Math.min(d.vTotal, this.#vCurrent + delta));
    this.#applyV();
  }
}

export default DualScrollSync;
