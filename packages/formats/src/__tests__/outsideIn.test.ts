import { describe, expect, it } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  chooseOutsideInMarkdownPath,
  importOutsideInDocument,
  isOutsideInMarkdownEditingEnabled,
  readOutsideInMetadata,
  readOutsideInOutputTemplate,
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

  it('reads the page template a companion names, or its opt-out', () => {
    const page = (value: string) => `---\nsquisq-output-template: ${value}\n---\n# Post\n`;
    expect(readOutsideInOutputTemplate(page('/_templates/post.html'))).toBe(
      '/_templates/post.html',
    );
    expect(readOutsideInOutputTemplate(page('../../_templates/post.html'))).toBe(
      '../../_templates/post.html',
    );
    expect(readOutsideInOutputTemplate(page('None'))).toBe('none');
    expect(readOutsideInOutputTemplate('# No frontmatter\n')).toBeNull();
    expect(readOutsideInOutputTemplate(page('""'))).toBeNull();
  });

  it('imports HTML into a frontmatter-linked Markdown source', async () => {
    const imported = await importOutsideInDocument({
      targetPath: 'battle-of-britain.html',
      data: new TextEncoder().encode('<h1>Battle of Britain</h1><p>Never was so much owed.</p>'),
    });
    expect(imported.markdown).toContain('# Battle of Britain');
    expect(readOutsideInMetadata(imported.markdown)?.format).toBe('html');
  });

  it('round-trips CSV through an editable Markdown table', async () => {
    const imported = await importOutsideInDocument({
      targetPath: 'data/Inventory.csv',
      data: new TextEncoder().encode('Item,Qty\nWidget,2\n'),
    });
    expect(imported.layout).toMatchObject({
      format: 'csv',
      markdownPath: 'data/Inventory_files/inventory.md',
      backupPath: 'data/Inventory_files/.original/original.csv',
    });
    expect(imported.markdown).toContain('| Item');
    expect(imported.markdown).toContain('| Widget');
    expect(readOutsideInMetadata(imported.markdown)?.format).toBe('csv');

    const rendered = await renderOutsideInDocument({
      targetPath: imported.layout.targetPath,
      markdown: withOutsideInMarkdownEditing(imported.markdown, imported.layout),
      container: imported.container,
    });
    expect(new TextDecoder().decode(rendered.bytes)).toBe('Item,Qty\r\nWidget,2');
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

  describe('diagrams and data in rendered documents', () => {
    /** A valid 1×1 PNG. */
    const PNG = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ),
      (char) => char.charCodeAt(0),
    );
    const SOURCE = [
      '# Plan',
      '',
      '```mermaid',
      'flowchart LR',
      '  a --> b',
      '```',
      '',
      '## Ledger {[dataTable src=plan_files/data/ledger.csv]}',
      '',
      '[ledger.csv](plan_files/data/ledger.csv)',
      '',
    ].join('\n');

    async function render(targetPath: string, withRenderer: boolean) {
      const container = new MemoryContentContainer();
      const rows = ['Item,Qty', ...Array.from({ length: 150 }, (_, i) => `Item ${i + 1},${i}`)];
      await container.writeFile(
        'plan_files/data/ledger.csv',
        Uint8Array.from(`${rows.join('\n')}\n`, (char) => char.charCodeAt(0)),
      );
      const kinds: string[] = [];
      const result = await renderOutsideInDocument(
        {
          targetPath,
          markdown: withOutsideInMarkdownEditing(SOURCE, resolveOutsideInLayout(targetPath)!),
          container,
        },
        withRenderer
          ? {
              renderDiagram: async (diagram) => {
                kinds.push(diagram.kind);
                return { data: PNG, width: 300, height: 120 };
              },
            }
          : {},
      );
      return { result, kinds };
    }

    async function wordXml(bytes: Uint8Array): Promise<string> {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(bytes);
      return (await zip.file('word/document.xml')?.async('string')) ?? '';
    }

    it('gives Word a picture of each diagram and a preview of each data table', async () => {
      const { result, kinds } = await render('Plan.docx', true);
      expect(kinds).toEqual(['mermaid']);
      const xml = await wordXml(result.bytes);
      expect(xml).toContain('<pic:pic');
      expect(xml).not.toContain('flowchart LR');
      expect(xml).toContain('Item 100');
      expect(xml).not.toContain('Item 101');
      expect(xml).toContain('Showing 100 of 150 rows.');
    });

    it('keeps diagrams as source without a renderer', async () => {
      const { result } = await render('Plan.docx', false);
      const xml = await wordXml(result.bytes);
      expect(xml).toContain('flowchart LR');
      expect(xml).toContain('Item 100');
    });

    it('asks a PowerPoint target only for the diagrams its shapes cannot draw', async () => {
      const { kinds } = await render('Plan.pptx', true);
      expect(kinds).toEqual(['mermaid']);
    });
  });
});
