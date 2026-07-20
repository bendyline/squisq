import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index';
import { markdownToDoc, getBlockBodyText } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';
import type { Block } from '../schemas/Doc';

const toDoc = (md: string) => markdownToDoc(parseMarkdown(md));
const roundTrip = (md: string) => stringifyMarkdown(docToMarkdown(toDoc(md)));
const byTitle = (blocks: Block[], title: string) => blocks.find((b) => b.title === title);

describe('body-annotation promotion — parse', () => {
  it('promotes a whole-paragraph tag right after the heading', () => {
    const doc = toDoc('# Troops Ashore\n\n{[statHighlight stat="156,000" colorScheme=blue]}\n');
    const block = doc.blocks[0];
    expect(block.template).toBe('statHighlight');
    expect(block.templateOverrides).toMatchObject({ stat: '156,000', colorScheme: 'blue' });
    expect(block.promotedBodyAnnotation?.origin.kind).toBe('paragraph');
    // The tag no longer lingers as literal body content.
    expect(getBlockBodyText(block)).not.toContain('{[');
  });

  it('promotes a tag glued to the end of a body paragraph (trailing token)', () => {
    const doc = toDoc(
      '# D-Day\n\nThe Normandy Landings\n{[title subtitle="The Normandy Landings"]}\n',
    );
    const block = doc.blocks[0];
    expect(block.template).toBe('title');
    expect(block.templateOverrides).toEqual({ subtitle: 'The Normandy Landings' });
    expect(block.promotedBodyAnnotation?.origin.kind).toBe('trailing');
    // The real body text survives; only the tag is stripped.
    const text = getBlockBodyText(block);
    expect(text).toContain('The Normandy Landings');
    expect(text).not.toContain('{[');
  });

  it('promotes a bare {[list]} trailing a list (icon collision resolved)', () => {
    const doc = toDoc('# Five Beaches\n\n- Utah\n- Omaha\n\n{[list]}\n');
    const block = doc.blocks[0];
    expect(block.template).toBe('list');
    expect(block.promotedBodyAnnotation?.template).toBe('list');
    // The list items are preserved as the block body.
    expect(getBlockBodyText(block)).toContain('Utah');
  });

  it('applies block-meta params (duration) while promoting', () => {
    const doc = toDoc('# H\n\nText\n{[factCard duration=8]}\n');
    const block = doc.blocks[0];
    expect(block.template).toBe('factCard');
    expect(block.duration).toBe(8);
  });
});

describe('body-annotation promotion — lazy round-trip (unedited)', () => {
  it('keeps a whole-paragraph tag in the body, byte-identical for canonical input', () => {
    const src = '# Troops Ashore\n\n{[statHighlight stat="156,000"]}\n';
    const out = roundTrip(src);
    expect(out).toContain('{[statHighlight stat="156,000"]}');
    expect(out).not.toContain('# Troops Ashore {['); // NOT relocated to the heading
    expect(out).toBe(src);
  });

  it('keeps a trailing-token tag glued to its paragraph, byte-identical', () => {
    const src = '# D-Day\n\nThe Normandy Landings\n{[title subtitle="The Normandy Landings"]}\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('is stable (idempotent) even for non-canonical input', () => {
    const src = '# D-Day\nThe Normandy Landings\n{[title subtitle="x"]}\n';
    const once = roundTrip(src);
    expect(roundTrip(once)).toBe(once);
    expect(once).not.toMatch(/#[^\n]*\{\[/); // tags never migrated to headings
  });
});

describe('body-annotation promotion — fix on edit', () => {
  it('relocates the tag onto the heading when the template changes', () => {
    const doc = toDoc('# D-Day\n\nText\n{[title subtitle="x"]}\n');
    doc.blocks[0].template = 'quote';
    const out = stringifyMarkdown(docToMarkdown(doc));
    expect(out).toContain('# D-Day {[quote'); // moved to the heading
    expect(out).not.toContain('\n{[quote'); // gone from the body
  });

  it('relocates onto the heading when a param changes', () => {
    const doc = toDoc('# H\n\n{[statHighlight stat="1"]}\n');
    doc.blocks[0].templateOverrides = { stat: '2' };
    const out = stringifyMarkdown(docToMarkdown(doc));
    // `2` needs no quoting, so the serializer emits it bare.
    expect(out).toContain('# H {[statHighlight stat=2]}');
    expect(out).not.toContain('\n{[statHighlight'); // no longer in the body
  });
});

describe('body-annotation promotion — non-promotion (existing behavior preserved)', () => {
  it('does not promote when content follows the tag (stays a heading-less block)', () => {
    const doc = toDoc('# One\n\n{[quote]}\n\nquoted\n');
    expect(doc.blocks[0].promotedBodyAnnotation).toBeUndefined();
    const standalone = doc.blocks.find((b) => b.standaloneAnnotation);
    expect(standalone?.template).toBe('quote');
  });

  it('does not promote when there are multiple body tags', () => {
    const doc = toDoc('# Gallery\n\n{[quote]}\n\n{[statHighlight]}\n');
    expect(doc.blocks[0].promotedBodyAnnotation).toBeUndefined();
    expect(doc.blocks.filter((b) => b.standaloneAnnotation)).toHaveLength(2);
  });

  it('does not promote onto an already-annotated heading', () => {
    const doc = toDoc('# H {[sectionHeader]}\n\n{[quote]}\n');
    expect(doc.blocks[0].template).toBe('sectionHeader');
    expect(doc.blocks[0].promotedBodyAnnotation).toBeUndefined();
  });

  it('does not promote an unknown template name', () => {
    const doc = toDoc('# H\n\nText\n{[notARealTemplate]}\n');
    expect(doc.blocks[0].promotedBodyAnnotation).toBeUndefined();
  });
});

describe('body-annotation promotion — D-Day-shaped fixture', () => {
  const DDAY = [
    '# D-Day',
    'The Normandy Landings',
    '{[title subtitle="The Normandy Landings"]}',
    '',
    '# Troops Ashore',
    '{[statHighlight stat="156,000" colorScheme=blue]}',
    '',
    '# What Was D-Day?',
    '',
    '- The Allied invasion',
    '- Operation Neptune',
    '',
    '{[list]}',
    '',
  ].join('\n');

  it('understands every misplaced tag', () => {
    const doc = toDoc(DDAY);
    expect(byTitle(doc.blocks, 'D-Day')?.template).toBe('title');
    expect(byTitle(doc.blocks, 'Troops Ashore')?.template).toBe('statHighlight');
    expect(byTitle(doc.blocks, 'What Was D-Day?')?.template).toBe('list');
  });

  it('renders no literal tag text and no stray heading tags', () => {
    const doc = toDoc(DDAY);
    for (const block of doc.blocks) {
      expect(getBlockBodyText(block)).not.toContain('{[');
    }
    const once = roundTrip(DDAY);
    expect(roundTrip(once)).toBe(once); // stable
    expect(once).not.toMatch(/#[^\n]*\{\[/); // tags stayed in the body
  });
});
