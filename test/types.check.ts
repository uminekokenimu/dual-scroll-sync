// Type-check only — not executed at runtime.
// Run: tsc --noEmit --strict test/types.check.ts

import { buildMap, lookup, DualScrollSync } from '../src/index.js';
import type { Anchor, Segment, MapData, SyncOptions, AxisPos } from '../src/index.js';

// ─── buildMap ───
const anchors: Anchor[] = [
  { aPx: 100, bPx: 200 },
  { aPx: 300, bPx: 600, snap: true },
];
const data: MapData = buildMap(anchors, 1000, 2000);
const seg: Segment = data.segments[0];
const v: number = data.vTotal;
const snaps: number[] = data.snapVs;

// ─── lookup ───
const from: AxisPos = 'aPx';
const to: AxisPos = 'vPx';
const result: number = lookup(data.segments, from, to, 500);
const result2: number = lookup(data.segments, 'vPx', 'bPx', 300);

// ─── DualScrollSync (type-level only) ───
declare const paneA: HTMLElement;
declare const paneB: HTMLElement;

const opts: SyncOptions = {
  getAnchors: () => anchors,
  onSync: () => {},
  onMapBuilt: (d: MapData) => { console.log(d.vTotal); },
  dampZonePx: 80,
  dampMin: 0.15,
  snapRangePx: 40,
  snapDelayMs: 200,
  snapOffsetPx: 25,
};

const sync: DualScrollSync = new DualScrollSync(paneA, paneB, opts);
sync.enabled = false;
sync.invalidate();
const mapData: MapData = sync.ensureMap();
sync.destroy();

// Minimal opts (only required fields)
const minSync: DualScrollSync = new DualScrollSync(paneA, paneB, {
  getAnchors: () => [],
});
minSync.destroy();
