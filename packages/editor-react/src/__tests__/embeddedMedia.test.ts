import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { collectEmbeddedMedia, mediaKindFromUrl } from '../embeddedMedia';

function block(md: string) {
  return markdownToDoc(parseMarkdown(md), { articleId: 't' }).blocks[0];
}

describe('mediaKindFromUrl', () => {
  it('classifies by extension', () => {
    expect(mediaKindFromUrl('a/clip.webm')).toBe('video');
    expect(mediaKindFromUrl('take1.mp3')).toBe('audio');
    expect(mediaKindFromUrl('photo.png')).toBeNull();
    expect(mediaKindFromUrl('https://x.com/page')).toBeNull();
  });
});

describe('collectEmbeddedMedia', () => {
  it('finds a recorder <video> HTML tag with its source line', () => {
    const found = collectEmbeddedMedia(
      block('# Tips\n\n<video src="video/recording.webm" controls></video>\n'),
    );
    expect(found).toEqual([{ src: 'video/recording.webm', kind: 'video', sourceLine: 3 }]);
  });

  it('finds an <audio> tag', () => {
    const found = collectEmbeddedMedia(block('# Intro\n\n<audio src="audio/take.mp3"></audio>\n'));
    expect(found[0]).toMatchObject({ src: 'audio/take.mp3', kind: 'audio' });
  });

  it('finds a markdown link/image to media', () => {
    expect(collectEmbeddedMedia(block('# B\n\n[clip](v/r.webm)\n'))[0]).toMatchObject({
      src: 'v/r.webm',
      kind: 'video',
    });
    expect(collectEmbeddedMedia(block('# B\n\n![v](clip.mp4)\n'))[0]).toMatchObject({
      src: 'clip.mp4',
      kind: 'video',
    });
  });

  it('ignores plain images and non-media links', () => {
    expect(
      collectEmbeddedMedia(block('# B\n\n![p](pic.png)\n\n[docs](https://x.com/y)\n')),
    ).toEqual([]);
  });
});
