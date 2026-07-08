import { describe, expect, it } from 'vitest';
import { removeMediaReferencesFromMarkdown } from '../mediaReferences';

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
