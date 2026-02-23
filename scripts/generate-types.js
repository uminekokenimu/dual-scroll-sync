#!/usr/bin/env node
/**
 * Generate src/index.d.ts from JSDoc annotations.
 *
 * 1. Run tsc to emit raw .d.ts into .dts-out/
 * 2. Strip @internal members
 * 3. Replace inline import("./types.js") references with bare names
 * 4. Add import + re-export for shared types
 * 5. Add module header, write to src/index.d.ts
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

// 1. Run tsc
try {
  execSync("tsc -p tsconfig.emit.json", { stdio: "inherit" });
} catch {
  console.error("tsc failed — aborting type generation");
  process.exit(1);
}

let src = readFileSync(".dts-out/index.d.ts", "utf8");
rmSync(".dts-out", { recursive: true, force: true });

// 2. Strip @internal members (JSDoc block + following declaration line)
src = src.replace(
  / *\/\*\*(?:(?!\*\/)[\s\S])*?@internal(?:(?!\*\/)[\s\S])*?\*\/\n *[^\n]+\n/g,
  "",
);

// 3. Replace inline import("./types.js").X with bare X
src = src.replace(/import\("\.\/types\.js"\)\./g, "");

// 4. Collect type names from bottom re-export lines, then remove them
const reExportNames = [];
src = src.replace(/^export type (\w+) = \1;\n/gm, (_m, name) => {
  if (name !== "AxisSize") reExportNames.push(name);
  return "";
});

// 5. Strip redundant JSDoc on constructor (just @param types, no prose)
src = src.replace(
  / *\/\*\*\n(?: *\* *@param \{\w+\} \w+\n)+ *\*\/\n/g,
  "",
);

// 6. Clean up excessive blank lines
src = src.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

// 7. Assemble: header + import (for internal use) + re-export + body
const header = `/**
 * dual-scroll-sync — type definitions (auto-generated, do not edit).
 * @module dual-scroll-sync
 * @license MIT
 */

`;

const typeNames = reExportNames.join(", ");
const preamble = reExportNames.length
  ? `import type { ${typeNames} } from "./types.js";\nexport type { ${typeNames} } from "./types.js";\n\n`
  : "";

writeFileSync("src/index.d.ts", header + preamble + src);
console.log("Generated src/index.d.ts");
