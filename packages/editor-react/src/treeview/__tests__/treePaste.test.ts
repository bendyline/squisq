import { describe, expect, it } from 'vitest';
import { shouldPasteAsTreeFence } from '../treePaste';

const FILE_TREE = ['src/', '├── index.ts', '├── utils/', '│   └── math.ts', '└── config.ts'].join(
  '\n',
);
const ASCII_TREE = ['root', '|-- a', '|-- b', '`-- c'].join('\n');
const BOX_DIAGRAM = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

describe('shouldPasteAsTreeFence', () => {
  it('accepts bare Unicode file-tree art', () => {
    expect(shouldPasteAsTreeFence(FILE_TREE)).toBe(true);
  });

  it('accepts bare ASCII tree art', () => {
    expect(shouldPasteAsTreeFence(ASCII_TREE)).toBe(true);
  });

  it('rejects a box diagram (belongs to the diagram gate)', () => {
    expect(shouldPasteAsTreeFence(BOX_DIAGRAM)).toBe(false);
  });

  it('rejects a GFM table', () => {
    expect(shouldPasteAsTreeFence(['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n'))).toBe(false);
  });

  it('rejects text already containing a fence, and prose', () => {
    expect(shouldPasteAsTreeFence('```\n' + FILE_TREE + '\n```')).toBe(false);
    expect(shouldPasteAsTreeFence('just a normal paragraph of text')).toBe(false);
    expect(shouldPasteAsTreeFence('')).toBe(false);
  });
});
