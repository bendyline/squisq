import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parseMarkdown, parseVideoEmbedUrl } from '@bendyline/squisq/markdown';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { VideoEmbedFrame } from '../VideoEmbedFrame';

const YT = 'dQw4w9WgXcQ';
const EMBED_SRC = `https://www.youtube-nocookie.com/embed/${YT}`;

function renderMarkdown(markdown: string, htmlPolicy?: 'strip' | 'sanitize' | 'trusted') {
  return render(
    <MarkdownRenderer nodes={parseMarkdown(markdown).children} htmlPolicy={htmlPolicy} />,
  );
}

describe('VideoEmbedFrame', () => {
  it('renders the provider player with the canonical attributes', () => {
    const embed = parseVideoEmbedUrl(`https://youtu.be/${YT}?t=42`)!;
    const { container } = render(<VideoEmbedFrame embed={embed} title="Keynote" />);
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBe(`${EMBED_SRC}?start=42`);
    expect(iframe.getAttribute('title')).toBe('Keynote');
    expect(iframe.hasAttribute('allowfullscreen')).toBe(true);
    expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(iframe.getAttribute('loading')).toBe('lazy');
    expect(iframe.getAttribute('allow')).toContain('encrypted-media');

    const caption = container.querySelector('figcaption a')!;
    expect(caption.textContent).toBe('Keynote');
    expect(caption.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${YT}&t=42s`);
  });

  it('names an untitled player after its provider and omits the caption', () => {
    const embed = parseVideoEmbedUrl('https://vimeo.com/76979871')!;
    const { container } = render(<VideoEmbedFrame embed={embed} />);
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe('Vimeo video');
    expect(container.querySelector('figcaption')).toBeNull();
  });

  it('marks a Shorts frame portrait', () => {
    const embed = parseVideoEmbedUrl(`https://www.youtube.com/shorts/${YT}`)!;
    const { container } = render(<VideoEmbedFrame embed={embed} />);
    expect(container.querySelector('.squisq-video-embed')!.getAttribute('data-orientation')).toBe(
      'portrait',
    );
  });
});

describe('MarkdownRenderer video embeds', () => {
  it('renders a paragraph that is only a video link as the player', () => {
    const { container } = renderMarkdown(`[Launch keynote](https://www.youtube.com/watch?v=${YT})`);
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe(EMBED_SRC);
    expect(container.querySelector('figcaption')!.textContent).toBe('Launch keynote');
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders a bare video URL as the player', () => {
    const { container } = renderMarkdown(`https://youtu.be/${YT}`);
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe(EMBED_SRC);
  });

  it('keeps a video link in a list, blockquote or footnote as a link', () => {
    for (const md of [
      `- https://youtu.be/${YT}`,
      `> [Keynote](https://youtu.be/${YT})`,
      `See note.[^1]\n\n[^1]: https://youtu.be/${YT}`,
    ]) {
      const { container } = renderMarkdown(md);
      expect(container.querySelector('iframe'), md).toBeNull();
    }
  });

  it('keeps a video link inside prose as a link', () => {
    const { container } = renderMarkdown(`Watch [the keynote](https://youtu.be/${YT}) first.`);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('a')!.getAttribute('href')).toBe(`https://youtu.be/${YT}`);
  });

  it('renders pasted provider embed code as the same player', () => {
    const { container } = renderMarkdown(
      `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=x" title="YouTube video player" frameborder="0" allowfullscreen></iframe>`,
    );
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBe(EMBED_SRC);
    expect(iframe.getAttribute('title')).toBe('YouTube video');
    expect(container.querySelector('.squisq-md-html-block')).toBeNull();
  });

  it('never renders an unknown iframe, even under the trusted policy', () => {
    for (const policy of ['sanitize', 'trusted'] as const) {
      const { container } = renderMarkdown(
        '<div><iframe src="https://evil.example/frame"></iframe></div>',
        policy,
      );
      expect(container.querySelector('iframe'), policy).toBeNull();
    }
  });

  it('renders a provider iframe nested in authored HTML inline', () => {
    const { container } = renderMarkdown(
      `<p>Clip: <iframe src="https://player.vimeo.com/video/76979871"></iframe></p>`,
      'trusted',
    );
    const player = container.querySelector('.squisq-video-embed')!;
    expect(player.tagName).toBe('SPAN');
    expect(player.querySelector('iframe')!.getAttribute('src')).toBe(
      'https://player.vimeo.com/video/76979871',
    );
  });

  it('honors the strip policy for embed code but not for link paragraphs', () => {
    const iframe = renderMarkdown(`<iframe src="https://youtu.be/${YT}"></iframe>`, 'strip');
    expect(iframe.container.querySelector('iframe')).toBeNull();
    const link = renderMarkdown(`https://youtu.be/${YT}`, 'strip');
    expect(link.container.querySelector('iframe')).not.toBeNull();
  });
});
