/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import { PropertiesPanel } from '../imageEditor/PropertiesPanel.js';
import type { ImageEditorAction } from '../imageEditor/state.js';

function buildDoc(): ImageEditDoc {
  return {
    version: 1,
    canvas: { width: 100, height: 80, background: '#ffffff' },
    layers: [
      {
        id: 'a',
        type: 'shape',
        name: 'Box',
        position: { x: 5, y: 6, width: 30, height: 20 },
        content: { shape: 'rect', fill: '#3399ff' },
      },
    ],
  };
}

describe('PropertiesPanel', () => {
  it('shows an empty hint when no layer is selected', () => {
    const dispatch = vi.fn();
    render(<PropertiesPanel doc={buildDoc()} selectedLayerId={null} dispatch={dispatch} />);
    expect(screen.getByText(/no layer selected/i)).toBeTruthy();
  });

  it('editing the canvas width dispatches set-canvas', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<PropertiesPanel doc={buildDoc()} selectedLayerId={null} dispatch={dispatch} />);
    const widthInput = screen.getByDisplayValue('100') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '200' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-canvas',
      canvas: expect.objectContaining({ width: 200, height: 80 }),
    });
  });

  it('renaming a layer dispatches update-layer with patch.name', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<PropertiesPanel doc={buildDoc()} selectedLayerId="a" dispatch={dispatch} />);
    const nameInput = screen.getByDisplayValue('Box') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'update-layer',
      layerId: 'a',
      patch: expect.objectContaining({ name: 'Renamed' }),
    });
  });

  it('changing position X dispatches update-layer with merged position', () => {
    const dispatch = vi.fn<(a: ImageEditorAction) => void>();
    render(<PropertiesPanel doc={buildDoc()} selectedLayerId="a" dispatch={dispatch} />);
    const xInput = screen.getByDisplayValue('5') as HTMLInputElement;
    fireEvent.change(xInput, { target: { value: '50' } });
    const calls = dispatch.mock.calls.map((c) => c[0]);
    const last = calls[calls.length - 1];
    expect(last).toMatchObject({
      type: 'update-layer',
      layerId: 'a',
      patch: { position: { x: 50, y: 6, width: 30, height: 20 } },
    });
  });
});
