/**
 * TiptapVideo — block-level atom Tiptap node for HTML5 `<video>` elements.
 *
 * Without this extension, Tiptap's StarterKit strips unknown HTML tags
 * when parsing the editor's content. By registering `<video>` as a known
 * node, the editor can render a recording's inline player inside the
 * WYSIWYG surface and round-trip the tag through markdown.
 *
 * The NodeView renders a real `<video controls>` whose src is resolved
 * through the EditorContext's MediaProvider — same mechanism
 * `ImageNodeView` uses for `<img>`.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useResolvedMediaSrc } from './useResolvedMediaSrc.js';

export interface TiptapVideoOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (attrs: {
        src: string;
        width?: number | string | null;
        controls?: boolean;
      }) => ReturnType;
    };
  }
}

function VideoNodeView({ node }: NodeViewProps) {
  const { src, width, height, poster, controls } = node.attrs as {
    src: string;
    width: string | number | null;
    height: string | number | null;
    poster: string | null;
    controls: boolean;
  };
  const resolvedSrc = useResolvedMediaSrc(src ?? '');
  // Resolve poster through the same provider when present so a
  // workspace-local frame thumbnail also renders inside the editor.
  const resolvedPoster = useResolvedMediaSrc(poster ?? '');

  return (
    <NodeViewWrapper
      as="span"
      className="squisq-inline-video-player"
      // Mark as a drag handle so ProseMirror moves the node when the user
      // drags it, rather than the browser starting a native media-drag.
      data-drag-handle
      draggable
    >
      <video
        src={resolvedSrc || undefined}
        poster={poster ? resolvedPoster : undefined}
        controls={controls}
        playsInline
        preload="metadata"
        width={width ?? undefined}
        height={height ?? undefined}
      />
    </NodeViewWrapper>
  );
}

export const TiptapVideo = Node.create<TiptapVideoOptions>({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      height: { default: null },
      poster: { default: null },
      // The HTML5 `controls` attribute is boolean-presence; parse its
      // existence (even with an empty string value) as `true`, otherwise
      // default to true (we want recordings to be playable by default).
      controls: {
        default: true,
        parseHTML: (el) => el.hasAttribute('controls'),
        renderHTML: (attrs) => (attrs.controls ? { controls: '' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'video' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoNodeView);
  },

  addCommands() {
    return {
      setVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export default TiptapVideo;
