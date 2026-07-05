/**
 * Bundle the package stylesheet into dist/ so published consumers load CSS
 * from build output (not src/). Resolves the `@import` graph rooted at
 * src/styles/index.css (including @fortawesome/fontawesome-free) into a
 * single dist/styles/index.css; referenced font files are copied alongside
 * it with their url() references rewritten.
 */

import { build } from 'esbuild';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(pkgDir, 'src/styles/index.css')],
  bundle: true,
  outfile: resolve(pkgDir, 'dist/styles/index.css'),
  loader: {
    '.woff2': 'copy',
    '.woff': 'copy',
    '.ttf': 'copy',
    '.eot': 'copy',
    '.svg': 'copy',
  },
  logLevel: 'info',
});
