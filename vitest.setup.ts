/**
 * Vitest setup — configures pdfjs-dist's worker for the Node test
 * environment. This file uses Node.js APIs (which is fine for tests)
 * so the library code itself stays browser-pure.
 */

import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, vi } from 'vitest';
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

// Tiptap's useEditor destroys an unmounted editor on a 1 ms timer, so a test
// file that ends right after unmounting can tear jsdom down first, and the
// editor's teardown then runs against missing globals (`window is not
// defined`) as an unhandled error that fails the whole run. Let those
// deferred destroys run while jsdom is still here.
afterAll(async () => {
  if (typeof window === 'undefined') return;
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 10));
});
