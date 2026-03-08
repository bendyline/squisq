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
