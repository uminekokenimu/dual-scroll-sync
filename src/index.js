/**
 * dual-scroll-sync
 *
 * Synchronized scrolling for two panes with different content heights.
 * Uses a ratio-normalized virtual axis so both panes are treated symmetrically —
 * no primary/secondary distinction, no overflow handling, no edge-case stalling.
 *
 * @license MIT
 */

// ─── Defaults ───

const DEFAULTS = {
  /** LERP factor for smooth scrolling (0–1). Lower = smoother but slower. */
  lerp: 0.18,
  /** Animation stops when virtual-axis residual drops below this value. */
  epsilon: 0.15,
  /** Internal scale for ratio space. Larger = more precision. */
  scale: 10000,
};

// ─── Core: Map Builder ───

/**
 * Build a sparse scroll map in ratio space.
 *
 * @param {Array<{a: number, b: number}>} anchors
 *   Anchor points where a = normalized position in pane A (0–1)
 *   and b = normalized position in pane B (0–1).
 *   Does NOT need to include (0,0) or (1,1) — they are added automatically.
 * @param {number} scale - Internal scale factor.
 * @returns {Array<{aS: number, bS: number, vS: number}>} Scroll map entries.
 */
export function buildMap(anchors, scale = DEFAULTS.scale) {
  const S = scale;

  // Convert normalized 0–1 to 0–SCALE and collect
  const raw = anchors.map(({ a, b }) => ({
    aS: Math.min(S, Math.max(0, a * S)),
    bS: Math.min(S, Math.max(0, b * S)),
  }));

  // Sort by aS (pane A position order)
  raw.sort((x, y) => x.aS - y.aS);

  // Build map with bS monotonicity enforcement — skip entries where
  // bS goes backwards, which would break interpolation.
  const map = [{ aS: 0, bS: 0, vS: 0 }];
  let lastBS = 0;

  for (const entry of raw) {
    if (entry.bS >= lastBS && entry.aS > map[map.length - 1].aS) {
      map.push({ aS: entry.aS, bS: entry.bS, vS: 0 });
      lastBS = entry.bS;
    }
  }

  // Virtual tail: always (SCALE, SCALE)
  map.push({ aS: S, bS: S, vS: 0 });

  // Compute vS cumulatively.
  // Each interval's vS length = max(aS distance, bS distance).
  // The longer side scrolls at full speed; the shorter side proportionally slower.
  map[0].vS = 0;
  for (let i = 1; i < map.length; i++) {
    const aD = map[i].aS - map[i - 1].aS;
    const bD = map[i].bS - map[i - 1].bS;
    map[i].vS = map[i - 1].vS + Math.max(aD, bD);
  }

  return map;
}

// ─── Core: Binary Search + Interpolation ───

/**
 * Binary search: find the largest index where map[i][key] <= value.
 */
function mapSearch(map, key, value) {
  let lo = 0,
    hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid][key] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Interpolate between map entries.
 * Given a value on `fromKey` axis, return the interpolated value on `toKey` axis.
 * O(log n) via binary search.
 *
 * @param {Array} map - Scroll map from buildMap().
 * @param {string} fromKey - Source axis key ('aS', 'bS', or 'vS').
 * @param {string} toKey - Target axis key.
 * @param {number} value - Position on the source axis.
 * @returns {number} Interpolated position on the target axis.
 */
export function mapLookup(map, fromKey, toKey, value) {
  const idx = mapSearch(map, fromKey, value);
  const a = map[idx];
  const b = map[Math.min(idx + 1, map.length - 1)];
  const dist = b[fromKey] - a[fromKey];
  if (dist <= 0) return a[toKey];
  const t = (value - a[fromKey]) / dist;
  return a[toKey] + t * (b[toKey] - a[toKey]);
}

// ─── High-level: DualScrollSync class ───

/**
 * Synchronized scrolling controller for two scrollable elements.
 *
 * @example
 * const sync = new DualScrollSync(editorEl, previewEl, {
 *   getAnchors: () => {
 *     const edMax = editorEl.scrollHeight - editorEl.clientHeight;
 *     const pvMax = previewEl.scrollHeight - previewEl.clientHeight;
 *     return Array.from(previewEl.querySelectorAll('[data-line]')).map(el => ({
 *       a: getEditorPxForLine(+el.dataset.line) / edMax,
 *       b: el.offsetTop / pvMax,
 *     }));
 *   }
 * });
 */
