import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { createSourceBaseline, preserveSource } from '../sourcePreservation';

/**
 * The Write view used to save the bridge's normalized serialization of the
 * whole document after any edit, rewriting (and in places damaging) content
 * the user never touched. `preserveSource` keeps the original bytes of every
 * region an edit did not reach. These tests use the string bridge as the
 * normalizer; `wysiwygSourcePreservation.test.tsx` runs the real editor.
 */

const normalize = (md: string): string => tiptapToMarkdown(markdownToTiptap(md));

/** Load `original`, apply `edit` to its normalized form, save. */
function saveAfter(original: string, edit: (normalized: string) => string): string {
  const normalized = normalize(original);
  const baseline = createSourceBaseline(original, normalized);
  return preserveSource(baseline, edit(normalized));
}

const README = [
  'Project Readme',
  '==============',
  '',
  '[![Build](https://img.shields.io/badge/build-passing-green.svg)](https://example.com/ci)',
  '',
  'Some intro text with __bold underscores__ and _italic underscores_.',
  '',
  'Install',
  '-------',
  '',
  '* first star bullet',
  '* second star bullet',
  '',
  '| Option      | Default | Description       |',
  '|:------------|:-------:|------------------:|',
  '| `--verbose` | `false` | Print more output |',
  '',
  '~~~bash',
  'npm install --save my-package',
  '~~~',
  '',
  '```js title="x.js"',
  'const a = 1;',
  '```',
  '',
  '> [!NOTE]',
  '> GitHub alert body.',
  '',
  '> Outer quote',
  '',
  '[docs]: https://example.com/docs',
  '',
  'Last line of the readme.',
  '',
].join('\n');

describe('preserveSource', () => {
  it('returns the original byte for byte when nothing was edited', () => {
    expect(saveAfter(README, (n) => n)).toBe(README);
  });

  it('changes only the edited line', () => {
    const saved = saveAfter(README, (n) =>
      n.replace('Last line of the readme.', 'Last line of the readme, edited.'),
    );
    expect(saved).toBe(
      README.replace('Last line of the readme.', 'Last line of the readme, edited.'),
    );
  });

  it('keeps an original code fence opener while its body is edited', () => {
    const saved = saveAfter(README, (n) => n.replace('const a = 1;', 'const a = 2;'));
    expect(saved).toContain('```js title="x.js"\nconst a = 2;\n```');
    expect(saved).toBe(README.replace('const a = 1;', 'const a = 2;'));
  });

  it('never splices a normalized fence opener onto an original closer', () => {
    // The original opens with ~~~; the editor normalizes that to ```. Changing
    // the opener in the editor must not leave the original ~~~ closer behind
    // a ``` opener, which would never close.
    const original = 'Intro.\n\n~~~bash\nnpm install\n~~~\n\nAfter.\n';
    const normalized = 'Intro.\n\n```bash\nnpm install\n```\n\nAfter.\n';
    const baseline = createSourceBaseline(original, normalized);
    const edited = normalized.replace('```bash', '```sh');
    const saved = preserveSource(baseline, edited);
    expect(saved).toBe(edited);
  });

  it('inserts a new paragraph between untouched blocks', () => {
    const saved = saveAfter(README, (n) =>
      n.replace('> Outer quote\n', '> Outer quote\n\nA brand new paragraph.\n'),
    );
    expect(saved).toContain('A brand new paragraph.');
    // Everything else is still the original source.
    expect(saved.replace('\nA brand new paragraph.\n', '')).toBe(README);
  });

  it('re-serializes only the block an edit touched', () => {
    // Deleting a list item rewrites that list in the editor's dialect; the
    // setext heading, underscores and padded table around it keep theirs.
    const saved = saveAfter(README, (n) => n.replace('- second star bullet\n', ''));
    expect(saved).toBe(
      README.replace('* first star bullet\n* second star bullet', '- first star bullet'),
    );
  });

  it('keeps original text the editor never showed beside an untouched neighbour', () => {
    // Suppose a comment normalized away entirely: it has no normalized lines.
    const original = 'Intro.\n\n<!-- maintainer note -->\n\nBody.\n\nOutro.\n';
    const normalized = 'Intro.\n\nBody.\n\nOutro.\n';
    const baseline = createSourceBaseline(original, normalized);
    // Editing the block after it keeps it after the untouched block before it.
    expect(preserveSource(baseline, normalized.replace('Body.', 'Body, edited.'))).toBe(
      original.replace('Body.', 'Body, edited.'),
    );
    // Deleting both of its neighbours removes it with them.
    expect(preserveSource(baseline, 'Outro.\n')).toBe('Outro.\n');
  });

  it('never joins a kept line onto the next block when the line between is deleted', () => {
    // The bridge gives each line of a soft-wrapped paragraph its own
    // paragraph. Deleting the last one must not leave the first glued to the
    // thematic break, which would make it a setext heading.
    const original = 'Para line one\nPara line two\n\n---\n\nAfter.\n';
    const saved = saveAfter(original, (n) => n.replace('Para line two\n\n', ''));
    expect(saved).toBe('Para line one\n\n---\n\nAfter.\n');
    expect(normalize(saved)).toBe(normalize(original).replace('Para line two\n\n', ''));
  });

  it('keeps a missing final newline when the end is untouched', () => {
    const original = 'Title\n=====\n\nFirst.\n\nNo newline at the end.';
    const saved = saveAfter(original, (n) => n.replace('First.', 'First, edited.'));
    expect(saved).toBe('Title\n=====\n\nFirst, edited.\n\nNo newline at the end.');
  });

  it('round-trips a CRLF document and gives new lines its line ending', () => {
    const original = README.replace(/\n/g, '\r\n');
    expect(saveAfter(original, (n) => n)).toBe(original);
    const saved = saveAfter(original, (n) =>
      n.replace('Last line of the readme.', 'Edited last line.\n\nAnd one more.'),
    );
    expect(saved).toBe(
      README.replace('Last line of the readme.', 'Edited last line.\n\nAnd one more.').replace(
        /\n/g,
        '\r\n',
      ),
    );
  });

  it('is a pass-through when the source is already normalized', () => {
    const original = '# Title\n\nParagraph.\n';
    expect(normalize(original)).toBe(original);
    expect(saveAfter(original, (n) => n.replace('Paragraph.', 'Changed.'))).toBe(
      '# Title\n\nChanged.\n',
    );
  });
});

