# dual-scroll-sync

Synchronized scrolling for two panes with different content heights.

When two scrollable panes show related content (a source editor and its rendered preview, two files in a diff view, etc.), their total heights are almost never equal. **dual-scroll-sync** uses a ratio-normalized virtual axis to keep both panes in sync smoothly, treating them as equal citizens rather than making one follow the other.

Zero dependencies. Framework-agnostic. ~380 lines of vanilla JavaScript.

## Motivation

Synchronizing scroll positions between two panes of different heights is a deceptively hard problem. A common approach is to pick one pane as "primary," find the corresponding position in the other pane, and set its `scrollTop` directly. This works in many cases, but has a few known challenges:

- When one pane reaches its scroll limit before the other, the shorter side stops — even though the longer side still has content to show.
- Setting `scrollTop` on one pane fires a scroll event, which tries to set the other, potentially causing oscillation.
- Direct `scrollTop` assignment without animation can feel abrupt.

**dual-scroll-sync** takes a different approach: instead of one pane driving the other, both panes derive their positions from a shared virtual scroll axis. This avoids the asymmetry and makes edge-of-scroll behavior more predictable.

## How It Works

### Virtual Axis

A single virtual axis controls both panes:

```
wheel δ  →  targetV += δ
                ↓
          currentV ← LERP(currentV, targetV)     ← rAF loop
                ↓
          map.lookup(vS → aS)  →  paneA.scrollTop
          map.lookup(vS → bS)  →  paneB.scrollTop
```

### Ratio Normalization

All positions are normalized to a `0–SCALE` ratio space:

```
aS = (paneA.scrollTop / paneA.scrollMax) × SCALE
bS = (paneB.scrollTop / paneB.scrollMax) × SCALE
```

Both panes map to the same `[0, SCALE]` range regardless of pixel heights. The virtual tail is always `(SCALE, SCALE)`, so both panes reach their scroll limits at the same time.

### Speed Ratio

The virtual axis distance for each interval is:

```
vS_distance = max(aS_distance, bS_distance)
```

The longer side scrolls at full speed. The shorter side scrolls proportionally slower — but keeps moving. Both reach their ends together.

### Scroll Map

The map is a sparse array of anchor entries `{ aS, bS, vS }`:

```
Index    aS      bS      vS
  0       0       0       0       ← head
  1    1200    3500    3500       ← first anchor
  2    2500    4000    4800
  ...
  n   10000   10000   15200       ← tail (always SCALE, SCALE)
```

- `aS`, `bS`: positions in ratio space (0–SCALE)
- `vS`: cumulative virtual position; `vS[i] = vS[i-1] + max(Δ aS, Δ bS)`
- Lookups use binary search — O(log n) per query
- The map is cached and rebuilt only when content or layout changes (dirty-flag)

### Circular Event Prevention

Setting `scrollTop` on one pane fires a scroll event. To prevent infinite loops, we use an **expected-value pattern**: before setting `scrollTop`, we record the value. When the resulting scroll event fires, we check if the actual value matches what we set and skip the sync if so. This is deterministic and avoids timing-dependent workarounds.

## Installation

```bash
# Install from GitHub
npm install github:uminekokenimu/dual-scroll-sync

# Or clone directly
git clone https://github.com/uminekokenimu/dual-scroll-sync.git
```

Or just copy `src/index.js` into your project — it has zero dependencies:

```html
<script type="module">
  import { DualScrollSync } from './path/to/dual-scroll-sync/src/index.js';
</script>
```

## Quick Start

```js
import { DualScrollSync } from 'dual-scroll-sync';

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');

// Your project provides this — maps a source line number to a pixel offset.
// This example assumes a monospace <textarea> with fixed line height.
function getEditorPixelForLine(line) {
  const style = getComputedStyle(editor);
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  return paddingTop + (line - 1) * lineHeight;
}

const sync = new DualScrollSync(editor, preview, {
  getAnchors: () => {
    const edMax = Math.max(1, editor.scrollHeight - editor.clientHeight);
    const pvMax = Math.max(1, preview.scrollHeight - preview.clientHeight);

    // Anchor points from data-line attributes on rendered preview elements
    return Array.from(preview.querySelectorAll('[data-line]')).map(el => ({
      a: getEditorPixelForLine(+el.dataset.line) / edMax,
      b: el.offsetTop / pvMax,
    }));
  }
});

// After content changes (and after async resources like images/fonts have loaded):
sync.invalidate();

// Cleanup:
sync.destroy();
```

## API

### `new DualScrollSync(paneA, paneB, options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `getAnchors` | `() => {a, b}[]` | *required* | Returns anchor points. `a` and `b` are normalized positions (0–1) in each pane. |
| `lerp` | `number` | `0.18` | Smoothing factor. Lower = smoother but slower to converge. |
| `epsilon` | `number` | `0.15` | Animation stops when residual drops below this. |
| `scale` | `number` | `10000` | Internal ratio scale. No need to change this. |

### Instance Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `.enabled` | `boolean` | `true` | Set to `false` to suspend all sync (useful when one pane is hidden). Set back to `true` and call `.invalidate()` to resume. |

### Instance Methods

| Method | Description |
|--------|-------------|
| `.invalidate()` | Mark the scroll map for rebuild. Call after content changes, layout changes, window resize, or async resource loading (images, fonts, math rendering). |
| `.scrollATo(px)` | Programmatically scroll pane A, syncing pane B. |
| `.scrollBTo(px)` | Programmatically scroll pane B, syncing pane A. |
| `.destroy()` | Remove all event listeners and stop animation. |

### Low-level Exports

The core functions are also exported for advanced use:

```js
import { buildMap, mapLookup } from 'dual-scroll-sync';

const map = buildMap([
  { a: 0.1, b: 0.3 },
  { a: 0.5, b: 0.6 },
  { a: 0.9, b: 0.95 },
]);

const bS = mapLookup(map, 'aS', 'bS', 5000); // aS=5000 → bS=?
```

## Use Cases

**Markdown / LaTeX / Typst editor + preview** — Anchor points come from source-line mappings (e.g., `data-line` attributes, SyncTeX, `typst query`).

**Diff viewer** — Two files side by side. Anchors are placed at hunk boundaries.

**Translation editor** — Original and translated text. Anchors at paragraph or sentence boundaries.

**Any dual-pane layout** — Anywhere two scrollable regions show related content at different heights.

## Design Decisions

**Why a virtual axis instead of direct A→B mapping?**
Direct mapping requires choosing which pane drives the other, creating asymmetry. The virtual axis treats both panes equally — the same `mapLookup` function works in both directions.

**Why ratio normalization?**
Pixel-based mapping breaks when pane heights differ significantly. Normalizing to 0–SCALE ensures the map always spans the full scroll range of both panes, and both reach their scroll limits simultaneously.

**Why LERP?**
Direct `scrollTop` assignment feels abrupt, especially when the mapping ratio changes sharply between intervals. LERP on the virtual axis smooths this out. Both panes animate together and arrive at their targets at the same time.

**Why binary search?**
The scroll map is sparse (typically 50–300 entries). Binary search keeps each lookup to ~8 comparisons. During active scrolling, the hot path is two lookups + two `scrollTop` assignments — well under 1ms per frame.

## Examples

The examples use ES module imports, so they need to be served over HTTP (not opened as local files). From the project root:

```bash
npx serve .
# or: python3 -m http.server 8000
```

Then open `http://localhost:3000/examples/markdown.html` (or port 8000 for Python).

- **`markdown.html`** — Markdown editor with live preview
- **`diff-viewer.html`** — Side-by-side diff with hunk-aligned scrolling

## License

MIT
