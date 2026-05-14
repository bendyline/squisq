/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import { LayersPanel } from '../imageEditor/LayersPanel.js';
import type { ImageEditorAction } from '../imageEditor/state.js';

function buildDoc(): ImageEditDoc {
  return {
    version: 1,
    canvas: { width: 100, height: 100 },
    layers: [
      {
        id: 'a',
        type: 'shape',
        name: 'Bottom',
        position: { x: 0, y: 0, width: 10, height: 10 },
        content: { shape: 'rect' },
      },
      {
        id: 'b',
        type: 'text',
        name: 'Middle',
        position: { x: 0, y: 0, width: 50, height: 20 },
        content: { text: 'Hi', style: { fontSize: 16, color: '#000' } },
      },
      {
        id: 'c',
        type: 'shape',
        name: 'Top',
        visible: false,
        position: { x: 0, y: 0, width: 10, height: 10 },
        content: { shape: 'rect' },
      },
    ],
  };
}

describe('LayersPanel', () => {
  it('renders layers with the top of the SVG stack first', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<LayersPanel doc={buildDoc()} selectedLayerId={null} dispatch={dispatch} />);
    const items = screen.getAllByText(/Bottom|Middle|Top/);
    expect(items[0]?.textContent).toContain('Top');
    expect(items[items.length - 1]?.textContent).toContain('Bottom');
  });

  it('clicking the layer name dispatches a select action', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<LayersPanel doc={buildDoc()} selectedLayerId={null} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Middle'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'select', layerId: 'b' });
  });

  it('toggling visibility dispatches an update-layer action', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<LayersPanel doc={buildDoc()} selectedLayerId={null} dispatch={dispatch} />);
    // The "Hide layer" buttons exist for visible layers.
    const hideButtons = screen.getAllByRole('button', { name: 'Hide layer' });
    fireEvent.click(hideButtons[0]!); // top-most visible layer is 'b'
    expect(dispatch).toHaveBeenCalledWith({
      type: 'update-layer',
      layerId: 'b',
      patch: { visible: false },
    });
  });

  it('move-up button is disabled at the top of the stack', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<LayersPanel doc={buildDoc()} selectedLayerId={null} dispatch={dispatch} />);
    const upButtons = screen.getAllByRole('button', { name: 'Move layer up' });
    // Visual order is c, b, a; layer 'c' is at the top of the stack and cannot move up.
    expect((upButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('delete button dispatches a remove-layer action', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<LayersPanel doc={buildDoc()} selectedLayerId={null} dispatch={dispatch} />);
    const delButtons = screen.getAllByRole('button', { name: 'Delete layer' });
    fireEvent.click(delButtons[0]!); // top of stack ('c')
    expect(dispatch).toHaveBeenCalledWith({ type: 'remove-layer', layerId: 'c' });
  });

  it('shows an empty-state message when there are no layers', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(
      <LayersPanel
        doc={{ version: 1, canvas: { width: 1, height: 1 }, layers: [] }}
        selectedLayerId={null}
        dispatch={dispatch}
      />,
    );
    expect(screen.getByText(/no layers yet/i)).toBeTruthy();
  });
});
