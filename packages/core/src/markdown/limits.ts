import type { MarkdownDocument } from './types.js';

export interface MarkdownSafetyLimits {
  maxSourceBytes: number;
  maxNodes: number;
  maxDepth: number;
  maxTableCells: number;
}

export const DEFAULT_MARKDOWN_SAFETY_LIMITS: Readonly<MarkdownSafetyLimits> = Object.freeze({
  maxSourceBytes: 16 * 1024 * 1024,
  maxNodes: 250_000,
  maxDepth: 128,
  maxTableCells: 100_000,
});

export class MarkdownLimitError extends RangeError {
  readonly code: 'SOURCE_BYTES' | 'NODES' | 'DEPTH' | 'TABLE_CELLS';

  constructor(code: MarkdownLimitError['code'], message: string) {
    super(message);
    this.name = 'MarkdownLimitError';
    this.code = code;
  }
}

export function assertMarkdownSourceWithinLimits(
  source: string,
  limits: Partial<MarkdownSafetyLimits> | false | undefined,
): void {
  if (limits === false) return;
  const resolved = resolveMarkdownSafetyLimits(limits);
  if (utf8ByteLength(source, resolved.maxSourceBytes) > resolved.maxSourceBytes) {
    throw new MarkdownLimitError(
      'SOURCE_BYTES',
      `Markdown source exceeds the ${resolved.maxSourceBytes}-byte safety limit`,
    );
  }
}

export function assertMarkdownDocumentWithinLimits(
  document: MarkdownDocument,
  limits: Partial<MarkdownSafetyLimits> | false | undefined,
  signal?: AbortSignal,
): void {
  if (limits === false) return;
  const resolved = resolveMarkdownSafetyLimits(limits);
  const stack: Array<{ value: unknown; depth: number }> = [{ value: document, depth: 0 }];
  let nodes = 0;
  let tableCells = 0;

  while (stack.length > 0) {
    if ((nodes & 1023) === 0) signal?.throwIfAborted();
    const current = stack.pop()!;
    if (!current.value || typeof current.value !== 'object') continue;
    const node = current.value as { type?: unknown; children?: unknown; htmlChildren?: unknown };
    if (typeof node.type !== 'string') continue;

    nodes += 1;
    if (nodes > resolved.maxNodes) {
      throw new MarkdownLimitError(
        'NODES',
        `Markdown document exceeds the ${resolved.maxNodes}-node safety limit`,
      );
    }
    if (current.depth > resolved.maxDepth) {
      throw new MarkdownLimitError(
        'DEPTH',
        `Markdown document exceeds the ${resolved.maxDepth}-level nesting safety limit`,
      );
    }
    if (node.type === 'tableCell' && ++tableCells > resolved.maxTableCells) {
      throw new MarkdownLimitError(
        'TABLE_CELLS',
        `Markdown document exceeds the ${resolved.maxTableCells}-table-cell safety limit`,
      );
    }

    pushChildren(stack, node.children, current.depth + 1);
    pushChildren(stack, node.htmlChildren, current.depth + 1);
  }
}

export function resolveMarkdownSafetyLimits(
  limits?: Partial<MarkdownSafetyLimits>,
): MarkdownSafetyLimits {
  const resolved = { ...DEFAULT_MARKDOWN_SAFETY_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
  return resolved;
}

function pushChildren(
  stack: Array<{ value: unknown; depth: number }>,
  children: unknown,
  depth: number,
): void {
  if (!Array.isArray(children)) return;
  for (let index = children.length - 1; index >= 0; index--) {
    stack.push({ value: children[index], depth });
  }
}

function utf8ByteLength(value: string, stopAfter: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}
