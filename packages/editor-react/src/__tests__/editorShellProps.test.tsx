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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RawEditorProps } from '../RawEditor';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';

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

describe('<EditorShell> Files badge', () => {
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
});

describe('<Toolbar> Insert menu', () => {
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
});
