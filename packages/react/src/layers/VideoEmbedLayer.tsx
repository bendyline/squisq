/**
 * VideoEmbedLayer Component
 *
 * Renders a hosted-video layer (YouTube, Vimeo, Loom, Dailymotion, Wistia)
 * within an SVG block, letterboxed to the video's aspect ratio inside the
 * layer's bounds. Three modes, chosen by the host:
 *
 * - `player` — the provider's live player in a `<foreignObject>`. Only for a
 *   surface a viewer can use: the DocPlayer's current slide, a dashboard.
 * - `poster` (default) — a still frame drawn in SVG: the provider's thumbnail
 *   where it serves one, a play button, the title. For thumbnails, previews,
 *   and a slide on its way out, so none of them loads a player.
 * - `placeholder` — the poster without the remote thumbnail. Frame capture
 *   (video/image export) cannot draw a cross-origin frame and must not wait
 *   on, or be tainted by, a remote image.
 *
 * The iframe `src` is re-derived from `content.url` by core's
 * `parseVideoEmbedUrl` — never taken from the layer — so an authored layer
 * cannot frame an arbitrary page; an unsupported URL renders nothing.
 */

import {
  parseVideoEmbedUrl,
  videoEmbedIframeAttributes,
  type VideoEmbed,
} from '@bendyline/squisq/markdown';
import type { VideoEmbedLayer as VideoEmbedLayerType } from '@bendyline/squisq/schemas';
import { getAnchorOffset, resolveValue } from '../utils/layerUtils';

export type VideoEmbedMode = 'player' | 'poster' | 'placeholder';

interface VideoEmbedLayerProps {
  layer: VideoEmbedLayerType;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** How to draw the video (see the component docs). Default `poster`. */
  mode?: VideoEmbedMode;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The largest box of the video's shape centred in the layer's box. */
function containedBox(outer: Box, aspectRatio: number): Box {
  const width = Math.min(outer.width, outer.height * aspectRatio);
  const height = width / aspectRatio;
  return {
    x: outer.x + (outer.width - width) / 2,
    y: outer.y + (outer.height - height) / 2,
    width,
    height,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function Poster({
  box,
  embed,
  title,
  showThumbnail,
}: {
  box: Box;
  embed: VideoEmbed;
  title: string;
  showThumbnail: boolean;
}) {
  const unit = Math.min(box.width, box.height);
  const buttonW = unit * 0.3;
  const buttonH = buttonW * 0.7;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const tri = buttonH * 0.42;
  const fontSize = Math.max(10, unit * 0.055);
  const radius = Math.max(4, unit * 0.02);
  return (
    <>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={radius} fill="#111318" />
      {showThumbnail && embed.thumbnailUrl ? (
        <image
          href={embed.thumbnailUrl}
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          preserveAspectRatio="xMidYMid slice"
          opacity={0.85}
        />
      ) : null}
      <rect
        x={cx - buttonW / 2}
        y={cy - buttonH / 2}
        width={buttonW}
        height={buttonH}
        rx={buttonH * 0.24}
        fill="rgba(0, 0, 0, 0.55)"
        stroke="rgba(255, 255, 255, 0.35)"
        strokeWidth={Math.max(1, unit * 0.004)}
      />
      <path
        d={`M ${cx - tri * 0.36} ${cy - tri / 2} L ${cx + tri * 0.54} ${cy} L ${cx - tri * 0.36} ${cy + tri / 2} Z`}
        fill="#ffffff"
      />
      <text
        x={box.x + fontSize * 0.9}
        y={box.y + box.height - fontSize * 0.9}
        fill="#ffffff"
        fontSize={fontSize}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight={600}
        style={{ paintOrder: 'stroke' }}
        stroke="rgba(0, 0, 0, 0.6)"
        strokeWidth={fontSize * 0.12}
      >
        {truncate(title ? `${title} · ${embed.providerName}` : embed.providerName, 70)}
      </text>
    </>
  );
}

export function VideoEmbedLayer({ layer, viewport, mode = 'poster' }: VideoEmbedLayerProps) {
  const embed = parseVideoEmbedUrl(layer.content.url);
  if (!embed) return null;

  const { position } = layer;
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;
  const offset = getAnchorOffset(position.anchor, width, height);
  const box = containedBox(
    {
      x: resolveValue(position.x, viewport.width) + offset.x,
      y: resolveValue(position.y, viewport.height) + offset.y,
      width,
      height,
    },
    embed.aspectRatio,
  );
  const title = layer.content.title?.trim() ?? '';

  if (mode !== 'player') {
    return (
      <g
        className="block-layer block-layer--video-embed"
        data-layer-id={layer.id}
        data-provider={embed.provider}
        role="img"
        aria-label={
          title ? `${title} (${embed.providerName} video)` : `${embed.providerName} video`
        }
      >
        <Poster box={box} embed={embed} title={title} showThumbnail={mode === 'poster'} />
      </g>
    );
  }

  const attrs = videoEmbedIframeAttributes(embed, title);
  return (
    <g
      className="block-layer block-layer--video-embed"
      data-layer-id={layer.id}
      data-provider={embed.provider}
    >
      <foreignObject x={box.x} y={box.y} width={box.width} height={box.height}>
        <iframe
          // The player is a separate page: clicks inside it never reach the
          // slide, and `data-no-swipe` keeps a drag on its border from
          // turning into a slide change.
          data-no-swipe=""
          src={attrs.src}
          title={attrs.title}
          allow={attrs.allow}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          style={{
            display: 'block',
            width: `${box.width}px`,
            height: `${box.height}px`,
            border: 0,
            background: '#000',
          }}
        />
      </foreignObject>
    </g>
  );
}

export default VideoEmbedLayer;
