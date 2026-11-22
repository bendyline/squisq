/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  EditorProvider,
  useEditorContext,
  type BlockTagVisibility,
  type EditorView,
  type ViewPreferences,
} from '../EditorContext';
import { PreviewSettingsProvider, usePreviewSettings } from '../PreviewControls';
import { Toolbar, type ToolbarProps } from '../Toolbar';
import { ViewMenu, type ViewMenuToggleItem } from '../ViewMenu';

afterEach(cleanup);

const MARKDOWN = '# One\n\nFirst block.\n\n## Two\n\nSecond block.\n';

function Probes() {
  const { activeView, layoutMode, outlineVisible, inlinePreviewVisible, blockTagVisibility } =
    useEditorContext();
  const { activeDisplayMode } = usePreviewSettings();
  return (
    <>
      <div data-testid="active-view">{activeView}</div>
      <div data-testid="layout-mode">{layoutMode}</div>
      <div data-testid="display-mode">{activeDisplayMode}</div>
      <div data-testid="outline">{String(outlineVisible)}</div>
      <div data-testid="block-previews">{String(inlinePreviewVisible)}</div>
      <div data-testid="block-tags">{blockTagVisibility}</div>
    </>
  );
}

function ToolbarHarness(props: ToolbarProps) {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <Toolbar {...props} />
      <Probes />
    </PreviewSettingsProvider>
  );
}

function renderToolbar({
  initialView = 'wysiwyg',
  onViewPreferencesChange = vi.fn(),
  ...toolbarProps
}: ToolbarProps & {
  initialView?: EditorView;
  onViewPreferencesChange?: (preferences: ViewPreferences) => void;
} = {}) {
  render(
    <EditorProvider
      initialMarkdown={MARKDOWN}
      initialView={initialView}
      allowRecording={false}
      onViewPreferencesChange={onViewPreferencesChange}
    >
      <ToolbarHarness {...toolbarProps} />
    </EditorProvider>,
  );
}

/** The view button: named after the active view, it opens the View menu. */
function viewButton() {
  return screen.getByRole('button', { name: /^View: / });
}

function openViewMenu() {
  fireEvent.click(viewButton());
  return screen.getByRole('menu', { name: 'View' });
}

function columnOf(menu: HTMLElement, kind: 'navigation' | 'views' | 'panes') {
  return menu.querySelector<HTMLElement>(`[data-view-menu-column="${kind}"]`);
}

function viewLabels(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole('menuitemradio')
    .map((item) => item.querySelector('.squisq-view-mode-menu-label')?.textContent ?? '');
}

function rowLabels(group: HTMLElement, role: 'menuitemcheckbox' | 'menuitemradio'): string[] {
  return within(group)
    .getAllByRole(role)
    .map((item) => item.textContent?.replace(/[✓●]/g, '').trim() ?? '');
}

