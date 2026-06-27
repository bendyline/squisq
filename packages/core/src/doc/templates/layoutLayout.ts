/**
 * Layout layout — pure derivation of positioned layers from a `layout`
 * block's child sub-blocks. The layout counterpart to `drawingLayout.ts`,
 * with two deliberate differences:
 *
 *  - **Absolute** positioning. Each child's `x`/`y`/`width`/`height` are
 *    used as-is in viewport units (no auto-grid, no fit-to-viewport
 *    scaling). A layout is a free-form canvas; authors place things where
 *    they want them.
 *  - **Text content lives in the child body.** A `{[text …]}` child's
 *    paragraphs/lists/marks under its heading become the text — readable
 *    markdown rather than an encoded blob. (`content.html` is filled by the
 *    editor for rich on-canvas rendering; SSR uses the plain `content.text`.)
 *
 * Each child heading is one layer: `### {#id} {[<type> x=.. y=.. …]}`.
 * Children are emitted in document order, so the first child is the
 * back-most layer (painters' order).
 */

import type { Layer, ShapeLayer, TextLayer, PathLayer, ImageLayer } from '../../schemas/Doc.js';
import { extractPlainText } from '../../markdown/utils.js';
import { normalizeShapeKind } from './drawingLayout.js';
import { shapePath } from '../utils/shapeGeometry.js';

export interface LayoutLayersResult {
  layers: Layer[];
  warnings: string[];
}

/** Minimal Block shape this derivation reads (subset of `Block`). */
interface LayoutChildBlock {
  id: string;
  template?: string;
  templateOverrides?: Record<string, string>;
  title?: string;
  contents?: import('../../markdown/types.js').MarkdownNode[];
}

const DEFAULT_TEXT = { w: 300, h: 80 };
const DEFAULT_SHAPE = { w: 160, h: 90 };
const DEFAULT_IMAGE = { w: 320, h: 240 };

/**
 * Map a layout block's children → positioned layers. Pure: same children
 * always produce the same layers.
 */
export function computeLayoutLayers(
  children: readonly LayoutChildBlock[],
  _viewport: { width: number; height: number },
): LayoutLayersResult {
  const layers: Layer[] = [];
  const warnings: string[] = [];

  for (const child of children) {
    const params = child.templateOverrides ?? {};
    const annotation = (child.template ?? '').toLowerCase();
    const x = numParam(params, 'x') ?? 0;
    const y = numParam(params, 'y') ?? 0;

    if (annotation === 'image' || annotation === 'img') {
      const src = strParam(params, 'src');
      if (!src) {
        warnings.push(`Layout image "${child.id}" has no src= and was skipped`);
        continue;
      }
      const layer: ImageLayer = {
        id: child.id,
        type: 'image',
        position: {
          x,
          y,
          width: numParam(params, 'width') ?? DEFAULT_IMAGE.w,
          height: numParam(params, 'height') ?? DEFAULT_IMAGE.h,
        },
        content: {
          src,
          alt: strParam(params, 'alt') ?? '',
          ...(strParam(params, 'fit')
            ? { fit: strParam(params, 'fit') as 'cover' | 'contain' | 'fill' }
            : {}),
        },
      };
      layers.push(layer);
      continue;
    }

    const kind = normalizeShapeKind(child.template);
    if (!kind) {
      warnings.push(
        `Layout child "${child.id}" is not a layer (annotation "${child.template ?? '—'}") and was skipped`,
      );
      continue;
    }

    if (kind === 'text') {
      const text = bodyText(child) || child.title || '';
      const layer: TextLayer = {
        id: child.id,
        type: 'text',
        position: {
          x,
          y,
          width: numParam(params, 'width') ?? DEFAULT_TEXT.w,
          height: numParam(params, 'height') ?? DEFAULT_TEXT.h,
        },
        content: { text, style: textStyleFromParams(params) },
      };
      layers.push(layer);
      continue;
    }

    const width = numParam(params, 'width') ?? numParam(params, 'w') ?? DEFAULT_SHAPE.w;
    const height = numParam(params, 'height') ?? numParam(params, 'h') ?? DEFAULT_SHAPE.h;

    if (kind === 'rect' || kind === 'circle') {
      const shape: ShapeLayer = {
        id: child.id,
        type: 'shape',
        position: { x, y, width, height },
        content: {
          shape: kind,
          ...(strParam(params, 'fill') ? { fill: strParam(params, 'fill') } : {}),
          ...(strParam(params, 'stroke') ? { stroke: strParam(params, 'stroke') } : {}),
          ...(numParam(params, 'strokeWidth') != null
            ? { strokeWidth: numParam(params, 'strokeWidth') }
            : {}),
          ...(strParam(params, 'borderStyle')
            ? { borderStyle: strParam(params, 'borderStyle') as 'solid' | 'dashed' | 'dotted' }
            : {}),
          ...(kind === 'rect' && numParam(params, 'borderRadius') != null
            ? { borderRadius: numParam(params, 'borderRadius') }
            : {}),
        },
      };
      layers.push(shape);
      continue;
    }

    // line / arrow / path / named polygon → PathLayer (absolute geometry).
    const diagonal = `M ${round(x)} ${round(y)} L ${round(x + width)} ${round(y + height)}`;
    let d = diagonal;
    let pathFill = 'none';
    let endMarker: 'none' | 'arrow' = 'none';
    if (kind === 'path') {
      d = strParam(params, 'd') ?? diagonal;
      pathFill = strParam(params, 'fill') ?? 'none';
    } else if (kind === 'arrow') {
      endMarker = 'arrow';
    } else if (kind !== 'line') {
      d = shapePath(kind, x, y, width, height) ?? diagonal;
      pathFill = strParam(params, 'fill') ?? 'none';
    }
    const path: PathLayer = {
      id: child.id,
      type: 'path',
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      content: {
        d,
        stroke: strParam(params, 'stroke') ?? '#1e293b',
        strokeWidth: numParam(params, 'strokeWidth') ?? 2,
        fill: pathFill,
        ...(strParam(params, 'dasharray') ? { dasharray: strParam(params, 'dasharray') } : {}),
        ...(endMarker !== 'none' ? { endMarker } : {}),
      },
    };
    layers.push(path);
  }

  return { layers, warnings };
}

