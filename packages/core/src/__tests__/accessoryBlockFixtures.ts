/**
 * Shared fixtures for accessory block tests: a corpus of documents that
 * exercise every place an accessory block can sit, and a way to put one of a
 * given type under every heading as tools write them.
 */
import { parseMarkdown } from '../markdown/index';
import type { MarkdownHeading } from '../markdown/types';
import { markdownToDoc } from '../doc/markdownToDoc';
import type { AccessoryBlockType } from '../doc/accessoryBlockTypes';
import type { Doc } from '../schemas/Doc';

export const convert = (md: string, fileName?: string): Doc =>
  markdownToDoc(parseMarkdown(md), { articleId: 'test', ...(fileName ? { fileName } : {}) });

/** Remove source positions (and the line numbers derived from them). */
export function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'position' || key === 'line' || key === 'sourceLine') continue;
    out[key] = strip(inner);
  }
  return out;
}

/** What each type's block says, before the things that must never leak out. */
const BODIES: Partial<Record<AccessoryBlockType, (index: number) => string[]>> = {
  summary: (index) => [
    `Summary ${index} {[summary passage=a${index}-1 origin=ai layout=statement]}`,
    '',
    '- A point the slide makes',
    '- Another point',
  ],
  flashcard: (index) => [
    `Card ${index} {[flashcard origin=ai passage=a${index}-1]}`,
    '',
    'The answer to the card.',
  ],
  quiz: (index) => [
    `Question ${index} {[quiz origin=ai passage=a${index}-1]}`,
    '',
    '- [ ] A wrong choice',
    '- [x] The right choice',
    '- [ ] Another wrong choice',
    '',
    'Why the right choice is right.',
  ],
};

/** An accessory block of `type`, with a few things in its body that must never leak out. */
export function accessoryBlockFixture(
  type: AccessoryBlockType,
  depth: number,
  index: number,
): string {
  const hashes = '#'.repeat(depth);
  const nested = depth < 6 ? `${'#'.repeat(depth + 1)} Nested note\n\nMore notes.\n\n` : '';
  const body = BODIES[type];
  if (!body) throw new Error(`No fixture body for accessory block type "${type}".`);
  const [title, ...rest] = body(index);
  return [
    `${hashes} ${title}`,
    ...rest,
    '',
    '![A summary picture](images/summary.png)',
    '',
    '{[audio src=audio/summary.webm anchor=document]}',
    '',
    '{[quote text="Never a slide"]}',
    '',
    `${nested}`,
  ].join('\n');
}

/**
 * The document with an accessory block of `type` (one of each, in order, for
 * several) under every heading (after the section's own text, before its
 * first sub-section, at that sub-section's depth so no level is skipped) and
 * at the top level, as tools write them.
 */
export function withAccessoryBlocks(
  md: string,
  type: AccessoryBlockType | readonly AccessoryBlockType[],
): string {
  const types = typeof type === 'string' ? [type] : type;
  const fixture = (depth: number, index: number) =>
    types.map((item) => accessoryBlockFixture(item, depth, index)).join('\n');
  const parsed = parseMarkdown(md);
  const lines = md.split('\n');
  const headings = parsed.children.filter(
    (node): node is MarkdownHeading => node.type === 'heading' && !!node.position,
  );
  const inserts: Array<{ line: number; text: string }> = [];
  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const depth = next && next.depth > heading.depth ? next.depth : heading.depth + 1;
    if (depth > 6) return;
    const line = next ? next.position!.start.line - 1 : lines.length;
    inserts.push({ line, text: fixture(depth, index + 1) });
  });
  if (headings.length > 0) {
    const first = headings[0];
    inserts.push({
      line: first.position!.start.line - 1,
      text: fixture(first.depth, 0),
    });
  }
  for (const insert of inserts.sort((a, b) => b.line - a.line)) {
    lines.splice(insert.line, 0, insert.text);
  }
  return lines.join('\n');
}

/** The document with a summary under every heading. */
export const withSummaries = (md: string): string => withAccessoryBlocks(md, 'summary');

export const DOCUMENTS: Record<string, string> = {
  plain: [
    '# Launch plan',
    '',
    'We ship the editor in March. Two teams share the work.',
    '',
    '## What ships',
    '',
    'The editor, the exporter and the slide designer ship together.',
    '',
    '## Who does what',
    '',
    '- Design owns the look',
    '- Engineering owns the exporter',
    '- Support owns the guide',
  ].join('\n'),
  preamble: [
    'Text before any heading, with a picture.',
    '',
    '![Cover](images/cover.png)',
    '',
    '## First',
    '',
    'First section.',
    '',
    '#### Skipped a level',
    '',
    'Deep text.',
    '',
    '## Second',
    '',
    'Second section.',
  ].join('\n'),
  standalone: [
    '# Story',
    '',
    'Opening line.',
    '',
    '{[quote text="A standalone quote" attribution=Ada]}',
    '',
    'Text after the quote.',
    '',
    '## Leaf',
    '',
    'Leaf text.',
    '',
    '{[statHighlight stat=40% description="Growth"]}',
    '',
    '## Another leaf',
    '',
    'More.',
  ].join('\n'),
  media: [
    '{[audio src=audio/take.webm anchor=document]}',
    '',
    '# Narrated',
    '',
    'Narration covers this.',
    '',
    '{[video src=clips/demo.mp4]}',
    '',
    '## Timed {[duration=8]}',
    '',
    'A pinned section.',
  ].join('\n'),
  containers: [
    '# Flow {[diagram]}',
    '',
    '## Start',
    '',
    '## Finish',
    '',
    '# After',
    '',
    'Closing words.[^1]',
    '',
    '[^1]: A footnote.',
  ].join('\n'),
  autoTemplates: [
    '---',
    'title: From the frontmatter',
    '---',
    '',
    '# Numbers',
    '',
    '| Region | Sales |',
    '| --- | --- |',
    '| North | 40 |',
    '| South | 25 |',
    '',
    '## Steps',
    '',
    '1. Plan',
    '2. Build',
    '3. Ship',
    '',
    '###### Deepest',
    '',
    'Level six has nowhere to nest a summary.',
  ].join('\n'),
};
