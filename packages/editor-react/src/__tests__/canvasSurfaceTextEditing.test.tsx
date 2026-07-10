/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import { CanvasSurface } from '../imageEditor/CanvasSurface.js';
import type { ImageEditorAction } from '../imageEditor/state.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CanvasSurface text editing', () => {
  it('uses one tightly measured edit box and applies SVG zoom only once', async () => {
    const context = {
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);

    const doc: ImageEditDoc = {
      version: 1,
      canvas: { width: 640, height: 480 },
      layers: [
        {
          id: 'text-1',
          type: 'text',
          name: 'Text',
          position: { x: 100, y: 80, width: 240, height: 48 },
          content: {
            text: 'hello',
            style: { fontSize: 20, lineHeight: 1.4, color: '#111111' },
          },
        },
      ],
    };

    const { container } = render(
      <CanvasSurface
        doc={doc}
        selectedLayerId="text-1"
        tool="select"
        resolveAssetUrl={async (path) => path}
        dispatch={vi.fn<(action: ImageEditorAction) => void>()}
        requestEditLayerId="text-1"
        zoom={2}
      />,
    );

    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    const editBox = container.querySelector('foreignObject');

    expect(editBox?.getAttribute('width')).toBe('50');
    expect(textarea.style.fontSize).toBe('20px');
    await waitFor(() => {
      expect(container.querySelector('.squisq-image-editor-selection-handles')).toBeNull();
    });
  });
});