export class DualScrollSync {
  /**
   * @param {HTMLElement} paneA - First scrollable element.
   * @param {HTMLElement} paneB - Second scrollable element.
   * @param {Object} options
   * @param {() => Array<{a: number, b: number}>} options.getAnchors
   *   Function returning anchor points. Called when the map is rebuilt.
   *   Each anchor: { a: 0–1 position in pane A, b: 0–1 position in pane B }.
   * @param {number} [options.lerp=0.18] - LERP smoothing factor.
   * @param {number} [options.epsilon=0.15] - Animation stop threshold.
   * @param {number} [options.scale=10000] - Internal ratio scale.
   */
  constructor(paneA, paneB, options) {
    this.paneA = paneA;
    this.paneB = paneB;
    this.getAnchors = options.getAnchors;
    this.lerp = options.lerp ?? DEFAULTS.lerp;
    this.epsilon = options.epsilon ?? DEFAULTS.epsilon;
    this.scale = options.scale ?? DEFAULTS.scale;

    /**
     * When false, all sync behavior is suspended: wheel events are not
     * intercepted, and scroll events on either pane are ignored.
     * Set to false when one pane is hidden; set back to true (and call
     * invalidate()) when both panes are visible again.
     */
    this.enabled = true;

    // State
    this._map = null;
    this._mapDirty = true;
    this._targetV = 0;
    this._currentV = 0;
    this._totalVMax = 0;
    this._rafId = null;
    this._rafRunning = false;
    this._wheelControlled = false;
    this._lastSetA = null;
    this._lastSetB = null;
    this._expectedA = null;
    this._expectedB = null;

    // Bind handlers
    this._onWheel = this._handleWheel.bind(this);
    this._onScrollA = this._handleScrollA.bind(this);
    this._onScrollB = this._handleScrollB.bind(this);
    this._frame = this._animationFrame.bind(this);

    // Attach
    paneA.addEventListener('wheel', this._onWheel, { passive: false });
    paneB.addEventListener('wheel', this._onWheel, { passive: false });
    paneA.addEventListener('scroll', this._onScrollA);
    paneB.addEventListener('scroll', this._onScrollB);
  }

  // ─── Public API ───

  /** Mark the scroll map as needing rebuild (call after content/layout changes). */
  invalidate() {
    this._mapDirty = true;
  }

  /** Programmatically scroll pane A to a given scrollTop, syncing pane B. */
  scrollATo(scrollTop) {
    this._stopAnimation();
    this.paneA.scrollTop = Math.max(0, scrollTop);
    this._syncBToA();
  }

  /** Programmatically scroll pane B to a given scrollTop, syncing pane A. */
  scrollBTo(scrollTop) {
    this._stopAnimation();
    this.paneB.scrollTop = Math.max(0, scrollTop);
    this._syncAToB();
  }

  /** Clean up all event listeners and stop animation. */
  destroy() {
    this._stopAnimation();
    this.paneA.removeEventListener('wheel', this._onWheel);
    this.paneB.removeEventListener('wheel', this._onWheel);
    this.paneA.removeEventListener('scroll', this._onScrollA);
    this.paneB.removeEventListener('scroll', this._onScrollB);
  }

  // ─── Internals ───

  _scrollMax(el) {
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }

  _toAS(scrollTop) {
    const max = this._scrollMax(this.paneA);
    return max > 0 ? Math.min(this.scale, (scrollTop / max) * this.scale) : 0;
  }

  _toBS(scrollTop) {
    const max = this._scrollMax(this.paneB);
    return max > 0 ? Math.min(this.scale, (scrollTop / max) * this.scale) : 0;
  }

  _fromAS(aS) {
    const max = this._scrollMax(this.paneA);
    return Math.max(0, Math.min(max, (aS / this.scale) * max));
  }

  _fromBS(bS) {
    const max = this._scrollMax(this.paneB);
    return Math.max(0, Math.min(max, (bS / this.scale) * max));
  }

  _getMap() {
    if (this._mapDirty || !this._map) {
      const anchors = this.getAnchors();
      this._map = buildMap(anchors, this.scale);
      this._totalVMax =
        this._map.length > 0 ? this._map[this._map.length - 1].vS : 0;
      this._mapDirty = false;
    }
    return this._map;
  }

