/**
 * Bundle the package stylesheet into dist/ so published consumers load CSS
 * from build output (not src/). Resolves the `@import` graph rooted at
 * src/styles/index.css into a single dist/styles/index.css.
 */

import { build } from 'esbuild';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(pkgDir, 'src/styles/index.css')],
  bundle: true,
  outfile: resolve(pkgDir, 'dist/styles/index.css'),
  logLevel: 'info',
});
