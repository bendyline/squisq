import { describe, expect, it } from 'vitest';
import {
  collectMediaReferencesFromMarkdown,
  removeMediaReferencesFromMarkdown,
} from '../mediaReferences';

describe('collectMediaReferencesFromMarkdown', () => {
  it('collects markdown image/link and html media references', () => {
    const refs = collectMediaReferencesFromMarkdown(
      [
        '![One](attachments/one.png)',
        '[Two](attachments/two.pdf)',
        '<video src="video/clip.webm" poster="video/poster.png"></video>',
        '<a href="attachments/three.txt">Three</a>',
      ].join('\n'),
    );

    expect([...refs].sort()).toEqual([
      'attachments/one.png',
      'attachments/three.txt',
      'attachments/two.pdf',
      'video/clip.webm',
      'video/poster.png',
    ]);
  });

  it('collects media references from squiggly annotations', () => {
    const refs = collectMediaReferencesFromMarkdown(
      [
        '## Intro {[audio=audio/take.mp3]}',
        '{[video src="video/clip with spaces.webm"]}',
        '### Image {#hero} {[image src=images/hero.png alt="Hero"]}',
      ].join('\n'),
    );

    expect([...refs].sort()).toEqual([
      'audio/take.mp3',
      'images/hero.png',
      'video/clip with spaces.webm',
    ]);
  });
});

describe('removeMediaReferencesFromMarkdown', () => {
  it('removes standalone image references to the media path', () => {
    const source = ['Before', '', '![Screenshot](attachments/pasted.png)', '', 'After'].join('\n');

    expect(removeMediaReferencesFromMarkdown(source, 'attachments/pasted.png')).toBe(
      ['Before', '', '', 'After'].join('\n'),
    );
  });

  it('removes inline image and link references without touching similar paths', () => {
    const source = [
      'Keep ![Other](attachments/pasted.png.backup).',
      'Drop ![Screenshot](attachments/pasted.png) and [file](attachments/pasted.png).',
    ].join('\n');

    expect(removeMediaReferencesFromMarkdown(source, 'attachments/pasted.png')).toBe(
      ['Keep ![Other](attachments/pasted.png.backup).', 'Drop  and .'].join('\n'),
    );
  });

  it('supports angle-wrapped destinations and markdown titles', () => {
    const source =
      'Drop ![A](<attachments/my pasted image.png>) and [A](attachments/simple.png "title").';

    expect(removeMediaReferencesFromMarkdown(source, 'attachments/my pasted image.png')).toBe(
      'Drop  and [A](attachments/simple.png "title").',
    );
    expect(removeMediaReferencesFromMarkdown(source, 'attachments/simple.png')).toBe(
      'Drop ![A](<attachments/my pasted image.png>) and .',
    );
  });

  it('removes resized raw HTML image tags and raw HTML anchors', () => {
    const source =
      '<img alt="Screenshot" src="attachments/pasted.png" width="320">\n<a href="attachments/pasted.png">Screenshot</a>';

    expect(removeMediaReferencesFromMarkdown(source, 'attachments/pasted.png')).toBe('\n');
  });
});
