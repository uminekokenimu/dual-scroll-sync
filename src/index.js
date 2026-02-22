/**
 * dual-scroll-sync v9
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

// ─── Types ───

/**
 * @typedef {Object} ScrollPane
 * @property {number} scrollTop   - Current scroll offset (read/write).
 * @property {number} scrollHeight - Total content height (read-only).
 * @property {number} clientHeight - Visible viewport height (read-only).
 * @property {function} addEventListener
 * @property {function} removeEventListener
 */

/**
 * @typedef {Object} Anchor
 * @property {number}  aPx  - Pixel position in pane A.
 * @property {number}  bPx  - Pixel position in pane B.
 */

/**
 * @typedef {Object} Segment
 * @property {number} aPx - Pane A start (px).
 * @property {number} bPx - Pane B start (px).
 * @property {number} vPx - V-axis start (px).
 * @property {number} aS  - Pane A segment length (px).
 * @property {number} bS  - Pane B segment length (px).
 * @property {number} vS  - V-axis segment length: max(aS, bS).
 */

/**
 * @typedef {Object} MapData
 * @property {Segment[]} segments     - Ordered segments.
 * @property {number}    vTotal       - Total v-axis length (px).
 * @property {number}    droppedCount - Anchors dropped due to non-monotonic bPx.
 */

/**
 * @typedef {Object} SyncOptions
 * @property {function(): Anchor[]} getAnchors - Returns anchor array.
 * @property {function} [onSync]      - Called after each sync update.
 * @property {function(MapData)} [onMapBuilt] - Called on map rebuild.
 * @property {number} [wheelSmooth=0.05] - Interpolation factor for wheel input (0–1).
 *   Each animation frame drains this fraction of the remaining delta.
 *   1 = instant (no smoothing). 0 = frozen. Typical range: 0.02–0.2.
 * @property {function} [requestFrame] - Frame scheduler (default: requestAnimationFrame or setTimeout fallback).
 * @property {function} [cancelFrame]  - Cancel a scheduled frame (default: cancelAnimationFrame or clearTimeout).
 */

// ─── Core ───

/**
 * Build a virtual-axis scroll map from anchors.
 *
 * @param {Anchor[]} anchors - Anchor points (0,0 and end are added automatically).
 * @param {number} sMaxA - scrollHeight − clientHeight of pane A.
 * @param {number} sMaxB - scrollHeight − clientHeight of pane B.
 * @returns {MapData}
 */
export function buildMap(anchors, sMaxA, sMaxB) {
  const sorted = anchors
    .map(function (e) {
      return {
        aPx: Math.max(0, Math.min(sMaxA, Math.round(e.aPx))),
        bPx: Math.max(0, Math.min(sMaxB, Math.round(e.bPx))),
      };
    })
    .sort(function (x, y) {
      return x.aPx - y.aPx;
    });

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
 * @param {Segment[]} segments - Segment array from buildMap.
 * @param {string} from   - Source axis: 'aPx', 'bPx', or 'vPx'.
 * @param {string} to     - Target axis: 'aPx', 'bPx', or 'vPx'.
 * @param {number} value  - Position on source axis (px). Caller must clamp
 *   to valid range; out-of-range values are extrapolated, not clamped.
 * @returns {number} Position on target axis (px).
 */
export function lookup(segments, from, to, value) {
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
 *   getAnchors: function() { return headingAnchors(); },
 * });
 */
export class DualScrollSync {
  /**
   * @param {ScrollPane} paneA - First scrollable pane.
   * @param {ScrollPane} paneB - Second scrollable pane.
   * @param {SyncOptions} opts
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
    this._requestFrame =
      opts.requestFrame ||
      g.requestAnimationFrame ||
      function (fn) {
        return setTimeout(fn, 16);
      };
    this._cancelFrame =
      opts.cancelFrame || g.cancelAnimationFrame || clearTimeout;

    this._data = null;
    this._dirty = true;
    this._vCurrent = 0;
    this._expectedA = null;
    this._expectedB = null;
    this._lock = null;
    this._wheelRemaining = 0;
    this._wheelPumping = false;

    const self = this;
    this._onScrollA = function () {
      self._handleScroll("a");
    };
    this._onScrollB = function () {
      self._handleScroll("b");
    };
    this._onWheel = function (e) {
      self._onWheelEvent(e);
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
      } catch (e) {
        this._data = { segments: [], vTotal: 0 };
      }
      this._dirty = false;
      if (this.onMapBuilt) this.onMapBuilt(this._data);
    }
    return this._data;
  }

  /** Remove all event listeners and timers. */
  destroy() {
    this._wheelRemaining = 0;
    this.paneA.removeEventListener("scroll", this._onScrollA);
    this.paneB.removeEventListener("scroll", this._onScrollB);
    this.paneA.removeEventListener("wheel", this._onWheel);
    this.paneB.removeEventListener("wheel", this._onWheel);
  }

  /** @private Set both panes from _vCurrent. */
  _applyV() {
    const segs = this._data.segments;
    this._lock = "a";
    this.paneA.scrollTop = lookup(segs, "vPx", "aPx", this._vCurrent);
    this.paneB.scrollTop = lookup(segs, "vPx", "bPx", this._vCurrent);
    this._expectedA = this.paneA.scrollTop;
    this._expectedB = this.paneB.scrollTop;
    this._lock = null;
    if (this.onSync) this.onSync();
  }

  /** @private */
  _handleScroll(source) {
    if (!this.enabled) return;

    if (source === "a" && this._expectedA !== null) {
      if (Math.abs(this.paneA.scrollTop - this._expectedA) < 2) {
        this._expectedA = null;
        return;
      }
      this._expectedA = null;
    }
    if (source === "b" && this._expectedB !== null) {
      if (Math.abs(this.paneB.scrollTop - this._expectedB) < 2) {
        this._expectedB = null;
        return;
      }
      this._expectedB = null;
    }

    if (this._lock && this._lock !== source) return;

    const d = this.ensureMap();
    const segs = d.segments;

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

  /** @private Guard checks + preventDefault, then dispatch delta (immediate or buffered). */
  _onWheelEvent(e) {
    if (!this.enabled || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.deltaX !== 0 && e.deltaY === 0) return;
    e.preventDefault();
    if (this.wheelSmooth >= 1) {
      this._handleWheel(e.deltaY);
      return;
    }
    this._wheelRemaining += e.deltaY;
    if (!this._wheelPumping) this._pumpWheel();
  }

  /** @private rAF drain loop: drains _wheelRemaining one frame at a time. */
  _pumpWheel() {
    this._wheelPumping = true;
    const self = this;
    const rf = this._requestFrame;
    (function loop() {
      rf(function () {
        const delta = self._wheelRemaining * self.wheelSmooth;
        self._wheelRemaining -= delta;
        self._handleWheel(delta);
        if (Math.abs(self._wheelRemaining) >= 0.5) loop();
        else self._wheelPumping = false;
      });
    })();
  }

  /** @private Apply delta to vCurrent, sync panes. */
  _handleWheel(delta) {
    const d = this.ensureMap();
    this._vCurrent = Math.max(0, Math.min(d.vTotal, this._vCurrent + delta));
    this._applyV();
  }
}

export default DualScrollSync;