/** Build a TextStyle from a text layer's annotation params. */
function textStyleFromParams(params: Record<string, string>): TextLayer['content']['style'] {
  const style: TextLayer['content']['style'] = {
    fontSize: numParam(params, 'fontSize') ?? 32,
    color: strParam(params, 'color') ?? '#1e293b',
  };
  const fontFamily = strParam(params, 'fontFamily');
  if (fontFamily) style.fontFamily = fontFamily;
  const fontWeight = strParam(params, 'fontWeight');
  if (fontWeight === 'bold' || fontWeight === 'normal') style.fontWeight = fontWeight;
  const fontStyle = strParam(params, 'fontStyle');
  if (fontStyle === 'italic' || fontStyle === 'normal') style.fontStyle = fontStyle;
  const align = strParam(params, 'align');
  if (align === 'left' || align === 'center' || align === 'right') style.textAlign = align;
  const valign = strParam(params, 'valign');
  if (valign === 'top' || valign === 'middle' || valign === 'bottom') style.verticalAlign = valign;
  const lineHeight = numParam(params, 'lineHeight');
  if (lineHeight != null) style.lineHeight = lineHeight;
  const padding = numParam(params, 'padding');
  if (padding != null) style.padding = padding;
  const background = strParam(params, 'background');
  if (background) style.background = background;
  return style;
}

/** Read a raw string param (trims a trailing comma — `x=21, y=25` tolerated). */
function strParam(params: Record<string, string>, key: string): string | undefined {
  const raw = params[key];
  if (raw == null) return undefined;
  const v = raw.replace(/,\s*$/, '').trim();
  return v.length > 0 ? v : undefined;
}

/** Coerce a numeric param, tolerating a trailing comma. Undefined on failure. */
function numParam(params: Record<string, string>, key: string): number | undefined {
  const v = strParam(params, key);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Plain text of a block's body content. */
function bodyText(block: LayoutChildBlock): string {
  if (!block.contents || block.contents.length === 0) return '';
  return block.contents
    .map((node) => extractPlainText(node))
    .join('\n')
    .trim();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
