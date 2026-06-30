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
const cssFile = resolve(distDir, 'squisq-player.css');
const outJs = resolve(distDir, 'standalone-source.js');

// Read the IIFE bundle
const source = readFileSync(iifeFile, 'utf-8');
const css = readFileSync(cssFile, 'utf-8');
const browserReadySource = addBrowserRuntimeShims(inlineCssSource(source, css));

// Keep the public standalone JS self-contained too. The sourcemap still points
// back to the original bundle, but the runtime artifact no longer depends on a
// sidecar CSS file or ambient Rollup globals for Node built-ins.
writeFileSync(iifeFile, browserReadySource, 'utf-8');

// Write ESM module that exports the source as a string. The matching
// .d.ts lives at `src/standalone-source.d.ts` and is committed —
// keeping it out of `dist/` lets consumers typecheck against this
// subpath export without having to build this package first.
writeFileSync(
  outJs,
  `/** Auto-generated — do not edit. Contains the squisq-player IIFE bundle as a string. */\nexport const PLAYER_BUNDLE = ${JSON.stringify(browserReadySource)};\n`,
  'utf-8',
);

// eslint-disable-next-line no-undef, no-console
console.log(
  `Generated standalone-source.js (${(browserReadySource.length / 1024).toFixed(1)} KB source)`,
);

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

function addBrowserRuntimeShims(bundleSource) {
  const wrapperMatch = bundleSource.match(
    /^var SquisqPlayer=\(function\(exports,([^,]+),([^,]+),([^)]+)\)\{/,
  );

  if (!wrapperMatch) {
    return bundleSource;
  }

  const [, pathGlobal, processGlobal, urlGlobal] = wrapperMatch;
  const callPattern = new RegExp(
    `\\}\\)\\(\\{\\},${escapeRegExp(pathGlobal)},${escapeRegExp(processGlobal)},${escapeRegExp(
      urlGlobal,
    )}\\);`,
  );

  if (!callPattern.test(bundleSource)) {
    throw new Error('Could not find standalone bundle global call site');
  }

  const shimSource = [
    'var __SQUISQ_PATH_SHIM__={basename:function(p){return String(p).split(/[\\\\/]/).pop()||""},dirname:function(p){var s=String(p).replace(/[\\\\/][^\\\\/]*$/,"");return s||"."},extname:function(p){var b=String(p).split(/[\\\\/]/).pop()||"";var i=b.lastIndexOf(".");return i>0?b.slice(i):""},join:function(){return Array.prototype.slice.call(arguments).filter(Boolean).join("/").replace(/\\\\/g,"/")},resolve:function(){return Array.prototype.slice.call(arguments).filter(Boolean).join("/").replace(/\\\\/g,"/")}};',
    'var __SQUISQ_PROCESS_SHIM__={env:{},browser:true};',
    'var __SQUISQ_URL_SHIM__={fileURLToPath:function(v){return String(v).replace(/^file:\\/\\//,"")},pathToFileURL:function(v){return {href:"file://"+v,toString:function(){return this.href}}}};',
  ].join('');

  return (
    shimSource +
    bundleSource.replace(
      callPattern,
      '})({},__SQUISQ_PATH_SHIM__,__SQUISQ_PROCESS_SHIM__,__SQUISQ_URL_SHIM__);',
    )
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
