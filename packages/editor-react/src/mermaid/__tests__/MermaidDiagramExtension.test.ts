import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../../tiptapBridge';
import { replaceAsciiFenceText } from '../../asciiDiagram/asciiDiagramCommands';
import {
  MERMAID_DIAGRAM_KEY,
  MermaidDiagramExtension,
  findMermaidDiagramBlockPos,
  isMermaidSourceVisible,
  toggleMermaidSource,
} from '../MermaidDiagramExtension';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    mermaidAPI: {
      getDiagramFromText: vi.fn(async () => ({
        type: 'flowchart-v2',
        db: {
          getVertices: () =>
            new Map([
              [
                'start',
                {
                  id: 'start',
                  domId: 'flowchart-start-0',
                  text: 'Start',
                  type: 'square',
                  classes: [],
                },
              ],
              [
                'next',
                {
                  id: 'next',
                  domId: 'flowchart-next-1',
                  text: 'Next',
                  type: 'square',
                  classes: [],
                },
              ],
            ]),
          getEdges: () => [
            {
              id: 'L_start_next_0',
              start: 'start',
              end: 'next',
              text: '',
              type: 'arrow_point',
            },
          ],
          getDirection: () => 'LR',
        },
      })),
    },
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 200 100"><g class="node" id="${id}-flowchart-start-0"><rect x="5" y="10" width="70" height="40" /></g><g class="node" id="${id}-flowchart-next-1"><rect x="125" y="10" width="70" height="40" /></g><path class="flowchart-link" data-id="L_start_next_0" d="M75 30L125 30" /></svg>`,
      diagramType: 'flowchart-v2',
    })),
  },
}));

const SAMPLE = [
  'flowchart LR',
  '  client["MCP client"] <--> transport["Local stdio transport"]',
  '  transport <--> sdk["MCP SDK server"]',
  '',
  '  subgraph docblocks["DocBlocks MCP process"]',
  '    sdk --> tools["19 strict tools"]',
  '    tools --> guard["Guarded expensive operations"]',
  '  end',
].join('\n');

const editors: Editor[] = [];

