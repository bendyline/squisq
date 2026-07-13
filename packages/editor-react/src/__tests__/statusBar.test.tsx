import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../EditorContext';
import { StatusBar } from '../StatusBar';

function renderStatusBar(markdown: string) {
  return render(
    <EditorProvider initialMarkdown={markdown} articleId="status-bar-test">
      <StatusBar />
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
});
