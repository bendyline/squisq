/**
 * ImageNodeView — Custom Tiptap NodeView for images.
 *
 * Resolves image `src` attributes through the EditorContext's MediaProvider,
 * converting relative paths (e.g. "images/hero.jpg") to displayable blob URLs.
 *
 * The ProseMirror node retains the original relative path so markdown roundtrip
 * is preserved — only the rendered DOM uses the resolved URL.
 *
 * When the image is hovered or selected, a small floating "Edit" affordance
 * appears in the top-right corner — clicking it calls `openImageEdit` on the
 * editor context, which `<EditorShell>` consumes to open a modal
 * `<ImageEditor>` on the source path. Only shown for paths that are
 * relative (i.e. live in the document's media container).
 */

import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import { useEditorContext } from './EditorContext';

function ImageComponent({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const { src, alt, title, width } = node.attrs as {
    src: string;
    alt: string;
    title: string;
    width: number | null;
    height: number | null;
  };
  const { mediaProvider, imageDisplayMode, openImageEdit, mediaRevision } = useEditorContext();
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [hovered, setHovered] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Live preview width while a resize gesture is in flight. Null means
  // "use the persisted width attr". Committed to node attrs on mouseup.
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const isThumbnail = imageDisplayMode === 'thumbnail';
  const isEditable = editor?.isEditable ?? true;

  const isRelative =
    src &&
    !src.startsWith('blob:') &&
    !src.startsWith('http') &&
    !src.startsWith('data:') &&
    !src.startsWith('/');

  useEffect(() => {
    if (!mediaProvider || !isRelative) {
      setResolvedSrc(src);
      return;
    }

    let cancelled = false;
    mediaProvider.resolveUrl(src).then(
      (resolved) => {
        if (!cancelled) setResolvedSrc(resolved);
      },
      () => {
        if (!cancelled) setResolvedSrc(src);
      },
    );

    return () => {
      cancelled = true;
    };
    // `mediaRevision` is bumped after the image editor writes back to the
    // same path — re-resolve so we pick up the fresh blob URL.
  }, [src, mediaProvider, isRelative, mediaRevision]);

  // The Edit affordance is only meaningful when:
  //  - the editor is editable (read-only previews skip it),
  //  - the path is relative (lives in the doc's container, so the editor
  //    can read+write it back), and
  //  - a media provider is wired (the modal resolves the URL through it).
  const canEdit = isEditable && isRelative && mediaProvider !== null;
  const showAffordance = canEdit && (selected || hovered);
  // Resize handle is shown for any selected image in an editable view —
  // even non-relative ones (external URLs, data URIs) — so authors can
  // size remote pictures the same way as local ones.
  const canResize = isEditable && !isThumbnail;
  const showResize = canResize && (selected || hovered);

  // Effective render width: live preview while dragging, otherwise the
  // persisted attr. Height is always derived from the natural aspect
  // ratio of the image element so authors can't accidentally squash it.
  const effectiveWidth = previewWidth ?? width ?? null;

  const beginResize = (event: React.MouseEvent) => {
    if (!canResize) return;
    event.preventDefault();
    event.stopPropagation();
    const imgEl = imgRef.current;
    if (!imgEl) return;
    const startWidth = imgEl.getBoundingClientRect().width;
    const startX = event.clientX;
    // Cap at the image's natural width so dragging out doesn't upscale
    // past the source pixels (which just looks blurry).
    const maxWidth = imgEl.naturalWidth || Infinity;
    const minWidth = 24;

    const onMove = (e: MouseEvent) => {
      const next = Math.max(minWidth, Math.min(maxWidth, startWidth + (e.clientX - startX)));
      setPreviewWidth(Math.round(next));
    };
    const onUp = (e: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const finalWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + (e.clientX - startX)));
      const naturalW = imgEl.naturalWidth;
      const naturalH = imgEl.naturalHeight;
      const w = Math.round(finalWidth);
      const h = naturalW > 0 && naturalH > 0 ? Math.round((w * naturalH) / naturalW) : null;
      setPreviewWidth(null);
      updateAttributes({ width: w, height: h });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetSize = (event: React.MouseEvent) => {
    if (!canResize) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewWidth(null);
    updateAttributes({ width: null, height: null });
  };

  const baseStyle: React.CSSProperties = isThumbnail
    ? {
        maxWidth: '100px',
        maxHeight: '100px',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
        display: 'block',
      }
    : effectiveWidth
      ? {
          width: `${effectiveWidth}px`,
          maxWidth: '100%',
          height: 'auto',
          display: 'block',
        }
      : { maxWidth: '100%', height: 'auto', display: 'block' };

  return (
    <NodeViewWrapper
      as="figure"
      // `data-drag-handle` tells ProseMirror that drags starting on this
      // wrapper are NODE moves (not OS-level image drags). Without it,
      // grabbing the inner `<img>` fires the browser's default image-drag
      // behaviour: the picture is packaged as a virtual file in
      // `dataTransfer.files`, the drop is treated as an external upload,
      // and the source node is never removed — producing a duplicate.
      // Combined with `draggable: true` in the node spec, this gives
      // ProseMirror's default dropHandler a real internal move which
      // preserves the `width`/`height` attrs and deletes the original.
      draggable
      data-drag-handle
      style={{ margin: '0.5em 0', position: 'relative', display: 'inline-block', maxWidth: '100%' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        ref={imgRef}
        src={resolvedSrc}
        alt={alt || ''}
        title={title || undefined}
        className={isThumbnail ? 'squisq-image squisq-image--thumbnail' : 'squisq-image'}
        style={baseStyle}
        // Disable the inner `<img>`'s native HTML5 drag so the gesture is
        // captured by the wrapper's `data-drag-handle` instead. (Without
        // this the browser still emits its own dragstart on the image
        // and ProseMirror sees an external file drop.)
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        data-selected={selected ? 'true' : undefined}
      />
      {showAffordance && (
        <button
          type="button"
          className="squisq-image-edit-affordance"
          data-testid="image-edit-affordance"
          // Stop the click from re-selecting the ProseMirror node and from
          // bubbling to host handlers like file-drop overlays.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openImageEdit(src);
          }}
          title="Edit image"
          aria-label={`Edit image ${alt || src}`}
        >
          <span aria-hidden="true" style={{ fontSize: '0.95em', lineHeight: 1 }}>
            ✎
          </span>
          <span>Edit</span>
        </button>
      )}
      {showResize && (
        <>
          <span
            className="squisq-image-resize-handle"
            data-testid="image-resize-handle"
            onMouseDown={beginResize}
            // Double-click clears the persisted width/height so the image
            // returns to its natural rendered size.
            onDoubleClick={resetSize}
            title="Drag to resize · double-click to reset"
            aria-label="Resize image"
            role="separator"
          />
          {(previewWidth != null || width != null) && (
            <span className="squisq-image-resize-readout" aria-hidden="true">
              {Math.round(effectiveWidth ?? 0)}px
            </span>
          )}
        </>
      )}
    </NodeViewWrapper>
  );
}

/**
 * Image extension with a custom React NodeView that resolves URLs
 * through the EditorContext's MediaProvider, plus author-controlled
 * width/height attributes for in-editor resizing.
 *
 * When `width` (and optionally `height`) is set, the markdown serializer
 * (`tiptapToMarkdown` in `tiptapBridge.ts`) emits an HTML `<img>` tag
 * rather than the `![alt](src)` shorthand so dimensions survive a
 * markdown ↔ WYSIWYG round-trip.
 */
export const ImageWithMediaProvider = Image.extend({
  // Mark the node draggable so ProseMirror handles drag-to-reposition
  // as an internal node move (preserves `width`/`height` attrs and
  // removes the source node automatically). Combined with the
  // `data-drag-handle` on the NodeViewWrapper, this is what makes the
  // `moved` flag true in `handleDrop` so the editor's file-upload path
  // doesn't fire on a drag-reorder.
  draggable: true,
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('width');
          if (!raw) return null;
          const n = parseInt(raw, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs: { width?: number | null }) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('height');
          if (!raw) return null;
          const n = parseInt(raw, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs: { height?: number | null }) =>
          attrs.height ? { height: String(attrs.height) } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageComponent);
  },
});
