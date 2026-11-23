/**
 * @vitest-environment jsdom
 *
 * Where focus goes once a view is chosen from the View menu. In a keyboard
 * flow (opened or picked with the keyboard), back to the view button, as a
 * menu button does. Opened and picked with the pointer, not there: focus left
 * on the button drew the keyboard focus ring at the first key press (the
 * arrows that drive Narrate) and Space reopened the menu.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider } from '../PreviewControls';
import { Toolbar } from '../Toolbar';

afterEach(cleanup);

function Harness() {
  const { doc, activeView } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <Toolbar />
      <output data-testid="active-view">{activeView}</output>
    </PreviewSettingsProvider>
  );
}

function renderToolbar() {
  render(
    <EditorProvider initialMarkdown={'# One\n\nFirst block.\n'} allowRecording={false}>
      <Harness />
    </EditorProvider>,
  );
}

const viewButton = () => screen.getByRole('button', { name: /^View: / });

/** Opens the menu and picks Narrate, both with the pointer or both with the keyboard. */
function chooseNarrate(detail: number) {
  fireEvent.click(viewButton(), { detail });
  const menu = screen.getByRole('menu', { name: 'View' });
  // A pointer click counts its clicks in `detail`; Enter or Space on a button
  // fires a click whose detail is 0.
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Narrate' }), { detail });
}

describe('View menu focus after choosing a view', () => {
  it('leaves the view button alone when the view is chosen with the pointer', () => {
    renderToolbar();
    chooseNarrate(1);

    expect(screen.getByTestId('active-view').textContent).toBe('preview');
    expect(document.activeElement).not.toBe(viewButton());
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
  });

  it('returns focus to the view button when the keyboard opened the menu', () => {
    renderToolbar();
    viewButton().focus();
    fireEvent.keyDown(viewButton(), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: 'View' });
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Narrate' }), { detail: 1 });

    expect(document.activeElement).toBe(viewButton());
  });

  it('returns focus to the view button when the view is chosen with the keyboard', () => {
    renderToolbar();
    chooseNarrate(0);

    expect(screen.getByTestId('active-view').textContent).toBe('preview');
    expect(document.activeElement).toBe(viewButton());
  });
});
