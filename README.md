# dual-scroll-sync

Synchronized scrolling for two panes with different content heights.

Each segment's virtual length is `vS = max(aS, bS)` — the pane with more content scrolls at normal speed, the other follows proportionally. Wheel input moves along the virtual axis in pixels, like normal browser scrolling.

## Install

```
npm install dual-scroll-sync
```

## Demo

`examples/demo.html` is a markdown editor + preview demo with interactive scroll sync:

```
npm start
```

Open the Settings panel to adjust `alignOffset`, `wheel.smooth`, `snap`, and `brake` in real time.

## Usage

```js
import { DualScrollSync } from 'dual-scroll-sync';

const sync = new DualScrollSync(editorPane, previewPane, {
  getAnchors() {
    return headings.map(h => ({
      aPx: h.editorPx,
      bPx: h.previewPx,
      snap: true,
    }));
  },
  wheel: { smooth: 0.1, snap: 60, brake: { factor: 0.2, zone: 80 } },
});

// After content changes:
sync.invalidate();

// Cleanup:
sync.destroy();
```

## Why anchor granularity matters

Most scroll-sync implementations (including VSCode and Joplin) use **line numbers** as the intermediate representation. This works well when each markdown line produces a proportionally-sized HTML element, but breaks down when it doesn't:

- A single `| table |` line in markdown may render as a 500px table in preview
- A `![image](...)` line may render as a 800px image
- A fenced code block may have very different heights in editor vs preview

Line-based sync can only interpolate linearly between line boundaries, so scrolling through a large table in the editor causes the preview to jump past it.

**dual-scroll-sync uses pixel-position anchors instead of line numbers.** You can place anchors at any granularity — not just headings, but at table boundaries, image positions, code block edges, or any other block-level element. The more anchors you provide, the more precise the synchronization.

### Block-level anchor example

```js
function getAnchors() {
  const anchors = [];

  // Headings — snap targets
  preview.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => {
    const line = Number(el.dataset.sourceLine);
    anchors.push({
      aPx: editor.lineToPixel(line),
      bPx: el.offsetTop,
      snap: true,
    });
  });

  // Tables — anchor both top and bottom edges
  preview.querySelectorAll('table').forEach(el => {
    const startLine = Number(el.dataset.sourceLine);
    const endLine = Number(el.dataset.sourceLineEnd);
    anchors.push(
      { aPx: editor.lineToPixel(startLine), bPx: el.offsetTop },
      { aPx: editor.lineToPixel(endLine),   bPx: el.offsetTop + el.offsetHeight },
    );
  });

  // Images
  preview.querySelectorAll('img').forEach(el => {
    const line = Number(el.dataset.sourceLine);
    anchors.push(
      { aPx: editor.lineToPixel(line),     bPx: el.offsetTop },
      { aPx: editor.lineToPixel(line + 1), bPx: el.offsetTop + el.offsetHeight },
    );
  });

  // Code blocks
  preview.querySelectorAll('pre').forEach(el => {
    const startLine = Number(el.dataset.sourceLine);
    const endLine = Number(el.dataset.sourceLineEnd);
    anchors.push(
      { aPx: editor.lineToPixel(startLine), bPx: el.offsetTop },
      { aPx: editor.lineToPixel(endLine),   bPx: el.offsetTop + el.offsetHeight },
    );
  });

  return anchors;
}
```

With heading-only anchors, dual-scroll-sync behaves similarly to line-based approaches. With block-level anchors, it achieves substantially more precise synchronization — especially for documents with tables, images, and code blocks of varying heights.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `getAnchors` | `() => Anchor[]` | *required* | Returns anchor points. Called on each map rebuild. |
| `onSync` | `() => void` | — | Called after each scroll synchronization. |
| `onMapBuilt` | `(data: MapData) => void` | — | Called when the scroll map is rebuilt. |
| `onError` | `(error: unknown) => void` | — | Called when `getAnchors()` throws during map rebuild. If omitted, errors are silently ignored and an empty map is used. |
| `alignOffset` | `number` | `0` | Viewport offset (px). Anchors align this many pixels below the top of each pane. |
| `wheel` | `WheelOptions` | `{ smooth: 0.1 }` | Wheel behavior (see below). |
| `requestFrame` | `(cb) => number` | `requestAnimationFrame` | Frame scheduler override (useful for testing). |
| `cancelFrame` | `(id) => void` | `cancelAnimationFrame` | Cancel a scheduled frame. |

### Wheel options (`wheel`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `smooth` | `number` | `0.1` | Interpolation factor. `0` = wheel handling OFF (browser default), `1` = instant, `(0,1)` = smoothly interpolated across frames. |
| `snap` | `number` | `0` | Snap-to-anchor distance (virtual px). After the wheel pump stops within this range of an anchor, scroll animates to it. `0` = disabled. |
| `brake` | `WheelBrakeOptions` | — | Anchor proximity braking. Omit to disable. |

### Brake options (`wheel.brake`)

| Option | Type | Description |
|--------|------|-------------|
| `factor` | `number` | Minimum drain-rate multiplier at an anchor (0--1). Lower = stronger braking. |
| `zone` | `number` | Radius (virtual px) around each anchor where braking applies. |

## API

### `buildMap(anchors, sMaxA, sMaxB)`

Build a virtual-axis scroll map from anchor points. Negative `sMaxA`/`sMaxB` values are clamped to 0.

Returns `{ segments, vTotal, droppedCount, hasSnap }`:
- `segments` — Ordered array of `Segment` objects
- `vTotal` — Total virtual axis length (px)
- `droppedCount` — Number of anchors dropped due to non-monotonic `bPx`
- `hasSnap` — Whether any segment has `snap: true`

### `lookup(segments, from, to, value)`

Convert a position between axes (`'aPx'`, `'bPx'`, `'vPx'`). Binary search + linear interpolation. Caller must clamp `value` to valid range; out-of-range values are extrapolated, not clamped.

### `DualScrollSync`

- `vCurrent` — Current virtual-axis scroll position (px, read-only)
- `scrollTo(v)` — Scroll both panes to virtual-axis position `v` (clamped to `[0, vTotal]`)
- `invalidate()` — Mark map for rebuild
- `ensureMap()` — Rebuild if dirty, return `MapData`
- `destroy()` — Remove all listeners and timers. Safe to call repeatedly; further method calls become no-ops
- `enabled` — Set `false` to suspend sync

## How it works

1. Anchors define corresponding positions in both panes
2. Between anchors, each segment gets `vS = max(aS, bS)`
3. Wheel delta maps 1:1 to v-axis pixels — the pane with more content in that segment scrolls at normal speed
4. Optional braking (smoothstep) reduces scroll speed near anchor boundaries (`wheel.brake`)
5. Optional snap settles to nearest anchor after the wheel pump stops (`wheel.snap`)

## License

MIT
