import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { Block, VideoEmbedLayer as VideoEmbedLayerType } from '@bendyline/squisq/schemas';
import { BlockRenderer } from '../BlockRenderer';
import { VideoEmbedLayer } from '../layers/VideoEmbedLayer';
import { MediaFigureSection } from '../page/sections';

const YT = 'dQw4w9WgXcQ';
const VIEWPORT = { width: 1920, height: 1080 };

function layer(url: string, title?: string): VideoEmbedLayerType {
  return {
    id: 'v',
    type: 'videoEmbed',
    // A square area: the 16:9 player letterboxes inside it.
    position: { x: 0, y: 0, width: 1000, height: 1000 },
    content: { url, ...(title ? { title } : {}) },
  };
}

function inSvg(node: React.ReactNode) {
  return render(<svg>{node}</svg>);
}

describe('VideoEmbedLayer', () => {
  it('plays the provider player, letterboxed to the video shape, in player mode', () => {
    const { container } = inSvg(
      <VideoEmbedLayer
        layer={layer(`https://youtu.be/${YT}?t=5`, 'Demo')}
        viewport={VIEWPORT}
        mode="player"
      />,
    );
    const frame = container.querySelector('foreignObject')!;
    expect(frame.getAttribute('width')).toBe('1000');
    expect(Number(frame.getAttribute('height'))).toBeCloseTo(562.5);
    expect(Number(frame.getAttribute('y'))).toBeCloseTo(218.75);
    const iframe = frame.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${YT}?start=5`);
    expect(iframe.getAttribute('title')).toBe('Demo');
    expect(iframe.hasAttribute('data-no-swipe')).toBe(true);
  });

  it('draws a poster with the provider thumbnail by default', () => {
    const { container } = inSvg(
      <VideoEmbedLayer layer={layer(`https://youtu.be/${YT}`, 'Demo')} viewport={VIEWPORT} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('image')!.getAttribute('href')).toBe(
      `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
    );
    expect(container.querySelector('text')!.textContent).toBe('Demo · YouTube');
    expect(container.querySelector('g')!.getAttribute('aria-label')).toBe('Demo (YouTube video)');
  });

  it('loads nothing remote as a capture placeholder', () => {
    const { container } = inSvg(
      <VideoEmbedLayer
        layer={layer(`https://youtu.be/${YT}`)}
        viewport={VIEWPORT}
        mode="placeholder"
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('image')).toBeNull();
    expect(container.querySelector('text')!.textContent).toBe('YouTube');
  });

  it('renders nothing for a URL that is not a supported video', () => {
    for (const url of ['https://evil.example/frame', 'javascript:alert(1)']) {
      const { container } = inSvg(
        <VideoEmbedLayer layer={layer(url)} viewport={VIEWPORT} mode="player" />,
      );
      expect(container.querySelector('g'), url).toBeNull();
    }
  });
});

describe('BlockRenderer video embeds', () => {
  const block: Block = {
    id: 'b',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [layer('https://vimeo.com/76979871', 'Tour')],
  };

  it('defaults to a poster so thumbnails and previews never load a player', () => {
    const { container } = render(<BlockRenderer block={block} blockTime={0} basePath="" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.block-layer--video-embed')).not.toBeNull();
  });

  it('plays when the host asks for players', () => {
    const { container } = render(
      <BlockRenderer block={block} blockTime={0} basePath="" videoEmbeds="player" />,
    );
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe(
      'https://player.vimeo.com/video/76979871',
    );
  });
});

describe('page media figure', () => {
  it('plays a hosted video in a videoWithCaption section', () => {
    const { container } = render(
      <MediaFigureSection
        block={{ id: 'b', startTime: 0, duration: 1, audioSegment: 0 }}
        section={
          {
            id: 's',
            blockId: 'b',
            kind: 'media-figure',
            variant: 'video',
            slots: {
              media: { type: 'videoEmbed', url: `https://youtu.be/${YT}`, title: 'Demo' },
              caption: 'Demo',
            },
          } as unknown as Parameters<typeof MediaFigureSection>[0]['section']
        }
      />,
    );
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}`,
    );
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('figcaption')!.textContent).toBe('Demo');
  });
});
