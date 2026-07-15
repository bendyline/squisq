/**
 * SceneTextOverlay — the shared inline rich-text editor for canvas
 * textboxes. An absolutely-positioned HTML Tiptap instance laid over the
 * edited layer's on-screen box (so it tracks pan/zoom), rendered inside
 * `.squisq-scene-root`. Real HTML over the SVG (not a transformed
 * foreignObject) to avoid SVG focus/IME quirks.
 *
 * Lifecycle: focuses on mount, publishes its editor to `sceneTextChannel`
 * (so the top toolbar can format it), commits on blur/Enter(inline)/
 * Cmd+Enter and cancels on Escape. Clears the channel on unmount.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Layer } from '@bendyline/squisq/schemas';
import { DEFAULT_DOC_FONT } from '@bendyline/squisq/schemas';
import { plainTextFromInlineHtml } from '@bendyline/squisq/markdown';
import { layerBounds } from '../hooks/useSceneHitTest';
import type { SceneTransform } from '../hooks/useScenePanZoom';
import type { SceneTextEditConfig } from './sceneTextConfig';
import { buildSceneTextExtensions } from './sceneTiptap';

interface SceneTextOverlayProps {
  config: SceneTextEditConfig;
  /** The layer being edited (for box geometry + base text style). */
  layer: Layer;
  editableId: string;
  viewport: { width: number; height: number };
  transform: SceneTransform;
  viewportToScreen: (vx: number, vy: number) => { x: number; y: number };
  onClose: () => void;
}

export function SceneTextOverlay({
  config,
  layer,
  editableId,
  viewport,
  transform,
  viewportToScreen,
  onClose,
}: SceneTextOverlayProps) {
  const initialHtml = useMemo(() => config.getHtml(editableId), [config, editableId]);
  const style = layer.type === 'text' ? layer.content.style : undefined;

  // Stable commit/cancel via refs so the editor's keydown closure (bound
  // once at creation) always calls the latest handlers.
  const committedRef = useRef(false);
  const commitRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: buildSceneTextExtensions(config.level),
    content: initialHtml,
    autofocus: 'end',
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelRef.current();
          return true;
        }
        // Inline labels: Enter commits (Shift+Enter = hard break). Rich
        // textboxes: Enter is a paragraph; commit on Cmd/Ctrl+Enter.
        const enterCommits =
          config.level === 'inline' ? !event.shiftKey : event.metaKey || event.ctrlKey;
        if (event.key === 'Enter' && enterCommits) {
          event.preventDefault();
          commitRef.current();
          return true;
        }
        return false;
      },
    },
  });

  commitRef.current = useCallback(() => {
    if (committedRef.current || !editor) return;
    committedRef.current = true;
    const html = editor.getHTML();
    config.commit(editableId, { html, text: plainTextFromInlineHtml(html) });
    onClose();
  }, [editor, config, editableId, onClose]) as () => void;

  cancelRef.current = useCallback(() => {
    committedRef.current = true; // suppress the blur-commit that follows
    onClose();
  }, [onClose]) as () => void;

  // Publish to the toolbar channel while mounted; clear on unmount.
  useEffect(() => {
    if (!editor || !config.channel) return;
    const channel = config.channel;
    channel.set({ editor, level: config.level });
    return () => {
      if (channel.get()?.editor === editor) channel.set(null);
    };
  }, [editor, config.level, config.channel]);

  // Commit when focus leaves the editor — unless it went to the toolbar
  // (the user clicking Bold) or stayed within the overlay.
  const onBlur = useCallback((e: React.FocusEvent) => {
    const next = e.relatedTarget as HTMLElement | null;
    if (next && next.closest('.squisq-toolbar, .squisq-scene-text-overlay')) return;
    commitRef.current();
  }, []);

  const bounds = layerBounds(layer, viewport);
  if (!bounds) return null;
  const tl = viewportToScreen(bounds.x, bounds.y);
  const scale = transform.scale;
  const fontSize = (style?.fontSize ?? 18) * scale;
  const pad = (style?.padding ?? 0) * scale;
  // Mirror the layer's vertical alignment so changing it (via the toolbar)
  // updates the editor live, matching what the committed box will look like.
  const justifyContent =
    style?.verticalAlign === 'middle'
      ? 'center'
      : style?.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'flex-start';

  return (
    <div
      className="squisq-scene-text-overlay"
      onBlur={onBlur}
      // Keep clicks inside the editor from reaching the SVG (which would
      // focus the canvas and blur us mid-edit).
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: tl.x,
        top: tl.y,
        width: bounds.width * scale,
        height: bounds.height * scale,
        zIndex: 20,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent,
        padding: pad,
        fontSize,
        fontFamily: style?.fontFamily || DEFAULT_DOC_FONT,
        color: style?.color ?? '#1e293b',
        lineHeight: style?.lineHeight || 1.4,
        textAlign: style?.textAlign ?? 'left',
        background: 'var(--squisq-surface, #ffffff)',
        border: '2px solid var(--squisq-accent, #6366f1)',
        borderRadius: 4,
        overflow: 'auto',
        cursor: 'text',
      }}
    >
      <EditorContent editor={editor} className="squisq-scene-text-editor" />
    </div>
  );
}

export default SceneTextOverlay;
