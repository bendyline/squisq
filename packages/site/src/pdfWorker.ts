/**
 * pdfWorker — one-time pdfjs worker registration for the dev site.
 *
 * Both the download path (`markdownDocToPdf`) and the upload path
 * (`pdfToContainer`) need the worker configured before pdfjs runs, and both can
 * be the first to touch PDF in a session — so the registration lives here
 * rather than in either caller.
 *
 * Vite's `?url` suffix returns a resolved asset URL at build time. The URL
 * string is tiny and doesn't pull pdfjs-dist code into the main chunk; the
 * format package itself stays behind the dynamic import below.
 */

import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

let configured = false;

/** Configure the pdfjs worker once per session. Safe to call repeatedly. */
export async function ensurePdfWorker(): Promise<void> {
  if (configured) return;
  const { configurePdfWorker } = await import('@bendyline/squisq-formats/pdf');
  configurePdfWorker(pdfjsWorkerUrl);
  configured = true;
}
