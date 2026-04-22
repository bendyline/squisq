/**
 * ImageNodeView — Custom Tiptap NodeView for images.
 *
 * Resolves image `src` attributes through the EditorContext's MediaProvider,
 * converting relative paths (e.g. "images/hero.jpg") to displayable blob URLs.
 *
 * The ProseMirror node retains the original relative path so markdown roundtrip
 * is preserved — only the rendered DOM uses the resolved URL.
 */

import { useEffect, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import { useEditorContext } from './EditorContext';

function ImageComponent({ node }: NodeViewProps) {
  const { src, alt, title } = node.attrs as { src: string; alt: string; title: string };
  const { mediaProvider, imageDisplayMode } = useEditorContext();
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const isThumbnail = imageDisplayMode === 'thumbnail';

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
  }, [src, mediaProvider, isRelative]);

  return (
    <NodeViewWrapper as="figure" style={{ margin: '0.5em 0' }}>
      <img
        src={resolvedSrc}
        alt={alt || ''}
        title={title || undefined}
        className={isThumbnail ? 'squisq-image squisq-image--thumbnail' : 'squisq-image'}
        style={
          isThumbnail
            ? {
                maxWidth: '100px',
                maxHeight: '100px',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
              }
            : { maxWidth: '100%', height: 'auto', display: 'block' }
        }
      />
    </NodeViewWrapper>
  );
}

/**
 * Image extension with a custom React NodeView that resolves URLs
 * through the EditorContext's MediaProvider.
 */
export const ImageWithMediaProvider = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageComponent);
  },
});
