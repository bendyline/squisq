import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index.js';
import { extractPlainText } from '../markdown/utils.js';
import type { MarkdownTable, MarkdownTableCell } from '../markdown/types.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';

/** What the Write view writes when a checklist is inserted into a table cell. */
const RICH =
  '<div data-squisq-table-cell=""><p>After the table.</p><ul data-type="taskList">' +
  '<li data-checked="false" data-type="taskItem"><div><p>Book &#124; venue</p></div></li>' +
  '<li data-checked="true" data-type="taskItem"><div><p><strong>Paid</strong> deposit</p></div></li>' +
  '</ul></div>';
const MARKDOWN = `# Plan\n\n| ${RICH} | Notes |\n| --- | --- |\n| plain **cell** | x |\n`;

function firstCell(markdown: string): MarkdownTableCell {
  const table = parseMarkdown(markdown).children.find(
    (node): node is MarkdownTable => node.type === 'table',
  );
  if (!table) throw new Error('no table');
  return table.children[0].children[0];
}

describe('rich table cells', () => {
  it('read as lines with checkbox markers instead of HTML', () => {
    const cell = firstCell(MARKDOWN);
    expect(extractPlainText(cell)).toBe('After the table.\n☐ Book | venue\n☑ Paid deposit');
    expect(JSON.stringify(cell.children)).not.toContain('<');
    expect(cell.children).toContainEqual({
      type: 'strong',
      children: [{ type: 'text', value: 'Paid' }],
    });
  });

  it('write back the exact envelope the editor reopens', () => {
    const out = stringifyMarkdown(parseMarkdown(MARKDOWN));
    expect(out).toContain(`| ${RICH} |`);
    expect(out).toContain('plain **cell**');
  });

  it('leave ordinary cells alone', () => {
    const table = parseMarkdown(MARKDOWN).children.find((node) => node.type === 'table') as
      MarkdownTable | undefined;
    const plain = table?.children[1].children[0];
    expect(plain?.richHtml).toBeUndefined();
    expect(plain && extractPlainText(plain)).toBe('plain cell');
  });

  it('number ordered lists, bullet plain ones and keep line breaks', () => {
    const cell = firstCell(
      '| <div data-squisq-table-cell=""><ol><li><p>One</p></li><li><p>Two</p></li></ol>' +
        '<ul><li><p>Dot</p></li></ul><p>a<br>b</p></div> |\n| --- |\n',
    );
    expect(extractPlainText(cell)).toBe('1. One\n2. Two\n• Dot\na\nb');
  });

  it('reach the slideshow as readable text', () => {
    const preview = buildPreviewDoc(markdownToDoc(parseMarkdown(MARKDOWN)));
    // What templates draw: the table's header/row text and the cells' inline
    // children. (`richHtml` rides along only for writing Markdown back.)
    const drawn = JSON.stringify(preview.blocks, (key, value: unknown) =>
      key === 'richHtml' ? undefined : value,
    );
    expect(drawn).toContain('☐ Book | venue');
    expect(drawn).not.toContain('data-squisq-table-cell');
    expect(drawn).not.toContain('taskItem');
  });
});
