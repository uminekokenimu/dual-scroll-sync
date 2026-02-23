/**
 * dual-scroll-sync — shared type definitions.
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

/** Axis key for segment-size fields. */
export type AxisSize = "aS" | "bS" | "vS";

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
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    options?: boolean | { capture?: boolean; passive?: boolean },
  ): void;
  addEventListener(
    type: string,
    handler: (e: Event) => void,
    options?: boolean | { capture?: boolean; passive?: boolean },
  ): void;
  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
  ): void;
  removeEventListener(type: string, handler: (e: Event) => void): void;
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
  /** Called when getAnchors() or buildMap() throws during ensureMap().
   *  Receives the thrown error. If omitted, errors are silently ignored
   *  and an empty map is used. */
  onError?: (error: unknown) => void;
  /** Viewport offset (px) for anchor alignment. Anchors align this many
   *  pixels below the top of each pane. @default 0 */
  alignOffset?: number;
  /** Frame scheduler. Default: requestAnimationFrame (with setTimeout fallback). */
  requestFrame?: (callback: () => void) => number;
  /** Cancel a scheduled frame. Default: cancelAnimationFrame (with clearTimeout fallback). */
  cancelFrame?: (id: number) => void;
  /** Wheel behavior. Omit for defaults (smooth: 0.1, no brake). */
  wheel?: WheelOptions;
}
