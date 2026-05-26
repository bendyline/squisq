/**
 * TextTool — click to place a new TextLayer; the host can hook the
 * `prompt` option to swap the default `window.prompt` for an inline
 * editing UI (Tiptap, contenteditable, etc.) when one is available.
 */

import type { TextLayer } from '@bendyline/squisq/schemas';
import type { SceneTool } from './SceneTool';

interface TextToolOptions {
  /** Default font size in viewport units. Default 24. */
  fontSize?: number;
  /** Default text color. Default '#1e293b'. */
  color?: string;
  /** Default text alignment. Default 'left'. */
  textAlign?: 'left' | 'center' | 'right';
  /**
   * Prompt the user for the text content. Returns null to cancel.
   * Default uses `window.prompt`.
   */
  prompt?: () => string | null;
  /** Override id / label / shortcut. */
  id?: string;
  label?: string;
  shortcut?: string;
}

export function createTextTool(options: TextToolOptions = {}): SceneTool {
  const fontSize = options.fontSize ?? 24;
  const color = options.color ?? '#1e293b';
  const textAlign = options.textAlign ?? 'left';
  const prompt = options.prompt ?? (() => window.prompt('Text:'));

  return {
    id: options.id ?? 'text',
    label: options.label ?? 'Text',
    cursor: 'text',
    shortcut: options.shortcut ?? 't',

    onPointerDown(e, ctx) {
      if (e.button !== 0) return;
      const rect = (e.currentTarget as Element).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = ctx.screenToViewport(sx, sy);
      const text = prompt();
      if (text == null || text.length === 0) {
        ctx.setActiveTool?.('select');
        return;
      }
      const layer: TextLayer = {
        id: `text-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        type: 'text',
        position: {
          x: v.x,
          y: v.y,
          // No explicit width — hit-test will treat the bounding box as
          // measured at render time. Provide a generous default so the
          // hit-test stub finds something.
          width: Math.max(fontSize * text.length * 0.6, 80),
          height: fontSize * 1.4,
        },
        content: {
          text,
          style: { fontSize, color, textAlign },
        },
      };
      ctx.dispatch({ kind: 'addLayer', layer });
      ctx.setActiveTool?.('select');
    },
  };
}
