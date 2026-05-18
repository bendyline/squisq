/**
 * InlineVideoPlayer
 *
 * Small inline HTML5 video player for `<video>` tags embedded directly in
 * a markdown document — e.g. a recording dropped into the doc by the
 * recorder. Resolves the `src` through `MediaContext` (same path
 * `VideoLayer` uses) so a container-backed `audio/foo.webm` or
 * `video/foo.mp4` resolves to a blob URL instead of 404-ing on the
 * filesystem path.
 *
 * Deliberately thin: native browser controls, intrinsic aspect ratio,
 * no autoplay. The MarkdownRenderer swaps this in for a raw `<video>`
 * htmlElement; the editor-react Tiptap video node uses the same
 * component for its NodeView.
 */
import { useMediaUrl } from './hooks/MediaContext.js';

export interface InlineVideoPlayerProps {
  /** Source path — resolved through MediaContext when relative. */
  src: string;
  /** Base path used when no MediaProvider is in context. */
  basePath?: string;
  /** Optional explicit width (pixels or CSS length). */
  width?: number | string;
  /** Optional explicit height (pixels or CSS length). */
  height?: number | string;
  /** Optional poster image src — also resolved through MediaContext. */
  poster?: string;
  /** Whether to show native controls. Defaults to true. */
  controls?: boolean;
  /** `preload` attribute passthrough. Defaults to `'metadata'`. */
  preload?: 'none' | 'metadata' | 'auto';
  /** Extra className on the wrapper. */
  className?: string;
}

export function InlineVideoPlayer({
  src,
  basePath = '',
  width,
  height,
  poster,
  controls = true,
  preload = 'metadata',
  className,
}: InlineVideoPlayerProps) {
  const resolvedSrc = useMediaUrl(src, basePath);
  // Always call the hook (Rules of Hooks); only use the result if a poster
  // was actually requested. Empty input → fallback path which we discard.
  const resolvedPoster = useMediaUrl(poster ?? '', basePath);
  const posterUrl = poster ? resolvedPoster : undefined;

  if (!resolvedSrc) return null;

  return (
    <span className={`squisq-inline-video-player ${className ?? ''}`.trim()}>
      <video
        src={resolvedSrc}
        poster={posterUrl}
        controls={controls}
        preload={preload}
        width={width}
        height={height}
        playsInline
      />
    </span>
  );
}

export default InlineVideoPlayer;
