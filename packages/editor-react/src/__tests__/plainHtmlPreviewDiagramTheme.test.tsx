/**
 * Document mode draws a diagram as a picture, as the export does. On a themed
 * page the picture must be in the theme's colors on the page's background: a
 * dark theme showed a white panel of default blue boxes.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { resolveTheme } from '@bendyline/squisq/schemas';
import type { DiagramPictureOptions } from '@bendyline/squisq-react/diagram-pictures';
import { PlainHtmlPreview } from '../PlainHtmlPreview';

const pictureOptions = vi.hoisted(() => [] as DiagramPictureOptions[]);

vi.mock('@bendyline/squisq-react/diagram-pictures', () => ({
  createDiagramPictureRenderer: (options: DiagramPictureOptions = {}) => {
    pictureOptions.push(options);
    return async () => ({ data: new Uint8Array([137, 80, 78, 71]), width: 40, height: 20 });
  },
}));

const DIAGRAM =
  '## Flow\n\n```diagram\n+-----+     +-----+\n|  A  |---->|  B  |\n+-----+     +-----+\n```\n';

describe('PlainHtmlPreview diagram pictures', () => {
  it("draws a diagram in the page theme's colors, on its background", async () => {
    const theme = resolveTheme('warm-earth');
    render(<PlainHtmlPreview markdown={DIAGRAM} theme={theme} />);

    await waitFor(() =>
      expect(pictureOptions).toContainEqual({ theme, background: theme.colors.background }),
    );
  });

  it('reuses one renderer for the same theme resolved again', async () => {
    const before = pictureOptions.length;
    const { rerender } = render(
      <PlainHtmlPreview markdown={DIAGRAM} theme={resolveTheme('documentary')} />,
    );
    await waitFor(() => expect(pictureOptions.length).toBeGreaterThan(before));
    const created = pictureOptions.length;

    rerender(<PlainHtmlPreview markdown={DIAGRAM} theme={{ ...resolveTheme('documentary') }} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pictureOptions.length).toBe(created);
  });
});
