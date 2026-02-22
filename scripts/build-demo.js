/**
 * Build examples/demo.html from examples/demo.src.html + src/index.js.
 *
 * Replaces the `// @@LIBRARY@@` marker in the template with a processed
 * copy of the library source (export keywords stripped, indented 4 spaces).
 *
 * Usage: node scripts/build-demo.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libSrc = readFileSync(resolve(root, 'src/index.js'), 'utf8');
const template = readFileSync(resolve(root, 'examples/demo.src.html'), 'utf8');

// Strip export keywords for inline embedding
const libInline = libSrc
  .replace(/^export function /gm, 'function ')
  .replace(/^export class /gm, 'class ')
  .replace(/^export default .*;\n?/gm, '')
  .split('\n')
  .map(function (line) { return line ? '    ' + line : ''; })
  .join('\n');

const output = template.replace('    // @@LIBRARY@@', libInline);

writeFileSync(resolve(root, 'examples/demo.html'), output);
console.log('Built examples/demo.html');
