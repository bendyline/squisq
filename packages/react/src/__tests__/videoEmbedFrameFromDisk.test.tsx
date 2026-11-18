// @vitest-environment-options {"url": "file:///C:/Exports/plan/index.html"}
/**
 * An exported HTML page opened from disk sends no referrer, and YouTube's
 * player refuses to play without one ("Error 153"). There the frame links to
 * the video instead; other providers keep their player.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parseVideoEmbedUrl } from '@bendyline/squisq/markdown';
import { VideoEmbedFrame } from '../VideoEmbedFrame';

const YT = 'dQw4w9WgXcQ';

describe('VideoEmbedFrame on a page opened from disk', () => {
  it('links a YouTube video to its page instead of loading a player that refuses', () => {
    expect(window.location.protocol).toBe('file:');
    const embed = parseVideoEmbedUrl(`https://youtu.be/${YT}`)!;
    const { container } = render(<VideoEmbedFrame embed={embed} title="Keynote" />);
    expect(container.querySelector('iframe')).toBeNull();
    const card = container.querySelector('.squisq-video-embed-frame a')!;
    expect(card.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${YT}`);
    expect(card.textContent).toBe('\u25B6\uFE0E Watch \u201cKeynote\u201d on YouTube');
    expect((card as HTMLElement).style.backgroundImage).toContain('i.ytimg.com');
  });

  it('keeps the player for providers that play without a referrer', () => {
    const embed = parseVideoEmbedUrl('https://vimeo.com/76979871')!;
    const { container } = render(<VideoEmbedFrame embed={embed} />);
    expect(container.querySelector('iframe')).not.toBeNull();
  });
});
