/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../RawEditor', () => ({
  RawEditor: () => <div data-testid="raw-editor-stub" />,
}));
vi.mock('../WysiwygEditor', () => ({
  WysiwygEditor: () => <div data-testid="wysiwyg-editor-stub" />,
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-panel-stub" />,
}));

import { EditorShell } from '../EditorShell';

beforeEach(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
});

describe('<EditorShell> print mode', () => {
  it('honors presentation and print capabilities supplied by an embedded host', () => {
    render(
      <EditorShell
        initialMarkdown="# Embedded"
        initialView="preview"
        showStatusBar={false}
        allowPresentationWindow={false}
        allowPresentationFullscreen={false}
        allowPrint={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Present: Fill canvas' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Presentation options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
  });

  it('places Print after Present and replaces the Use controls until Close', () => {
    render(
      <EditorShell initialMarkdown="# Print me" initialView="preview" showStatusBar={false} />,
    );

    const present = screen.getByRole('button', { name: 'Present: Fill canvas' });
    const print = screen.getByRole('button', { name: 'Print' });
    expect(present.closest('.squisq-presentation-control')?.nextElementSibling).toBe(print);

    fireEvent.click(print);
    expect(screen.getByLabelText('Print preview controls')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Present:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Print preview controls')).toBeNull();
    expect(screen.getByRole('button', { name: 'Present: Fill canvas' })).toBeTruthy();
  });
});
