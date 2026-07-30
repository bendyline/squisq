/**
 * @vitest-environment jsdom
 *
 * Prop-contract tests for the v1.5 naming renames:
 *   - `<EditorShell>`'s light/dark chrome prop is `colorScheme` (was
 *     `theme`), and it drives the `data-theme` attribute on the shell root.
 *   - `<RawEditor>`'s Monaco theme-string prop is `monacoTheme` (was
 *     `theme`); the shell maps `colorScheme` → `monacoTheme` (`'dark'` →
 *     `'vs-dark'`, `'light'` → `'vs'`).
 *
 * The heavy editing surfaces are stubbed so the shell mounts under jsdom
 * without dragging in monaco-editor or Tiptap. The RawEditor stub records
 * the props it receives so we can assert `monacoTheme` reaches it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RawEditorProps } from '../RawEditor';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { useMediaProvider } from '@bendyline/squisq-react';

// Records the props the shell passes to RawEditor on each render.
const rawEditorProps: RawEditorProps[] = [];

vi.mock('../RawEditor', () => ({
  RawEditor: (props: RawEditorProps) => {
    rawEditorProps.push(props);
    return <div data-testid="raw-editor-stub" />;
  },
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-stub" />,
}));

import { EditorShell } from '../EditorShell';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { Toolbar } from '../Toolbar';

function MarkdownSourceProbe() {
  const { markdownSource } = useEditorContext();
  return <pre data-testid="markdown-source">{markdownSource}</pre>;
}

function MediaProviderProbe({ expected }: { expected: MediaProvider }) {
  const provider = useMediaProvider();
  return (
    <span data-testid="media-context-probe">{provider === expected ? 'same' : 'missing'}</span>
  );
}

function mediaProviderWith(count: number): MediaProvider {
  const entries: MediaEntry[] = Array.from({ length: count }, (_, i) => ({
    name: `file-${i + 1}.png`,
    mimeType: 'image/png',
    size: i + 1,
  }));
  return {
    async addMedia(name: string) {
      return name;
    },
    async resolveUrl(relPath: string) {
      return relPath;
    },
    async listMedia() {
      return entries;
    },
    async removeMedia() {
      /* no-op */
    },
    dispose() {
      /* no-op */
    },
  };
}

function mediaProviderWithCounts(counts: number[]): MediaProvider {
  let callCount = 0;
  return {
    async addMedia(name: string) {
      return name;
    },
    async resolveUrl(relPath: string) {
      return relPath;
    },
    async listMedia() {
      const count = counts[Math.min(callCount, counts.length - 1)] ?? 0;
      callCount += 1;
      return Array.from({ length: count }, (_, i) => ({
        name: `file-${i + 1}.png`,
        mimeType: 'image/png',
        size: i + 1,
      }));
    },
    async removeMedia() {
      /* no-op */
    },
    dispose() {
      /* no-op */
    },
  };
}

function mutableMediaProviderWith(entries: MediaEntry[]): {
  provider: MediaProvider;
  removed: string[];
} {
  let current = [...entries];
  const removed: string[] = [];
  return {
    removed,
    provider: {
      async addMedia(name: string) {
        return name;
      },
      async resolveUrl(relPath: string) {
        return relPath;
      },
      async listMedia() {
        return current;
      },
      async removeMedia(relPath: string) {
        removed.push(relPath);
        current = current.filter((entry) => entry.name !== relPath);
      },
      dispose() {
        /* no-op */
      },
    },
  };
}

beforeEach(() => {
  rawEditorProps.length = 0;
  // jsdom lacks matchMedia / ResizeObserver, which the Toolbar uses.
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      }),
    });
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
});

describe('<EditorShell> colorScheme prop', () => {
  it('applies dark chrome via data-theme when colorScheme="dark"', () => {
    const { container } = render(
      <EditorShell initialMarkdown="# hi" initialView="raw" colorScheme="dark" />,
    );
    const shell = container.querySelector('.squisq-editor-shell');
    expect(shell?.getAttribute('data-theme')).toBe('dark');
  });

  it('defaults to light chrome when colorScheme is omitted', () => {
    const { container } = render(<EditorShell initialMarkdown="# hi" initialView="raw" />);
    const shell = container.querySelector('.squisq-editor-shell');
    expect(shell?.getAttribute('data-theme')).toBe('light');
  });
});

