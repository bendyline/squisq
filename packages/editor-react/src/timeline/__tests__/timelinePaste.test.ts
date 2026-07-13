import { describe, expect, it } from 'vitest';
import { shouldPasteAsTimelineFence } from '../timelinePaste';

const MULTI_TRACK = [
  'Kernel: ● T28 {#t28} ─────● T29 {#t29} ─────►',
  'Client: ○ F28 {#f28} ─────● F29 {#f29} ─────►',
  'branch: t29 -> f29 : interpolate',
].join('\n');

describe('shouldPasteAsTimelineFence', () => {
  it('accepts bare, high-confidence Unicode timeline art', () => {
    expect(shouldPasteAsTimelineFence(MULTI_TRACK)).toBe(true);
    expect(shouldPasteAsTimelineFence('     ┌─ warmup\n────●────●────►')).toBe(true);
  });

  it('rejects already-fenced input, sparse ASCII, prose, and blank text', () => {
    expect(shouldPasteAsTimelineFence(`\`\`\`timeline\n${MULTI_TRACK}\n\`\`\``)).toBe(false);
    expect(shouldPasteAsTimelineFence('Release: *---- Alpha {#alpha} ---->')).toBe(false);
    expect(shouldPasteAsTimelineFence('Release planning -- Alpha -> Beta')).toBe(false);
    expect(shouldPasteAsTimelineFence('   \n\t')).toBe(false);
  });

  it('does not steal Markdown tables, trees, or box diagrams', () => {
    const table = ['| Milestone | Date |', '| --- | --- |', '| Alpha | Monday |'].join('\n');
    const tree = ['root/', '├── src/', '│   └── index.ts', '└── README.md'].join('\n');
    const diagram = ['┌─────┐', '│ A   │', '└──┬──┘', '   ▼', '┌─────┐', '│ B   │', '└─────┘'].join(
      '\n',
    );

    expect(shouldPasteAsTimelineFence(table)).toBe(false);
    expect(shouldPasteAsTimelineFence(tree)).toBe(false);
    expect(shouldPasteAsTimelineFence(diagram)).toBe(false);
  });
});
