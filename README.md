# dual-scroll-sync

Synchronized scrolling for two panes with different content heights.

Each segment's virtual length is `vS = max(aS, bS)` — the pane with more content scrolls at normal speed, the other follows proportionally. Wheel input moves along the virtual axis in pixels, like normal browser scrolling.

## Install

```
npm install dual-scroll-sync
```

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
| `getAnchors` | `() => Anchor[]` | *required* | Returns anchor points |
| `onSync` | `() => void` | — | Called after each sync |
| `onMapBuilt` | `(data) => void` | — | Called on map rebuild |
| `wheelScale` | `number` | `1.0` | Wheel deltaY multiplier |
| `dampZonePx` | `number` | `80` | Damping radius around snap anchors (v-px). `0` = off |
| `dampMin` | `number` | `0.15` | Minimum damping factor at snap center (0–1) |
| `snapRangePx` | `number` | `40` | Snap attraction range (v-px). `0` = off |
| `snapDelayMs` | `number` | `200` | Idle time before snap (ms) |
| `snapOffsetPx` | `number` | `25` | Snap landing offset (v-px before anchor) |

## API

### `buildMap(anchors, sMaxA, sMaxB)`

Build a virtual-axis scroll map. Returns `{ segments, vTotal, snapVs }`.

### `lookup(segments, from, to, value)`

Convert a position between axes (`'aPx'`, `'bPx'`, `'vPx'`). Caller must clamp `value` to valid range; out-of-range values are extrapolated, not clamped.

### `DualScrollSync`

- `invalidate()` — Mark map for rebuild
- `ensureMap()` — Rebuild if dirty, return map data
- `destroy()` — Remove listeners and timers
- `enabled` — Set `false` to suspend sync

## How it works

1. Anchors define corresponding positions in both panes
2. Between anchors, each segment gets `vS = max(aS, bS)`
3. Wheel delta maps 1:1 to v-axis pixels — the pane with more content in that segment scrolls at normal speed
4. Optional damping (smoothstep) reduces scroll speed near snap anchors
5. Optional snap settles to nearest anchor after wheel stops

## License

MIT
