/**
 * TiptapVideo — block-level atom Tiptap node for HTML5 `<video>` elements.
 *
 * Without this extension, Tiptap's StarterKit strips unknown HTML tags
 * when parsing the editor's content. By registering `<video>` as a known
 * node, the editor can render a recording's inline player inside the
 * WYSIWYG surface and round-trip the tag through markdown.
 *
 * The NodeView renders a real `<video controls>` whose src is resolved
 * through the EditorContext's MediaProvider. When metadata reports no visual
 * track, legacy/misclassified `<video>` markup uses compact audio controls
 * instead of an empty black stage.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useState, type SyntheticEvent } from 'react';
import type {
  VideoPipPosition,
  VideoPipShape,
  VideoPipSize,
  VideoPlacement,
} from '@bendyline/squisq/schemas';
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
        placement?: VideoPlacement;
        lockToBlock?: boolean;
        pipSize?: VideoPipSize;
        pipShape?: VideoPipShape;
        pipPosition?: VideoPipPosition;
        startAt?: number | string | null;
        clipStart?: number | string | null;
        clipEnd?: number | string | null;
      }) => ReturnType;
    };
  }
}

const PLACEMENT_OPTIONS: Array<{ value: VideoPlacement; label: string; title: string }> = [
  { value: 'content', label: 'In layout', title: 'Participate in the block content layout' },
  {
    value: 'picture-in-picture',
    label: 'PIP',
    title: 'Show above the composition as picture in picture',
  },
  { value: 'overlay', label: 'Overlay', title: 'Show above the composition as full-frame video' },
];

function normalizeVideoPlacement(value: unknown): VideoPlacement {
  return value === 'picture-in-picture' || value === 'overlay' ? value : 'content';
}

function normalizeLockToBlock(value: unknown): boolean {
  return value !== false && value !== 'false' && value !== 0 && value !== '0';
}

function VideoNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const {
    src,
    width,
    height,
    poster,
    controls,
    placement: rawPlacement,
    lockToBlock: rawLockToBlock,
  } = node.attrs as {
    src: string;
    width: string | number | null;
    height: string | number | null;
    poster: string | null;
    controls: boolean;
    placement: VideoPlacement;
    lockToBlock: boolean;
  };
  const placement = normalizeVideoPlacement(rawPlacement);
  const lockToBlock = normalizeLockToBlock(rawLockToBlock);
  const resolvedSrc = useResolvedMediaSrc(src ?? '');
  const [audioOnly, setAudioOnly] = useState(false);
  // Resolve poster through the same provider when present so a
  // workspace-local frame thumbnail also renders inside the editor.
  const resolvedPoster = useResolvedMediaSrc(poster ?? '');

  useEffect(() => {
    setAudioOnly(false);
  }, [resolvedSrc]);

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setAudioOnly(video.videoWidth <= 0 && video.videoHeight <= 0);
  };

  return (
    <NodeViewWrapper
      as="div"
      className={`${audioOnly ? 'squisq-inline-audio-player squisq-video-node--audio-only' : 'squisq-inline-video-player'} squisq-video-node${selected ? ' squisq-video-node--selected' : ''}`}
      data-video-placement={placement}
    >
      {!audioOnly && (
        <div
          className="squisq-video-placement-toolbar"
          role="toolbar"
          aria-label="Video placement"
          contentEditable={false}
        >
          <span className="squisq-video-placement-label">Video</span>
          {PLACEMENT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="squisq-video-placement-button"
              aria-pressed={placement === option.value}
              title={option.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ placement: option.value })}
            >
              {option.label}
            </button>
          ))}
          {placement !== 'content' && (
            <button
              type="button"
              className="squisq-video-placement-button squisq-video-placement-button--lock"
              aria-label="Lock to block"
              aria-pressed={lockToBlock}
              title={
                lockToBlock
                  ? 'Locked to this block; turn off for independent document timing'
                  : 'Document-timed; turn on to follow this block'
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ lockToBlock: !lockToBlock })}
            >
              Lock to block
            </button>
          )}
        </div>
      )}
      {audioOnly ? (
        <audio
          data-drag-handle
          draggable
          src={resolvedSrc || undefined}
          controls={controls}
          preload="metadata"
        />
      ) : (
        <video
          // Mark the media surface as the drag handle so toolbar button presses
          // never initiate a ProseMirror node drag.
          data-drag-handle
          draggable
          src={resolvedSrc || undefined}
          poster={poster ? resolvedPoster : undefined}
          controls={controls}
          playsInline
          preload="metadata"
          width={width ?? undefined}
          height={height ?? undefined}
          onLoadedMetadata={handleLoadedMetadata}
        />
      )}
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
      placement: {
        default: 'content',
        parseHTML: (el) => normalizeVideoPlacement(el.getAttribute('data-squisq-video-placement')),
        renderHTML: (attrs) => {
          const placement = normalizeVideoPlacement(attrs.placement);
          return placement === 'content' ? {} : { 'data-squisq-video-placement': placement };
        },
      },
      lockToBlock: {
        default: true,
        parseHTML: (el) => normalizeLockToBlock(el.getAttribute('data-squisq-video-lock-to-block')),
        renderHTML: (attrs) => {
          const placement = normalizeVideoPlacement(attrs.placement);
          const locked = normalizeLockToBlock(attrs.lockToBlock);
          return placement !== 'content' && !locked
            ? { 'data-squisq-video-lock-to-block': 'false' }
            : {};
        },
      },
      pipSize: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-squisq-video-pip-size'),
        renderHTML: (attrs) =>
          attrs.pipSize === 'small' || attrs.pipSize === 'large'
            ? { 'data-squisq-video-pip-size': attrs.pipSize }
            : {},
      },
      pipShape: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-squisq-video-pip-shape'),
        renderHTML: (attrs) =>
          attrs.pipShape === 'square' || attrs.pipShape === 'wide'
            ? { 'data-squisq-video-pip-shape': attrs.pipShape }
            : {},
      },
      pipPosition: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-squisq-video-pip-position'),
        renderHTML: (attrs) =>
          attrs.pipPosition === 'top-left' ||
          attrs.pipPosition === 'top-right' ||
          attrs.pipPosition === 'bottom-left' ||
          attrs.pipPosition === 'bottom-right'
            ? { 'data-squisq-video-pip-position': attrs.pipPosition }
            : {},
      },
      startAt: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-squisq-video-start-at'),
        renderHTML: (attrs) => {
          const placement = normalizeVideoPlacement(attrs.placement);
          return (placement === 'content' || !normalizeLockToBlock(attrs.lockToBlock)) &&
            attrs.startAt != null
            ? { 'data-squisq-video-start-at': String(attrs.startAt) }
            : {};
        },
      },
      clipStart: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-squisq-video-clip-start'),
        renderHTML: (attrs) => {
          const placement = normalizeVideoPlacement(attrs.placement);
          return (placement === 'content' || !normalizeLockToBlock(attrs.lockToBlock)) &&
            attrs.clipStart != null
            ? { 'data-squisq-video-clip-start': String(attrs.clipStart) }
            : {};
        },
      },
      clipEnd: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-squisq-video-clip-end'),
        renderHTML: (attrs) => {
          const placement = normalizeVideoPlacement(attrs.placement);
          return (placement === 'content' || !normalizeLockToBlock(attrs.lockToBlock)) &&
            attrs.clipEnd != null
            ? { 'data-squisq-video-clip-end': String(attrs.clipEnd) }
            : {};
        },
      },
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
