/**
 * TimelineTrack pointer-interaction contract.
 *
 * Regression: timeline interaction used to rewrite embedded HTML media into
 * `{[video …]}` / `{[audio …]}` annotations. Clicks must not mutate source,
 * while timing drags must preserve the original playable HTML element.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { TimelineTrack } from '../TimelineTrack';

afterEach(cleanup);

const MD = [
  '# Intro {[duration=12]}',
  '',
  '<video src="video/rec.webm" controls width="240"></video>',
  '',
  '# Next {[duration=8]}',
  '',
  'Body text.',
  '',
].join('\n');

let latestSource = '';
function SourceProbe() {
  latestSource = useEditorContext().markdownSource;
  return null;
}

/**
 * Dispatch a pointer-type event carrying a real `clientX`. A `MouseEvent` with a
 * pointer type name gives us reliable coordinates (jsdom's `PointerEvent`
 * support is patchy) and satisfies both React's delegated `onPointerDown` and
 * the component's own `window` pointer listeners.
 */
function firePointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  });
}

function renderTimeline() {
  render(
    <EditorProvider initialMarkdown={MD} initialView="wysiwyg">
      <SourceProbe />
      <TimelineTrack />
    </EditorProvider>,
  );
  return screen.getByText('rec').closest('.squisq-timeline-clip') as HTMLElement;
}

describe('TimelineTrack embedded-clip interaction', () => {
  it('samples video frames across the background of a media bar', () => {
    const clip = renderTimeline();
    const filmstrip = clip.querySelector('.squisq-timeline-video-filmstrip');
    const frames = filmstrip?.querySelectorAll('video') ?? [];

    expect(filmstrip).not.toBeNull();
    expect(frames).toHaveLength(3);
    expect(frames[0]?.getAttribute('src')).toBe('video/rec.webm');
    expect(frames[0]?.getAttribute('preload')).toBe('metadata');
  });

  it('renders multiple videos in one block on independent tracks', () => {
    const multiVideoMarkdown = [
      '# Intro {[duration=12]}',
      '',
      '<video src="video/camera.webm" controls></video>',
      '<video src="video/screen.webm" controls></video>',
      '',
    ].join('\n');

    render(
      <EditorProvider initialMarkdown={multiVideoMarkdown} initialView="wysiwyg">
        <TimelineTrack />
      </EditorProvider>,
    );

    const cameraTrack = screen.getByText('camera').closest('[data-testid="timeline-media-track"]');
    const screenTrack = screen.getByText('screen').closest('[data-testid="timeline-media-track"]');
    expect(cameraTrack).not.toBeNull();
    expect(screenTrack).not.toBeNull();
    expect(cameraTrack).not.toBe(screenTrack);
    expect(screen.getAllByTestId('timeline-media-track')).toHaveLength(2);
  });

  it('plays embedded videos through one unmuted host even when a preview pane is visible', () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const multiVideoMarkdown = [
      '# Intro {[duration=12]}',
      '',
      '<video src="video/camera.webm" controls></video>',
      '<video src="video/screen.webm" controls></video>',
      '',
    ].join('\n');

    const { container } = render(
      <EditorProvider initialMarkdown={multiVideoMarkdown} initialView="wysiwyg">
        <TimelineTrack videoVisible />
      </EditorProvider>,
    );

    const playbackVideos = container.querySelectorAll(
      '.squisq-timeline-media-host video[data-clip-id]',
    );
    expect(playbackVideos).toHaveLength(2);
    expect([...playbackVideos].every((video) => !(video as HTMLVideoElement).muted)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    for (const video of playbackVideos) {
      expect(play.mock.instances).toContain(video);
    }
  });

  it('keeps overlapping unlocked videos visible as dedicated tracks', () => {
    const unlockedVideoMarkdown = [
      '# Intro {[duration=12]}',
      '',
      '<video src="video/presenter.webm" controls data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>',
      '<video src="video/slides.webm" controls data-squisq-video-placement="picture-in-picture" data-squisq-video-lock-to-block="false"></video>',
      '',
    ].join('\n');

    render(
      <EditorProvider initialMarkdown={unlockedVideoMarkdown} initialView="wysiwyg">
        <TimelineTrack />
      </EditorProvider>,
    );

    const presenterTrack = screen
      .getByText('presenter')
      .closest('[data-testid="timeline-media-track"]');
    const slidesTrack = screen.getByText('slides').closest('[data-testid="timeline-media-track"]');
    expect(presenterTrack).not.toBeNull();
    expect(slidesTrack).not.toBeNull();
    expect(presenterTrack).not.toBe(slidesTrack);
  });

  it('does not rewrite an embedded <video> into a tag on a plain click', () => {
    const clip = renderTimeline();
    const before = latestSource;

    firePointer(clip, 'pointerdown', 100);
    firePointer(window, 'pointerup', 100); // released without moving → a click

    expect(latestSource).toBe(before);
    expect(latestSource).not.toContain('{[video');
  });

  it('keeps the inline video playable and writes timing attributes on a drag', () => {
    const clip = renderTimeline();

    firePointer(clip, 'pointerdown', 100);
    firePointer(window, 'pointermove', 160); // 60px ≫ threshold → a real drag
    firePointer(window, 'pointerup', 160);

    expect(latestSource).toContain('<video src="video/rec.webm"');
    expect(latestSource).toContain('data-squisq-video-start-at=');
    expect(latestSource).toContain('data-squisq-video-clip-end="12"');
    expect(latestSource).not.toContain('{[video');
  });

  it('keeps inline audio as HTML when its start is dragged', () => {
    const audioMarkdown = [
      '# Intro {[duration=12]}',
      '',
      '<audio src="audio/take.webm" controls></audio>',
      '',
    ].join('\n');
    render(
      <EditorProvider initialMarkdown={audioMarkdown} initialView="wysiwyg">
        <SourceProbe />
        <TimelineTrack />
      </EditorProvider>,
    );
    const clip = screen.getByText('take.webm').closest('.squisq-timeline-clip') as HTMLElement;

    firePointer(clip, 'pointerdown', 100);
    firePointer(window, 'pointermove', 160);
    firePointer(window, 'pointerup', 160);

    expect(latestSource).toContain('<audio src="audio/take.webm" controls');
    expect(latestSource).toContain('data-squisq-audio-start-at=');
    expect(latestSource).toContain('data-squisq-audio-clip-end="12"');
    expect(latestSource).not.toContain('{[audio');
  });
});

