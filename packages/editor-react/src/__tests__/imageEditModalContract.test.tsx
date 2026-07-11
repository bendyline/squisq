/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { useEditorContext } from '../EditorContext';

const imageEditorProps: Array<{
  filesContainer: ContentContainer;
  saveFormat: 'png' | 'jpeg' | 'webp';
  onExport: (blob: Blob, format: 'png' | 'jpeg' | 'webp') => void;
}> = [];

vi.mock('../ImageEditor', () => ({
  ImageEditor: (props: (typeof imageEditorProps)[number]) => {
    imageEditorProps.push(props);
    return <div data-testid="image-editor-contract-stub" />;
  },
}));
vi.mock('../RawEditor', () => ({ RawEditor: () => <div /> }));
vi.mock('../WysiwygEditor', () => ({ WysiwygEditor: () => <div /> }));
vi.mock('../PreviewPanel', () => ({ PreviewPanel: () => <div /> }));

import { EditorShell } from '../EditorShell';

function Trigger({ path }: { path: string }) {
  const { openImageEdit } = useEditorContext();
  return <button onClick={() => openImageEdit(path)}>edit</button>;
}

function provider(): MediaProvider {
  return {
    addMedia: vi.fn(async (name: string) => name),
    resolveUrl: vi.fn(async (name: string) => `blob:${name}`),
    listMedia: vi.fn(async () => []),
    removeMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  imageEditorProps.length = 0;
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
  }
});

describe('ImageEditModal storage contract', () => {
  it('writes JPEG bytes/MIME back to a .jpg path', async () => {
    const mediaProvider = provider();
    render(
      <EditorShell
        initialMarkdown="# image"
        mediaProvider={mediaProvider}
        toolbarSlotRight={<Trigger path="photo.jpg" />}
      />,
    );
    fireEvent.click(screen.getByText('edit'));
    await waitFor(() => expect(screen.getByTestId('image-editor-contract-stub')).toBeTruthy());
    const props = imageEditorProps[imageEditorProps.length - 1]!;
    expect(props.saveFormat).toBe('jpeg');
    await act(async () => props.onExport(new Blob(['jpeg']), 'jpeg'));
    expect(mediaProvider.addMedia).toHaveBeenCalledWith(
      'photo.jpg',
      expect.any(Blob),
      'image/jpeg',
    );
  });

  it('hashes sidecar paths so sanitized-name collisions remain separate', async () => {
    const parent = new MemoryContentContainer();
    const mediaProvider = provider();
    const first = render(
      <EditorShell
        initialMarkdown="# image"
        workspaceContainer={parent}
        mediaProvider={mediaProvider}
        toolbarSlotRight={<Trigger path="a/b.png" />}
      />,
    );
    fireEvent.click(screen.getByText('edit'));
    await waitFor(() => expect(imageEditorProps).toHaveLength(1));
    const firstContainer = imageEditorProps[0].filesContainer;
    first.unmount();

    render(
      <EditorShell
        initialMarkdown="# image"
        workspaceContainer={parent}
        mediaProvider={mediaProvider}
        toolbarSlotRight={<Trigger path="a_b.png" />}
      />,
    );
    fireEvent.click(screen.getByText('edit'));
    await waitFor(() => expect(imageEditorProps).toHaveLength(2));
    const secondContainer = imageEditorProps[1].filesContainer;
    await firstContainer.writeFile('sentinel', new Uint8Array([1]).buffer);
    await secondContainer.writeFile('sentinel', new Uint8Array([2]).buffer);
    const paths = (await parent.listFiles('.imageEdits')).map((entry) => entry.path);
    expect(paths.filter((path) => path.endsWith('/sentinel'))).toHaveLength(2);
  });

  it('refuses unsupported source formats instead of writing mismatched bytes', async () => {
    render(
      <EditorShell
        initialMarkdown="# image"
        mediaProvider={provider()}
        toolbarSlotRight={<Trigger path="animated.gif" />}
      />,
    );
    fireEvent.click(screen.getByText('edit'));
    await waitFor(() => expect(screen.getByText(/supports PNG, JPEG, and WebP/i)).toBeTruthy());
    expect(screen.queryByTestId('image-editor-contract-stub')).toBeNull();
  });
});