  _stopAnimation() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafRunning = false;
    this._rafId = null;
    this._wheelControlled = false;
    this._lastSetA = null;
    this._lastSetB = null;
  }

  _startAnimation() {
    if (!this._rafRunning) {
      this._rafRunning = true;
      this._wheelControlled = true;
      this._lastSetA = this.paneA.scrollTop;
      this._lastSetB = this.paneB.scrollTop;
      this._rafId = requestAnimationFrame(this._frame);
    }
  }

  _animationFrame() {
    // Detect external scroll changes
    if (
      this._lastSetA !== null &&
      Math.abs(this.paneA.scrollTop - this._lastSetA) > 1
    ) {
      this._stopAnimation();
      this._syncBToA();
      return;
    }

    const map = this._getMap();
    if (!map || map.length === 0) {
      this._stopAnimation();
      return;
    }

    // LERP on virtual axis
    const vDiff = this._targetV - this._currentV;
    if (Math.abs(vDiff) > this.epsilon) {
      this._currentV += vDiff * this.lerp;
    } else if (Math.abs(vDiff) > 0.01) {
      this._currentV = this._targetV;
    }

    // Look up both sides
    const aS = mapLookup(map, 'vS', 'aS', this._currentV);
    const bS = mapLookup(map, 'vS', 'bS', this._currentV);

    this.paneA.scrollTop = this._fromAS(aS);
    this.paneB.scrollTop = this._fromBS(bS);
    this._lastSetA = this.paneA.scrollTop;
    this._lastSetB = this.paneB.scrollTop;

    if (Math.abs(this._targetV - this._currentV) > this.epsilon) {
      this._rafId = requestAnimationFrame(this._frame);
    } else {
      this._stopAnimation();
    }
  }

  _handleWheel(e) {
    if (!this.enabled) return;
    // Shift+wheel or pure horizontal scroll → let browser handle natively
    if (e.shiftKey || (e.deltaX !== 0 && e.deltaY === 0)) return;
    e.preventDefault();
    const map = this._getMap();

    // Scale delta to virtual axis
    const aMax = Math.max(1, this._scrollMax(this.paneA));
    const bMax = Math.max(1, this._scrollMax(this.paneB));
    const factor =
      this._totalVMax > 0 ? this._totalVMax / Math.max(aMax, bMax) : 1;
    const delta = e.deltaY * factor;

    // Re-sync if stopped
    if (!this._rafRunning) {
      const aS = this._toAS(this.paneA.scrollTop);
      const bS = this._toBS(this.paneB.scrollTop);
      const vA = mapLookup(map, 'aS', 'vS', aS);
      const vB = mapLookup(map, 'bS', 'vS', bS);
      this._currentV = Math.max(vA, vB);
      this._targetV = this._currentV;
    }

    this._targetV = Math.max(
      0,
      Math.min(this._totalVMax, this._targetV + delta)
    );
    this._startAnimation();
  }

  // ─── Scrollbar / Keyboard fallback (expected-value circular prevention) ───

  _syncBToA() {
    if (!this.enabled || this._wheelControlled) return;
    if (
      this._expectedA !== null &&
      Math.abs(this.paneA.scrollTop - this._expectedA) < 2
    ) {
      this._expectedA = null;
      return;
    }
    const map = this._getMap();
    const aS = this._toAS(this.paneA.scrollTop);
    const bS = mapLookup(map, 'aS', 'bS', aS);
    this._expectedB = this._fromBS(bS);
    this.paneB.scrollTop = this._expectedB;
    this._targetV = mapLookup(map, 'aS', 'vS', aS);
    this._currentV = this._targetV;
  }

  _syncAToB() {
    if (!this.enabled || this._wheelControlled) return;
    if (
      this._expectedB !== null &&
      Math.abs(this.paneB.scrollTop - this._expectedB) < 2
    ) {
      this._expectedB = null;
      return;
    }
    const map = this._getMap();
    const bS = this._toBS(this.paneB.scrollTop);
    const aS = mapLookup(map, 'bS', 'aS', bS);
    this._expectedA = this._fromAS(aS);
    this.paneA.scrollTop = this._expectedA;
    this._targetV = mapLookup(map, 'bS', 'vS', bS);
    this._currentV = this._targetV;
  }

  _handleScrollA() {
    this._syncBToA();
  }

  _handleScrollB() {
    this._syncAToB();
  }
}

export default DualScrollSync;