describe('<EditorShell> link delegation', () => {
  it('passes the literal href to the host and suppresses browser navigation', () => {
    const onLinkClick = vi.fn();
    render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        onLinkClick={onLinkClick}
        toolbarSlotRight={
          <a href="../guide/agent-loop.md?mode=read#start">
            <span>Agent loop</span>
          </a>
        }
      />,
    );

    const link = screen.getByRole('link', { name: 'Agent loop' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.querySelector('span')?.dispatchEvent(event);

    expect(onLinkClick).toHaveBeenCalledWith('../guide/agent-loop.md?mode=read#start');
    expect(event.defaultPrevented).toBe(true);
  });

  it('allows the browser default when the host returns false', () => {
    render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        onLinkClick={() => false}
        toolbarSlotRight={<a href="#section">Section</a>}
      />,
    );

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByRole('link', { name: 'Section' }).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('marks delegated links as interactive and shows their href while hovered', () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        onLinkClick={vi.fn()}
        toolbarSlotRight={<a href="https://example.com/docs">Documentation</a>}
      />,
    );

    const shell = container.querySelector('.squisq-editor-shell');
    const link = screen.getByRole('link', { name: 'Documentation' });
    expect(shell?.getAttribute('data-link-handler')).toBe('true');
    expect(link.getAttribute('title')).toBeNull();

    fireEvent.mouseOver(link);
    expect(link.getAttribute('title')).toBe('https://example.com/docs');

    fireEvent.mouseOut(link, { relatedTarget: document.body });
    expect(link.getAttribute('title')).toBeNull();
  });

  it('does not add delegated-link affordances without a handler', () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        toolbarSlotRight={<a href="https://example.com/docs">Documentation</a>}
      />,
    );

    const shell = container.querySelector('.squisq-editor-shell');
    const link = screen.getByRole('link', { name: 'Documentation' });
    fireEvent.mouseOver(link);

    expect(shell?.getAttribute('data-link-handler')).toBeNull();
    expect(link.getAttribute('title')).toBeNull();
  });

  it('preserves an authored link title', () => {
    render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        onLinkClick={vi.fn()}
        toolbarSlotRight={
          <a href="https://example.com/docs" title="Read the documentation">
            Documentation
          </a>
        }
      />,
    );

    const link = screen.getByRole('link', { name: 'Documentation' });
    fireEvent.mouseOver(link);

    expect(link.getAttribute('title')).toBe('Read the documentation');
  });
});

describe('<EditorShell> Write canvas settings', () => {
  it('exposes host settings as live CSS variables on the shell', () => {
    const { container, rerender } = render(
      <EditorShell
        initialMarkdown="Paragraph"
        writeCanvasSettings={{ textSize: 18, lineSpacing: 1.9 }}
      />,
    );
    const shell = container.querySelector<HTMLElement>('.squisq-editor-shell')!;
    expect(shell.style.getPropertyValue('--squisq-write-text-size')).toBe('18px');
    expect(shell.style.getPropertyValue('--squisq-write-line-spacing')).toBe('1.9');

    rerender(
      <EditorShell
        initialMarkdown="Paragraph"
        writeCanvasSettings={{ textSize: 20, lineSpacing: 2 }}
      />,
    );
    expect(shell.style.getPropertyValue('--squisq-write-text-size')).toBe('20px');
    expect(shell.style.getPropertyValue('--squisq-write-line-spacing')).toBe('2');
  });

  it('exposes host header/body fonts as live CSS variables on the shell', () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="Paragraph"
        writeCanvasSettings={{
          headerFont: '"Hanken Grotesk", system-ui, sans-serif',
          bodyFont: '"Lora", Georgia, serif',
        }}
      />,
    );
    const shell = container.querySelector<HTMLElement>('.squisq-editor-shell')!;
    expect(shell.style.getPropertyValue('--squisq-write-header-font')).toBe(
      '"Hanken Grotesk", system-ui, sans-serif',
    );
    expect(shell.style.getPropertyValue('--squisq-write-body-font')).toBe('"Lora", Georgia, serif');
  });
});

