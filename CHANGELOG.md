# Changelog

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
- TypeScript type definitions
- Examples: Markdown editor, diff viewer
