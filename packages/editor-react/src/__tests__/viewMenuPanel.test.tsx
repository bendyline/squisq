/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  EditorProvider,
  useEditorContext,
  type BlockTagVisibility,
  type ViewPreferences,
} from '../EditorContext';
import { ViewMenuPanel } from '../ViewMenuPanel';

afterEach(cleanup);

function BlockTagVisibilityProbe() {
  const { blockTagVisibility } = useEditorContext();
  return <output data-testid="block-tag-visibility">{blockTagVisibility}</output>;
}

function renderViewMenu({
  blockTags,
  blockTagVisibility,
  viewPreferences,
  onViewPreferencesChange,
}: {
  blockTags?: boolean;
  blockTagVisibility?: BlockTagVisibility;
  viewPreferences?: ViewPreferences;
  onViewPreferencesChange?: (preferences: ViewPreferences) => void;
} = {}) {
  render(
    <EditorProvider
      initialMarkdown="# One\n\nFirst block.\n\n## Two\n\nSecond block.\n"
      initialView="wysiwyg"
      blockTags={blockTags}
      blockTagVisibility={blockTagVisibility}
      viewPreferences={viewPreferences}
      onViewPreferencesChange={onViewPreferencesChange}
    >
      <ViewMenuPanel />
      <BlockTagVisibilityProbe />
    </EditorProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'View options' }));
  return screen.getByRole('radiogroup', { name: 'Show block tags' });
}

describe('ViewMenuPanel block-tag visibility', () => {
  it('offers the three visibility choices and defaults to the selected/hovered block', () => {
    const group = renderViewMenu();

    const items = within(group).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'No inline block tags',
      'Selected/hovered block',
      'Always show',
    ]);
    expect(
      within(group)
        .getByRole('menuitemradio', { name: 'Selected/hovered block' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByTestId('block-tag-visibility').textContent).toBe('active');
  });

  it('switches to active and none and emits both new and legacy preferences', () => {
    const onViewPreferencesChange = vi.fn<(preferences: ViewPreferences) => void>();
    const group = renderViewMenu({ onViewPreferencesChange });

    fireEvent.click(within(group).getByRole('menuitemradio', { name: 'Always show' }));
    expect(screen.getByTestId('block-tag-visibility').textContent).toBe('always');

    fireEvent.click(within(group).getByRole('menuitemradio', { name: 'Selected/hovered block' }));
    expect(screen.getByTestId('block-tag-visibility').textContent).toBe('active');
    expect(onViewPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        blockTagVisibility: 'active',
        blockTags: true,
      }),
    );

    fireEvent.click(within(group).getByRole('menuitemradio', { name: 'No inline block tags' }));
    expect(screen.getByTestId('block-tag-visibility').textContent).toBe('none');
    expect(onViewPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        blockTagVisibility: 'none',
        blockTags: false,
      }),
    );
  });

  it('maps the legacy blockTags={false} prop to no inline block tags', () => {
    const group = renderViewMenu({ blockTags: false });

    expect(screen.getByTestId('block-tag-visibility').textContent).toBe('none');
    expect(
      within(group)
        .getByRole('menuitemradio', { name: 'No inline block tags' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('maps the legacy blockTags={true} prop to always show', () => {
    const group = renderViewMenu({ blockTags: true });

    expect(screen.getByTestId('block-tag-visibility').textContent).toBe('always');
    expect(
      within(group)
        .getByRole('menuitemradio', { name: 'Always show' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('restores the active mode from bundled view preferences', () => {
    const group = renderViewMenu({
      blockTags: false,
      blockTagVisibility: 'always',
      viewPreferences: { blockTags: false, blockTagVisibility: 'active' },
    });

    expect(screen.getByTestId('block-tag-visibility').textContent).toBe('active');
    expect(
      within(group)
        .getByRole('menuitemradio', { name: 'Selected/hovered block' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
});
