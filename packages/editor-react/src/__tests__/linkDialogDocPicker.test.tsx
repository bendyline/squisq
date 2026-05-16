/**
 * Covers the LinkDialog's "Browse documents" picker added behind the
 * `documentLinkProvider` prop. The picker is purely additive — when
 * the prop is absent the dialog renders its original URL-only layout.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LinkDialog } from '../LinkDialog';
import type { DocumentLinkProvider } from '../EditorContext';

const NEIGHBORS = [
  { path: 'resume.md', label: 'Resume', description: 'My CV' },
  { path: 'projects.md', label: 'Projects' },
  { path: 'misc/notes.md', label: 'Notes', description: 'Scratchpad' },
];

const provider: DocumentLinkProvider = async (q) => {
  const query = q.trim().toLowerCase();
  if (!query) return NEIGHBORS;
  return NEIGHBORS.filter(
    (n) => n.label.toLowerCase().includes(query) || n.path.toLowerCase().includes(query),
  );
};

describe('LinkDialog — document picker', () => {
  it('hides the documents tab when no provider is supplied', () => {
    render(
      <LinkDialog
        mode="insert"
        initialText=""
        initialUrl=""
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('tab', { name: /browse documents/i })).toBeNull();
  });

  it('shows both tabs when the provider is supplied', () => {
    render(
      <LinkDialog
        mode="insert"
        initialText=""
        initialUrl=""
        onConfirm={() => {}}
        onClose={() => {}}
        documentLinkProvider={provider}
      />,
    );
    expect(screen.getByRole('tab', { name: 'URL' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Browse documents' })).toBeTruthy();
  });

  it('lists initial candidates when the documents tab opens', async () => {
    render(
      <LinkDialog
        mode="insert"
        initialText=""
        initialUrl=""
        onConfirm={() => {}}
        onClose={() => {}}
        documentLinkProvider={provider}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Browse documents' }));
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeTruthy();
      expect(screen.getByText('Projects')).toBeTruthy();
      expect(screen.getByText('Notes')).toBeTruthy();
    });
  });

  it('filters candidates as the user types', async () => {
    render(
      <LinkDialog
        mode="insert"
        initialText=""
        initialUrl=""
        onConfirm={() => {}}
        onClose={() => {}}
        documentLinkProvider={provider}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Browse documents' }));
    await waitFor(() => screen.getByText('Resume'));
    const search = screen.getByLabelText('Search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'proj' } });
    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeTruthy();
      expect(screen.queryByText('Resume')).toBeNull();
    });
  });

  it('picking a document fills the URL and auto-fills the caption when empty', async () => {
    const onConfirm = vi.fn();
    render(
      <LinkDialog
        mode="insert"
        initialText=""
        initialUrl=""
        onConfirm={onConfirm}
        onClose={() => {}}
        documentLinkProvider={provider}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Browse documents' }));
    await waitFor(() => screen.getByText('Resume'));
    fireEvent.click(screen.getByRole('option', { name: /Resume/i }));
    // After picking, the dialog jumps back to the URL tab so Enter submits.
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    expect(urlInput.value).toBe('resume.md');
    const textInput = screen.getByLabelText('Text') as HTMLInputElement;
    expect(textInput.value).toBe('Resume');
    // Submit
    fireEvent.submit(urlInput.closest('form')!);
    expect(onConfirm).toHaveBeenCalledWith('Resume', 'resume.md');
  });

  it('preserves a caption the user already typed when picking a document', async () => {
    render(
      <LinkDialog
        mode="insert"
        initialText="Read my work"
        initialUrl=""
        onConfirm={() => {}}
        onClose={() => {}}
        documentLinkProvider={provider}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Browse documents' }));
    await waitFor(() => screen.getByText('Resume'));
    fireEvent.click(screen.getByRole('option', { name: /Resume/i }));
    const textInput = screen.getByLabelText('Text') as HTMLInputElement;
    expect(textInput.value).toBe('Read my work');
  });
});
