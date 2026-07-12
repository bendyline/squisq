/** Paste gate for bare, high-confidence Unicode timeline art. */

import { detectAsciiTimeline } from '@bendyline/squisq/doc';

export function shouldPasteAsTimelineFence(text: string): boolean {
  if (!text.trim() || /^\s*```/m.test(text)) return false;
  return detectAsciiTimeline(text).isTimeline;
}