beforeAll(() => {
  if (typeof globalThis.ResizeObserver !== 'undefined') return;
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

function makeEditor(markdown: string, enabled = true): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      MermaidDiagramExtension.configure({ enabled }),
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function entriesOf(editor: Editor) {
  return MERMAID_DIAGRAM_KEY.getState(editor.state)?.entries ?? [];
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe('MermaidDiagramExtension', () => {
  it('claims explicit Mermaid fences regardless of diagram type or validity', () => {
    const editor = makeEditor(
      `\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n\n\`\`\`mermaid\nnot finished yet\n\`\`\`\n`,
    );
    expect(entriesOf(editor)).toHaveLength(2);
  });

  it('does not steal ordinary code or ASCII diagram fences', () => {
    const editor = makeEditor(
      '```js\nflowchart LR\n  a --> b\n```\n\n```diagram\n+---+  +---+\n| A |->| B |\n+---+  +---+\n```\n',
    );
    expect(entriesOf(editor)).toHaveLength(0);
  });

  it('keeps one block id across edits above and inside the source fence', () => {
    const editor = makeEditor(`\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`);
    const [before] = entriesOf(editor);
    editor.commands.insertContentAt(0, '<p>Before</p>');
    const [shifted] = entriesOf(editor);
    expect(shifted.id).toBe(before.id);
    expect(shifted.pos).toBeGreaterThan(before.pos);

    expect(replaceAsciiFenceText(editor, shifted.pos, `${SAMPLE}\n  guard --> documents`)).toBe(
      true,
    );
    const [rewritten] = entriesOf(editor);
    expect(rewritten.id).toBe(before.id);
    expect(findMermaidDiagramBlockPos(editor, before.id)).toBe(rewritten.pos);
  });

  it('source visibility is session-only and does not mutate Mermaid text', () => {
    const editor = makeEditor(`\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`);
    const [entry] = entriesOf(editor);
    const before = tiptapToMarkdown(editor.getHTML());
    expect(isMermaidSourceVisible(editor, entry.id)).toBe(false);
    toggleMermaidSource(editor, entry.id);
    expect(isMermaidSourceVisible(editor, entry.id)).toBe(true);
    expect(tiptapToMarkdown(editor.getHTML())).toBe(before);
  });

  it('round-trips the complex graph as a Mermaid code block byte-for-byte', () => {
    const markdown = `\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`;
    const editor = makeEditor(markdown);
    expect(tiptapToMarkdown(editor.getHTML())).toBe(markdown);
  });

  it('selects rendered nodes and exposes palette plus on-canvas edit gestures', async () => {
    const editor = makeEditor('```mermaid\nflowchart LR\n  start["Start"] --> next["Next"]\n```\n');
    const root = editor.view.dom;
    await vi.waitFor(() => {
      expect(root.querySelector('g[data-squisq-node-id="start"]')).not.toBeNull();
    });

    root
      .querySelector('g[data-squisq-node-id="start"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(root.querySelector('[aria-label="Selected Mermaid node actions"]')).not.toBeNull();
    });
    expect(
      root.querySelectorAll('[aria-label="Selected Mermaid node actions"] button'),
    ).toHaveLength(5);

    const shapeButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Shape',
    );
    expect(shapeButton?.disabled).toBe(false);
    shapeButton?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('[aria-label="Mermaid node shapes"]')).not.toBeNull();
    });
    expect(root.querySelectorAll('[aria-label="Mermaid node shapes"] button')).toHaveLength(48);

    root
      .querySelector<HTMLButtonElement>(
        '[aria-label="Selected Mermaid node actions"] button[aria-label="Rename node"]',
      )
      ?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('[aria-label="Mermaid node label"]')).not.toBeNull();
    });
    const renameInput = root.querySelector<HTMLInputElement>('[aria-label="Mermaid node label"]');
    expect(renameInput?.value).toBe('Start');
    fireEvent.change(renameInput!, { target: { value: 'Begin' } });
    fireEvent.keyDown(renameInput!, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(tiptapToMarkdown(editor.getHTML())).toContain('start@{ shape: rect, label: "Begin" }');
    });
    expect(root.querySelector('[aria-label="Mermaid node label"]')).toBeNull();

    await vi.waitFor(() => {
      expect(root.querySelector('g[data-squisq-node-id="start"]')).not.toBeNull();
    });
    fireEvent.doubleClick(root.querySelector('g[data-squisq-node-id="start"]')!);
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLInputElement>('[aria-label="Mermaid node label"]')?.value).toBe(
        'Start',
      );
    });
    const cancelInput = root.querySelector<HTMLInputElement>('[aria-label="Mermaid node label"]')!;
    fireEvent.change(cancelInput, { target: { value: 'Cancelled label' } });
    fireEvent.keyDown(cancelInput, { key: 'Escape' });
    expect(root.querySelector('[aria-label="Mermaid node label"]')).toBeNull();
    expect(tiptapToMarkdown(editor.getHTML())).not.toContain('Cancelled label');

    fireEvent.doubleClick(root.querySelector('g[data-squisq-node-id="start"]')!);
    await vi.waitFor(() => {
      expect(root.querySelector('[aria-label="Mermaid node label"]')).not.toBeNull();
    });
    const blurInput = root.querySelector<HTMLInputElement>('[aria-label="Mermaid node label"]')!;
    fireEvent.change(blurInput, { target: { value: 'Click away' } });
    fireEvent.blur(blurInput);
    await vi.waitFor(() => {
      expect(tiptapToMarkdown(editor.getHTML())).toContain(
        'start@{ shape: rect, label: "Click away" }',
      );
    });
  });

  it('edits connector labels inline and exposes on-canvas disconnect', async () => {
    const editor = makeEditor('```mermaid\nflowchart LR\n  start["Start"] --> next["Next"]\n```\n');
    const root = editor.view.dom;
    await vi.waitFor(() => {
      expect(root.querySelector('.squisq-mermaid-edge-hit-target')).not.toBeNull();
    });
    expect(root.querySelector('.squisq-mermaid-edge-hit-target')?.getAttribute('aria-label')).toBe(
      'Connection from Start to Next',
    );

    root
      .querySelector('.squisq-mermaid-edge-hit-target')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(
        root.querySelector('[aria-label="Selected Mermaid connection actions"]'),
      ).not.toBeNull();
    });
    expect(root.querySelector('[aria-label="Mermaid node label"]')).toBeNull();
    expect(
      root.querySelectorAll('[aria-label="Selected Mermaid connection actions"] button'),
    ).toHaveLength(2);

    const sideLabelButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Label',
    );
    expect(sideLabelButton?.disabled).toBe(false);

    root.querySelector<HTMLButtonElement>('button[aria-label="Edit connection label"]')?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('[aria-label="Mermaid connection label"]')).not.toBeNull();
    });
    const labelInput = root.querySelector<HTMLInputElement>(
      '[aria-label="Mermaid connection label"]',
    )!;
    expect(labelInput.value).toBe('');
    fireEvent.change(labelInput, { target: { value: 'continues' } });
    fireEvent.keyDown(labelInput, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(tiptapToMarkdown(editor.getHTML())).toContain('-->|"continues"| next["Next"]');
    });
    expect(root.querySelector('[aria-label="Mermaid connection label"]')).toBeNull();

    await vi.waitFor(() => {
      expect(root.querySelector('button[aria-label="Disconnect nodes"]')).not.toBeNull();
    });
    root.querySelector<HTMLButtonElement>('button[aria-label="Disconnect nodes"]')?.click();
    await vi.waitFor(() => {
      const markdown = tiptapToMarkdown(editor.getHTML());
      expect(markdown).not.toContain('-->');
      expect(markdown).toContain('start@{ shape: rect, label: "Start" }');
      expect(markdown).toContain('next@{ shape: rect, label: "Next" }');
    });
  });

  it('offers a visual gallery of horizontal and vertical flow layouts', async () => {
    const editor = makeEditor('```mermaid\nflowchart LR\n  start["Start"] --> next["Next"]\n```\n');
    const root = editor.view.dom;
    await vi.waitFor(() => {
      expect(root.querySelector('button[aria-label="Direction"]')).not.toBeNull();
    });

    root.querySelector<HTMLButtonElement>('button[aria-label="Direction"]')?.click();
    await vi.waitFor(() => {
      expect(root.querySelector('[aria-label="Flowchart layout gallery"]')).not.toBeNull();
    });

    const gallery = root.querySelector('[aria-label="Flowchart layout gallery"]')!;
    expect(gallery.querySelectorAll('.squisq-mermaid-direction-card')).toHaveLength(4);
    expect(
      gallery
        .querySelector('[aria-label="Horizontal: left to right"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');

    gallery.querySelector<HTMLButtonElement>('[aria-label="Vertical: top to bottom"]')?.click();
    await vi.waitFor(() => {
      expect(tiptapToMarkdown(editor.getHTML())).toContain('flowchart TB');
    });
  });

  it('pans the rendered diagram with right-mouse drag and resets from Fit diagram', async () => {
    const editor = makeEditor('```mermaid\nflowchart LR\n  start["Start"] --> next["Next"]\n```\n');
    const root = editor.view.dom;
    await vi.waitFor(() => {
      expect(root.querySelector('.squisq-mermaid-svg')).not.toBeNull();
    });

    const viewport = root.querySelector<HTMLElement>('.squisq-mermaid-canvas-scroll')!;
    const diagram = root.querySelector<HTMLElement>('.squisq-mermaid-svg')!;
    const fitButton = root.querySelector<HTMLButtonElement>('button[aria-label="Fit diagram"]')!;
    expect(fitButton.getAttribute('aria-pressed')).toBe('true');
    expect(diagram.style.transform).toBe('translate3d(0px, 0px, 0)');

    root.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')?.click();
    await vi.waitFor(() => expect(fitButton.getAttribute('aria-pressed')).toBe('false'));

    fireEvent.mouseDown(viewport, {
      button: 2,
      buttons: 2,
      clientX: 100,
      clientY: 80,
    });
    await vi.waitFor(() => expect(viewport.dataset.panning).toBe('true'));
    fireEvent.mouseMove(window, {
      buttons: 2,
      clientX: 145,
      clientY: 110,
    });
    await vi.waitFor(() => {
      expect(diagram.style.transform).toBe('translate3d(45px, 30px, 0)');
    });
    expect(fireEvent.contextMenu(viewport)).toBe(false);

    fireEvent.mouseUp(window, { button: 2, buttons: 0 });
    await vi.waitFor(() => expect(viewport.dataset.panning).toBeUndefined());

    fitButton.click();
    await vi.waitFor(() => {
      expect(fitButton.getAttribute('aria-pressed')).toBe('true');
      expect(diagram.style.transform).toBe('translate3d(0px, 0px, 0)');
    });
  });

  it('can be disabled without registering a plugin state', () => {
    const editor = makeEditor(`\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`, false);
    expect(MERMAID_DIAGRAM_KEY.getState(editor.state)).toBeUndefined();
  });
});
