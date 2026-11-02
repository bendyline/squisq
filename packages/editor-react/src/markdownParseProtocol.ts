import { parseMarkdown, type MarkdownDocument } from '@bendyline/squisq/markdown';

export interface MarkdownParseRequest {
  id: number;
  source: string;
}
export type MarkdownParseResult =
  | { id: number; markdown: MarkdownDocument; error: null }
  | { id: number; markdown: null; error: string };

export function handleMarkdownParseRequest(value: unknown): MarkdownParseResult | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).length !== 2 ||
    !Number.isSafeInteger(request.id) ||
    typeof request.id !== 'number' ||
    request.id < 1 ||
    typeof request.source !== 'string'
  )
    return null;
  try {
    return { id: request.id, markdown: parseMarkdown(request.source), error: null };
  } catch (error) {
    return {
      id: request.id,
      markdown: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Envelope check for responses from our own bundled parser, not arbitrary AST imports. */
export function isMarkdownParseResult(value: unknown): value is MarkdownParseResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== 3 ||
    !Number.isSafeInteger(result.id) ||
    typeof result.id !== 'number' ||
    result.id < 1
  )
    return false;
  if (result.markdown === null) return typeof result.error === 'string';
  if (result.error !== null || !result.markdown || typeof result.markdown !== 'object')
    return false;
  const markdown = result.markdown as Record<string, unknown>;
  return markdown.type === 'document' && Array.isArray(markdown.children);
}
