import { describe, it, expect } from 'vitest';
import {
  readHeadingLineTransition,
  setHeadingLineTransition,
  readBlockAttrsTransition,
  setBlockAttrsTransition,
  EMPTY_TRANSITION,
} from '../headingTransition';

describe('readHeadingLineTransition', () => {
  it('returns empty for a plain heading', () => {
    expect(readHeadingLineTransition('## Tips')).toEqual(EMPTY_TRANSITION);
  });

  it('returns empty for a non-heading line', () => {
    expect(readHeadingLineTransition('Just a paragraph')).toEqual(EMPTY_TRANSITION);
  });

  it('reads transition from a Pandoc block', () => {
    expect(readHeadingLineTransition('## Tips {transition=fade}')).toEqual({
      type: 'fade',
      direction: '',
      duration: '',
    });
  });

  it('reads type, direction and duration together', () => {
    expect(
      readHeadingLineTransition(
        '## Tips {transition=push transitionDirection=left transitionDuration=0.7}',
      ),
    ).toEqual({ type: 'push', direction: 'left', duration: '0.7' });
  });

  it('reads a hand-typed transition from the {[…]} template params', () => {
    expect(readHeadingLineTransition('## Tips {[title transition=zoom]}')).toEqual({
      type: 'zoom',
      direction: '',
      duration: '',
    });
  });

  it('prefers the Pandoc block over the template params when both set it', () => {
    expect(
      readHeadingLineTransition('## Tips {transition=fade} {[title transition=zoom]}'),
    ).toEqual({ type: 'fade', direction: '', duration: '' });
  });
});

describe('setHeadingLineTransition', () => {
  it('adds a Pandoc block to a plain heading', () => {
    expect(setHeadingLineTransition('## Tips', { type: 'fade', direction: '', duration: '' })).toBe(
      '## Tips {transition=fade}',
    );
  });

  it('writes the Pandoc block before an existing {[…]} template annotation', () => {
    expect(
      setHeadingLineTransition('## Tips {[title]}', { type: 'fade', direction: '', duration: '' }),
    ).toBe('## Tips {transition=fade} {[title]}');
  });

  it('includes direction and duration when present', () => {
    expect(
      setHeadingLineTransition('## Tips', { type: 'push', direction: 'up', duration: '1.2' }),
    ).toBe('## Tips {transition=push transitionDirection=up transitionDuration=1.2}');
  });

  it('updates an existing transition in place, preserving other params and the id', () => {
    expect(
      setHeadingLineTransition('## Tips {#intro transition=fade x=10}', {
        type: 'zoom',
        direction: '',
        duration: '',
      }),
    ).toBe('## Tips {#intro x=10 transition=zoom}');
  });

  it('removes the transition (and an empty block) when set to none', () => {
    expect(setHeadingLineTransition('## Tips {transition=fade}', EMPTY_TRANSITION)).toBe('## Tips');
  });

  it('keeps a non-empty Pandoc block when only the transition is cleared', () => {
    expect(setHeadingLineTransition('## Tips {#intro transition=fade}', EMPTY_TRANSITION)).toBe(
      '## Tips {#intro}',
    );
  });

  it('drops direction/duration when the type is cleared', () => {
    expect(
      setHeadingLineTransition(
        '## Tips {transition=push transitionDirection=left}',
        EMPTY_TRANSITION,
      ),
    ).toBe('## Tips');
  });

  it('round-trips through read', () => {
    const next = { type: 'wipe', direction: 'right', duration: '0.5' };
    const line = setHeadingLineTransition('## Tips {[title]}', next);
    expect(readHeadingLineTransition(line)).toEqual(next);
  });

  it('leaves non-heading lines untouched', () => {
    expect(
      setHeadingLineTransition('paragraph', { type: 'fade', direction: '', duration: '' }),
    ).toBe('paragraph');
  });
});

describe('block-attrs (WYSIWYG) helpers', () => {
  it('reads from the dataBlockAttrs inner', () => {
    expect(readBlockAttrsTransition('#intro transition=fade', null)).toEqual({
      type: 'fade',
      direction: '',
      duration: '',
    });
  });

  it('reads a hand-typed transition from dataTemplateParams', () => {
    expect(readBlockAttrsTransition(null, 'transition=zoom x=1')).toEqual({
      type: 'zoom',
      direction: '',
      duration: '',
    });
  });

  it('writes a fresh inner when none exists', () => {
    expect(setBlockAttrsTransition(null, { type: 'fade', direction: '', duration: '' })).toBe(
      'transition=fade',
    );
  });

  it('preserves the id and clears to null when emptied', () => {
    expect(setBlockAttrsTransition('transition=fade', EMPTY_TRANSITION)).toBeNull();
    expect(setBlockAttrsTransition('#intro transition=fade', EMPTY_TRANSITION)).toBe('#intro');
  });
});
