// Loads the vendored libraries for Node tests, as the browser does with
// <script> tags (not a test file: the glob only matches *.test.js).

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

export const markdownit = require('../vendor/markdown-it/markdown-it.min.js');
export const hljs = require('../vendor/highlight/highlight.min.js');
export const katex = require('../vendor/katex/katex.min.js');

// mhchem's UMD build require()s "katex" by package name, which doesn't resolve
// from vendor/; run it with the vendored copy instead (it registers \ce and \pu).
const mhchem = readFileSync(new URL('../vendor/katex/mhchem.min.js', import.meta.url), 'utf8');
new Function('module', 'exports', 'require', mhchem)({ exports: {} }, {}, (name) => {
  if (name === 'katex') return katex;
  throw new Error(`mhchem asked for unexpected module "${name}"`);
});
