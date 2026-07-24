/**
 * Post-build script: reads the IIFE bundle and generates an ESM module
 * that exports the bundle source as a string constant.
 *
 * This allows the formats package (or any consumer) to import the player
 * JS source for embedding in HTML documents:
 *
 *   import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';
 *   const html = `<script>${PLAYER_BUNDLE}</script>`;
 */

import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const iifeFile = resolve(distDir, 'squisq-player.global.js');
const cssFile = resolve(distDir, 'squisq-player.css');
const fullIifeFile = resolve(distDir, 'squisq-player.full.global.js');
const fullCssFile = resolve(distDir, 'squisq-player.full.css');
const outJs = resolve(distDir, 'standalone-source.js');
const outDts = resolve(distDir, 'standalone-source.d.ts');
const iconStylesJs = resolve(distDir, 'standalone-icon-styles.js');
const iconStylesDts = resolve(distDir, 'standalone-icon-styles.d.ts');

const source = readFileSync(iifeFile, 'utf-8');
const css = readFileSync(cssFile, 'utf-8');
const browserReadySource = inlineCssSource(source, css);
const iconStyles = await buildStandaloneIconStyles();

// Keep the public standalone JS self-contained too. The sourcemap still points
// back to the original bundle, but the runtime artifact no longer depends on a
// sidecar CSS file. The standalone build itself targets the browser, so Node
// built-ins never enter this artifact.
writeFileSync(iifeFile, browserReadySource, 'utf-8');
writeFileSync(
  fullIifeFile,
  inlineCssSource(readFileSync(fullIifeFile, 'utf-8'), readFileSync(fullCssFile, 'utf-8')),
  'utf-8',
);

// Write ESM module that exports the source as a string. The matching
// .d.ts lives at `src/standalone-source.d.ts` and is committed —
// keeping it out of `dist/` lets consumers typecheck against this
// subpath export without having to build this package first.
writeFileSync(
  outJs,
  `/** Auto-generated — do not edit. Contains the squisq-player IIFE bundle as a string. */\n` +
    `import { PLAYER_ICON_STYLES } from './standalone-icon-styles.js';\n` +
    `const ICON_STYLE_BOOTSTRAP = 'globalThis.__SQUISQ_PLAYER_ICON_STYLES__=' + JSON.stringify(PLAYER_ICON_STYLES) + ';\\n';\n` +
    `export const PLAYER_BUNDLE = ICON_STYLE_BOOTSTRAP + ${JSON.stringify(browserReadySource)};\n`,
  'utf-8',
);
writeFileSync(outDts, 'export declare const PLAYER_BUNDLE: string;\n', 'utf-8');
writeFileSync(
  iconStylesJs,
  `/** Auto-generated — do not edit. Shared Font Awesome CSS and WOFF2 data. */\n` +
    `export const PLAYER_ICON_STYLES = ${JSON.stringify(iconStyles)};\n`,
  'utf-8',
);
writeFileSync(iconStylesDts, 'export declare const PLAYER_ICON_STYLES: string;\n', 'utf-8');
unlinkSync(cssFile);
unlinkSync(fullCssFile);

// eslint-disable-next-line no-undef, no-console
console.log(
  `Generated standalone-source.js (${(browserReadySource.length / 1024).toFixed(1)} KB source) ` +
    `and shared icon styles (${(iconStyles.length / 1024).toFixed(1)} KB)`,
);

async function buildStandaloneIconStyles() {
  const result = await build({
    entryPoints: [resolve(__dirname, '..', 'src', 'styles', 'standalone-icons.css')],
    bundle: true,
    minify: true,
    write: false,
    loader: {
      '.woff2': 'dataurl',
    },
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  if (!output) {
    throw new Error('Font Awesome standalone CSS build produced no CSS output');
  }
  return output.text;
}

function inlineCssSource(bundleSource, cssSource) {
  const cssVarMatch = bundleSource.match(
    /var ([A-Za-z_$][\w$]*)=\{\};var [A-Za-z_$][\w$]*=false;function [A-Za-z_$][\w$]*\(\)\{[^}]*?textContent=\1/,
  );

  if (!cssVarMatch) {
    throw new Error('Could not find extracted CSS placeholder in standalone bundle');
  }

  const cssVar = cssVarMatch[1];
  return bundleSource.replace(`var ${cssVar}={};`, `var ${cssVar}=${JSON.stringify(cssSource)};`);
}
