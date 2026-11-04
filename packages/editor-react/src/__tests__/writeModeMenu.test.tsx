/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorProvider, useEditorContext, type EditorView } from '../EditorContext';
import { PreviewSettingsProvider } from '../PreviewControls';
import { Toolbar } from '../Toolbar';
import { ViewMenuPanel } from '../ViewMenuPanel';

afterEach(cleanup);

function WriteTabHarness() {
  const { activeView, layoutMode, doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <Toolbar />
      <div data-testid="active-view">{activeView}</div>
      <div data-testid="layout-mode">{layoutMode}</div>
    </PreviewSettingsProvider>
  );
}

function renderTabs(initialView: EditorView, onViewPreferencesChange = vi.fn()) {
  render(
    <EditorProvider
      initialMarkdown="# One\n\nFirst block.\n\n## Two\n\nSecond block.\n"
      initialView={initialView}
      allowRecording={false}
      onViewPreferencesChange={onViewPreferencesChange}
    >
      <WriteTabHarness />
    </EditorProvider>,
  );
}

describe('Write tab mode menu', () => {
  it('lists the Write modes beside the tab and renames the tab for the chosen one', () => {
    const onViewPreferencesChange = vi.fn();
    renderTabs('wysiwyg', onViewPreferencesChange);

    const writeTab = screen.getByRole('tab', { name: 'Write' });
    const tabCluster = writeTab.closest<HTMLElement>('.squisq-toolbar-view-tabs');
    expect(tabCluster).not.toBeNull();
    const trigger = within(tabCluster!).getByRole('button', { name: 'Choose Write mode' });
    expect(trigger.closest('[role="tablist"]')).toBeNull();

    // Write is already active, so clicking it opens the menu rather than
    // re-entering the view.
    fireEvent.click(writeTab);
    const menu = screen.getByRole('menu', { name: 'Write mode' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.querySelector('.squisq-view-mode-menu-label')?.textContent),
    ).toEqual(['Write', 'Blocks', 'Timeline']);
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Write' }).getAttribute('aria-checked'),
    ).toBe('true');

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Blocks' }));
    expect(screen.getByTestId('layout-mode').textContent).toBe('block');
    expect(screen.queryByRole('menu', { name: 'Write mode' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Blocks' }).getAttribute('data-view')).toBe('wysiwyg');
    expect(screen.queryByRole('tab', { name: 'Write' })).toBeNull();
    expect(onViewPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutMode: 'block' }),
    );
  });

  it('enters Write when a mode is chosen from another view', () => {
    renderTabs('raw');

    // The ▾ opens the menu without switching views first.
    fireEvent.click(screen.getByRole('button', { name: 'Choose Write mode' }));
    expect(screen.getByTestId('active-view').textContent).toBe('raw');

    const menu = screen.getByRole('menu', { name: 'Write mode' });
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Timeline' }));
    expect(screen.getByTestId('layout-mode').textContent).toBe('timeline');
    expect(screen.getByTestId('active-view').textContent).toBe('wysiwyg');
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('a click on the inactive Write tab enters Write without opening the menu', () => {
    renderTabs('raw');
    fireEvent.click(screen.getByRole('tab', { name: 'Write' }));
    expect(screen.getByTestId('active-view').textContent).toBe('wysiwyg');
    expect(screen.queryByRole('menu', { name: 'Write mode' })).toBeNull();
  });

  it('is no longer offered in View options', () => {
    render(
      <EditorProvider initialMarkdown="# One" initialView="wysiwyg">
        <ViewMenuPanel />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    const menu = screen.getByRole('menu', { name: 'View options' });
    expect(within(menu).queryByRole('group', { name: 'View' })).toBeNull();
    expect(within(menu).queryByRole('menuitemradio', { name: 'Block-at-a-time' })).toBeNull();
  });
});
