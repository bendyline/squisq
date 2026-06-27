/**
 * LayoutAdapter — edit a `{[layout]}` block as semantic markdown.
 *
 * Read direction:  child `{[type …]}` headings → `computeLayoutLayers` →
 *                  Scene layers (text content comes from each child's body).
 * Write direction: SceneCommand → `layoutCommands` (insert/update/delete
 *                  layer headings + bodies).
 *
 * The layout counterpart to `DrawingAdapter` — same seam
 * (`LayoutAdapterResult`), absolute positioning, and text layers whose rich
 * content lives in the child heading's markdown body. Nothing is persisted as
 * a base64 `layers=` blob anymore; every layer is a heading. Documents that
 * still carry the legacy blob are auto-migrated to child sub-blocks on first
 * mount (see the migration effect).
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { Layer, Block, TextStyle } from '@bendyline/squisq/schemas';
import { computeLayoutLayers } from '@bendyline/squisq/doc';
import type { SceneCommand, SceneEdge } from '../commands/SceneCommand';
import type { SceneTool, SceneToolContext } from '../tools/SceneTool';
import { SelectTool } from '../tools/SelectTool';
import { markdownToTiptap } from '../../tiptapBridge';
import { readLayersFromHeading, writeLayersToHeading } from './blockLayers';
import {
  listLayoutChildren,
  addLayoutLayer,
  moveLayoutLayer,
  resizeLayoutLayer,
  setLayoutParam,
  setLayoutText,
  removeLayoutLayer,
} from '../commands/layoutCommands';

export interface LayoutAdapterResult {
  /** Layers to pass to `<Scene layers={...} />`. */
  layers: Layer[];
  /** Tool set the host should expose. */
  tools: SceneTool[];
  /** Command dispatch for `<Scene onCommand={...} />`. */
  dispatch: (cmd: SceneCommand) => void;
  // ── Connector-capable adapters (drawing) set these; layout omits them ──
  /** Connector edges to pass to `<Scene edges={...} />`. */
  edges?: SceneEdge[];
  /** `<Scene layerFollows={...} />` — a label layer follows its shape. */
  layerFollows?: (layerId: string) => string | null;
  /** `<Scene renderExtras={...} />` — draws the connector pass behind layers. */
  renderExtras?: (ctx: SceneToolContext) => ReactNode;
}

export interface LayoutAdapterOptions {
  /** Override the tool set (defaults to `[SelectTool]`). */
  tools?: SceneTool[];
}

/** Viewport the layout canvas composes against (matches `SceneBlockWidget`). */
const SCENE_VIEWPORT = { width: 1920, height: 1080 };

/**
 * Build a LayoutAdapter for the heading at `headingPos`. Subscribes to the
 * editor's transactions so the returned `layers` reflect the latest doc.
 */
export function useLayoutAdapter(
  editor: Editor,
  headingPos: number,
  options: LayoutAdapterOptions = {},
): LayoutAdapterResult {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  // ── Read: child headings → layers ──────────────────────────────
  const node = editor.state.doc.nodeAt(headingPos);
  const children = node ? listLayoutChildren(editor, headingPos) : [];
  const blocks: Block[] = children.map((c) => ({
    id: c.id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    ...(c.kind ? { template: c.kind } : {}),
    ...(Object.keys(c.params).length > 0 ? { templateOverrides: c.params } : {}),
  }));
  const { layers } = computeLayoutLayers(blocks, SCENE_VIEWPORT);
  // Text content comes from the child body (faithful rich HTML + plain text),
  // not the annotation — overwrite what the core derivation left empty.
  for (const l of layers) {
    if (l.type !== 'text') continue;
    const c = children.find((ch) => ch.id === l.id);
    if (!c) continue;
    l.content.text = c.bodyText;
    if (c.bodyHtml.trim()) l.content.html = c.bodyHtml;
  }

  // ── Migration: legacy base64 `layers=` blob → child sub-blocks ──
  // SSR never decoded the blob, so this only matters in the editor. Runs
  // at most once: no-op when children already exist or no blob is present.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    const n = editor.state.doc.nodeAt(headingPos);
    if (!n) return;
    if (listLayoutChildren(editor, headingPos).length > 0) {
      migratedRef.current = true;
      return;
    }
    const legacy = readLayersFromHeading(n);
    if (legacy.length === 0) {
      migratedRef.current = true;
      return;
    }
    migratedRef.current = true;
    for (const layer of legacy) {
      const child = layerToLayoutChild(layer);
      addLayoutLayer(editor, headingPos, layer.id, child.kind, child.params, child.bodyHtml);
    }
    writeLayersToHeading(editor, headingPos, []);
  }, [editor, headingPos]);

  // ── Write: SceneCommand → layout heading commands ──────────────
  const dispatch = (cmd: SceneCommand) => {
    switch (cmd.kind) {
      case 'moveLayer':
        moveLayoutLayer(editor, headingPos, cmd.id, cmd.x, cmd.y);
        return;
      case 'resizeLayer':
        resizeLayoutLayer(editor, headingPos, cmd.id, cmd.width, cmd.height);
        return;
      case 'addLayer': {
        const child = layerToLayoutChild(cmd.layer);
        const id = cmd.layer.id || nextLayoutId(editor, headingPos, child.kind);
        addLayoutLayer(editor, headingPos, id, child.kind, child.params, child.bodyHtml);
        return;
      }
      case 'removeLayer':
        removeLayoutLayer(editor, headingPos, cmd.id);
        return;
      case 'renameLayer':
        // Layout text content lives in the body; treat a rename as a plain
        // text replacement of that body.
        setLayoutText(editor, headingPos, cmd.id, markdownToTiptap(cmd.label));
        return;
      case 'setLayerText':
        setLayoutText(
          editor,
          headingPos,
          cmd.id,
          cmd.html && cmd.html.trim() ? cmd.html : markdownToTiptap(cmd.text),
        );
        return;
      case 'setLayerAttr': {
        const mapped = paramForLayoutPath(cmd.path);
        if (mapped) setLayoutParam(editor, headingPos, cmd.id, mapped, String(cmd.value ?? ''));
        return;
      }
      case 'addEdge':
      case 'removeEdge':
        // Layouts don't model edges.
        return;
    }
    const _exhaustive: never = cmd;
    void _exhaustive;
  };

  return {
    layers,
    tools: options.tools ?? [SelectTool],
    dispatch,
  };
}

