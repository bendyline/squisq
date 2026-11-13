/** @vitest-environment jsdom */

/**
 * FillAvailableExtension: a height-capable widget host that ends the document
 * is handed the page's spare height (`data-fill-height`); anything that is not
 * at the end, a page with no room left, and an auto-growing shell get nothing.
 * jsdom has no layout, so geometry is stubbed per element.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { markdownToTiptap } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';
import { DataCardExtension } from '../dataCard/DataCardExtension';
import { EditorShell } from '../EditorShell';
import {
  FILL_HEIGHT_ATTR,
  FILL_HEIGHT_VAR,
  FillAvailableExtension,
  fillHeightFor,
  terminalFillHost,
} from '../fillAvailable/FillAvailableExtension';

describe('fillHeightFor', () => {
  it('gives the room between the host top and the page bottom, less what sits below', () => {
    expect(fillHeightFor({ viewportHeight: 900, hostTop: 200, below: 26 })).toBe(674);
  });

  it('floors fractional room so the page never overflows by a sub-pixel', () => {
    expect(fillHeightFor({ viewportHeight: 900.6, hostTop: 200, below: 26 })).toBe(674);
  });

  it('gives nothing when the host starts at or below the page bottom', () => {
    expect(fillHeightFor({ viewportHeight: 900, hostTop: 880, below: 26 })).toBeNull();
    expect(fillHeightFor({ viewportHeight: 900, hostTop: 1400, below: 26 })).toBeNull();
  });
});

describe('terminalFillHost', () => {
  function editorDom(html: string): HTMLElement {
    const dom = document.createElement('div');
    dom.innerHTML = html;
    return dom;
  }

  it('finds a host that is the last element', () => {
    const dom = editorDom('<p>Intro</p><div class="squisq-block-fill-available" id="h"></div>');
    expect(terminalFillHost(dom)?.id).toBe('h');
  });

  it('looks past empty paragraphs and hidden nodes after the host', () => {
    const dom = editorDom(
      '<div class="squisq-block-fill-available" id="h"></div>' +
        '<p><br class="ProseMirror-trailingBreak"></p>' +
        '<p style="display: none">hidden</p>',
    );
    expect(terminalFillHost(dom)?.id).toBe('h');
  });

  it('refuses a host with content after it', () => {
    const dom = editorDom('<div class="squisq-block-fill-available"></div><p>After</p>');
    expect(terminalFillHost(dom)).toBeNull();
  });

  it('refuses a document without a host', () => {
    expect(terminalFillHost(editorDom('<p>Only prose</p>'))).toBeNull();
  });
});

const DATA_DOC = [
  '## Q3 {[dataTable src=report_files/data/q3.csv]}',
  '',
  '[q3.csv](report_files/data/q3.csv)',
].join('\n');

interface Rect {
  top: number;
  bottom: number;
}

describe('FillAvailableExtension', () => {
  const editors: Editor[] = [];
  const rects = new Map<Element, Rect>();

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const rect = rects.get(this) ?? { top: 0, bottom: 0 };
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: 0,
        right: 800,
        width: 800,
        height: rect.bottom - rect.top,
        x: 0,
        y: rect.top,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    for (const editor of editors) editor.destroy();
    editors.length = 0;
    rects.clear();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  /** Mount an editor in a 900px-high scroll container; the data card host sits at 200–260. */
  function mount(markdown: string, wrap?: (container: HTMLElement) => HTMLElement): Editor {
    const container = document.createElement('div');
    container.className = 'squisq-wysiwyg-container';
    Object.defineProperty(container, 'clientHeight', { value: 900 });
    document.body.appendChild(wrap ? wrap(container) : container);
    rects.set(container, { top: 0, bottom: 900 });

    const editor = new Editor({
      extensions: [
        StarterKit,
        LinkWithTitle.configure({ openOnClick: false, autolink: false }),
        DataCardExtension.configure({ mediaProvider: () => null, mediaRevision: () => 0 }),
        FillAvailableExtension,
      ],
      content: markdownToTiptap(markdown),
    });
    editors.push(editor);
    const dom = editor.view.dom as HTMLElement;
    dom.style.paddingBottom = '16px';
    container.appendChild(dom);
    const host = dom.querySelector<HTMLElement>('.squisq-data-card-host');
    if (host) {
      host.style.marginBottom = '10px';
      rects.set(host, { top: 200, bottom: 260 });
    }
    // The plugin measures after each state update; an empty transaction
    // stands in for the first edit after the view is attached.
    editor.view.dispatch(editor.state.tr);
    return editor;
  }

  function host(editor: Editor): HTMLElement {
    return editor.view.dom.querySelector<HTMLElement>('.squisq-data-card-host')!;
  }

  it('hands a terminal data card the room left on the page', () => {
    const editor = mount(DATA_DOC);

    // 900 viewport − 200 host top − (10 margin + 16 page padding) below.
    expect(host(editor).getAttribute(FILL_HEIGHT_ATTR)).toBe('674');
    expect(host(editor).style.getPropertyValue(FILL_HEIGHT_VAR)).toBe('674px');
  });

  it('withdraws the room once something is typed below the card', () => {
    const editor = mount(DATA_DOC);
    expect(host(editor).hasAttribute(FILL_HEIGHT_ATTR)).toBe(true);

    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Notes below</p>');

    expect(host(editor).hasAttribute(FILL_HEIGHT_ATTR)).toBe(false);
    expect(host(editor).style.getPropertyValue(FILL_HEIGHT_VAR)).toBe('');
  });

  it('gives nothing when the card starts below the page bottom', () => {
    const editor = mount(DATA_DOC);
    rects.set(host(editor), { top: 1200, bottom: 1260 });
    editor.view.dispatch(editor.state.tr);

    expect(host(editor).hasAttribute(FILL_HEIGHT_ATTR)).toBe(false);
  });

  it('leaves an auto-growing shell alone', () => {
    const editor = mount(DATA_DOC, (container) => {
      const shell = document.createElement('div');
      shell.className = 'squisq-editor-shell';
      shell.setAttribute('data-auto-grow', 'true');
      shell.appendChild(container);
      return shell;
    });

    expect(host(editor).hasAttribute(FILL_HEIGHT_ATTR)).toBe(false);
  });

  it('clears the stamp when the editor is destroyed', () => {
    const editor = mount(DATA_DOC);
    const stamped = host(editor);
    expect(stamped.hasAttribute(FILL_HEIGHT_ATTR)).toBe(true);

    editor.destroy();
    editors.length = 0;

    expect(stamped.hasAttribute(FILL_HEIGHT_ATTR)).toBe(false);
  });
});

