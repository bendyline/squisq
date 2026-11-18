/**
 * VideoEmbedFrame
 *
 * The provider player (YouTube, Vimeo, Loom, Wistia) for a
 * recognized hosted video — what the MarkdownRenderer renders for a paragraph
 * that is only a link to a video page, or for a provider `<iframe>` embed
 * snippet. See `@bendyline/squisq/markdown`'s `findBlockVideoEmbed`.
 *
 * The iframe's attributes come from core's `videoEmbedIframeAttributes`, the
 * single definition every renderer and exporter shares; its `src` is rebuilt
 * from the validated video id, never the author's URL. Layout is responsive:
 * the frame fills its column at the provider's aspect ratio (16:9, or 9:16
 * for YouTube Shorts), so authored `width`/`height` are not honored.
 */
import type { CSSProperties } from 'react';
import { videoEmbedIframeAttributes, type VideoEmbed } from '@bendyline/squisq/markdown';

export interface VideoEmbedFrameProps {
  /** The recognized video (`parseVideoEmbedUrl` / `findBlockVideoEmbed`). */
  embed: VideoEmbed;
  /**
   * The author's label. Names the iframe for assistive tech and, when
   * `showCaption` is on, renders beneath the player as a link to the page.
   */
  title?: string | null;
  /** Render the title as a caption linking to the watch page (default true). */
  showCaption?: boolean;
  /**
   * Phrasing-content root (`<span>`, no caption) for a player nested in
   * authored HTML, where a `<figure>` could land inside a `<p>`.
   */
  inline?: boolean;
  /** Extra className on the root element. */
  className?: string;
}

/** Fill the frame. Inline so the player lays out even with no stylesheet. */
const IFRAME_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  border: 0,
};

/** The link card that stands in for a player that cannot play here. */
const LINK_CARD_STYLE: CSSProperties = {
  ...IFRAME_STYLE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#000',
  backgroundPosition: 'center',
  backgroundSize: 'cover',
  backgroundRepeat: 'no-repeat',
  color: '#fff',
  font: '600 1rem/1.3 system-ui, sans-serif',
  textDecoration: 'none',
  textShadow: '0 1px 3px rgba(0, 0, 0, 0.9)',
};

/**
 * YouTube refuses to play an embed whose page sends no referrer (the player
 * shows "Error 153"), and a page opened from disk — an exported HTML file
 * opened locally — never sends one. There the frame links to the video.
 */
function playerRefusedHere(embed: VideoEmbed): boolean {
  return (
    embed.provider === 'youtube' &&
    typeof window !== 'undefined' &&
    window.location?.protocol === 'file:'
  );
}

export function VideoEmbedFrame({
  embed,
  title,
  showCaption = true,
  inline = false,
  className,
}: VideoEmbedFrameProps) {
  const attrs = videoEmbedIframeAttributes(embed, title);
  const portrait = embed.aspectRatio < 1;
  const caption = showCaption && !inline ? title?.trim() : '';
  const Root = inline ? 'span' : 'figure';
  const linkInstead = playerRefusedHere(embed);
  return (
    <Root
      className={`squisq-video-embed ${className ?? ''}`.trim()}
      data-provider={embed.provider}
      data-orientation={portrait ? 'portrait' : 'landscape'}
    >
      <span
        className="squisq-video-embed-frame"
        style={{ position: 'relative', display: 'block', aspectRatio: String(embed.aspectRatio) }}
      >
        {linkInstead ? (
          <a
            href={embed.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...LINK_CARD_STYLE,
              ...(embed.thumbnailUrl
                ? { backgroundImage: `url(${JSON.stringify(embed.thumbnailUrl)})` }
                : {}),
            }}
          >
            {`\u{25B6}\u{FE0E} Watch ${caption ? `\u{201C}${caption}\u{201D} ` : ''}on ${embed.providerName}`}
          </a>
        ) : (
          <iframe
            src={attrs.src}
            title={attrs.title}
            allow={attrs.allow}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
            style={IFRAME_STYLE}
          />
        )}
      </span>
      {caption ? (
        <figcaption className="squisq-video-embed-caption">
          <a href={embed.watchUrl} target="_blank" rel="noopener noreferrer">
            {caption}
          </a>
        </figcaption>
      ) : null}
    </Root>
  );
}

export default VideoEmbedFrame;