describe('RawEditor monacoTheme prop', () => {
  it('maps colorScheme="dark" to monacoTheme="vs-dark"', () => {
    render(<EditorShell initialMarkdown="# hi" initialView="raw" colorScheme="dark" />);
    expect(screen.getByTestId('raw-editor-stub')).toBeTruthy();
    const last = rawEditorProps[rawEditorProps.length - 1];
    expect(last?.monacoTheme).toBe('vs-dark');
  });

  it('maps colorScheme="light" to monacoTheme="vs"', () => {
    render(<EditorShell initialMarkdown="# hi" initialView="raw" colorScheme="light" />);
    expect(screen.getByTestId('raw-editor-stub')).toBeTruthy();
    const last = rawEditorProps[rawEditorProps.length - 1];
    expect(last?.monacoTheme).toBe('vs');
  });
});

describe('<EditorShell> instance boundaries', () => {
  it('provides its mediaProvider to React preview/layer consumers', async () => {
    const provider = mediaProviderWith(0);
    await act(async () => {
      render(
        <EditorShell
          initialMarkdown="# hi"
          initialView="raw"
          mediaProvider={provider}
          toolbarSlotLeft={<MediaProviderProbe expected={provider} />}
        />,
      );
    });
    expect(screen.getByTestId('media-context-probe').textContent).toBe('same');
  });

  it('keeps view shortcuts inside the editor that received the key', async () => {
    const { container } = render(
      <>
        <EditorShell initialMarkdown="# first" initialView="raw" />
        <EditorShell initialMarkdown="# second" initialView="raw" />
      </>,
    );
    const shells = container.querySelectorAll<HTMLElement>('.squisq-editor-shell');
    fireEvent.keyDown(within(shells[1]).getByTestId('raw-editor-stub'), {
      key: '1',
      ctrlKey: true,
    });
    await waitFor(() => expect(within(shells[1]).getByTestId('wysiwyg-editor-stub')).toBeTruthy());
    expect(within(shells[0]).getByTestId('raw-editor-stub')).toBeTruthy();
  });

  it('ignores file drops in readOnly mode', async () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="# original"
        initialView="raw"
        readOnly
        toolbarSlotRight={<MarkdownSourceProbe />}
      />,
    );
    const shell = container.querySelector<HTMLElement>('.squisq-editor-shell')!;
    const file = new File(['# replacement'], 'replacement.md', { type: 'text/markdown' });
    fireEvent.drop(shell, {
      dataTransfer: {
        types: ['Files'],
        files: [file],
        items: [{ kind: 'file', type: 'text/markdown', getAsFile: () => file }],
      },
    });
    await act(async () => Promise.resolve());
    expect(screen.getByTestId('markdown-source').textContent).toBe('# original');
  });
});

