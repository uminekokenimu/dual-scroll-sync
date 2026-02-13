# Changelog

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
