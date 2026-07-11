import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import type { Doc, Transition } from '@bendyline/squisq/schemas';
import { buildPreviewDoc } from '../buildPreviewDoc';

function previewSlides(md: string) {
  const doc = markdownToDoc(parseMarkdown(md), { articleId: 't' });
  return buildPreviewDoc(doc).blocks as unknown as Array<{ transition?: Transition }>;
}

describe('buildPreviewDoc transition mapping', () => {
  it('carries an authored transition through to the player slide', () => {
    // Legacy Pandoc transition syntax remains supported.
    const md = ['# Intro', '', '# Second {transition=vortex}', '', 'body'].join('\n');
    const slides = previewSlides(md);
    expect(slides[1].transition).toEqual({ type: 'vortex' });
  });

  it('preserves direction and duration on the transition', () => {
    const md = [
      '# Intro',
      '',
      '# Second {transition=push transitionDirection=up transitionDuration=1.2}',
    ].join('\n');
    const slides = previewSlides(md);
    expect(slides[1].transition).toEqual({ type: 'push', direction: 'up', duration: 1.2 });
  });

  it('falls back to the default fade for a non-first block with no transition', () => {
    const md = ['# Intro', '', '# Second'].join('\n');
    const slides = previewSlides(md);
    expect(slides[1].transition).toEqual({ type: 'fade', duration: 0.5 });
  });

  it('leaves the first block without a transition when none is authored', () => {
    const slides = previewSlides(['# Intro', '', '# Second'].join('\n'));
    expect(slides[0].transition).toBeUndefined();
  });

  it('honors a transition authored on the first block', () => {
    const slides = previewSlides(['# Intro {transition=zoom}', '', '# Second'].join('\n'));
    expect(slides[0].transition).toEqual({ type: 'zoom' });
  });

  // The `{[name key=value]}` template-annotation form is the one the editor's
  // attribute autocomplete advertises for `transition=`. The coerced typed
  // transition object also rides along as a raw string in the block's
  // templateData; if that string is spread over the typed field it silently
  // downgrades `{ type: 'vortex' }` to the string `'vortex'`, which the player
  // can't animate. These guard that the typed object wins.
  describe('transition written inside a {[…]} template annotation', () => {
    it('keeps a bare transition as a typed object, not a raw string', () => {
      const md = ['# Intro', '', '## Second {[quote transition=vortex]}', '', '> hi'].join('\n');
      const slides = previewSlides(md);
      expect(slides[1].transition).toEqual({ type: 'vortex' });
      expect(typeof slides[1].transition).toBe('object');
    });

    it('preserves direction and duration from the annotation', () => {
      const md = [
        '# Intro',
        '',
        '## Second {[factCard transition=push transitionDirection=left transitionDuration=0.8]}',
        '',
        'body',
      ].join('\n');
      const slides = previewSlides(md);
      expect(slides[1].transition).toEqual({ type: 'push', direction: 'left', duration: 0.8 });
    });
  });

  it('preserves document-wide fields and mapped audio', () => {
    const source = markdownToDoc(parseMarkdown('# Intro'), { articleId: 'full' }) as Doc;
    const enriched = {
      ...source,
      frontmatter: { owner: 'team' },
      customThemes: [{ id: 'custom-theme' }],
      persistentLayers: { layers: [] },
      documentMedia: [{ id: 'bed', kind: 'audio', src: 'bed.mp3', startTime: 0 }],
      audio: {
        segments: [{ src: 'narration.mp3', name: 'narration', duration: 4, startTime: 0 }],
      },
    } as unknown as Doc;
    const preview = buildPreviewDoc(enriched);
    expect(preview.frontmatter).toEqual({ owner: 'team' });
    expect(preview.customThemes).toBe(enriched.customThemes);
    expect(preview.persistentLayers).toBe(enriched.persistentLayers);
    expect(preview.documentMedia).toBe(enriched.documentMedia);
    expect(preview.audio).toBe(enriched.audio);
  });
});
