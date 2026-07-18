import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  applyMarkdownSourceTransform,
  unwrapMarkdownSource,
  wrapMarkdownSource,
} from '@bendyline/squisq/markdown';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { TransformMenu } from '../TransformMenu';

/**
 * Full EditorShell mounts Tiptap + Monaco (jsdom-hostile) — so, like
 * versionHistory.test.tsx, these tests exercise the TransformMenu against a
 * bare EditorProvider and a stubbed Monaco instance.
 */

const LONG = Array.from({ length: 60 }, (_, i) => `word${String(i).padStart(2, '0')}`).join(' ');
const WRAPPED = wrapMarkdownSource(`${LONG}\n\n${LONG}\n`, { width: 80, strict: true });

type EditorCtx = ReturnType<typeof useEditorContext>;
type FakeMonaco = Parameters<EditorCtx['setMonacoEditor']>[0];

function makeFakeMonaco(initialValue: string) {
  const executed: Array<{ text: string }> = [];
  const positionAt = (offset: number) => {
    const before = initialValue.slice(0, offset).split('\n');
    return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
  };
  const model = { getValue: () => initialValue, getPositionAt: positionAt };
  const pushUndoStop = vi.fn();
  const executeEdits = vi.fn((_source: string, ops: Array<{ range: unknown; text: string }>) => {
    executed.push(...ops.map((op) => ({ text: op.text })));
    return true;
  });
  const editor = {
    getModel: () => model,
    pushUndoStop,
    executeEdits,
  } as unknown as NonNullable<FakeMonaco>;
  return { editor, executed, pushUndoStop, executeEdits };
}

function Harness({ monaco }: { monaco?: NonNullable<FakeMonaco> }) {
  const ctx = useEditorContext();
  return (
    <div>
      <span data-testid="live-source">{ctx.markdownSource}</span>
      <button type="button" data-testid="go-preview" onClick={() => ctx.setActiveView('preview')}>
        Go preview
      </button>
      <button
        type="button"
        data-testid="go-raw"
        onClick={() => {
          if (monaco) ctx.setMonacoEditor(monaco);
          ctx.setActiveView('raw');
        }}
      >
        Go raw
      </button>
      <TransformMenu />
    </div>
  );
}

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Transform document' }));
}

describe('TransformMenu', () => {
  it('lists the registry transforms and the detected wrap state', async () => {
    render(
      <EditorProvider initialMarkdown={WRAPPED}>
        <Harness />
      </EditorProvider>,
    );
    openMenu();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Transform document' })).toBeTruthy();
    });
    expect(screen.getByText('Unwrap paragraphs')).toBeTruthy();
    expect(screen.getByText('Wrap at width')).toBeTruthy();
    expect(screen.getByText('Clean up formatting')).toBeTruthy();
    expect(screen.getByText('Stored wrap: ~80 columns')).toBeTruthy();
  });

  it('applies unwrap as one source write in Write view', async () => {
    render(
      <EditorProvider initialMarkdown={WRAPPED}>
        <Harness />
      </EditorProvider>,
    );
    openMenu();
    fireEvent.click(screen.getByText('Unwrap paragraphs'));
    await waitFor(() => {
      expect(screen.getByTestId('live-source').textContent).toBe(unwrapMarkdownSource(WRAPPED));
    });
    expect(screen.getByRole('status').textContent).toBe('Transformed.');
    // The state header follows the live source.
    expect(screen.getByText('Stored wrap: unwrapped')).toBeTruthy();
  });

  it('reports "No changes needed." on an already-conforming document', async () => {
    const unwrapped = `${LONG}\n`;
    render(
      <EditorProvider initialMarkdown={unwrapped}>
        <Harness />
      </EditorProvider>,
    );
    openMenu();
    fireEvent.click(screen.getByText('Unwrap paragraphs'));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('No changes needed.');
    });
    expect(screen.getByTestId('live-source').textContent).toBe(unwrapped);
  });

  it('honors the selected wrap width preset', async () => {
    render(
      <EditorProvider initialMarkdown={`${LONG}\n`}>
        <Harness />
      </EditorProvider>,
    );
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    fireEvent.click(screen.getByText('Wrap at width'));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Transformed.');
    });
    const lines = (screen.getByTestId('live-source').textContent ?? '').trimEnd().split('\n');
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(100);
    expect(Math.max(...lines.map((l) => l.length))).toBeGreaterThan(80);
  });

  it('disables actions in the Use view with a hint', async () => {
    render(
      <EditorProvider initialMarkdown={WRAPPED}>
        <Harness />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByTestId('go-preview'));
    openMenu();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Transform document' })).toBeTruthy();
    });
    const action = screen.getByText('Unwrap paragraphs').closest('button');
    expect(action?.disabled).toBe(true);
    expect(screen.getByText(/Switch to Write or Source view/)).toBeTruthy();
  });

  it('disables actions outside the document layout with a hint', async () => {
    render(
      <EditorProvider initialMarkdown={WRAPPED} layoutMode="block">
        <Harness />
      </EditorProvider>,
    );
    openMenu();
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Transform document' })).toBeTruthy();
    });
    const action = screen.getByText('Unwrap paragraphs').closest('button');
    expect(action?.disabled).toBe(true);
    expect(screen.getByText(/Document layout/)).toBeTruthy();
  });

  it('applies minimal Monaco edits between undo stops in Source view', async () => {
    const fake = makeFakeMonaco(WRAPPED);
    render(
      <EditorProvider initialMarkdown={WRAPPED}>
        <Harness monaco={fake.editor} />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByTestId('go-raw'));
    openMenu();
    fireEvent.click(screen.getByText('Unwrap paragraphs'));

    await waitFor(() => {
      expect(fake.executeEdits).toHaveBeenCalledTimes(1);
    });
    expect(fake.executeEdits.mock.calls[0][0]).toBe('squisq-transform');
    expect(fake.pushUndoStop).toHaveBeenCalledTimes(2);
    // The ops carry exactly the engine's per-paragraph edit texts.
    const expected = applyMarkdownSourceTransform('unwrap', WRAPPED, { strict: true });
    expect(fake.executed.map((op) => op.text)).toEqual(expected.edits.map((e) => e.text));
    // The Write-view fallback path was NOT taken.
    expect(screen.getByTestId('live-source').textContent).toBe(WRAPPED);
    expect(screen.getByRole('status').textContent).toBe('Transformed.');
  });
});