describe('EditorShell and the data card', () => {
  const SIDECAR = 'report_files/data/q3.csv';

  async function renderCard(rows: number, props: { minHeight?: string } = {}) {
    const container = new MemoryContentContainer();
    const lines = ['Name,Value', ...Array.from({ length: rows }, (_, i) => `Row ${i},${i}`)];
    await container.writeFile(
      SIDECAR,
      new TextEncoder().encode(`${lines.join('\n')}\n`),
      'text/csv',
    );
    const view = render(
      <EditorShell
        initialMarkdown={DATA_DOC}
        initialView="wysiwyg"
        workspaceContainer={container}
        fileName="report.md"
        readOnly
        showStatusBar={false}
        {...props}
      />,
    );
    await waitFor(() => {
      expect(view.container.querySelector('.squisq-data-card-grid')).toBeTruthy();
    });
    return view.container;
  }

  it('lets a table that outgrows the natural grid take spare height', async () => {
    const rendered = await renderCard(40);
    expect(rendered.querySelector('.squisq-data-card')?.getAttribute('data-fills')).toBe('true');
  });

  it('keeps a short table at its natural size', async () => {
    const rendered = await renderCard(3);
    expect(rendered.querySelector('.squisq-data-card')?.hasAttribute('data-fills')).toBe(false);
  });

  it('marks an auto-growing shell so nothing fills inside it', async () => {
    const rendered = await renderCard(3, { minHeight: '120px' });
    expect(rendered.querySelector('.squisq-editor-shell')?.getAttribute('data-auto-grow')).toBe(
      'true',
    );
  });
});