// ============================================
// Layer ↔ child mapping
// ============================================

interface LayoutChildWrite {
  kind: string;
  params: Record<string, string>;
  /** Tiptap HTML for a text layer's body ('' for non-text layers). */
  bodyHtml: string;
}

/** Map a Layer to a `{[type …]}` child heading's kind + params + body HTML. */
function layerToLayoutChild(layer: Layer): LayoutChildWrite {
  const params = posParams(layer.position);
  if (layer.type === 'text') {
    Object.assign(params, styleParams(layer.content.style));
    const bodyHtml = layer.content.html?.trim()
      ? layer.content.html
      : markdownToTiptap(layer.content.text ?? '');
    return { kind: 'text', params, bodyHtml };
  }
  if (layer.type === 'shape') {
    const c = layer.content;
    const kind = c.shape === 'rect' ? 'rectangle' : c.shape; // circle / line keep their name
    if (c.fill) params.fill = c.fill;
    if (c.stroke) params.stroke = c.stroke;
    if (c.strokeWidth != null) params.strokeWidth = String(c.strokeWidth);
    if (c.borderStyle) params.borderStyle = c.borderStyle;
    if (c.borderRadius != null) params.borderRadius = String(c.borderRadius);
    return { kind, params, bodyHtml: '' };
  }
  if (layer.type === 'path') {
    const c = layer.content;
    params.d = c.d;
    if (c.stroke) params.stroke = c.stroke;
    if (c.strokeWidth != null) params.strokeWidth = String(c.strokeWidth);
    if (c.fill) params.fill = c.fill;
    return { kind: 'path', params, bodyHtml: '' };
  }
  if (layer.type === 'image') {
    const c = layer.content;
    params.src = c.src;
    if (c.alt) params.alt = c.alt;
    if (c.fit) params.fit = c.fit;
    return { kind: 'image', params, bodyHtml: '' };
  }
  // Unknown layer types degrade to an empty text box.
  return { kind: 'text', params, bodyHtml: '' };
}

/** Pull numeric x/y/width/height out of a Layer position into string params. */
function posParams(pos: Layer['position']): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof pos.x === 'number') out.x = String(Math.round(pos.x));
  if (typeof pos.y === 'number') out.y = String(Math.round(pos.y));
  if (typeof pos.width === 'number') out.width = String(Math.round(pos.width));
  if (typeof pos.height === 'number') out.height = String(Math.round(pos.height));
  return out;
}

/** Serialize a text layer's style into annotation params. */
function styleParams(style: TextStyle): Record<string, string> {
  const p: Record<string, string> = {};
  if (style.fontSize != null) p.fontSize = String(Math.round(style.fontSize));
  if (style.color) p.color = style.color;
  if (style.fontFamily) p.fontFamily = style.fontFamily;
  if (style.fontWeight && style.fontWeight !== 'normal') p.fontWeight = style.fontWeight;
  if (style.fontStyle && style.fontStyle !== 'normal') p.fontStyle = style.fontStyle;
  if (style.textAlign) p.align = style.textAlign;
  if (style.verticalAlign) p.valign = style.verticalAlign;
  if (style.lineHeight != null) p.lineHeight = String(style.lineHeight);
  if (style.padding != null) p.padding = String(style.padding);
  if (style.background) p.background = style.background;
  return p;
}

/** Map a `setLayerAttr` dotted path to a layout child param name. */
function paramForLayoutPath(path: string): string | null {
  switch (path) {
    case 'content.style.textAlign':
      return 'align';
    case 'content.style.verticalAlign':
      return 'valign';
    case 'content.style.fontSize':
      return 'fontSize';
    case 'content.style.color':
      return 'color';
    case 'content.style.fontFamily':
      return 'fontFamily';
    case 'content.style.fontWeight':
      return 'fontWeight';
    case 'content.style.fontStyle':
      return 'fontStyle';
    case 'content.style.lineHeight':
      return 'lineHeight';
    case 'content.style.padding':
      return 'padding';
    case 'content.style.background':
      return 'background';
    case 'content.fill':
      return 'fill';
    case 'content.stroke':
      return 'stroke';
    case 'content.strokeWidth':
      return 'strokeWidth';
    case 'content.borderStyle':
      return 'borderStyle';
    case 'content.borderRadius':
      return 'borderRadius';
    default:
      return null;
  }
}

const KIND_PREFIX: Record<string, string> = {
  text: 'text',
  rectangle: 'box',
  rect: 'box',
  circle: 'circle',
  line: 'line',
  path: 'path',
  image: 'image',
};

/** A fresh, unique heading id for a new layer, e.g. `text-1`, `box-2`. */
function nextLayoutId(editor: Editor, parentPos: number, kind: string): string {
  const used = new Set(listLayoutChildren(editor, parentPos).map((c) => c.id));
  const prefix = KIND_PREFIX[kind] ?? (kind.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'layer');
  let i = 1;
  let id = `${prefix}-${i}`;
  while (used.has(id)) id = `${prefix}-${++i}`;
  return id;
}
