/**
 * DrawingAdapter — same persistence as LayoutAdapter, but pre-bundles
 * the shape / path / text tools so the user can author new layers from
 * scratch.
 *
 * Reuses `useLayoutAdapter` for the read/write logic — the difference
 * is purely the default tool set returned to the host.
 */

import type { Editor } from '@tiptap/react';
import { useMemo } from 'react';
import { SelectTool } from '../tools/SelectTool';
import { createShapeTool } from '../tools/ShapeTool';
import { createPathTool } from '../tools/PathTool';
import { createTextTool } from '../tools/TextTool';
import { useLayoutAdapter, type LayoutAdapterResult } from './LayoutAdapter';

export interface DrawingAdapterOptions {
  /** Default stroke color for new shapes/paths. */
  stroke?: string;
  /** Default fill color for new shapes. */
  fill?: string;
}

export function useDrawingAdapter(
  editor: Editor,
  headingPos: number,
  options: DrawingAdapterOptions = {},
): LayoutAdapterResult {
  const tools = useMemo(
    () => [
      SelectTool,
      createShapeTool({ shape: 'rect', stroke: options.stroke, fill: options.fill, shortcut: 'r' }),
      createShapeTool({
        shape: 'circle',
        stroke: options.stroke,
        fill: options.fill,
        shortcut: 'o',
        id: 'shape-circle',
      }),
      createShapeTool({ shape: 'line', stroke: options.stroke, shortcut: 'l', id: 'shape-line' }),
      createPathTool({ stroke: options.stroke }),
      createTextTool({ color: options.stroke }),
    ],
    [options.stroke, options.fill],
  );
  return useLayoutAdapter(editor, headingPos, { tools });
}