describe('<EditorShell> hostMode', () => {
  it('keeps chat embeds in Write view with Insert but without formatting or view tabs', async () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="Chat draft"
        initialView="raw"
        hostMode="chat"
        toolbarSlotRight={<button type="button">Send</button>}
      />,
    );

    const shell = container.querySelector<HTMLElement>('.squisq-editor-shell')!;
    expect(shell.dataset.hostMode).toBe('chat');
    expect(within(shell).getByTestId('wysiwyg-editor-stub')).toBeTruthy();
    expect(within(shell).queryByRole('tab', { name: /Write/ })).toBeNull();
    expect(within(shell).queryByRole('tab', { name: /Source/ })).toBeNull();
    expect(within(shell).queryByRole('button', { name: 'Custom layouts' })).toBeNull();
    expect(within(shell).queryByRole('button', { name: 'Transform document' })).toBeNull();
    expect(within(shell).queryByRole('button', { name: 'View options' })).toBeNull();
    expect(within(shell).queryByRole('button', { name: 'Document settings' })).toBeNull();
    expect(within(shell).queryByRole('button', { name: /^Bold/ })).toBeNull();
    const insert = within(shell).getByRole('button', { name: 'Insert' });
    expect(insert).toBeTruthy();
    expect(within(shell).getByRole('toolbar', { name: 'Editor toolbar' })).toBeTruthy();

    fireEvent.click(insert);
    expect(await screen.findByRole('menu')).toBeTruthy();

    fireEvent.keyDown(within(shell).getByTestId('wysiwyg-editor-stub'), {
      key: '2',
      ctrlKey: true,
    });
    expect(within(shell).getByTestId('wysiwyg-editor-stub')).toBeTruthy();
    expect(within(shell).queryByTestId('raw-editor-stub')).toBeNull();
    expect(within(shell).getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('allows chat hosts to hide Insert independently', () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="Chat draft"
        hostMode="chat"
        showInsertControls={false}
        toolbarSlotRight={<button type="button">Send</button>}
      />,
    );

    const shell = container.querySelector<HTMLElement>('.squisq-editor-shell')!;
    expect(within(shell).queryByRole('button', { name: /^Bold/ })).toBeNull();
    expect(within(shell).queryByRole('button', { name: 'Insert' })).toBeNull();
    expect(within(shell).getByRole('toolbar', { name: 'Editor toolbar' })).toBeTruthy();
    expect(within(shell).getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('allows chat hosts to opt back into formatting controls', () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="Chat draft"
        hostMode="chat"
        showFormattingControls
        toolbarSlotRight={<button type="button">Send</button>}
      />,
    );

    const shell = container.querySelector<HTMLElement>('.squisq-editor-shell')!;
    expect(within(shell).getByRole('button', { name: /^Bold/ })).toBeTruthy();
    expect(within(shell).getByRole('button', { name: 'Insert' })).toBeTruthy();
    expect(within(shell).getByRole('toolbar', { name: 'Formatting toolbar' })).toBeTruthy();
    expect(within(shell).getByRole('button', { name: 'Send' })).toBeTruthy();
  });
});

