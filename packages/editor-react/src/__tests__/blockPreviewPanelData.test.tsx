/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { EditorProvider } from '../EditorContext';
import { BlockPreviewPanel } from '../BlockPreviewPanel';

const SIDECAR = 'report_files/data/report.csv';
const MARKDOWN = [`# Report {[dataTable src=${SIDECAR}]}`, '', `[report.csv](${SIDECAR})`].join(
  '\n',
);

describe('BlockPreviewPanel data references', () => {
  it('renders the resolved sidecar rows after the initial empty preview', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile(
      SIDECAR,
      new TextEncoder().encode('Name,Value\nAlpha,100\nBeta,200\n'),
      'text/csv',
    );

    const { container: rendered } = render(
      <EditorProvider
        initialMarkdown={MARKDOWN}
        initialView="wysiwyg"
        articleId="report"
        workspaceContainer={container}
        fileName="report_files/report.md"
      >
        <BlockPreviewPanel />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(rendered.querySelector('th')?.textContent).toBe('Name');
      expect(rendered.querySelector('td')?.textContent).toBe('Alpha');
    });
  });
});
