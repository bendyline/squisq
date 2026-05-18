/**
 * InlineAudioPlayer
 *
 * Small inline HTML5 audio player for `<audio>` tags embedded directly in
 * a markdown document — e.g. a narration recording the user wants to
 * audition in the editor. Resolves the `src` through `MediaContext` so a
 * container-backed `audio/foo.webm` path returns a playable blob URL.
 *
 * Deliberately thin: native browser controls, no autoplay. The
 * MarkdownRenderer swaps this in for raw `<audio>` htmlElements; the
 * editor-react Tiptap audio node reuses it for its NodeView.
 */
import { useMediaUrl } from './hooks/MediaContext.js';

export interface InlineAudioPlayerProps {
  /** Source path — resolved through MediaContext when relative. */
  src: string;
  /** Base path used when no MediaProvider is in context. */
  basePath?: string;
  /** Whether to show native controls. Defaults to true. */
  controls?: boolean;
  /** `preload` attribute passthrough. Defaults to `'metadata'`. */
  preload?: 'none' | 'metadata' | 'auto';
  /** Extra className on the wrapper. */
  className?: string;
}

export function InlineAudioPlayer({
  src,
  basePath = '',
  controls = true,
  preload = 'metadata',
  className,
}: InlineAudioPlayerProps) {
  const resolvedSrc = useMediaUrl(src, basePath);

  if (!resolvedSrc) return null;

  return (
    <span className={`squisq-inline-audio-player ${className ?? ''}`.trim()}>
      <audio src={resolvedSrc} controls={controls} preload={preload} />
    </span>
  );
}

export default InlineAudioPlayer;
