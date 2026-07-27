import { describe, expect, it } from 'vitest';
import { DEFAULT_COVER_SLIDE_SETTINGS, resolveCoverSlideSettings } from '../doc/coverSlideSettings';

describe('resolveCoverSlideSettings', () => {
  it('returns backward-compatible defaults', () => {
    expect(resolveCoverSlideSettings(undefined)).toEqual(DEFAULT_COVER_SLIDE_SETTINGS);
  });

  it('reads canonical settings and normalizes aliases', () => {
    expect(
      resolveCoverSlideSettings({
        'squisq-cover-slide': false,
        'squisq-cover-template': 'image-with-caption',
        'squisq-cover-duration': '4.5',
        'squisq-cover-playback': 'play over',
      }),
    ).toEqual({
      enabled: false,
      template: 'imageWithCaption',
      duration: 4.5,
      playback: 'overlay',
    });
  });

  it('reads legacy keys and lets canonical keys win', () => {
    expect(
      resolveCoverSlideSettings({
        'cover-slide': false,
        'squisq-cover-slide': true,
        'cover-template': 'section-header',
        'cover-duration': 6,
        'cover-playback': 'delay',
      }),
    ).toEqual({
      enabled: true,
      template: 'sectionHeader',
      duration: 6,
      playback: 'preroll',
    });
  });

  it('falls back for invalid values and validates explicit overrides', () => {
    expect(
      resolveCoverSlideSettings(
        {
          'squisq-cover-template': 'not-a-template',
          'squisq-cover-duration': -2,
          'squisq-cover-playback': 'unknown',
        },
        { duration: Number.NaN },
      ),
    ).toEqual(DEFAULT_COVER_SLIDE_SETTINGS);
  });
});
