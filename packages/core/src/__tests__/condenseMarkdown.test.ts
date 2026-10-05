import { describe, expect, it } from 'vitest';
import { condenseMarkdownSource } from '../markdown/condenseMarkdown.js';
import { applyMarkdownSourceTransform } from '../markdown/sourceTransforms.js';

describe('condenseMarkdownSource', () => {
  it('removes pathological table padding without truncating the long cell', () => {
    const long = 'Article text. '.repeat(2000).trimEnd();
    const source = `| Title${' '.repeat(180027)} |\n| ${'-'.repeat(180027)} |\n| ${long} |\n`;
    const output = condenseMarkdownSource(source);
    expect(output).toBe(`| Title |\n| --- |\n| ${long} |\n`);
    expect(output.length).toBeLessThan(source.length / 10);
    expect(condenseMarkdownSource(output)).toBe(output);
  });

  it.each([
    '| A     | B     |\n| :---- | ----: |\n| x     | y     |\n',
    'A     | B     \n:---- | :---:\nx     | y     \n',
    '| A | B |\n| --- | --- |\n| | |\n| x |\n| x | y | z |\n',
    '| A | B |\n| :---- | ----: |\n',
    '| A | B |\n| ---- | ---- |\n| a\\|b | `a\\|b` |\n',
    '| A | B |\n| ---- | ---- |\n| `  a  b  ` | $a  b$ |\n',
    '| A | B |\n| ---- | ---- |\n| [x](https://example.org/a%20b "A  title") | **c**[^n] |\n\n[^n]: A citation.\n',
    '| A | B |\n| ---- | ---- |\n| &nbsp; | 漢字 👋 |\n',
    '> | A     | B |\n> | ----- | --: |\n> | X | Y |\n',
    '- Item\n\n  | A     | B |\n  | ----- | --- |\n  | X | Y |\n',
    '| A     | B |\r\n| ----- | --- |\r\n| X | Y |\r\n',
    '| A | B |\n| ---- | --- |\n| a\\| | b |\n',
  ])('preserves cells, alignment, container syntax, and idempotence: %s', (source) => {
    const output = condenseMarkdownSource(source);
    // The API itself checks every AST property, not just visible text.
    expect(condenseMarkdownSource(output)).toBe(output);
    expect(output).not.toMatch(/-{4,}/);
  });

  it('preserves frontmatter, citations, prose, code, HTML and math byte-for-byte', () => {
    const before =
      '---\n# preserve this comment\ntitle: Original\n---\n\n# Article\n\nProse  with [a link](https://example.org) and a note[^n].\n\n';
    const after =
      '\n```md\n| A       |\n| ------- |\n```\n\n    | B       |\n    | ------- |\n\n<div>  Keep  </div>\n\n$$\na  b\n$$\n\n[^n]: Source and attribution, CC BY-SA.\n';
    const table = '| A       |\n| ------- |\n| Cell    |\n';
    expect(condenseMarkdownSource(before + table + after)).toBe(
      before + '| A |\n| --- |\n| Cell |\n' + after,
    );
  });

  it('shortens thematic breaks while preserving the separation and heading syntax', () => {
    const source =
      '# Heading\n\n************\n\nTitle\n=====\n\nText\n\n________________\n\n> - - - - -\n';
    expect(condenseMarkdownSource(source)).toBe(
      '# Heading\n\n***\n\nTitle\n=====\n\nText\n\n___\n\n> ---\n',
    );
  });

  it('leaves a document without padding or long dividers unchanged', () => {
    const source = '---\ntitle: A\n---\n\nText[^n].\n\n[^n]: Note.\n';
    expect(condenseMarkdownSource(source)).toBe(source);
  });

  it('is available through the shared CLI/editor transform registry', () => {
    const source = '| A      |\n| ------ |\n';
    const result = applyMarkdownSourceTransform('condense', source, { strict: true });
    expect(result.output).toBe('| A |\n| --- |\n');
    expect(result.changed).toBe(true);
    expect(result.degraded).toBe(false);
  });
});
