/**
 * TokenTool — pointer-down on the canvas drops a pre-filled
 * placeholder layer at the click position. Used by the template
 * designer's TokenPalette so the user can place `{title}`,
 * `{content}`, `{children}`, or `{image:N}` in a single click instead
 * of typing the placeholder string into a generic TextTool.
 *
 * Factory pattern (`createTokenTool`) lets the palette build a
 * separate tool instance per token, each with its own id / label /
 * default layer shape.
 */

import type { ImageLayer, TextLayer } from '@bendyline/squisq/schemas';
import type { SceneTool } from './SceneTool';

export type TokenKind = 'text' | 'image';

interface TokenToolOptions {
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

export function createTokenTool(options: TokenToolOptions): SceneTool {
  const width = options.width ?? 480;
  const height = options.height ?? (options.kind === 'image' ? 320 : 72);
  const fontSize = options.fontSize ?? 36;
  const color = options.color ?? '#0f172a';

  return {
    id: options.id,
    label: options.label,
    cursor: 'crosshair',
    shortcut: options.shortcut,

    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      const rect = (e.currentTarget as Element).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = ctx.screenToViewport(sx, sy);
      const id = nextLayerId(options.kind);
      if (options.kind === 'text') {
        const layer: TextLayer = {
          id,
          type: 'text',
          position: { x: v.x, y: v.y, width, height },
          content: {
            text: options.token,
            style: { fontSize, color, textAlign: 'left' },
          },
        };
        ctx.dispatch({ kind: 'addLayer', layer });
      } else {
        const layer: ImageLayer = {
          id,
          type: 'image',
          position: { x: v.x, y: v.y, width, height },
          content: { src: options.token, alt: 'Placeholder image', fit: 'cover' },
        };
        ctx.dispatch({ kind: 'addLayer', layer });
      }
      // Hand control back to Select so the user can immediately
      // reposition the newly-added placeholder.
      ctx.setActiveTool?.('select');
    },
  };
}

let counter = 0;
function nextLayerId(kind: TokenKind): string {
  counter += 1;
  return `${kind}-token-${Date.now().toString(36)}-${counter}`;
}
