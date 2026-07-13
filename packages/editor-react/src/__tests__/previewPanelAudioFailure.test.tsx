/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';

const resolveAudioMapping = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('timing.json is corrupt');
  }),
);

vi.mock('@bendyline/squisq/doc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bendyline/squisq/doc')>()),
  resolveAudioMapping,
}));

import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider } from '../PreviewControls';
import { PreviewPanel } from '../PreviewPanel';

function Harness({ container }: { container: MemoryContentContainer }) {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <PreviewPanel workspaceContainer={container} />
    </PreviewSettingsProvider>
  );
}

describe('PreviewPanel optional audio mapping', () => {
  it('keeps the synchronous preview when audio discovery rejects', async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const container = new MemoryContentContainer();
    const view = render(
      <EditorProvider initialMarkdown="# Preview\n\nBody" initialView="preview">
        <Harness container={container} />
      </EditorProvider>,
    );
    await waitFor(() => expect(resolveAudioMapping).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId('preview-panel').textContent).not.toContain('No content');
    });
    view.unmount();
    load.mockRestore();
  });
});
