/**
 * TokenTool — pointer-down on the canvas drops a pre-filled
 * placeholder layer at the click position. Used by the template
 * designer's Add bin so the user can place `{title}`,
 * `{content}`, `{children}`, or `{image:N}` in a single click instead
 * of typing the placeholder string into a generic TextTool.
 *
 * Factory pattern (`createTokenTool`) lets the palette build a
 * separate tool instance per token, each with its own id / label /
 * default layer shape.
 */

import type { ImageLayer, TextLayer } from '@bendyline/squisq/schemas';
import type { SceneTool } from './SceneTool';
import { createPlaceTool } from './PlaceTool';

export type TokenKind = 'text' | 'image';

export interface TokenToolOptions {
  /** Stable tool id (e.g. `'token-title'`). */
  id: string;
  /** Label shown in the toolbar / palette button. */
  label: string;
  /** Optional keyboard shortcut. */
  shortcut?: string;
  /**
   * The placeholder string to substitute at render time, e.g.
   * `'{title}'` or `'{image:0}'`. The designer drops this literal
   * value into the new layer; the resolver replaces it later.
   */
  token: string;
  /**
   * Which layer kind to insert. `'text'` creates a TextLayer with
   * `content.text = token`; `'image'` creates an ImageLayer with
   * `content.src = token`.
   */
  kind: TokenKind;
  /** Default font size for text tokens. Default 36. */
  fontSize?: number;
  /** Default text color for text tokens. Default '#0f172a'. */
  color?: string;
  /** Default width (pixels) for the placed layer. Default 480. */
  width?: number;
  /** Default height (pixels) for the placed layer. Default for text: 72; for image: 320. */
  height?: number;
}

/**
 * Build a placeholder layer for `options` with its top-left corner at
 * the given viewport point. Shared by the click-to-place TokenTool and
 * the template designer's drag-and-drop drop handler so both produce
 * identical layers.
 */
export function buildTokenLayer(
  options: TokenToolOptions,
  point: { x: number; y: number },
): TextLayer | ImageLayer {
  const width = options.width ?? 480;
  const height = options.height ?? (options.kind === 'image' ? 320 : 72);
  const fontSize = options.fontSize ?? 36;
  const color = options.color ?? '#0f172a';
  const id = nextLayerId(options.kind);
  if (options.kind === 'text') {
    return {
      id,
      type: 'text',
      position: { x: point.x, y: point.y, width, height },
      content: {
        text: options.token,
        style: { fontSize, color, textAlign: 'left' },
      },
    };
  }
  return {
    id,
    type: 'image',
    position: { x: point.x, y: point.y, width, height },
    content: { src: options.token, alt: 'Placeholder image', fit: 'cover' },
  };
}

export function createTokenTool(options: TokenToolOptions): SceneTool {
  return createPlaceTool({
    id: options.id,
    label: options.label,
    shortcut: options.shortcut,
    build: (point) => buildTokenLayer(options, point),
  });
}

let counter = 0;
function nextLayerId(kind: TokenKind): string {
  counter += 1;
  return `${kind}-token-${Date.now().toString(36)}-${counter}`;
}
