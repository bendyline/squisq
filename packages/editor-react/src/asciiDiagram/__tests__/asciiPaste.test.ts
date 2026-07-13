import { describe, expect, it } from 'vitest';
import { shouldPasteAsAsciiFence } from '../asciiPaste';

const ASCII_ART = [
  '+--------+     +--------+',
  '| Input  | --> | Output |',
  '+--------+     +--------+',
].join('\n');

const UNICODE_ART = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    │',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

describe('shouldPasteAsAsciiFence', () => {
  it('accepts bare ASCII art (which would otherwise misdetect as a GFM table)', () => {
    expect(shouldPasteAsAsciiFence(ASCII_ART)).toBe(true);
  });

  it('accepts bare Unicode box art', () => {
    expect(shouldPasteAsAsciiFence(UNICODE_ART)).toBe(true);
  });

  it('rejects a real GFM table', () => {
    const table = ['| Name | Role |', '|------|------|', '| Ada  | Eng  |'].join('\n');
    expect(shouldPasteAsAsciiFence(table)).toBe(false);
  });

  it('rejects text that already contains a fence', () => {
    expect(shouldPasteAsAsciiFence('```\n' + ASCII_ART + '\n```')).toBe(false);
  });

  it('rejects prose and empty input', () => {
    expect(shouldPasteAsAsciiFence('Just a normal paragraph of text.')).toBe(false);
    expect(shouldPasteAsAsciiFence('')).toBe(false);
  });
});
