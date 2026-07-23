/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import type { TimelineClock } from '../useTimelineClock';
import { TimelineCompositionPanel } from '../TimelineCompositionPanel';

vi.mock('../PreviewControls', () => ({
  PreviewToolbarControls: () => null,
  usePreviewSettings: () => ({
    activeViewport: { width: 1600, height: 900 },
    activeTheme: undefined,
    activeTransformStyle: '',
    activeCaptionStyle: 'subtitle',
    activeCaptionsEnabled: true,
    activeVideoPresentation: 'background',
    activePipSize: 'small',
    activePipShape: 'square',
    activePipPosition: 'bottom-right',
    activeCoverSlide: false,
  }),
}));

vi.mock('../EditorContext', () => ({
  useEditorContext: () => ({ fileName: 'composition.md' }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TimelineCompositionPanel playback projection', () => {
  it('shows the second short block when the timeline clock crosses its boundary', async () => {
    const doc = markdownToDoc(parseMarkdown('# aaaa\n\na\n\n# bbbb\n\nb'), {
      articleId: 'timeline-composition-boundary',
      generateCoverBlock: false,
    });
    const clock: TimelineClock = {
      currentTime: 3.1,
      isPlaying: false,
      play: vi.fn(),
      pause: vi.fn(),
      toggle: vi.fn(),
      seek: vi.fn(),
    };
    const { container } = render(<TimelineCompositionPanel doc={doc} clock={clock} />);

    await waitFor(() => {
      expect(
        container.querySelector('.doc-player__block--active [data-block-id="bbbb"]'),
      ).toBeTruthy();
    });
    expect(container.querySelector('.doc-player__block--active [data-block-id="aaaa"]')).toBeNull();
  });
});
