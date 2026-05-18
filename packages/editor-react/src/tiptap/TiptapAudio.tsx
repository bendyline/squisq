/**
 * TiptapAudio — inline atom Tiptap node for HTML5 `<audio>` elements.
 *
 * Lets the WYSIWYG editor preserve `<audio>` tags that the recorder
 * drops into the markdown for narration / voice recordings, and render
 * a native playback control inside the editor surface. The resolved src
 * goes through the EditorContext's MediaProvider so a workspace-local
 * `audio/foo.webm` returns a blob URL.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useResolvedMediaSrc } from './useResolvedMediaSrc.js';

export interface TiptapAudioOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    audio: {
      setAudio: (attrs: { src: string; controls?: boolean }) => ReturnType;
    };
  }
}

function AudioNodeView({ node }: NodeViewProps) {
  const { src, controls } = node.attrs as { src: string; controls: boolean };
  const resolvedSrc = useResolvedMediaSrc(src ?? '');

  return (
    <NodeViewWrapper as="span" className="squisq-inline-audio-player" data-drag-handle draggable>
      <audio src={resolvedSrc || undefined} controls={controls} preload="metadata" />
    </NodeViewWrapper>
  );
}

export const TiptapAudio = Node.create<TiptapAudioOptions>({
  name: 'audio',
  // Block-level so each recording lives on its own line in the WYSIWYG —
  // matches how the recorder inserts the tag (on a fresh line) and
  // avoids odd inline-flow alignment when the native controls take more
  // vertical space than a line of text.
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
      controls: {
        default: true,
        parseHTML: (el) => el.hasAttribute('controls'),
        renderHTML: (attrs) => (attrs.controls ? { controls: '' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'audio' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioNodeView);
  },

  addCommands() {
    return {
      setAudio:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export default TiptapAudio;
