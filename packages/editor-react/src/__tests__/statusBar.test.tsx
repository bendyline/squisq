import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { StatusBar } from '../StatusBar';

function EditProbe() {
  const { markdownSource, setMarkdownSource, isParsing } = useEditorContext();
  return (
    <>
      <button type="button" onClick={() => setMarkdownSource(`${markdownSource} more`)}>
        Edit source
      </button>
      <output data-testid="parse-state">{String(isParsing)}</output>
    </>
  );
}

function renderStatusBar(markdown: string, slotRight?: ReactNode) {
  return render(
    <EditorProvider initialMarkdown={markdown} articleId="status-bar-test">
      <StatusBar slotRight={slotRight} />
    </EditorProvider>,
  );
}

describe('StatusBar', () => {
  it('counts nested document blocks, not only top-level roots', async () => {
    renderStatusBar('# Root\n\n## Child one\n\n### Grandchild\n\n## Child two\n');

    expect(await screen.findByText('4 blocks')).toBeTruthy();
  });

  it('uses the singular label for one block', async () => {
    renderStatusBar('# Only block\n');

    expect(await screen.findByText('1 block')).toBeTruthy();
    expect(screen.queryByText('1 blocks')).toBeNull();
  });

  it('renders host status content without exposing parse progress', () => {
    renderStatusBar('Working draft', <span>Autosave pending</span>);

    expect(screen.getByText('Autosave pending')).toBeTruthy();
    expect(screen.queryByText('Parsing…')).toBeNull();
  });

  it('keeps the last settled parse status visible while an edit is pending', async () => {
    render(
      <EditorProvider initialMarkdown="Working draft" articleId="status-bar-test">
        <StatusBar />
        <EditProbe />
      </EditorProvider>,
    );

    expect(screen.getByText('✓ OK')).toBeTruthy();
    expect(screen.getByText('13 chars')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit source' }));

    expect(screen.getByTestId('parse-state').textContent).toBe('true');
    expect(screen.getByText('✓ OK')).toBeTruthy();
    expect(screen.getByText('13 chars')).toBeTruthy();
    expect(await screen.findByText('18 chars')).toBeTruthy();
  });
});
