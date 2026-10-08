/**
 * Hosted-video embeds through the HTML formats: the plain-HTML exporter renders
 * a paragraph that is only a link to a video page as the provider's player (or
 * a static poster card), and HTML import turns a provider iframe back into that
 * paragraph.
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToPlainHtml } from '../html/plainHtml';
import { htmlToMarkdown } from '../html/import.js';

const YT = 'dQw4w9WgXcQ';
const EMBED_SRC = `https://www.youtube-nocookie.com/embed/${YT}`;

function render(md: string, options?: Parameters<typeof markdownDocToPlainHtml>[1]): string {
  return markdownDocToPlainHtml(parseMarkdown(md), options);
}

function bodyOf(html: string): string {
  return html.slice(html.indexOf('<body>'), html.indexOf('</body>'));
}

describe('markdownDocToPlainHtml video embeds', () => {
  it('renders a link-only paragraph as the player with a caption', () => {
    const body = bodyOf(render(`[Launch keynote](https://youtu.be/${YT}?t=42)`));
    expect(body).toContain(
      `<iframe src="${EMBED_SRC}?start=42" title="Launch keynote" allow="accelerometer;`,
    );
    expect(body).toContain(' allowfullscreen referrerpolicy="strict-origin-when-cross-origin"');
    expect(body).toContain(
      `<figcaption class="squisq-video-embed-caption"><a href="https://www.youtube.com/watch?v=${YT}&amp;t=42s">Launch keynote</a></figcaption>`,
    );
    expect(body).not.toContain('<p>');
  });

  it('renders a bare URL as an uncaptioned player', () => {
    const body = bodyOf(render('https://vimeo.com/76979871'));
    expect(body).toContain('<iframe src="https://player.vimeo.com/video/76979871"');
    expect(body).not.toContain('<figcaption');
  });

  it('keeps a video link in a list or blockquote as a link', () => {
    for (const md of [`- https://youtu.be/${YT}`, `> [Keynote](https://youtu.be/${YT})`]) {
      expect(bodyOf(render(md)), md).not.toContain('<iframe');
    }
  });

  it('keeps a video link inside prose as a link', () => {
    const body = bodyOf(render(`Watch [the keynote](https://youtu.be/${YT}) first.`));
    expect(body).not.toContain('<iframe');
    expect(body).toContain(`<a href="https://youtu.be/${YT}">the keynote</a>`);
  });

  it('renders pasted embed code as the same responsive player', () => {
    const body = bodyOf(
      render(
        `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=x" title="YouTube video player"></iframe>`,
      ),
    );
    expect(body).toContain(`<figure class="squisq-video-embed" data-provider="youtube"`);
    expect(body).toContain(`<iframe src="${EMBED_SRC}" title="YouTube video"`);
    expect(body).not.toContain('width="560"');
  });

  it('drops unknown iframes as before', () => {
    const body = bodyOf(render('<iframe src="https://evil.example/frame"></iframe>'));
    expect(body).not.toContain('<iframe');
  });

  it('renders a poster card that links out when asked', () => {
    const body = bodyOf(
      render(`[Launch keynote](https://www.youtube.com/watch?v=${YT})`, { videoEmbeds: 'poster' }),
    );
    expect(body).not.toContain('<iframe');
    expect(body).toContain(
      `<a class="squisq-video-embed-frame squisq-video-embed-poster" href="https://www.youtube.com/watch?v=${YT}"`,
    );
    expect(body).toContain('aria-label="Watch “Launch keynote” on YouTube"');
    expect(body).toContain(`<img src="https://i.ytimg.com/vi/${YT}/hqdefault.jpg" alt=""`);
  });

  it('nests a provider iframe in authored HTML without a block figure', () => {
    const body = bodyOf(
      render('<p>Clip: <iframe src="https://player.vimeo.com/video/76979871"></iframe></p>', {
        htmlPolicy: 'trusted',
      }),
    );
    expect(body).toContain('<p>Clip: <span class="squisq-video-embed"');
    expect(body).not.toContain('<figure');
  });

  it('ships the player layout CSS only with a video in the document', () => {
    expect(render(`https://youtu.be/${YT}`)).toContain('.squisq-video-embed-frame iframe');
    expect(render(`<div><iframe src="https://youtu.be/${YT}"></iframe></div>`)).toContain(
      '.squisq-video-embed-frame iframe',
    );
    expect(render('Plain text.')).not.toContain('squisq-video-embed');
    expect(render(`- https://youtu.be/${YT}`)).not.toContain('squisq-video-embed');
  });
});

describe('htmlToMarkdown video embeds', () => {
  it('turns a provider iframe into a paragraph that is only a link to the video', () => {
    const md = htmlToMarkdown(
      `<p>Intro.</p><div class="video"><iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=tracking" title="Launch keynote" allowfullscreen></iframe></div>`,
    );
    expect(md).toContain(`[Launch keynote](https://www.youtube.com/watch?v=${YT})`);
  });

  it('uses the bare page URL when the iframe carries only a generic title', () => {
    const md = htmlToMarkdown(
      '<iframe src="https://player.vimeo.com/video/76979871" title="vimeo-player"></iframe>',
    );
    expect(md.trim()).toBe('<https://vimeo.com/76979871>');
  });

  it('drops other iframes', () => {
    const md = htmlToMarkdown('<p>Before</p><iframe src="https://evil.example/x"></iframe>');
    expect(md).not.toContain('evil.example');
  });
});
