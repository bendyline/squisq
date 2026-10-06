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

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const iifeFile = resolve(distDir, 'squisq-player.global.js');
const outJs = resolve(distDir, 'standalone-source.js');
const outDts = resolve(distDir, 'standalone-source.d.ts');
const iconStylesJs = resolve(distDir, 'standalone-icon-styles.js');
const iconStylesDts = resolve(distDir, 'standalone-icon-styles.d.ts');

const source = readFileSync(iifeFile, 'utf-8');
const iconStyles = await buildStandaloneIconStyles();

// Both IIFE bundles already contain their animation CSS. Only read the light
// bundle here, so generation can be repeated without consuming build inputs.
// Write an ESM module that exports the source as a string. The matching
// .d.ts lives at `src/standalone-source.d.ts` and is committed —
// keeping it out of `dist/` lets consumers typecheck against this
// subpath export without having to build this package first.
writeFileSync(
  outJs,
  `/** Auto-generated — do not edit. Contains the squisq-player IIFE bundle as a string. */\n` +
    `import { PLAYER_ICON_STYLES } from './standalone-icon-styles.js';\n` +
    `const ICON_STYLE_BOOTSTRAP = 'globalThis.__SQUISQ_PLAYER_ICON_STYLES__=' + JSON.stringify(PLAYER_ICON_STYLES) + ';\\n';\n` +
    `export const PLAYER_BUNDLE = ICON_STYLE_BOOTSTRAP + ${JSON.stringify(source)};\n`,
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

// eslint-disable-next-line no-undef, no-console
console.log(
  `Generated standalone-source.js (${(source.length / 1024).toFixed(1)} KB source) ` +
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
