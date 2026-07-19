import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index';
import { flattenBlocks, markdownToDoc } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';

/** One full normalization cycle: md → doc → md. */
function normalize(markdown: string): string {
  return stringifyMarkdown(docToMarkdown(markdownToDoc(parseMarkdown(markdown))));
}

/** Byte-stability convention: stable after one normalization cycle. */
function expectStable(markdown: string): string {
  const once = normalize(markdown);
  const twice = normalize(once);
  expect(twice).toBe(once);
  return once;
}

describe('docToMarkdown media round-trip', () => {
  it('preserves a preamble document-anchored narration annotation', () => {
    const md = `{[audio src=audio/narration-001.webm anchor=document]}\n\n# Hello\n\nBody text.\n`;
    const once = expectStable(md);
    expect(once).toContain('{[audio src=audio/narration-001.webm anchor=document]}');
    // It must come back at the TOP (before the first heading) so reparsing
    // yields documentMedia again.
    expect(once.indexOf('{[audio')).toBeLessThan(once.indexOf('# Hello'));
    const reparsed = markdownToDoc(parseMarkdown(once));
    expect(reparsed.documentMedia?.length).toBe(1);
    expect(reparsed.documentMedia![0].anchor).toBe('document');
  });

  it('preserves a block-level clip mid-contents with params', () => {
    const md = `# Scene\n\nLead-in paragraph.\n\n{[video src=video/b.mp4 startAt=2 clipStart=1 clipEnd=9 spillover=true]}\n\nTrailing paragraph.\n`;
    const once = expectStable(md);
    expect(once).toContain(
      '{[video src=video/b.mp4 startAt=2 clipStart=1 clipEnd=9 spillover=true]}',
    );
    // Original position: after the lead-in, before the trailing paragraph.
    expect(once.indexOf('Lead-in')).toBeLessThan(once.indexOf('{[video'));
    expect(once.indexOf('{[video')).toBeLessThan(once.indexOf('Trailing'));
    const reparsed = markdownToDoc(parseMarkdown(once));
    const withMedia = reparsed.blocks.find((b) => b.media && b.media.length > 0);
    expect(withMedia?.media?.[0].clipStart).toBe(1);
    expect(withMedia?.media?.[0].spillover).toBe(true);
  });

  it('round-trips toolbar-authored HTML video placement byte-stably', () => {
    const md = `# Scene\n\n<video src="video/presenter.mp4" controls data-squisq-video-placement="picture-in-picture"></video>\n`;
    const once = expectStable(md);
    expect(once).toContain('data-squisq-video-placement="picture-in-picture"');
    const reparsed = markdownToDoc(parseMarkdown(once));
    const withMedia = flattenBlocks(reparsed.blocks).find((block) => block.media?.length);
    expect(withMedia?.media?.[0].placement).toBe('picture-in-picture');
  });

  it('round-trips an unlocked independently timed HTML video byte-stably', () => {
    const md = `# Scene\n\n<video src="video/presenter.mp4" controls data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-start-at="2" data-squisq-video-clip-end="9"></video>\n`;
    const once = expectStable(md);
    expect(once).toContain('data-squisq-video-lock-to-block="false"');
    const reparsed = markdownToDoc(parseMarkdown(once));
    expect(reparsed.documentMedia?.[0]).toMatchObject({
      lockToBlock: false,
      anchor: 'document',
      startAt: 2,
      clipEnd: 9,
    });
  });

  it('preserves a document-anchored annotation authored inside a section body', () => {
    const md = `# Section\n\nSome text.\n\n{[audio src=audio/full.mp3 anchor=document startAt=0:30]}\n\nMore text.\n`;
    const once = expectStable(md);
    // Raw text passthrough keeps the mm:ss time form byte-identical.
    expect(once).toContain('{[audio src=audio/full.mp3 anchor=document startAt=0:30]}');
    const reparsed = markdownToDoc(parseMarkdown(once));
    expect(reparsed.documentMedia?.[0].startAt).toBe(30);
  });

  it('preserves quoted srcs with spaces', () => {
    const md = `{[audio src="audio/my take.webm" anchor=document]}\n\n# Doc\n\nText.\n`;
    const once = expectStable(md);
    expect(once).toContain('src="audio/my take.webm"');
    const reparsed = markdownToDoc(parseMarkdown(once));
    expect(reparsed.documentMedia?.[0].src).toBe('audio/my take.webm');
  });

  it('emits programmatic doc clips (no origin) at the document top canonically', () => {
    const doc = markdownToDoc(parseMarkdown('# Title\n\nBody.\n'));
    doc.documentMedia = [
      { id: 'clip-1', src: 'audio/take.webm', kind: 'audio', startAt: 0, anchor: 'document' },
    ];
    const md = stringifyMarkdown(docToMarkdown(doc));
    expect(md).toContain('{[audio src=audio/take.webm anchor=document]}');
    expect(md.indexOf('{[audio')).toBeLessThan(md.indexOf('# Title'));
    // And the emission itself round-trips.
    const reparsed = markdownToDoc(parseMarkdown(md));
    expect(reparsed.documentMedia?.length).toBe(1);
    expect(stringifyMarkdown(docToMarkdown(reparsed))).toBe(md);
  });

  it('serializes programmatic video placement canonically', () => {
    const doc = markdownToDoc(parseMarkdown('# Title\n\nBody.\n'));
    doc.blocks[0].media = [
      {
        id: 'overlay',
        src: 'video/overlay.mp4',
        kind: 'video',
        placement: 'overlay',
        startAt: 0,
        anchor: 'block',
      },
    ];
    const md = stringifyMarkdown(docToMarkdown(doc));
    expect(md).toContain('{[video src=video/overlay.mp4 placement=overlay]}');
  });

  it('leaves docs without media untouched', () => {
    const md = `# Plain\n\nNothing to see.\n`;
    const once = expectStable(md);
    expect(once).not.toContain('{[audio');
  });
});
