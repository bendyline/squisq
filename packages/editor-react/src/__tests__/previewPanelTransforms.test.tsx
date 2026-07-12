/** @vitest-environment jsdom */
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';

vi.mock('@bendyline/squisq-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq-react')>();
  const blockSummary = (doc: Doc) =>
    JSON.stringify(doc.blocks.map((block) => ({ id: block.id, template: block.template })));
  return {
    ...actual,
    useMediaProvider: () => null,
    DocPlayer: ({ doc }: { doc: Doc }) => (
      <div data-testid="mock-doc-player">{blockSummary(doc)}</div>
    ),
    LinearDocView: ({ doc }: { doc: Doc }) => (
      <div data-testid="mock-linear-doc">{blockSummary(doc)}</div>
    ),
  };
});

vi.mock('../PlainHtmlPreview', () => ({
  PlainHtmlPreview: ({ markdown }: { markdown: string }) => (
    <div data-testid="mock-plain-document">{markdown}</div>
  ),
}));

import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider, usePreviewSettings } from '../PreviewControls';
import { PreviewPanel } from '../PreviewPanel';

const SOURCE = `---
title: Metrics Brief
---

# Metrics Brief {[title]}

This report collects the strongest signals from a year of product work.

## Growth

Revenue increased 42% year over year while customer retention reached 91%.

## Milestone

On January 15, 2026 the team shipped the largest release in company history.

## Customer voice

> "The new workflow saves our team hours every week."
`;

function TransformButton() {
  const { setSelectedTransformStyle } = usePreviewSettings();
  return <button onClick={() => setSelectedTransformStyle('data-driven')}>Summarize now</button>;
}

function Harness({ children }: { children?: ReactNode }) {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <TransformButton />
      {children}
      <PreviewPanel />
    </PreviewSettingsProvider>
  );
}

function renderMode(displayMode?: string) {
  const source = displayMode
    ? SOURCE.replace('title: Metrics Brief', `title: Metrics Brief\ndisplay-mode: ${displayMode}`)
    : SOURCE;
  return render(
    <EditorProvider initialMarkdown={source} initialView="preview">
      <Harness />
    </EditorProvider>,
  );
}

describe('PreviewPanel transform projection', () => {
  it('replaces the slideshow deck when a summarization style is selected', async () => {
    renderMode('slideshow');
    await waitFor(() => expect(screen.getByTestId('mock-doc-player')).toBeTruthy());
    expect(screen.getByTestId('mock-doc-player').textContent).not.toContain('transform-');

    fireEvent.click(screen.getByRole('button', { name: 'Summarize now' }));

    await waitFor(() =>
      expect(screen.getByTestId('mock-doc-player').textContent).toContain('transform-'),
    );
  });

  it('feeds the transformed content model to Page mode', async () => {
    renderMode('page');
    await waitFor(() => expect(screen.getByTestId('mock-linear-doc')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Summarize now' }));

    await waitFor(() =>
      expect(screen.getByTestId('mock-linear-doc').textContent).toContain('transform-'),
    );
  });

  it('feeds readable transformed Markdown to Document mode', async () => {
    renderMode('document');
    await waitFor(() => expect(screen.getByTestId('mock-plain-document')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Summarize now' }));

    await waitFor(() => {
      const markdown = screen.getByTestId('mock-plain-document').textContent ?? '';
      expect(markdown).toContain('Metrics Brief');
      expect(markdown).toContain('42%');
    });
  });
});
