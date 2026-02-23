/**
 * dual-scroll-sync v0.6.0
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
  /** Mark this anchor as a snap target. When any anchor has snap: true,
   *  only those anchors are considered for wheel snap. */
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
  /** Whether the anchor at this segment's start is a snap target. */
  snap?: boolean;
}

/** Axis key for position fields. */
export type AxisPos = "aPx" | "bPx" | "vPx";

/** Result of {@link buildMap}. */
export interface MapData {
  /** Ordered array of segments. */
  segments: Segment[];
  /** Total virtual axis length (px). */
  vTotal: number;
  /** Number of anchors dropped due to non-monotonic bPx. */
  droppedCount: number;
  /** Whether any segment has snap: true. */
  hasSnap: boolean;
}

/** Scrollable pane interface. Any object satisfying this contract works. */
export interface ScrollPane {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  addEventListener(
    type: string,
    handler: (e: any) => void,
    options?: any,
  ): void;
  removeEventListener(type: string, handler: (e: any) => void): void;
}

/** Anchor-proximity braking options. */
export interface WheelBrakeOptions {
  /** Minimum drain-rate multiplier at an anchor (0–1). */
  factor: number;
  /** Radius (virtual px) around each anchor where braking applies. */
  zone: number;
}

/** Wheel behavior options. */
export interface WheelOptions {
  /** Interpolation factor (0–1). 0 = OFF, 1 = instant, (0,1) = interpolated. @default 0.1 */
  smooth: number;
  /** Snap-to-anchor distance (virtual px). When the wheel pump stops within
   *  this range of an anchor, scroll animates to that anchor. 0 = disabled.
   *  @default 0 */
  snap?: number;
  /** Anchor proximity braking. Omit to disable. */
  brake?: WheelBrakeOptions;
}

/** Options for {@link DualScrollSync}. */
export interface SyncOptions {
  /** Returns the current anchor points. Called on map rebuild. */
  getAnchors: () => Anchor[];
  /** Called after each scroll synchronization. */
  onSync?: () => void;
  /** Called when the scroll map is rebuilt. */
  onMapBuilt?: (data: MapData) => void;
  /** Frame scheduler. Default: requestAnimationFrame (with setTimeout fallback). */
  requestFrame?: (callback: () => void) => number;
  /** Cancel a scheduled frame. Default: cancelAnimationFrame (with clearTimeout fallback). */
  cancelFrame?: (id: number) => void;
  /** Wheel behavior. Omit for defaults (smooth: 0.05, no brake). */
  wheel?: WheelOptions;
}

/**
 * Build a virtual-axis scroll map from anchors.
 *
 * @param anchors - Anchor points (0,0 and end are added automatically).
 * @param sMaxA - scrollHeight − clientHeight of pane A.
 * @param sMaxB - scrollHeight − clientHeight of pane B.
 */
export function buildMap(
  anchors: Anchor[],
  sMaxA: number,
  sMaxB: number,
): MapData;

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
export function lookup(
  segments: Segment[],
  from: AxisPos,
  to: AxisPos,
  value: number,
): number;

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
  /** Wheel behavior settings. */
  wheel: { smooth: number; snap: number; brake: WheelBrakeOptions | null };
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
