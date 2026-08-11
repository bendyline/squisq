import { describe, expect, it } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  chooseOutsideInMarkdownPath,
  importOutsideInDocument,
  isOutsideInMarkdownEditingEnabled,
  readOutsideInMetadata,
  renderOutsideInDocument,
  resolveOutsideInLayout,
  withOutsideInMetadata,
  withOutsideInMarkdownEditing,
} from '../outside-in/index.js';
import { buildThemedDocx } from './pptxInferFixtures.js';

describe('outside-in documents', () => {
  it('maps rendered files to case-preserving companions and slugged Markdown', () => {
    expect(resolveOutsideInLayout('decks/Tucson.pptx')).toEqual({
      targetPath: 'decks/Tucson.pptx',
      format: 'pptx',
      parentDirectory: 'decks',
      stem: 'Tucson',
      companionName: 'Tucson_files',
      companionDirectory: 'decks/Tucson_files',
      markdownFilename: 'tucson.md',
      markdownPath: 'decks/Tucson_files/tucson.md',
      relativeTargetPath: '../Tucson.pptx',
      backupDirectory: 'decks/Tucson_files/.original',
      backupFilename: 'original.pptx',
      backupPath: 'decks/Tucson_files/.original/original.pptx',
    });
  });

  it('accepts a sole legacy Markdown source when the canonical slug is absent', () => {
    const layout = resolveOutsideInLayout('reports/Quarterly Review.docx')!;
    expect(
      chooseOutsideInMarkdownPath(layout, [
        'reports/Quarterly Review_files/authored-source.md',
        'reports/Quarterly Review_files/hero.png',
      ]),
    ).toBe('reports/Quarterly Review_files/authored-source.md');
  });

  it('adds readable metadata without dropping unrelated frontmatter', () => {
    const layout = resolveOutsideInLayout('battle-of-britain.html')!;
    const source = withOutsideInMetadata(
      '---\ntitle: Battle of Britain\n---\n# Timeline\n',
      layout,
    );
    expect(source).toContain('title: Battle of Britain');
    expect(readOutsideInMetadata(source)).toEqual({
      version: 1,
      target: '../battle-of-britain.html',
      format: 'html',
      updateFromMarkdown: false,
    });
  });

  it('requires an explicit update-from-Markdown opt-in', async () => {
    const layout = resolveOutsideInLayout('reports/Quarterly Review.docx')!;
    const readOnly = withOutsideInMetadata('# Quarterly Review\n', layout);
    expect(isOutsideInMarkdownEditingEnabled(readOnly)).toBe(false);
    await expect(
      renderOutsideInDocument({ targetPath: layout.targetPath, markdown: readOnly }),
    ).rejects.toThrow('squisq-updatefrommarkdown: true');

    const editable = withOutsideInMarkdownEditing(readOnly, layout);
    expect(isOutsideInMarkdownEditingEnabled(editable)).toBe(true);
    expect(readOutsideInMetadata(editable)?.updateFromMarkdown).toBe(true);
  });

  it('imports HTML into a frontmatter-linked Markdown source', async () => {
    const imported = await importOutsideInDocument({
      targetPath: 'battle-of-britain.html',
      data: new TextEncoder().encode('<h1>Battle of Britain</h1><p>Never was so much owed.</p>'),
    });
    expect(imported.markdown).toContain('# Battle of Britain');
    expect(readOutsideInMetadata(imported.markdown)?.format).toBe('html');
  });

  it('retains an imported Office theme in the Markdown frontmatter', async () => {
    const imported = await importOutsideInDocument({
      targetPath: 'reports/Quarterly Review.docx',
      data: await buildThemedDocx(),
    });
    expect(imported.markdown).toContain('squisq-custom-themes:');
    expect(imported.markdown).toContain('squisq-theme:');
  });

  it('renders HTML against a shared runtime and companion media base', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile('hero.png', new Uint8Array([1, 2, 3]), 'image/png');
    const result = await renderOutsideInDocument(
      {
        targetPath: 'history/battle-of-britain.html',
        markdown: withOutsideInMarkdownEditing(
          '# Battle\n\n![Map](hero.png)\n',
          resolveOutsideInLayout('history/battle-of-britain.html')!,
        ),
        container,
      },
      {
        html: { playerScriptPath: '../_squisq/squisq-player.js' },
      },
    );
    const html = new TextDecoder().decode(result.bytes);
    expect(html).toContain('<script src="../_squisq/squisq-player.js"></script>');
    expect(html).toContain('basePath: "battle-of-britain_files"');
    expect(html).not.toContain('SquisqPlayer=function');
  });
});
