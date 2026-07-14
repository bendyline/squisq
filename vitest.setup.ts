/**
 * Vitest setup — configures pdfjs-dist's worker for the Node test
 * environment. This file uses Node.js APIs (which is fine for tests)
 * so the library code itself stays browser-pure.
 */

import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { configurePdfWorker } from './packages/formats/src/pdf/import';

const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
configurePdfWorker(pathToFileURL(workerPath).href);

// jsdom deliberately leaves media controls unimplemented and logs errors even
// when the application handles them. Give every test a deterministic baseline;
// individual tests can still spy on or replace these configurable methods.
if (typeof HTMLMediaElement !== 'undefined') {
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: {
      configurable: true,
      writable: true,
      value: () => Promise.resolve(),
    },
    pause: { configurable: true, writable: true, value: () => undefined },
    load: { configurable: true, writable: true, value: () => undefined },
  });
}
