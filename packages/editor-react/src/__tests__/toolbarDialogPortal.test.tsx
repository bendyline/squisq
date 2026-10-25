/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../EditorContext';
import { Toolbar } from '../Toolbar';

describe('<Toolbar> dialogs', () => {
  // The toolbar is a size container. The Chromium in VS Code 1.85–1.97 made
  // that the containing block for a fixed overlay rendered inside it, which
  // opened the dialog above the top of the window.
  it('opens Document settings on <body>, outside the toolbar, in the shell theme', () => {
    render(
      <EditorProvider
        initialMarkdown="Intro"
        initialView="raw"
        allowRecording={false}
        colorScheme="dark"
      >
        <Toolbar />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Document settings' }));

    const dialog = screen.getByRole('dialog', { name: /document settings/i });
    expect(dialog.closest('.squisq-toolbar')).toBeNull();
    const host = dialog.closest('.squisq-dialog-portal');
    expect(host?.parentElement).toBe(document.body);
    expect(host?.getAttribute('data-theme')).toBe('dark');
  });
});