describe('TimelineTrack item menus', () => {
  it('moves the block sliders properties into the block options menu', () => {
    renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Block options for Intro' }));

    const autotime = screen.getByRole('checkbox', { name: 'Autotime block' });
    expect((autotime as HTMLInputElement).checked).toBe(false);
    fireEvent.click(autotime);
    expect(latestSource.split('\n')[0]).not.toContain('duration=');

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Block start time in seconds' }), {
      target: { value: '2.5' },
    });
    expect(latestSource.split('\n')[0]).toContain('startTime=2.5');

    fireEvent.click(screen.getByTitle('Block transition'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Fade' }));
    expect(latestSource.split('\n')[0]).toContain('transition=fade');
  });

  it('edits video placement, locking, PIP size, shape, and position', () => {
    renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Video options for rec' }));
    fireEvent.click(screen.getByRole('button', { name: 'PIP' }));
    expect(latestSource).toContain('data-squisq-video-placement="picture-in-picture"');

    const lock = screen.getByRole('checkbox', { name: 'Lock to block' });
    expect((lock as HTMLInputElement).checked).toBe(true);
    fireEvent.click(lock);
    expect(latestSource).toContain('data-squisq-video-lock-to-block="false"');

    fireEvent.change(screen.getByRole('combobox', { name: 'Picture-in-picture size' }), {
      target: { value: 'large' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Picture-in-picture shape' }), {
      target: { value: 'wide' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Picture-in-picture position' }), {
      target: { value: 'top-left' },
    });
    expect(latestSource).toContain('data-squisq-video-pip-size="large"');
    expect(latestSource).toContain('data-squisq-video-pip-shape="wide"');
    expect(latestSource).toContain('data-squisq-video-pip-position="top-left"');
  });
});

describe('TimelineTrack narration-timed geometry', () => {
  // A caller (EditorShell) passes the narration-timed projection so the bars
  // match what plays. Bar geometry must come from that doc, not the editor's
  // raw parse — otherwise the playhead and the composition disagree.
  it('positions block bars from the passed doc, not the editor context doc', () => {
    const timedDoc = {
      articleId: 't',
      duration: 18,
      audio: { segments: [] },
      blocks: [
        { id: 'b0', title: 'Alpha', startTime: 0, duration: 10, audioSegment: 0 },
        { id: 'b1', title: 'Bravo', startTime: 10, duration: 8, audioSegment: 0 },
      ],
    } as unknown as Doc;

    render(
      <EditorProvider initialMarkdown={'# Intro\n\nbody\n\n# Next\n\nmore\n'} initialView="wysiwyg">
        <TimelineTrack doc={timedDoc} />
      </EditorProvider>,
    );

    // Bars come from the passed doc; the context doc's headings are not used.
    const bravo = screen.getByTitle(/Bravo/).closest('.squisq-timeline-block') as HTMLElement;
    expect(bravo).not.toBeNull();
    // startTime 10s × the default 18px/s ruler scale = 180px.
    expect(bravo.style.left).toBe('180px');
    expect(screen.queryByTitle(/Intro/)).toBeNull();
  });
});

describe('TimelineTrack block-edge drags', () => {
  // All pixel math uses the default 18 px/s ruler scale.
  it('writes a duration pin when a block right edge is dragged', () => {
    renderTimeline();
    const intro = screen.getByTitle(/Intro/) as HTMLElement;
    const edge = intro.querySelector('.squisq-timeline-edge--right') as HTMLElement;

    firePointer(edge, 'pointerdown', 300);
    firePointer(window, 'pointermove', 336); // +36px = +2s
    firePointer(window, 'pointerup', 336);

    expect(latestSource.split('\n')[0]).toBe('# Intro {[duration=14]}');
  });

  it('live-previews the ripple: the following bar tracks the dragged edge', () => {
    renderTimeline();
    const intro = screen.getByTitle(/Intro/) as HTMLElement;
    const next = screen.getByTitle(/Next/) as HTMLElement;
    expect(next.style.left).toBe(`${12 * 18}px`);

    const edge = intro.querySelector('.squisq-timeline-edge--right') as HTMLElement;
    firePointer(edge, 'pointerdown', 300);
    firePointer(window, 'pointermove', 336); // +2s
    // The dragged bar previews at 14s and the next bar follows its end — the
    // same contiguous layout the committed narration ripple produces, so the
    // preview is WYSIWYG rather than a re-flow the commit walks back.
    expect(intro.style.width).toBe(`${14 * 18}px`);
    expect(next.style.left).toBe(`${14 * 18}px`);
    firePointer(window, 'pointerup', 336);
  });

  it('dragging a block left edge resizes the previous block (boundary move)', () => {
    renderTimeline();
    const next = screen.getByTitle(/Next/) as HTMLElement;
    const edge = next.querySelector('.squisq-timeline-edge--left') as HTMLElement;

    firePointer(edge, 'pointerdown', 216);
    firePointer(window, 'pointermove', 198); // −18px = −1s
    firePointer(window, 'pointerup', 198);

    expect(latestSource.split('\n')[0]).toBe('# Intro {[duration=11]}');
    // The boundary belongs to the previous block; the dragged block keeps its pin.
    expect(latestSource).toContain('# Next {[duration=8]}');
  });

  it('a bare click on a block edge never writes a pin', () => {
    renderTimeline();
    const before = latestSource;
    const intro = screen.getByTitle(/Intro/) as HTMLElement;
    const edge = intro.querySelector('.squisq-timeline-edge--right') as HTMLElement;

    firePointer(edge, 'pointerdown', 300);
    firePointer(window, 'pointerup', 302); // < 4px travel — a click, not a drag

    expect(latestSource).toBe(before);
  });
});
