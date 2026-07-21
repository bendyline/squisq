/**
 * TimelineTrack pointer-interaction contract.
 *
 * Regression: clicking (as opposed to dragging) an embedded `<video>` clip in
 * the timeline used to commit the drag on pointer-up, which rewrote the inline
 * video into a `{[video …]}` annotation — the "video turned into a tag" bug. A
 * bare click must never mutate the source; only an actual drag may.
 */

import { describe, it, expect, afterEach } from 'vitest';
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
  it('does not rewrite an embedded <video> into a tag on a plain click', () => {
    const clip = renderTimeline();
    const before = latestSource;

    firePointer(clip, 'pointerdown', 100);
    firePointer(window, 'pointerup', 100); // released without moving → a click

    expect(latestSource).toBe(before);
    expect(latestSource).not.toContain('{[video');
  });

  it('still converts the embed to a timed clip annotation on an actual drag', () => {
    const clip = renderTimeline();

    firePointer(clip, 'pointerdown', 100);
    firePointer(window, 'pointermove', 160); // 60px ≫ threshold → a real drag
    firePointer(window, 'pointerup', 160);

    expect(latestSource).toContain('{[video');
    expect(latestSource).toContain('rec.webm');
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
