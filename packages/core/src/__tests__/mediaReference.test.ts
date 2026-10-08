import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { mediaKindForUrl } from '../markdown/mediaReference.js';
import { parseMarkdown } from '../markdown/parse.js';
import { pickAutoTemplate, profileBlockContents } from '../recommend/templates.js';

describe('mediaKindForUrl', () => {
  it('names video and audio by extension, ignoring a query or fragment', () => {
    expect(mediaKindForUrl('clips/plane.mp4')).toBe('video');
    expect(mediaKindForUrl('https://example.org/a/talk.WEBM?download=1#t=30')).toBe('video');
    expect(mediaKindForUrl('assets/intro.mov')).toBe('video');
    expect(mediaKindForUrl('sounds/bell.mp3')).toBe('audio');
    expect(mediaKindForUrl('a.m4a')).toBe('audio');
    expect(mediaKindForUrl('a.flac')).toBe('audio');
    expect(mediaKindForUrl('a.ogg')).toBe('audio');
  });

  it('treats a recorder container under audio/ as a recording', () => {
    expect(mediaKindForUrl('audio/note.webm')).toBe('audio');
    expect(mediaKindForUrl('./audio/note.mp4')).toBe('audio');
    expect(mediaKindForUrl('video/note.webm')).toBe('video');
  });

  it('leaves pictures, pages and extensionless paths alone', () => {
    expect(mediaKindForUrl('photo.png')).toBeNull();
    expect(mediaKindForUrl('docs/guide.md')).toBeNull();
    expect(mediaKindForUrl('clips/mp4')).toBeNull();
    expect(mediaKindForUrl('.mp4')).toBeNull();
    expect(mediaKindForUrl('')).toBeNull();
  });
});

describe('media references in documents', () => {
  it('never makes a clip the cover picture', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        '# Workshop\n\nThe bell: ![A bell](sounds/bell.mp3) ![A clip](clips/a.mp4)\n\n![The bench](bench.png)\n',
      ),
    );
    expect(doc.startBlock?.heroSrc).toBe('bench.png');
  });

  it('keeps a block with a clip out of image layouts', () => {
    const profile = profileBlockContents(
      parseMarkdown('Planing the edge.\n\n![Planing a board](clips/plane.mp4)\n').children,
    );
    expect(profile.imageCount).toBe(0);
    expect(profile.hasImage).toBe(false);
    expect(pickAutoTemplate(profile)).toBeUndefined();
  });
});
