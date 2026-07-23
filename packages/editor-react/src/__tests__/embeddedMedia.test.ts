import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  collectEmbeddedMedia,
  collectEmbeddedMediaSchedule,
  collectTimelinePlaybackSchedule,
  collectEmbeddedVideoSchedule,
  mediaKindFromUrl,
} from '../embeddedMedia';

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

describe('collectEmbeddedVideoSchedule', () => {
  it('places an embedded video across its owning block', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        '# First {duration=8}\n\nIntro\n\n# Second {duration=5}\n\n<video src="video/take.webm"></video>\n',
      ),
      { articleId: 't' },
    );

    expect(collectEmbeddedVideoSchedule(doc)).toEqual([
      expect.objectContaining({
        kind: 'video',
        src: 'video/take.webm',
        absoluteStart: 8,
        absoluteEnd: 13,
        sourceIn: 0,
        anchor: 'block',
        blockId: doc.blocks[1].id,
      }),
    ]);
  });

  it('does not duplicate embedded audio in the video monitor', () => {
    const doc = markdownToDoc(parseMarkdown('# Intro\n\n<audio src="take.mp3"></audio>\n'), {
      articleId: 't',
    });
    expect(collectEmbeddedVideoSchedule(doc)).toEqual([]);
  });
});

describe('collectTimelinePlaybackSchedule', () => {
  it('includes embedded audio and video so every audible timeline source can mix', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        '# Intro {duration=8}\n\n<audio src="audio/music.mp3"></audio>\n\n<video src="video/camera.webm"></video>\n',
      ),
      { articleId: 't' },
    );

    expect(collectEmbeddedMediaSchedule(doc)).toEqual([
      expect.objectContaining({ kind: 'audio', src: 'audio/music.mp3' }),
      expect.objectContaining({ kind: 'video', src: 'video/camera.webm' }),
    ]);

    const playback = collectTimelinePlaybackSchedule(doc, []);
    expect(playback).toEqual([
      expect.objectContaining({ kind: 'audio', src: 'audio/music.mp3' }),
      expect.objectContaining({ kind: 'video', src: 'video/camera.webm' }),
    ]);
  });

  it('adds legacy narration once when its source is not already scheduled', () => {
    const doc = markdownToDoc(parseMarkdown('# Intro {duration=8}\n\nBody.\n'), {
      articleId: 't',
    });
    doc.audio.segments = [
      { src: 'audio/take.mp3', name: 'Take', startTime: 1, duration: 5 },
      { src: 'audio/other.mp3', name: 'Other', startTime: 2, duration: 3 },
    ];
    const scheduled = [
      {
        id: 'scheduled-take',
        kind: 'audio' as const,
        src: 'audio/take.mp3',
        absoluteStart: 1,
        absoluteEnd: 6,
        sourceIn: 0,
        anchor: 'document' as const,
      },
    ];

    const playback = collectTimelinePlaybackSchedule(doc, scheduled);
    expect(playback.filter((clip) => clip.src === 'audio/take.mp3')).toHaveLength(1);
    expect(playback).toContainEqual(
      expect.objectContaining({
        id: 'narration:1',
        src: 'audio/other.mp3',
        absoluteStart: 2,
        absoluteEnd: 5,
      }),
    );
  });
});