/**
 * Real-world Markdown (this repository's own READMEs and guides) with
 * deterministic edits. Whatever is preserved, the editor must read the saved
 * file back exactly as it holds the edited document — preservation may keep
 * original bytes, never change what the document says.
 */
describe('preserveSource on real documents', () => {
  const repoRoot = resolve(__dirname, '../../../..');
  const files = [
    'README.md',
    'CONTRIBUTING.md',
    'MIGRATION.md',
    ...readdirSync(join(repoRoot, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/${name}`),
    ...['core', 'editor-react', 'formats', 'react', 'graph', 'video', 'cli'].map(
      (pkg) => `packages/${pkg}/README.md`,
    ),
  ];

  // Deterministic edits: change, insert after, and delete a few lines.
  function* edits(normalized: string): Generator<[string, string]> {
    const lines = normalized.split('\n');
    const prose = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^[A-Za-z]/.test(line) && line.length > 20);
    for (const { line, index } of prose.filter((_, k) => k % 7 === 3).slice(0, 4)) {
      const changed = [...lines];
      changed[index] = line.replace(/\b(\w+)\b/, '$1 edited');
      yield [`change line ${index}`, changed.join('\n')];
      const inserted = [...lines];
      inserted.splice(index + 1, 0, '', 'An inserted paragraph.');
      yield [`insert after ${index}`, inserted.join('\n')];
      // Deleting a paragraph removes its separator with it, as the editor does.
      const deleted = [...lines];
      deleted.splice(index, lines[index + 1] === '' ? 2 : 1);
      yield [`delete paragraph ${index}`, deleted.join('\n')];
    }
  }

  for (const file of files) {
    it(`preserves untouched content of ${file} without changing its meaning`, () => {
      const original = readFileSync(join(repoRoot, file), 'utf8');
      const normalized = normalize(original);
      const baseline = createSourceBaseline(original, normalized);
      expect(preserveSource(baseline, normalized)).toBe(original);
      for (const [label, edited] of edits(normalized)) {
        const saved = preserveSource(baseline, edited);
        // Loading the saved file gives back exactly what the editor held.
        expect(normalize(saved), `${file}: ${label}`).toBe(edited);
      }
    });
  }
});
