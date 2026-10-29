/**
 * `{[…]}` block tags type content for the player. A document format has
 * nothing to type, so Word, PDF and EPUB leave them out rather than printing
 * markup as prose — the standalone kind, the one glued to a section's last
 * sentence, and media tags alike.
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { withoutBlockTags } from '../shared/blockTags';
import { markdownDocToDocx } from '../docx/export';
import { markdownDocToEpub } from '../epub/export';

const SOURCE = [
  '# Results',
  '',
  'Revenue grew 40% this year {[statHighlight]}',
  '',
  '## Voices',
  '',
  '{[quote]}',
  '',
  'Words worth keeping.',
  '',
  '{[audio src=narration.webm anchor=document]}',
  '',
  '- {[quote]} in a list is text',
  '',
  '{[notATemplate]}',
  '',
].join('\n');

const TAG = /\{\[[^\]<]*\]\}/g;

describe('block tags in documents', () => {
  it('are removed only where the player reads them as tags', () => {
    const doc = withoutBlockTags(parseMarkdown(SOURCE));
    const text = JSON.stringify(doc);
    expect(text).toContain('Revenue grew 40% this year"');
    expect(text).not.toContain('statHighlight');
    expect(text).not.toContain('narration.webm');
    expect(text).toContain('{[quote]} in a list is text');
    expect(text).toContain('{[notATemplate]}');

    const kept = withoutBlockTags(parseMarkdown(SOURCE), { keepMedia: true });
    expect(JSON.stringify(kept)).toContain('narration.webm');
    const untouched = parseMarkdown('# Plain\n\nNo tags here.\n');
    expect(withoutBlockTags(untouched)).toBe(untouched);
  });

  it('are not printed in Word or EPUB', async () => {
    const docx = await JSZip.loadAsync(await markdownDocToDocx(parseMarkdown(SOURCE)));
    const xml = await docx.file('word/document.xml')!.async('string');
    expect(xml.match(TAG)).toEqual(['{[quote]}', '{[notATemplate]}']);
    expect(xml).toContain('Revenue grew 40% this year');

    const epub = await JSZip.loadAsync(await markdownDocToEpub(parseMarkdown(SOURCE)));
    const names = Object.keys(epub.files).filter((name) => name.endsWith('.xhtml'));
    const xhtml = (await Promise.all(names.map((name) => epub.file(name)!.async('string')))).join();
    expect(xhtml.match(TAG)).toEqual(['{[quote]}', '{[notATemplate]}']);
  });
});
