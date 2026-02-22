/**
 * dual-scroll-sync v9
 *
 * Synchronized scrolling for two panes with different content heights.
 *
 * @license MIT
 */

/** A single anchor point mapping positions between two panes. */
export interface Anchor {
  /** Pixel position in pane A (0 to scrollMaxA). */
  aPx: number;
  /** Pixel position in pane B (0 to scrollMaxB). */
  bPx: number;
  /** If true, this anchor is a damping/snap target. */
  snap?: boolean;
}

/** A segment in the scroll map. */
export interface Segment {
  /** Pane A start position (px). */
  aPx: number;
  /** Pane B start position (px). */
  bPx: number;
  /** Virtual axis start position (px). */
  vPx: number;
  /** Pane A segment length (px). */
  aS: number;
  /** Pane B segment length (px). */
  bS: number;
  /** Virtual axis segment length: max(aS, bS). */
  vS: number;
}

/** Axis key for position fields. */
export type AxisPos = 'aPx' | 'bPx' | 'vPx';

/** Result of {@link buildMap}. */
export interface MapData {
  /** Ordered array of segments. */
  segments: Segment[];
  /** Total virtual axis length (px). */
  vTotal: number;
  /** Virtual axis positions of snap anchors (sorted). */
  snapVs: number[];
  /** Number of anchors dropped due to non-monotonic bPx. */
  droppedCount: number;
}

/** Scrollable pane interface. Any object satisfying this contract works. */
export interface ScrollPane {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  addEventListener(type: string, handler: (e: any) => void, options?: any): void;
  removeEventListener(type: string, handler: (e: any) => void): void;
}

/** Options for {@link DualScrollSync}. */
export interface SyncOptions {
  /** Returns the current anchor points. Called on map rebuild. */
  getAnchors: () => Anchor[];
  /** Called after each scroll synchronization. */
  onSync?: () => void;
  /** Called when the scroll map is rebuilt. */
  onMapBuilt?: (data: MapData) => void;
  /** Damping radius around snap anchors (v-px). 0 = off. @default 80 */
  dampZonePx?: number;
  /** Minimum damping factor at snap center (0–1). @default 0.15 */
  dampMin?: number;
  /** Snap attraction range (v-px). 0 = off. @default 40 */
  snapRangePx?: number;
  /** Idle time before snap engages (ms). @default 200 */
  snapDelayMs?: number;
  /** V-px offset before anchor for snap landing position. @default 25 */
  snapOffsetPx?: number;
  /** Frame scheduler. Default: requestAnimationFrame (with setTimeout fallback). */
  requestFrame?: (callback: () => void) => number;
  /** Cancel a scheduled frame. Default: cancelAnimationFrame (with clearTimeout fallback). */
  cancelFrame?: (id: number) => void;
}

/**
 * Build a virtual-axis scroll map from anchors.
 *
 * @param anchors - Anchor points (0,0 and end are added automatically).
 * @param sMaxA - scrollHeight − clientHeight of pane A.
 * @param sMaxB - scrollHeight − clientHeight of pane B.
 */
export function buildMap(anchors: Anchor[], sMaxA: number, sMaxB: number): MapData;

/**
 * Look up a position on one axis given a position on another.
 *
 * @param segments - Segment array from buildMap.
 * @param from - Source axis.
 * @param to - Target axis.
 * @param value - Position on source axis (px). Caller must clamp;
 *   out-of-range values are extrapolated, not clamped.
 * @returns Position on target axis (px).
 */
export function lookup(segments: Segment[], from: AxisPos, to: AxisPos, value: number): number;

/**
 * Synchronized scrolling controller for two scrollable elements.
 */
export class DualScrollSync {
  /** First scrollable element. */
  readonly paneA: ScrollPane;
  /** Second scrollable element. */
  readonly paneB: ScrollPane;
  /** Anchor provider function. */
  getAnchors: () => Anchor[];
  /** Callback after each sync. */
  onSync: (() => void) | null;
  /** Callback on map rebuild. */
  onMapBuilt: ((data: MapData) => void) | null;
  /** Damping zone radius (v-px). */
  dampZonePx: number;
  /** Minimum damping factor at snap center. */
  dampMin: number;
  /** Snap attraction range (v-px). */
  snapRangePx: number;
  /** Snap idle delay (ms). */
  snapDelayMs: number;
  /** Snap landing offset (v-px). */
  snapOffsetPx: number;
  /** When false, all sync is suspended. */
  enabled: boolean;

  constructor(paneA: ScrollPane, paneB: ScrollPane, opts: SyncOptions);

  /** Mark the scroll map for rebuild on next access. */
  invalidate(): void;

  /** Ensure the scroll map is current. Returns the map data. */
  ensureMap(): MapData;

  /** Remove all event listeners and timers. */
  destroy(): void;
}

export default DualScrollSync;
