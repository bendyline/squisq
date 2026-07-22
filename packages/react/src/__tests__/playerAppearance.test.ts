import { describe, expect, it } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { resolveDocPlayerAppearance } from '../docPlayer/playerAppearance.js';

function doc(frontmatter?: Record<string, unknown>): Doc {
  return {
    articleId: 'appearance-test',
    duration: 1,
    blocks: [],
    audio: { segments: [] },
    themeId: 'tech-dark',
    frontmatter,
  };
}

describe('resolveDocPlayerAppearance', () => {
  it('inherits theme and PIP presentation settings from the document', () => {
    const appearance = resolveDocPlayerAppearance(
      doc({
        'squisq-video-presentation': 'pip',
        'squisq-pip-size': 'large',
        'squisq-pip-shape': '16:9',
        'squisq-pip-position': 'lower_right',
      }),
    );

    expect(appearance.theme.id).toBe('tech-dark');
    expect(appearance.videoPresentation).toBe('picture-in-picture');
    expect(appearance.pipSize).toBe('large');
    expect(appearance.pipShape).toBe('wide');
    expect(appearance.pipPosition).toBe('bottom-right');
    expect(appearance.showCoverSlide).toBe(true);
  });

  it('keeps explicit player/export overrides above document settings', () => {
    const theme = resolveTheme('morning-light');
    const appearance = resolveDocPlayerAppearance(
      doc({
        'squisq-video-presentation': 'background',
        'squisq-pip-size': 'small',
        'squisq-pip-shape': 'square',
        'squisq-pip-position': 'top-left',
      }),
      {
        theme,
        videoPresentation: 'full-frame',
        pipSize: 'large',
        pipShape: 'wide',
        pipPosition: 'bottom-left',
        showCoverSlide: false,
      },
    );

    expect(appearance).toEqual({
      theme,
      videoPresentation: 'full-frame',
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'bottom-left',
      showCoverSlide: false,
    });
  });

  it('reads legacy keys and safely falls back for invalid values', () => {
    expect(
      resolveDocPlayerAppearance(
        doc({
          'video-presentation': 'full',
          'pip-size': 'big',
          'pip-shape': 'widescreen',
          'pip-position': 'upper left',
          'cover-slide': 'hidden',
        }),
      ),
    ).toMatchObject({
      videoPresentation: 'full-frame',
      pipSize: 'large',
      pipShape: 'wide',
      pipPosition: 'top-left',
      showCoverSlide: false,
    });

    expect(
      resolveDocPlayerAppearance(
        doc({
          'squisq-video-presentation': 'invalid',
          'squisq-pip-size': 'invalid',
          'squisq-pip-shape': 'invalid',
          'squisq-pip-position': 'invalid',
        }),
      ),
    ).toMatchObject({
      videoPresentation: 'background',
      pipSize: 'small',
      pipShape: 'square',
      pipPosition: 'bottom-right',
      showCoverSlide: true,
    });
  });
});
