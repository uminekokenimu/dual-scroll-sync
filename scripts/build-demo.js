/**
 * Update the inlined library in examples/demo.html from src/index.js.
 *
 * Replaces everything between the `// @@LIB-START@@` and `// @@LIB-END@@`
 * markers with a processed copy of the library source (export keywords
 * stripped, indented 4 spaces).
 *
 * Usage: node scripts/build-demo.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libSrc = readFileSync(resolve(root, 'src/index.js'), 'utf8');
const demo = readFileSync(resolve(root, 'examples/demo.html'), 'utf8');

// Strip export keywords for inline embedding
const libInline = libSrc
  .replace(/^export function /gm, 'function ')
  .replace(/^export class /gm, 'class ')
  .replace(/^export default .*;\n?/gm, '')
  .split('\n')
  .map(function (line) { return line ? '    ' + line : ''; })
  .join('\n');

const startTag = '    // @@LIB-START@@';
const endTag = '    // @@LIB-END@@';

const startIdx = demo.indexOf(startTag);
const endIdx = demo.indexOf(endTag);
if (startIdx < 0 || endIdx < 0) {
  console.error('Could not find @@LIB-START@@ / @@LIB-END@@ markers in demo.html');
  process.exit(1);
}

const output = demo.substring(0, startIdx) + startTag + '\n' + libInline + '\n' + demo.substring(endIdx);

writeFileSync(resolve(root, 'examples/demo.html'), output);
console.log('Updated examples/demo.html');
