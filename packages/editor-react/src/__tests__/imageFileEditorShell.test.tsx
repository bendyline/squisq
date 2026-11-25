/** @vitest-environment jsdom */
/**
 * `<EditorShell>` wiring for outside-in image editing: an image file in
 * edit mode with `onImageWriteBack` gets the write-back editor, and
 * `allowVersioning` there is the image editor's history, never a Markdown
 * snapshot of an image file.
 */
import { forwardRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer, scopeContainer } from '@bendyline/squisq/storage';

const editorProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../ImageEditor', () => ({
  ImageEditor: forwardRef(function ImageEditorStub(props: Record<string, unknown>) {
    editorProps.push(props);
    return <div data-testid="image-editor-stub" />;
  }),
}));
vi.mock('../RawEditor', () => ({ RawEditor: () => <div data-testid="raw-editor-stub" /> }));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({ PreviewPanel: () => <div data-testid="preview-stub" /> }));

import { EditorShell } from '../EditorShell';
import { EditorProvider, useEditorContext } from '../EditorContext';

// A still PNG: signature, IHDR, IDAT, IEND (CRCs are not checked).
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 73, 68, 65, 84, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69,
  78, 68, 0, 0, 0, 0,
]);
const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

function VersioningProbe() {
  const { versioning } = useEditorContext();
  return <span data-testid="text-versioning">{versioning ? 'on' : 'off'}</span>;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  editorProps.length = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('EditorShell image editing', () => {
  it('mounts the write-back editor for an image file when the host can write it back', async () => {
    const onImageWriteBack = vi.fn(async () => {});
    render(
      <EditorShell
        fileName="shots/photo.png"
        imageSrc={PNG_URL}
        imageMode="edit"
        imageEditorContainer={scopeContainer(new MemoryContentContainer(), 'photo.png_files')}
        onImageWriteBack={onImageWriteBack}
      />,
    );
    await screen.findByTestId('image-editor-stub');
    expect(editorProps[editorProps.length - 1]).toMatchObject({
      saveBehavior: 'export',
      saveFormat: 'png',
      exportBasename: 'photo',
    });
  });

  it('keeps the layers-only editor for hosts that only export', async () => {
    render(
      <EditorShell
        fileName="photo.png"
        imageSrc={PNG_URL}
        imageMode="edit"
        imageEditorContainer={new MemoryContentContainer()}
      />,
    );
    await screen.findByTestId('image-editor-stub');
    expect(editorProps[editorProps.length - 1]?.saveBehavior).toBeUndefined();
  });

  it('builds no Markdown version history for an image file', () => {
    render(
      <EditorProvider
        fileName="photo.png"
        workspaceContainer={new MemoryContentContainer()}
        allowVersioning
      >
        <VersioningProbe />
      </EditorProvider>,
    );
    expect(screen.getByTestId('text-versioning').textContent).toBe('off');
    expect(warn).not.toHaveBeenCalled();
  });

  it('still builds it for a Markdown document', () => {
    render(
      <EditorProvider
        fileName="notes.md"
        workspaceContainer={new MemoryContentContainer()}
        allowVersioning
      >
        <VersioningProbe />
      </EditorProvider>,
    );
    expect(screen.getByTestId('text-versioning').textContent).toBe('on');
  });
});
