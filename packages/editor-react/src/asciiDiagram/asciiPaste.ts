/**
 * Paste gate for bare (unfenced) ASCII diagram art.
 *
 * `+--+ | |` art pasted as plain text is otherwise mangled: its `| x |`
 * rows match the GFM table-row pattern in `detectMarkdown`, so the paste
 * handler routes it through the markdown converter, fails table
 * validation, and emits one broken paragraph per line. When this gate
 * matches, the paste handler inserts the text verbatim into a fresh code
 * block instead — which the AsciiDiagramExtension then picks up as an
 * interactive diagram.
 */

import { detectAsciiDiagram } from '@bendyline/squisq/doc';

export function shouldPasteAsAsciiFence(text: string): boolean {
  if (!text || text.includes('```')) return false;
  const detection = detectAsciiDiagram(text);
  return detection.isDiagram && (detection.diagram?.nodes.length ?? 0) >= 2;
}
