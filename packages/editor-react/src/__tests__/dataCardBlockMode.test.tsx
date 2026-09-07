/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { EditorShell } from '../EditorShell';

const SIDECAR = 'pg-catalog_files/data/pg_catalog.csv';
const MARKDOWN = [
  '# pg\\_catalog {[dataTable src=pg-catalog\\_files/data/pg\\_catalog.csv]}',
  '',
  '[pg\\_catalog.csv](pg-catalog_files/data/pg\\_catalog.csv)',
].join('\n');

describe('data card in block-at-a-time layout', () => {
  it('mounts the linked data card in the Write pane', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile(
      SIDECAR,
      new TextEncoder().encode('Name,Value\nAlpha,100\nBeta,200\n'),
      'text/csv',
    );

    const { container: rendered } = render(
      <EditorShell
        initialMarkdown={MARKDOWN}
        initialView="wysiwyg"
        workspaceContainer={container}
        fileName="pg_catalog_files/pg-catalog.md"
        viewPreferences={{ layoutMode: 'block' }}
        readOnly
        showStatusBar={false}
      />,
    );

    await waitFor(() => {
      expect(rendered.querySelector('.squisq-data-card-host')).toBeTruthy();
      expect(rendered.querySelector('.squisq-data-card-name')?.textContent).toBe('pg_catalog.csv');
      expect(rendered.querySelector('.squisq-data-card-grid')).toBeTruthy();
      // jsdom has no layout viewport, so TanStack Virtual deliberately emits
      // no body rows here. The status still proves that the CSV was ingested
      // by the mounted grid rather than merely recognized as a link.
      expect(rendered.textContent).toContain('2 rows, 2 columns');
    });
  });
});
