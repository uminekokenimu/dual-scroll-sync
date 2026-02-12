/**
 * dual-scroll-sync
 *
 * Synchronized scrolling for two panes with different content heights.
 * Uses a ratio-normalized virtual axis so both panes are treated symmetrically.
 *
 * @license MIT
 */

/** An anchor point mapping normalized positions between two panes. */
export interface Anchor {
  /** Normalized position in pane A (0–1). */
  a: number;
  /** Normalized position in pane B (0–1). */
  b: number;
}

/** A single entry in the scroll map. */
export interface MapEntry {
  /** Pane A position in ratio space (0–SCALE). */
  aS: number;
  /** Pane B position in ratio space (0–SCALE). */
  bS: number;
  /** Position on the virtual scroll axis (cumulative). */
  vS: number;
}

/** Valid axis keys for map lookup. */
export type MapKey = 'aS' | 'bS' | 'vS';

/** Options for the DualScrollSync constructor. */
export interface DualScrollSyncOptions {
  /**
   * Function returning anchor points. Called when the map is rebuilt.
   * Each anchor: { a: 0–1 position in pane A, b: 0–1 position in pane B }.
   */
  getAnchors: () => Anchor[];

  /**
   * LERP smoothing factor (0–1). Lower = smoother but slower to converge.
   * @default 0.18
   */
  lerp?: number;

  /**
   * Animation stops when virtual-axis residual drops below this value.
   * @default 0.15
   */
  epsilon?: number;

  /**
   * Internal ratio scale. Larger = more floating-point precision.
   * @default 10000
   */
  scale?: number;
}

/**
 * Build a sparse scroll map in ratio space.
 *
 * @param anchors - Anchor points with normalized positions (0–1) in each pane.
 *   Does NOT need to include (0,0) or (1,1) — they are added automatically.
 * @param scale - Internal scale factor (default: 10000).
 * @returns Scroll map entries sorted by aS with cumulative vS.
 */
export function buildMap(anchors: Anchor[], scale?: number): MapEntry[];

/**
 * Interpolate between map entries using binary search.
 * Given a value on one axis, returns the interpolated value on another axis.
 * O(log n) complexity.
 *
 * @param map - Scroll map from buildMap().
 * @param fromKey - Source axis key ('aS', 'bS', or 'vS').
 * @param toKey - Target axis key.
 * @param value - Position on the source axis.
 * @returns Interpolated position on the target axis.
 */
export function mapLookup(
  map: MapEntry[],
  fromKey: MapKey,
  toKey: MapKey,
  value: number
): number;

/**
 * Synchronized scrolling controller for two scrollable elements.
 *
 * Creates a virtual scroll axis where both panes are equal citizens.
 * Handles wheel events (with LERP animation), scrollbar interaction
 * (with circular event prevention), and programmatic scrolling.
 */
export class DualScrollSync {
  /** First scrollable pane. */
  readonly paneA: HTMLElement;
  /** Second scrollable pane. */
  readonly paneB: HTMLElement;

  /**
   * When false, all sync behavior is suspended: wheel events are not
   * intercepted, and scroll events on either pane are ignored.
   * Set to false when one pane is hidden; set back to true (and call
   * invalidate()) when both panes are visible again.
   * @default true
   */
  enabled: boolean;

  constructor(
    paneA: HTMLElement,
    paneB: HTMLElement,
    options: DualScrollSyncOptions
  );

  /**
   * Mark the scroll map as needing rebuild.
   * Call after content changes, layout changes, or window resize.
   */
  invalidate(): void;

  /**
   * Programmatically scroll pane A to a given scrollTop, syncing pane B.
   * Stops any running wheel animation.
   */
  scrollATo(scrollTop: number): void;

  /**
   * Programmatically scroll pane B to a given scrollTop, syncing pane A.
   * Stops any running wheel animation.
   */
  scrollBTo(scrollTop: number): void;

  /**
   * Remove all event listeners and stop any running animation.
   * Call when the component is unmounted or no longer needed.
   */
  destroy(): void;
}

export default DualScrollSync;
