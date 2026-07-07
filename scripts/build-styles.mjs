/**
 * Shared CSS bundler for the React-facing packages (react, editor-react).
 *
 * Bundles a package's stylesheet into its dist/ so published consumers load
 * CSS from build output (not src/). Resolves the `@import` graph rooted at
 * <pkg>/src/styles/index.css into a single <pkg>/dist/styles/index.css, and
 * copies any referenced font files alongside it with their url() references
 * rewritten (the `copy` loaders are harmless for packages with no fonts).
 *
 * Invoked from each package's `build` script with the package directory as
 * cwd (npm runs workspace scripts with cwd = package dir), e.g.
 *   "build": "tsup && node ../../scripts/build-styles.mjs"
 */

import { build } from 'esbuild';
import { resolve } from 'path';

const pkgDir = process.cwd();

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
