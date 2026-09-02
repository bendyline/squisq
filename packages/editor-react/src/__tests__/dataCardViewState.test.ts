/** @vitest-environment jsdom */

/**
 * View-state ↔ heading binding: the grid's sort/filter persist onto the
 * OWNING heading's `{[dataTable …]}` params — and ONLY when that heading
 * really owns the sidecar (template ∈ TABLE_FED_TEMPLATES and `src` equals
 * the card's href). Repeat writes must be byte-stable through the markdown
 * emit, since every grid interaction routes through this path.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { DATA_CARD_KEY, DataCardExtension } from '../dataCard/DataCardExtension';
import {
  readHeadingViewBinding,
  viewStateFromBinding,
  writeHeadingViewState,
} from '../dataCard/viewStateBinding';
import type { TableViewState } from '@bendyline/squisq/table';

const editors: Editor[] = [];

function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      LinkWithTitle.configure({ openOnClick: false, autolink: false }),
      DataCardExtension.configure({ mediaProvider: () => null, mediaRevision: () => 0 }),
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function cardPosOf(editor: Editor): number {
  const entries = DATA_CARD_KEY.getState(editor.state)?.entries ?? [];
  if (entries.length === 0) throw new Error('no data card claimed');
  return entries[0]!.pos;
}

function emit(editor: Editor): string {
  return tiptapToMarkdown(editor.getHTML());
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const HREF = 'report_files/data/q3.csv';
const OWNED_DOC = [`## Q3 Transactions {[dataTable src=${HREF}]}`, '', `[q3.csv](${HREF})`].join(
  '\n',
);

const SORT_VIEW: TableViewState = {
  sort: [{ column: 'Revenue', dir: 'desc' }],
  filter: [],
};

describe('readHeadingViewBinding', () => {
  it('marks an owning dataTable heading as persisted', () => {
    const editor = makeEditor(OWNED_DOC);
    const binding = readHeadingViewBinding(editor, cardPosOf(editor), HREF);
    expect(binding.persisted).toBe(true);
    expect(binding.params.src).toBe(HREF);
  });

  it('reads existing sort/filter params into the binding', () => {
    const editor = makeEditor(
      [
        `## Q3 {[dataTable src=${HREF} sort=Revenue:desc filter=Region=West]}`,
        '',
        `[q3.csv](${HREF})`,
      ].join('\n'),
    );
    const binding = readHeadingViewBinding(editor, cardPosOf(editor), HREF);
    expect(binding.sortRaw).toBe('Revenue:desc');
    expect(binding.filterRaw).toBe('Region=West');
    const view = viewStateFromBinding(binding, ['Region', 'Revenue']);
    expect(view.sort).toEqual([{ column: 'Revenue', dir: 'desc' }]);
    expect(view.filter).toHaveLength(1);
  });

  it('is session-only under a template-less heading', () => {
    const editor = makeEditor(['## Plain heading', '', `[q3.csv](${HREF})`].join('\n'));
    const binding = readHeadingViewBinding(editor, cardPosOf(editor), HREF);
    expect(binding.persisted).toBe(false);
  });

  it('is session-only when the heading src names a different sidecar', () => {
    const editor = makeEditor(
      ['## Other {[dataTable src=report_files/data/other.csv]}', '', `[q3.csv](${HREF})`].join(
        '\n',
      ),
    );
    const binding = readHeadingViewBinding(editor, cardPosOf(editor), HREF);
    expect(binding.persisted).toBe(false);
  });

  it('is session-only under a non-table template', () => {
    const editor = makeEditor(
      [`## Quote {[quote src=${HREF}]}`, '', `[q3.csv](${HREF})`].join('\n'),
    );
    const binding = readHeadingViewBinding(editor, cardPosOf(editor), HREF);
    expect(binding.persisted).toBe(false);
  });
});

describe('writeHeadingViewState', () => {
  it('writes sort onto the annotation and emits it in markdown', () => {
    const editor = makeEditor(OWNED_DOC);
    expect(writeHeadingViewState(editor, cardPosOf(editor), HREF, SORT_VIEW)).toBe(true);
    const markdown = emit(editor);
    expect(markdown).toContain('sort=Revenue:desc');
    expect(markdown).toContain(`src=${HREF}`);
  });

  it('repeat writes of the same view are byte-stable', () => {
    const editor = makeEditor(OWNED_DOC);
    writeHeadingViewState(editor, cardPosOf(editor), HREF, SORT_VIEW);
    const first = emit(editor);
    writeHeadingViewState(editor, cardPosOf(editor), HREF, SORT_VIEW);
    expect(emit(editor)).toBe(first);
    // `sort=` appears exactly once — updated in place, never appended twice.
    expect(first.match(/sort=/g)).toHaveLength(1);
  });

  it('clearing the view removes the sort/filter params', () => {
    const editor = makeEditor(OWNED_DOC);
    writeHeadingViewState(editor, cardPosOf(editor), HREF, SORT_VIEW);
    writeHeadingViewState(editor, cardPosOf(editor), HREF, { sort: [], filter: [] });
    const markdown = emit(editor);
    expect(markdown).not.toContain('sort=');
    expect(markdown).toContain(`src=${HREF}`);
  });

  it('refuses to fabricate an annotation on a template-less heading', () => {
    const doc = ['## Plain heading', '', `[q3.csv](${HREF})`].join('\n');
    const editor = makeEditor(doc);
    const before = emit(editor);
    expect(writeHeadingViewState(editor, cardPosOf(editor), HREF, SORT_VIEW)).toBe(false);
    expect(emit(editor)).toBe(before);
  });

  it('quotes filter values that carry grammar characters', () => {
    const editor = makeEditor(OWNED_DOC);
    const view: TableViewState = {
      sort: [],
      filter: [{ column: 'Region', op: '=', value: 'West; South' }],
    };
    writeHeadingViewState(editor, cardPosOf(editor), HREF, view);
    const markdown = emit(editor);
    const reparsed = makeEditor(markdown);
    const binding = readHeadingViewBinding(reparsed, cardPosOf(reparsed), HREF);
    const roundTripped = viewStateFromBinding(binding, ['Region', 'Revenue']);
    expect(roundTripped.filter).toEqual(view.filter);
  });
});
