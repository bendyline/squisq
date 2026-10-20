import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { WikiLink } from '../WikiLink';
import { LinkDialog } from '../LinkDialog';
import {
  selectedWikiLink,
  sourceWikiLink,
  wikiLinkAtElement,
  wikiEditSource,
} from '../wikiLinkEditing';
import { markdownToTiptap } from '../tiptapBridge';

afterEach(cleanup);

describe('editing wiki links', () => {
  it('finds the completed node at the caret and the exact right-clicked node', () => {
    const editor = new Editor({
      extensions: [StarterKit, WikiLink.extend({ addNodeView: undefined })],
      content: markdownToTiptap('[[first]] [[second|Second label]] after'),
    });
    try {
      editor.commands.setTextSelection(2);
      expect(selectedWikiLink(editor)).toMatchObject({
        from: 1,
        to: 2,
        target: 'first',
        label: null,
      });
      const second = editor.view.dom.querySelector('[data-wiki-link="second"]')!;
      const clicked = wikiLinkAtElement(editor, second);
      expect(clicked).toMatchObject({ target: 'second', label: 'Second label' });
      editor.commands.setNodeSelection(clicked!.from);
      expect(selectedWikiLink(editor)).toEqual(clicked);
      editor.commands.setTextSelection(9);
      expect(selectedWikiLink(editor)).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it('uses exact source positions, preserves table syntax, and ignores literal code', () => {
    const source = '---\ntitle: Test\n---\n\n| Link |\n| --- |\n| [[foo\\|Friendly]] |';
    const found = sourceWikiLink(source, source.indexOf('Friendly'));
    expect(found).toMatchObject({ target: 'foo', label: 'Friendly', inTable: true });
    expect(source.slice(found!.from, found!.to)).toBe('[[foo\\|Friendly]]');
    expect(wikiEditSource('reference/new', 'New name', found!.inTable)).toBe(
      '[[reference/new\\|New name]]',
    );
    for (const source of ['`[[foo]]`', '```md\n[[foo]]\n```', '\\[\\[foo]]']) {
      expect(sourceWikiLink(source, source.indexOf('foo'))).toBeNull();
    }
    expect(wikiEditSource('../escape', 'Label')).toBeNull();
  });

  it('prefers the completed source link at a boundary shared with the next link', () => {
    const source = '[[completed]][[next|Keep this label]]';
    expect(sourceWikiLink(source, '[[completed]]'.length)).toMatchObject({
      target: 'completed',
      label: null,
      from: 0,
      to: '[[completed]]'.length,
    });
    expect(sourceWikiLink(source, source.indexOf('Keep'))).toMatchObject({
      target: 'next',
      label: 'Keep this label',
    });
  });

  it('shows the internal target separately and focuses the optional friendly name', () => {
    const onConfirm = vi.fn();
    render(
      <LinkDialog
        kind="wiki"
        mode="update"
        initialUrl="reference/foo"
        initialText=""
        onConfirm={onConfirm}
        onClose={() => {}}
        documentLinkProvider={async () => []}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Edit wiki link' })).toBeTruthy();
    const name = screen.getByLabelText('Friendly name') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(document.activeElement).toBe(name);
    expect((screen.getByLabelText('Article target') as HTMLInputElement).value).toBe(
      'reference/foo',
    );
    expect(screen.queryByRole('tab', { name: 'URL' })).toBeNull();
    fireEvent.change(name, { target: { value: 'My friendly name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onConfirm).toHaveBeenCalledWith('My friendly name', 'reference/foo');
  });

  it('validates wiki paths and friendly names before changing an existing link', () => {
    const onConfirm = vi.fn();
    render(
      <LinkDialog
        kind="wiki"
        mode="update"
        initialUrl="foo"
        initialText="Previous label"
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    const target = screen.getByLabelText('Article target');
    const submit = screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement;
    fireEvent.change(target, { target: { value: '../escape' } });
    expect(submit.disabled).toBe(true);
    fireEvent.submit(target.closest('form')!);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(target, { target: { value: 'reference/new' } });
    fireEvent.change(screen.getByLabelText('Friendly name'), { target: { value: 'bad|name' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Friendly name'), { target: { value: '' } });
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith('', 'reference/new');
  });
});
