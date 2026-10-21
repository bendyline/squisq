/**
 * Opening a document is not an edit. The read-only sync calls Tiptap's
 * setEditable(), which emits `update` with an empty transaction; the editor
 * used to serialize then and report its normalized Markdown (table alignment
 * dropped, `*` bullets rewritten) as a change, so hosts saved files that were
 * only opened.
 */
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { EditorShell } from '../EditorShell';

const SOURCE = `# Round trip

| Item | Qty | Price |
| :--- | :---: | ---: |
| Flour | 2 | 3.50 |

- Plain item
- [x] Done task

* Star bullet
`;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

describe('opening a document in the WYSIWYG view', () => {
  it('reports no change until the document is edited', async () => {
    const changes: string[] = [];
    const { rerender } = render(
      <EditorShell
        initialMarkdown={SOURCE}
        initialView="wysiwyg"
        onChange={(s) => changes.push(s)}
      />,
    );
    await settle();
    expect(changes.every((source) => source === SOURCE)).toBe(true);

    // Toggling read-only calls setEditable() again; still not an edit.
    rerender(
      <EditorShell
        initialMarkdown={SOURCE}
        initialView="wysiwyg"
        readOnly
        onChange={(s) => changes.push(s)}
      />,
    );
    await settle();
    expect(changes.every((source) => source === SOURCE)).toBe(true);
  });
});