describe('<EditorShell> Files badge', () => {
  it('opens the recorder dialog from the Files panel Record button', async () => {
    render(
      <EditorShell initialMarkdown="# hi" initialView="raw" mediaProvider={mediaProviderWith(0)} />,
    );

    fireEvent.click(await screen.findByLabelText('Toggle Files panel'));
    fireEvent.click(await screen.findByRole('button', { name: 'Record media' }));

    expect(screen.getByRole('dialog', { name: 'Record media' })).toBeTruthy();
  });

  it('hides the Files panel Record button when the host disables recording', async () => {
    render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        mediaProvider={mediaProviderWith(0)}
        allowRecording={false}
      />,
    );

    fireEvent.click(await screen.findByLabelText('Toggle Files panel'));

    expect(screen.queryByRole('button', { name: 'Record media' })).toBeNull();
  });

  it('hides Files panel download actions when the host disables binary downloads', async () => {
    render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        mediaProvider={mediaProviderWith(1)}
        allowBinaryDownloads={false}
      />,
    );

    fireEvent.click(await screen.findByLabelText('Toggle Files panel, 1 file'));

    expect(await screen.findByText('file-1.png')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download file-1.png' })).toBeNull();
  });

  it('shows the mediaProvider file count on the paperclip button', async () => {
    const { container } = render(
      <EditorShell initialMarkdown="# hi" initialView="raw" mediaProvider={mediaProviderWith(3)} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 3 files')).toBeTruthy();
    });
    expect(container.querySelector('.squisq-toolbar-files-badge')?.textContent).toBe('3');
  });

  it('compacts large visible counts while keeping the full count in the label', async () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        mediaProvider={mediaProviderWith(120)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 120 files')).toBeTruthy();
    });
    expect(container.querySelector('.squisq-toolbar-files-badge')?.textContent).toBe('99+');
  });

  it('uses the MediaBin scan count when the panel discovers files', async () => {
    const { container } = render(
      <EditorShell
        initialMarkdown="# hi"
        initialView="raw"
        mediaProvider={mediaProviderWithCounts([0, 1])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Toggle Files panel'));

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 1 file')).toBeTruthy();
    });
    expect(container.querySelector('.squisq-toolbar-files-badge')?.textContent).toBe('1');
  });

  it('hides internal metadata and version entries from the Files panel and its count', async () => {
    const { provider } = mutableMediaProviderWith([
      { name: '.gitignore', mimeType: 'text/plain', size: 11 },
      { name: 'notes_files/.gitignore', mimeType: 'text/plain', size: 11 },
      { name: '.versions/index.20260101T000000Z.md', mimeType: 'text/markdown', size: 24 },
      {
        name: '.imageEdits/hero-png-123/.versions/state.20260101T000000Z.json',
        mimeType: 'application/json',
        size: 256,
      },
      {
        name: '.imageEdits/hero-png-123/state.json',
        mimeType: 'application/json',
        size: 256,
      },
      { name: 'legacy_files/state.json', mimeType: 'application/json', size: 256 },
      { name: 'notes_files/hero.png', mimeType: 'image/png', size: 1024 },
    ]);

    render(<EditorShell initialMarkdown="# hi" initialView="raw" mediaProvider={provider} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 1 file')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Toggle Files panel, 1 file'));

    expect(await screen.findByText('hero.png')).toBeTruthy();
    expect(screen.queryByText('.gitignore')).toBeNull();
    expect(screen.queryByText('state.json')).toBeNull();
    expect(screen.getByText('Files (1)')).toBeTruthy();
  });

  it('removes a media file and matching markdown refs from the files context menu', async () => {
    const { provider, removed } = mutableMediaProviderWith([
      {
        name: 'attachments/pasted.png',
        mimeType: 'image/png',
        size: 1024,
      },
    ]);
    const changes: string[] = [];
    const initialMarkdown = [
      'Before',
      '',
      '![Screenshot](attachments/pasted.png)',
      '',
      'After',
    ].join('\n');

    render(
      <EditorShell
        initialMarkdown={initialMarkdown}
        initialView="raw"
        mediaProvider={provider}
        onChange={(source) => changes.push(source)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 1 file')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Toggle Files panel, 1 file'));
    const item = (await screen.findByText('pasted.png')).closest('.squisq-media-bin-item');
    expect(item).toBeTruthy();

    fireEvent.contextMenu(item as HTMLElement, { clientX: 24, clientY: 32 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove image' }));

    await waitFor(() => {
      expect(removed).toEqual(['attachments/pasted.png']);
    });
    await waitFor(() => {
      expect(screen.queryByText('pasted.png')).toBeNull();
    });
    await waitFor(() => {
      expect(changes[changes.length - 1]).toBe(['Before', '', '', 'After'].join('\n'));
    });
  });

  it('marks files as unused when the document does not reference them', async () => {
    const { container } = render(
      <EditorShell
        initialMarkdown={'![Used](attachments/used.png)\n\n# Notes'}
        initialView="raw"
        mediaProvider={
          mutableMediaProviderWith([
            {
              name: 'attachments/used.png',
              mimeType: 'image/png',
              size: 100,
            },
            {
              name: 'attachments/unused.png',
              mimeType: 'image/png',
              size: 200,
            },
          ]).provider
        }
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 2 files')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Toggle Files panel, 2 files'));

    await screen.findByText('used.png');
    await screen.findByText('unused.png');

    const items = Array.from(container.querySelectorAll('.squisq-media-bin-item'));
    const itemNamed = (name: string) =>
      items.find((item) => item.querySelector('.squisq-media-bin-name')?.textContent === name);
    const usedItem = itemNamed('used.png');
    const unusedItem = itemNamed('unused.png');

    expect(usedItem?.querySelector('.squisq-media-bin-unused-badge')).toBeNull();
    expect(unusedItem?.querySelector('.squisq-media-bin-unused-badge')?.textContent).toBe('Unused');
  });
});

