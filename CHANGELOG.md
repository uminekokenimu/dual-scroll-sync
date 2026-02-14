# Changelog

## 0.5.0 (2026-02-14)

### Changed

- **Virtual-pane-absolute wheel delta** — wheel input now moves a fixed
  proportion of the virtual axis, independent of which physical pane received
  the event.  The conversion uses the average scrollMax of both panes as the
  baseline.  This replaces the per-pane projection introduced in v0.4.0.

  Previously, the same wheel notch produced different vS deltas depending on
  which pane it occurred in and which map segment the pane was in.  In documents
  with large content-length asymmetry (e.g. a Markdown table that renders much
  taller in preview), this caused the faster pane to scroll at many times native
  speed.

  Now the virtual pane is the absolute reference.  Each physical pane's pixel
  movement is determined solely by the segment's density ratio (aS/vS and
  bS/vS), which is exactly what `buildMap` already encodes.  Scroll feel is
  consistent across all positions in the document and symmetric between panes.

  `wheelScale` remains a direct multiplier on scroll speed.

## 0.4.0 (2026-02-13)

### Changed

- **Pane-relative wheel delta** — wheel input is now projected through the
  scroll map of the pane that received the event, instead of using a global
  `totalVMax / max(scrollMaxA, scrollMaxB)` factor. This keeps scroll speed
  consistent regardless of document length or the other pane's height.
  Previously, a long document or a preview with many images would cause
  scroll speed to drop because the global factor shrank.

  `wheelScale: 1` now corresponds exactly to native browser scroll speed.
  Higher values are a direct multiplier on that native speed.

## 0.3.0 (2026-02-13)

### Added

- **`wheelScale` option** — wheel input multiplier (default: `1.0`). Set higher values for faster scrolling. Writable at runtime for dynamic adjustment.

## 0.2.1 (2026-02-13)

### Fixed

- **Ctrl+wheel / Cmd+wheel** (browser zoom) and Cmd+wheel (macOS) were blocked by `preventDefault` in the wheel handler. Now passed through alongside Shift+wheel and horizontal scroll.

## 0.2.0 (2026-02-13)

### Added

- **Snap anchors** — anchors can now include `snap: true` to mark them as damping/snap targets. The library does not interpret the semantic meaning; the caller decides which anchors are snap targets (e.g. headings, tables, code blocks).

- **Scroll damping** — wheel input is reduced near snap anchors using a smoothstep curve. The damping zone width is defined as a multiple of the current wheel delta (`dampZoneFactor`), making it consistent across document lengths and input devices.

- **Snap settle** — after wheel animation converges, if the position is within `snapThreshold` of a snap anchor, a brief LERP animation settles onto it. New wheel input cancels the snap.

- **`resync()` method** — re-derives the virtual axis from both panes' current scrollTop. Use after programmatic jumps that move both panes independently (e.g. TOC click).

- **`onSync` callback** — called after each synchronised scroll update (e.g. to update line numbers or other dependent UI).

- **`_syncing` guard** — prevents scroll-event feedback during `resync()`.

- **New options:**
  - `onSync` — callback after each sync update
  - `snapThreshold` (default: `0.001`) — snap range as fraction of scale. Set `0` to disable.
  - `dampZoneFactor` (default: `2.5`) — damping zone width as multiple of wheel delta. Set `0` to disable.
  - `dampMin` (default: `0.15`) — minimum scroll ratio on a snap anchor.

### Changed

- `buildMap()` now accepts and propagates the optional `snap` property on anchors.
- `_syncBToA()` / `_syncAToB()` now check `_syncing` flag to prevent feedback during `resync()`.

### Backward compatible

- Anchors without `snap` work exactly as before — no damping, no snapping.
- All new options have sensible defaults; existing code requires no changes.

## 0.1.0 (2026-02-13)

Initial release.

- Core algorithm: ratio-normalized virtual axis with cumulative vS computation
- `buildMap()` — sparse scroll map construction with bS monotonicity enforcement
- `mapLookup()` — O(log n) binary search with linear interpolation
- `DualScrollSync` class — high-level controller with:
  - Wheel event handling with LERP animation on virtual axis
  - Scrollbar/keyboard fallback with expected-value circular event prevention
  - Dirty-flag map caching (rebuild only on content/layout changes)
  - `invalidate()`, `scrollATo()`, `scrollBTo()`, `destroy()` API
  - `enabled` property to suspend/resume sync (e.g., when one pane is hidden)
  - Shift+wheel and horizontal scroll passthrough (not intercepted)
- TypeScript type definitions
- Examples: Markdown editor, diff viewer
