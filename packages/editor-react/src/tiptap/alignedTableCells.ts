/**
 * Table cells that keep GFM column alignment (`:---`, `:---:`, `---:`).
 *
 * The Markdown bridge writes a column's alignment as `style="text-align: …"`
 * on each of its cells and reads it back from there. Stock Tiptap cells keep
 * only colspan, rowspan and colwidth, so the style was dropped on parse and
 * every save rewrote aligned columns as `---`.
 */
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';

const ALIGNMENTS: ReadonlySet<string> = new Set(['left', 'center', 'right']);

const align = {
  default: null,
  parseHTML: (element: HTMLElement): string | null => {
    const value = element.style.textAlign;
    return ALIGNMENTS.has(value) ? value : null;
  },
  renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
    typeof attributes.align === 'string' && ALIGNMENTS.has(attributes.align)
      ? { style: `text-align: ${attributes.align}` }
      : {},
};

export const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), align };
  },
});

export const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), align };
  },
});
