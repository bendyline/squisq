/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@bendyline/squisq-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq-react')>();
  return {
    ...actual,
    useMediaProvider: () => null,
    DocPlayer: () => <div data-testid="mock-doc-player" />,
    LinearDocView: () => <div data-testid="mock-linear-doc" />,
  };
});

import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider } from '../PreviewControls';
import { PreviewPanel } from '../PreviewPanel';

// A saved presentation that no longer compiles: the deck falls back to the
// sections as written, which the player alone cannot explain.
const source = (displayMode: string) => `---
display-mode: ${displayMode}
squisq-presentation: '{}'
---

# Weather

The sky is pink.
`;

function Harness() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <PreviewPanel />
    </PreviewSettingsProvider>
  );
}

function renderMode(displayMode: string) {
  return render(
    <EditorProvider initialMarkdown={source(displayMode)} initialView="preview">
      <Harness />
    </EditorProvider>,
  );
}

describe('PreviewPanel presentation notice', () => {
  it('says why the player shows the sections as written', async () => {
    renderMode('slideshow');
    await waitFor(() => expect(screen.getByTestId('mock-doc-player')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe(
      'Showing the sections as written. The saved presentation is invalid. Make the presentation again.',
    );
  });

  it('stays out of views that never play the deck', async () => {
    renderMode('page');
    await waitFor(() => expect(screen.getByTestId('mock-linear-doc')).toBeTruthy());
    expect(screen.queryByText(/Showing the sections as written/)).toBeNull();
  });
});
