/**
 * Consumer type test — verifies the public API surface of the generated .d.ts.
 *
 * This file is NOT executed; it is only type-checked:
 *   npx tsc --noEmit test/types.check.ts
 */

import {
  buildMap,
  lookup,
  DualScrollSync,
} from "../src/index.js";

import type {
  Anchor,
  Segment,
  AxisPos,
  MapData,
  ScrollPane,
  WheelBrakeOptions,
  WheelOptions,
  SyncOptions,
} from "../src/index.js";

// ── Anchor ──
const anchor: Anchor = { aPx: 0, bPx: 0 };
const snapAnchor: Anchor = { aPx: 100, bPx: 200, snap: true };

// ── buildMap ──
const data: MapData = buildMap([anchor, snapAnchor], 1000, 2000);
const segments: Segment[] = data.segments;
const vTotal: number = data.vTotal;
const dropped: number = data.droppedCount;
const hasSnap: boolean = data.hasSnap;

// ── Segment fields ──
const seg: Segment = segments[0];
const _aPx: number = seg.aPx;
const _bPx: number = seg.bPx;
const _vPx: number = seg.vPx;
const _aS: number = seg.aS;
const _bS: number = seg.bS;
const _vS: number = seg.vS;
const _snap: boolean | undefined = seg.snap;

// ── lookup ──
const pos: AxisPos = "vPx";
const result: number = lookup(segments, "aPx", "bPx", 100);
const _r2: number = lookup(segments, pos, "aPx", 50);

// ── ScrollPane ──
const pane: ScrollPane = {
  scrollTop: 0,
  scrollHeight: 1000,
  clientHeight: 500,
  addEventListener(_type: string, _handler: (e: any) => void) {},
  removeEventListener(_type: string, _handler: (e: any) => void) {},
};

// ── WheelBrakeOptions ──
const brake: WheelBrakeOptions = { factor: 0.3, zone: 100 };

// ── WheelOptions ──
const wheel: WheelOptions = { smooth: 0.1, snap: 50, brake };

// ── SyncOptions ──
const opts: SyncOptions = {
  getAnchors: () => [anchor],
  onSync: () => {},
  onMapBuilt: (_d: MapData) => {},
  alignOffset: 20,
  wheel,
};

// ── DualScrollSync ──
const sync = new DualScrollSync(pane, pane, opts);
sync.invalidate();
const map: MapData = sync.ensureMap();
sync.enabled = false;
sync.destroy();

// ── default export ──
import DefaultSync from "../src/index.js";
const _sync2 = new DefaultSync(pane, pane, { getAnchors: () => [] });

// Suppress unused warnings
void [segments, vTotal, dropped, hasSnap, _aPx, _bPx, _vPx, _aS, _bS, _vS, _snap, result, _r2, map, _sync2];
