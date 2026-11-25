/**
 * Slide summaries (accessory blocks) fold in the Source view: each from its
 * heading to the next heading at its level or shallower, folded when the
 * document opens and left open when typed later. Documents without any keep
 * Monaco's own folding.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';
import { accessoryFoldingRanges, registerMarkdownAccessoryFolding } from '../monacoMarkdownFolding';

const SOURCE = [
  '## Results', // 1
  '', // 2
  'Revenue grew.', // 3
  '', // 4
  '### Revenue grew {[summary]}', // 5
  '', // 6
  '- Up 40%', // 7
  '', // 8
  '#### Inside the summary', // 9
  '', // 10
  'A note.', // 11
  '', // 12
  '### Later {[summary passage=abc-1 hidden=true]}', // 13
  '', // 14
  '```md', // 15
  '## Not a heading {[summary]}', // 16
  '```', // 17
  '', // 18
  '## Plan', // 19
  '', // 20
  '### Hand typed {[summary]}', // 21
].join('\n');

describe('accessory folding ranges', () => {
  it('folds each summary to its heading, nested headings included, never a fence', () => {
    const lines = SOURCE.split('\n');
    const fenced = (line: number) => line >= 15 && line <= 17;
    expect(accessoryFoldingRanges(lines, fenced)).toEqual([
      { start: 5, end: 11 },
      { start: 13, end: 17 },
    ]);
  });

  it('has nothing to fold in a document without summaries', () => {
    expect(accessoryFoldingRanges(['# A', '', 'Text.', '', '## B'])).toEqual([]);
  });
});

describe('the folding provider', () => {
  function fakeMonaco() {
    let provider: Monaco.languages.FoldingRangeProvider | null = null;
    const monaco = {
      languages: {
        FoldingRangeKind: { Imports: { value: 'imports' } },
        registerFoldingRangeProvider: vi.fn(
          (_language: string, value: Monaco.languages.FoldingRangeProvider) => {
            provider = value;
            return { dispose() {} };
          },
        ),
      },
    } as unknown as typeof Monaco;
    return {
      monaco,
      provide: (model: unknown) =>
        provider!.provideFoldingRanges(model as Monaco.editor.ITextModel, {} as never, {} as never),
    };
  }
  function model(text: string) {
    let version = 1;
    let value = text;
    return {
      getValue: () => value,
      getLinesContent: () => value.split('\n'),
      getVersionId: () => version,
      set(next: string) {
        value = next;
        version += 1;
      },
    };
  }

  it('registers once, and folds what the document opened with by itself', () => {
    const { monaco, provide } = fakeMonaco();
    registerMarkdownAccessoryFolding(monaco);
    registerMarkdownAccessoryFolding(monaco);
    expect(monaco.languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(1);

    const doc = model(SOURCE);
    const first = provide(doc) as Monaco.languages.FoldingRange[];
    expect(first.map((range) => range.kind)).toEqual([
      monaco.languages.FoldingRangeKind.Imports,
      monaco.languages.FoldingRangeKind.Imports,
    ]);
    doc.set(`${SOURCE}\n\nMore`);
    const later = provide(doc) as Monaco.languages.FoldingRange[];
    expect(later.every((range) => range.kind === undefined)).toBe(true);
  });

  it('leaves a document without summaries to Monaco, and folds none typed later', () => {
    const { monaco, provide } = fakeMonaco();
    registerMarkdownAccessoryFolding(monaco);
    const doc = model('# A\n\nText.');
    expect(provide(doc)).toBeNull();
    doc.set('# A\n\nText.\n\n## Typed {[summary]}\n\n- point');
    const ranges = provide(doc) as Monaco.languages.FoldingRange[];
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.kind).toBeUndefined();
  });
});
