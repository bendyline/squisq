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

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const iifeFile = resolve(distDir, 'squisq-player.global.js');
const outJs = resolve(distDir, 'standalone-source.js');
const outDts = resolve(distDir, 'standalone-source.d.ts');

// Read the IIFE bundle
const source = readFileSync(iifeFile, 'utf-8');

// Write ESM module that exports the source as a string
writeFileSync(
  outJs,
  `/** Auto-generated — do not edit. Contains the squisq-player IIFE bundle as a string. */\nexport const PLAYER_BUNDLE = ${JSON.stringify(source)};\n`,
  'utf-8',
);

// Write TypeScript declaration
writeFileSync(
  outDts,
  `/** The squisq-player IIFE bundle source code as a string constant. */\nexport declare const PLAYER_BUNDLE: string;\n`,
  'utf-8',
);

console.log(`Generated standalone-source.js (${(source.length / 1024).toFixed(1)} KB source)`);
