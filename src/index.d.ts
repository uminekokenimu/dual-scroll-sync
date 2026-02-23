/**
 * dual-scroll-sync — type definitions (auto-generated, do not edit).
 * @module dual-scroll-sync
 * @license MIT
 */

import type { Anchor, Segment, AxisPos, MapData, ScrollPane, WheelBrakeOptions, WheelOptions, SyncOptions } from "./types.js";
export type { Anchor, Segment, AxisPos, MapData, ScrollPane, WheelBrakeOptions, WheelOptions, SyncOptions } from "./types.js";

/**
 * Build a virtual-axis scroll map from anchors.
 *
 * @param {Anchor[]} anchors
 * @param {number} sMaxA - scrollHeight − clientHeight of pane A.
 * @param {number} sMaxB - scrollHeight − clientHeight of pane B.
 * @returns {MapData}
 */
export function buildMap(anchors: Anchor[], sMaxA: number, sMaxB: number): MapData;
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
export function lookup(segments: Segment[], from: AxisPos, to: AxisPos, value: number): number;
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
    constructor(paneA: ScrollPane, paneB: ScrollPane, opts: SyncOptions);
    paneA: ScrollPane;
    paneB: ScrollPane;
    getAnchors: () => Anchor[];
    onSync: (() => void) | null;
    onMapBuilt: ((data: MapData) => void) | null;
    alignOffset: number;
    enabled: boolean;
    wheel: {
        smooth: number;
        snap: number;
        brake: {
            factor: number;
            zone: number;
        } | null;
    };
    /** Mark the scroll map for rebuild on next access. */
    invalidate(): void;
    /**
     * Ensure the scroll map is current.
     * @returns {MapData}
     */
    ensureMap(): MapData;
    /** Remove all event listeners and timers. */
    destroy(): void;
}
export default DualScrollSync;
