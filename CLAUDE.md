# Project Guidelines

## Git Commits

- Do not add `Co-Authored-By` trailers to commit messages.

## Project Overview

Synchronized scrolling library for two panes with different content heights.
Each segment's virtual length is `max(aS, bS)` — the dominant pane scrolls at normal speed, the other follows via pixel-level anchor interpolation. Published as an npm package.

## File Map

| File | Role |
|------|------|
| `src/index.js` | Only runtime source (`buildMap`, `lookup`, `DualScrollSync` class) |
| `src/types.d.ts` | Type definitions (Anchor, Segment, MapData, SyncOptions, etc.) |
| `src/index.d.ts` | Auto-generated public type declarations — do not edit manually |
| `test/index.test.js` | Tests (node:test) |
| `test/types.check.ts` | Compile-time type checking |
| `examples/demo.html` | Interactive demo |
| `scripts/generate-types.js` | Generates index.d.ts from JSDoc |

## Commands

```
npm test                — Run tests via node --test
npm run lint            — ESLint on src/ and test/
npm run typecheck       — tsc type checking
npm run generate:types  — Regenerate index.d.ts
npm run build           — esbuild IIFE bundle
npm start               — Build + serve (for demo)
```

## Coding Conventions

- JavaScript (ES modules) with JSDoc type annotations — not TypeScript
- ES2022 `#private` fields
- `.d.ts` files are auto-generated via `tsc --declaration` — do not edit manually
- Tests use `node:test` (not vitest), no external test runner needed
- Test only public API (no tests for private methods)
- devDependencies: esbuild, eslint, typescript only (minimal footprint)