describe('View button', () => {
  it('shows only the active view, in place of the tabs, the mode menus and View options', () => {
    renderToolbar();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View options' })).toBeNull();
    const button = viewButton();
    expect(button.getAttribute('aria-label')).toBe('View: Write');
    expect(button.textContent).toContain('Write');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('data-active-view')).toBe('wysiwyg');
    expect(button.closest('.squisq-toolbar-view-tabs')).not.toBeNull();
  });

  it('renames itself for each view chosen from the menu', () => {
    const onViewPreferencesChange = vi.fn();
    renderToolbar({ onViewPreferencesChange });

    fireEvent.click(within(openViewMenu()).getByRole('menuitemradio', { name: 'Blocks' }));
    expect(screen.getByTestId('layout-mode').textContent).toBe('block');
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
    expect(viewButton().getAttribute('aria-label')).toBe('View: Blocks');
    expect(onViewPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutMode: 'block' }),
    );

    fireEvent.click(within(openViewMenu()).getByRole('menuitemradio', { name: 'Source' }));
    expect(screen.getByTestId('active-view').textContent).toBe('raw');
    // Source shows the whole file in every layout, so the layout stays put.
    expect(screen.getByTestId('layout-mode').textContent).toBe('block');
    expect(viewButton().getAttribute('aria-label')).toBe('View: Source');
    expect(viewButton().getAttribute('data-active-view')).toBe('raw');

    fireEvent.click(within(openViewMenu()).getByRole('menuitemradio', { name: 'Document' }));
    expect(screen.getByTestId('active-view').textContent).toBe('preview');
    expect(screen.getByTestId('display-mode').textContent).toBe('page');
    expect(viewButton().getAttribute('aria-label')).toBe('View: Document');
  });

  it('shows a Use mode’s short name beside its full one, for narrow toolbars', () => {
    renderToolbar({ initialView: 'preview' });
    const button = viewButton();
    expect(button.getAttribute('aria-label')).toBe('View: Slideshow');
    expect(button.querySelector('.squisq-toolbar-view-button-label--short')?.textContent).toBe(
      'Slides',
    );
  });

  it('is an icon button listing only the panes when the host hides the views', () => {
    renderToolbar({ showViewTabs: false });
    expect(screen.queryByRole('button', { name: /^View: / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const menu = screen.getByRole('menu', { name: 'View' });
    expect(columnOf(menu, 'views')).toBeNull();
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Outline' })).toBeTruthy();
  });

  it('lists only the Edit views when the Use views are off', () => {
    renderToolbar({ showPlayTab: false });
    const views = columnOf(openViewMenu(), 'views')!;
    expect(within(views).getByRole('group', { name: 'Edit' })).toBeTruthy();
    expect(within(views).queryByRole('group', { name: 'Use' })).toBeNull();
  });
});

describe('View menu', () => {
  it('has Navigation, Views and Panes columns', () => {
    renderToolbar();
    const menu = openViewMenu();

    expect(
      Array.from(menu.querySelectorAll('[data-view-menu-column]')).map((column) =>
        column.getAttribute('data-view-menu-column'),
      ),
    ).toEqual(['navigation', 'views', 'panes']);

    const navigation = columnOf(menu, 'navigation')!;
    expect(
      rowLabels(within(navigation).getByRole('group', { name: 'Navigation' }), 'menuitemcheckbox'),
    ).toEqual(['Outline']);

    const views = columnOf(menu, 'views')!;
    expect(viewLabels(within(views).getByRole('group', { name: 'Edit' }))).toEqual([
      'Write',
      'Source',
      'Blocks',
      'Timeline',
      'Summaries',
    ]);
    expect(viewLabels(within(views).getByRole('group', { name: 'Use' }))).toEqual([
      'Slideshow',
      'Flashcards',
      'Video',
      'Page',
      'Dashboard',
      'Document',
      'Narrate',
    ]);

    const panes = columnOf(menu, 'panes')!;
    expect(
      rowLabels(within(panes).getByRole('group', { name: 'Panes' }), 'menuitemcheckbox'),
    ).toEqual(['Block previews', 'Status bar']);
    expect(
      rowLabels(within(panes).getByRole('group', { name: 'Show block tags' }), 'menuitemradio'),
    ).toEqual(['No inline block tags', 'Selected/hovered block', 'Always show']);

    // Editor styling moved to Document settings.
    expect(within(menu).queryByText('Editor styling from theme')).toBeNull();
  });

  it('lists the host’s navigation panes after the Outline', () => {
    const onToggle = vi.fn();
    const navigation: ViewMenuToggleItem[] = [
      { id: 'files', label: 'Files', checked: true, onToggle },
    ];
    renderToolbar({ viewMenuNavigation: navigation });
    const menu = openViewMenu();

    const column = columnOf(menu, 'navigation')!;
    expect(rowLabels(column, 'menuitemcheckbox')).toEqual(['Outline', 'Files']);
    const files = within(column).getByRole('menuitemcheckbox', { name: 'Files' });
    expect(files.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(files);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu', { name: 'View' })).toBe(menu);
  });

  it('checks each group’s mode and highlights the view on screen', () => {
    renderToolbar();
    let menu = openViewMenu();
    const write = within(menu).getByRole('menuitemradio', { name: 'Write' });
    const slideshow = within(menu).getByRole('menuitemradio', { name: 'Slideshow' });
    expect(write.getAttribute('aria-checked')).toBe('true');
    expect(write.classList.contains('squisq-view-mode-menu-item--selected')).toBe(true);
    expect(document.activeElement).toBe(write);
    // Slideshow is the Use mode Ctrl+Shift+3 returns to: checked, not on screen.
    expect(slideshow.getAttribute('aria-checked')).toBe('true');
    expect(slideshow.classList.contains('squisq-view-mode-menu-item--selected')).toBe(false);
    expect(within(slideshow).getByText('Present designed slides one at a time.')).toBeTruthy();

    fireEvent.click(slideshow);
    expect(screen.getByTestId('active-view').textContent).toBe('preview');
    menu = openViewMenu();
    expect(
      within(menu)
        .getByRole('menuitemradio', { name: 'Slideshow' })
        .classList.contains('squisq-view-mode-menu-item--selected'),
    ).toBe(true);
    expect(
      within(menu)
        .getByRole('menuitemradio', { name: 'Write' })
        .classList.contains('squisq-view-mode-menu-item--selected'),
    ).toBe(false);
  });

  it('toggles panes and block tags without closing', () => {
    const onViewPreferencesChange = vi.fn<(preferences: ViewPreferences) => void>();
    renderToolbar({ onViewPreferencesChange });
    const menu = openViewMenu();

    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Outline' }));
    expect(screen.getByTestId('outline').textContent).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Block previews' }));
    expect(screen.getByTestId('block-previews').textContent).toBe('true');
    expect(screen.getByRole('menu', { name: 'View' })).toBe(menu);
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Outline' }).getAttribute('aria-checked'),
    ).toBe('true');

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'No inline block tags' }));
    expect(screen.getByTestId('block-tags').textContent).toBe('none');
    expect(onViewPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ blockTagVisibility: 'none', blockTags: false, outline: true }),
    );
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Always show' }));
    expect(screen.getByTestId('block-tags').textContent).toBe('always');
  });

  it('moves within a column with Up/Down and between columns with Left/Right', () => {
    renderToolbar({
      viewMenuNavigation: [{ id: 'files', label: 'Files', checked: false, onToggle: () => {} }],
    });
    const menu = openViewMenu();
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitemradio', { name: 'Write' }));

    press('ArrowDown');
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitemradio', { name: 'Source' }),
    );
    press('ArrowLeft');
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitemcheckbox', { name: 'Files' }),
    );
    press('ArrowRight');
    press('ArrowRight');
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitemcheckbox', { name: 'Status bar' }),
    );
    press('End');
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitemradio', { name: 'Always show' }),
    );
  });

  it('opens from the keyboard and closes on Escape, returning focus to the button', () => {
    renderToolbar();
    fireEvent.keyDown(viewButton(), { key: 'ArrowDown' });
    expect(screen.getByRole('menu', { name: 'View' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
    expect(document.activeElement).toBe(viewButton());
  });
});

describe('View menu block-tag visibility', () => {
  function renderMenu(props: {
    blockTags?: boolean;
    blockTagVisibility?: BlockTagVisibility;
    viewPreferences?: ViewPreferences;
  }) {
    render(
      <EditorProvider initialMarkdown={MARKDOWN} initialView="wysiwyg" {...props}>
        <ViewMenu variant="button" />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    return screen.getByRole('group', { name: 'Show block tags' });
  }

  function checked(group: HTMLElement): string | undefined {
    return within(group)
      .getAllByRole('menuitemradio')
      .find((item) => item.getAttribute('aria-checked') === 'true')
      ?.textContent?.replace('●', '')
      .trim();
  }

  it('defaults to the selected/hovered block', () => {
    expect(checked(renderMenu({}))).toBe('Selected/hovered block');
  });

  it('maps the legacy blockTags prop', () => {
    expect(checked(renderMenu({ blockTags: false }))).toBe('No inline block tags');
    cleanup();
    expect(checked(renderMenu({ blockTags: true }))).toBe('Always show');
  });

  it('restores the mode from bundled view preferences', () => {
    const group = renderMenu({
      blockTags: false,
      blockTagVisibility: 'always',
      viewPreferences: { blockTags: false, blockTagVisibility: 'active' },
    });
    expect(checked(group)).toBe('Selected/hovered block');
  });
});
