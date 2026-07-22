import type { Doc } from '@bendyline/squisq/schemas';
import { flattenBlocks } from '@bendyline/squisq/doc';

export type StandalonePlayerVariant = 'light' | 'full';

/**
 * Mermaid is deliberately omitted from the light standalone player. Video
 * capture therefore needs the full player whenever authored Markdown or an
 * already-materialized layer contains Mermaid content.
 */
export function selectStandalonePlayerVariant(doc: Pick<Doc, 'blocks'>): StandalonePlayerVariant {
  for (const block of flattenBlocks(doc.blocks)) {
    if (block.layers?.some((layer) => layer.type === 'mermaid')) return 'full';
    if (containsMermaidFence(block.contents)) return 'full';
  }
  return 'light';
}

function containsMermaidFence(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsMermaidFence);
  if (!isRecord(value)) return false;
  if (
    value.type === 'code' &&
    typeof value.lang === 'string' &&
    value.lang.trim().toLowerCase() === 'mermaid'
  ) {
    return true;
  }
  return containsMermaidFence(value.children);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
