import React from 'react';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { WikiLink } from '../WikiLink';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

afterEach(cleanup);
function Article() {
  const editor = useEditor({
    extensions: [StarterKit, WikiLink],
    content: markdownToTiptap('See [[reference/new article]].'),
  });
  return <EditorContent editor={editor} />;
}
function PresentationSnapshot() {
  const { doc, markdownSource } = useEditorContext();
  return <output data-testid="wiki-projection">{JSON.stringify({ doc, markdownSource })}</output>;
}
describe('wiki editor', () => {
  it('drops stale presentation links when targets disappear without changing source', async () => {
    const source = 'See [[foo]].';
    const open = vi.fn(async () => {});
    const { rerender } = render(
      <EditorProvider initialMarkdown={source} wikiLinks={{ exists: async () => true, open }}>
        <PresentationSnapshot />
      </EditorProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('wiki-projection').textContent).toContain('"url":"foo.md"'),
    );
    rerender(
      <EditorProvider initialMarkdown={source} wikiLinks={{ exists: async () => false, open }}>
        <PresentationSnapshot />
      </EditorProvider>,
    );
    await waitFor(() => {
      const snapshot = screen.getByTestId('wiki-projection').textContent;
      expect(snapshot).toContain('"url":""');
      expect(snapshot).not.toContain('"url":"foo.md"');
      expect(snapshot).toContain(source);
    });
    expect(open).not.toHaveBeenCalled();
  });
  it('round-trips an atomic node without escaping names or changing code', () => {
    const source = 'See [[my_notes]] and [[reference/A & B]]. `[[code]]`';
    const editor = new Editor({
      extensions: [StarterKit, WikiLink.extend({ addNodeView: undefined })],
      content: markdownToTiptap(source),
    });
    try {
      expect(tiptapToMarkdown(editor.getHTML()).trim()).toBe(source);
    } finally {
      editor.destroy();
    }
  });
  it('shows a create action, and creates only on activation', async () => {
    const open = vi.fn(async () => {});
    render(
      <EditorProvider wikiLinks={{ exists: async () => false, open }}>
        <Article />
      </EditorProvider>,
    );
    const link = await screen.findByRole('button', {
      name: 'Create article: reference/new article',
    });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(link);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('reference/new article', { create: true }),
    );
  });
  it('keeps lookup failures visible and does not enable creation', async () => {
    const open = vi.fn(async () => {});
    render(
      <EditorProvider
        wikiLinks={{
          exists: async () => {
            throw new Error('Permission denied');
          },
          open,
        }}
      >
        <Article />
      </EditorProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