describe('<Toolbar> Files badge', () => {
  it('places Document settings immediately before the Files button', () => {
    render(
      <EditorProvider initialMarkdown="# hi" initialView="raw" allowRecording={false}>
        <Toolbar onToggleFiles={() => {}} />
      </EditorProvider>,
    );

    const documentSettings = screen.getByRole('button', { name: 'Document settings' });
    const files = screen.getByRole('button', { name: 'Toggle Files panel' });
    expect(documentSettings.nextElementSibling).toBe(files);
  });

  it('self-scans mediaProvider when fileCount is not controlled by a parent', async () => {
    const { container } = render(
      <EditorProvider
        initialMarkdown="# hi"
        initialView="raw"
        mediaProvider={mediaProviderWith(2)}
        allowRecording={false}
      >
        <Toolbar onToggleFiles={() => {}} />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 2 files')).toBeTruthy();
    });
    expect(container.querySelector('.squisq-toolbar-files-badge')?.textContent).toBe('2');
  });

  it('excludes .gitignore from a self-scanned count', async () => {
    const { provider } = mutableMediaProviderWith([
      { name: '.gitignore', mimeType: 'text/plain', size: 11 },
      { name: 'hero.png', mimeType: 'image/png', size: 1024 },
    ]);
    const { container } = render(
      <EditorProvider
        initialMarkdown="# hi"
        initialView="raw"
        mediaProvider={provider}
        allowRecording={false}
      >
        <Toolbar onToggleFiles={() => {}} />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Files panel, 1 file')).toBeTruthy();
    });
    expect(container.querySelector('.squisq-toolbar-files-badge')?.textContent).toBe('1');
  });
});

describe('<Toolbar> Insert menu', () => {
  it('flips above its trigger when the rendered menu would cross the viewport bottom', async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const scrollHeightSpy = vi
      .spyOn(Element.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: Element) {
        return this.classList.contains('squisq-insert-menu') ? 300 : 0;
      });

    try {
      render(
        <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
          <Toolbar />
        </EditorProvider>,
      );

      const trigger = screen.getByLabelText('Insert');
      trigger.getBoundingClientRect = () =>
        ({
          x: 24,
          y: 700,
          top: 700,
          right: 64,
          bottom: 740,
          left: 24,
          width: 40,
          height: 40,
          toJSON: () => ({}),
        }) as DOMRect;

      fireEvent.click(trigger);
      const menu = await screen.findByRole('menu');

      await waitFor(() => {
        expect(menu.dataset.placement).toBe('up');
        expect(menu.style.top).toBe('396px');
        expect(menu.style.maxHeight).toBe('688px');
      });
    } finally {
      scrollHeightSpy.mockRestore();
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });

  it('closes on global Escape and returns focus to the Insert trigger', async () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
      </EditorProvider>,
    );

    const trigger = screen.getByLabelText('Insert');
    fireEvent.click(trigger);
    expect(await screen.findByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens media recording from the Insert menu instead of the main toolbar', async () => {
    render(
      <EditorProvider
        initialMarkdown="Intro"
        initialView="raw"
        mediaProvider={mediaProviderWith(0)}
      >
        <Toolbar />
      </EditorProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Record media' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Record media' }));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Record media' })).toBeTruthy();
  });

  it('adds a default task list from the Insert menu in raw fallback mode', async () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
        <MarkdownSourceProbe />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByLabelText('Insert'));
    const item = await screen.findByRole('menuitem', { name: /Task List/i });

    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId('markdown-source').textContent).toBe(
        ['Intro', '- [ ] Task 1', '- [ ] Task 2', '- [ ] Task 3', ''].join('\n'),
      );
    });
  });

  it('adds an explicit authored timeline fence from the Insert menu', async () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
        <MarkdownSourceProbe />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Timeline/i }));

    await waitFor(() => {
      expect(screen.getByTestId('markdown-source').textContent).toContain(
        '```timeline\nMilestones: ● Start',
      );
    });
  });

  it('opens the Mermaid type gallery and inserts the selected diagram grammar', async () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
        <MarkdownSourceProbe />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Complex Diagram (Mermaid)' }));
    expect(await screen.findByRole('menu', { name: 'Mermaid diagram type' })).toBeTruthy();
    expect(screen.getByText(/Flow direction remains a separate edit/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert Gantt Mermaid diagram' }));

    await waitFor(() => {
      expect(screen.getByTestId('markdown-source').textContent).toContain(
        '```mermaid\ngantt\n  title Project plan\n  dateFormat YYYY-MM-DD',
      );
    });
  });

  it('adds a typed code fence from the Code Snippet submenu', async () => {
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
        <MarkdownSourceProbe />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert Code Snippet' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Insert TypeScript code snippet' }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('markdown-source').textContent).toContain(
        "```typescript\nconst message: string = 'Hello, world!';\n```",
      );
    });
  });
});
