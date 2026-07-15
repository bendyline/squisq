import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { markdownDocToDocx } from '../docx/export';
import { markdownDocToPptx } from '../pptx/export';
import { sanitizeOfficeHyperlink } from '../shared/officeHyperlinks';

function linkDoc(url: string): MarkdownDocument {
  return {
    type: 'document',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'link', url, children: [{ type: 'text', value: 'open' }] }],
      },
    ],
  };
}

describe('Office hyperlink safety', () => {
  it.each([
    'file:///C:/secret.txt',
    'FILE:///C:/secret.txt',
    '\\\\server\\share\\x',
    '//server/share/x',
    '/etc/passwd',
    'C:\\secret.txt',
    'd:/secret.txt',
    'folder\\secret.txt',
    'custom-scheme:payload',
    'javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,hello',
    '\u0000https://example.com',
    'https://example.com\nnext',
    'https://example.com\u007f',
    '#section two',
  ])('rejects unsafe relationship target %j', (unsafe) => {
    expect(sanitizeOfficeHyperlink(unsafe)).toBeNull();
    expect(sanitizeOfficeHyperlink(unsafe, { allowRelative: true })).toBeNull();
  });

  it.each(['safe%00name', 'safe%0Aname', 'folder%5csecret.txt', '%2f%2fserver/share', '%ZZ'])(
    'rejects encoded or malformed relative target %j',
    (unsafe) => {
      expect(sanitizeOfficeHyperlink(unsafe, { allowRelative: true })).toBeNull();
    },
  );

  it('permits explicit safe schemes, fragments, and opted-in relative navigation', () => {
    expect(sanitizeOfficeHyperlink('https://example.com')).toBe('https://example.com');
    expect(sanitizeOfficeHyperlink('HTTP://example.com/path')).toBe('HTTP://example.com/path');
    expect(sanitizeOfficeHyperlink('mailto:help@example.com')).toBe('mailto:help@example.com');
    expect(sanitizeOfficeHyperlink('tel:+12065550100')).toBe('tel:+12065550100');
    expect(sanitizeOfficeHyperlink('#section')).toBe('#section');
    expect(sanitizeOfficeHyperlink('guide.html')).toBeNull();
    expect(sanitizeOfficeHyperlink('guide.html', { allowRelative: true })).toBe('guide.html');
    expect(sanitizeOfficeHyperlink('../guide.html?chapter=1#intro', { allowRelative: true })).toBe(
      '../guide.html?chapter=1#intro',
    );
    expect(sanitizeOfficeHyperlink(null)).toBeNull();
    expect(sanitizeOfficeHyperlink(undefined)).toBeNull();
    expect(sanitizeOfficeHyperlink('   ')).toBeNull();
  });

  it.each([
    ['DOCX', async (doc: MarkdownDocument) => markdownDocToDocx(doc)],
    ['PPTX', async (doc: MarkdownDocument) => markdownDocToPptx(doc)],
  ])('%s does not write an unsafe external relationship', async (_name, exportFile) => {
    const bytes = await exportFile(linkDoc('file:///C:/secret.txt'));
    const zip = await JSZip.loadAsync(bytes);
    const relationshipFiles = Object.keys(zip.files).filter((path) => path.endsWith('.rels'));
    const relationships = await Promise.all(
      relationshipFiles.map((path) => zip.file(path)!.async('text')),
    );
    expect(relationships.join('\n')).not.toContain('file:///C:/secret.txt');
  });
});
