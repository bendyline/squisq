import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseAsciiTimeline, renderAsciiTimeline, type AsciiTimeline } from '@bendyline/squisq/doc';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { TimelineEditorWidget } from '../TimelineEditorWidget';
import { TIMELINE_VIEW_KEY, TimelineViewExtension } from '../TimelineViewExtension';
import { useTimelineData, type TimelineViewData } from '../timelineData';

const TIMELINE: AsciiTimeline = {
  tracks: [
    {
      id: 'kernel',
      label: 'Kernel',
      row: 0,
      startColumn: 0,
      endColumn: 100,
      events: [
        { id: 'start', label: 'Start', column: 0, side: 'above', marker: 'filled' },
        { id: 'review', label: 'Review', column: 50, side: 'below', marker: 'hollow' },
      ],
    },
    {
      id: 'client',
      label: 'Client',
      row: 1,
      startColumn: 0,
      endColumn: 100,
      events: [
        {
          id: 'frame',
          label: 'f',
          column: 25,
          side: 'above',
          callout: false,
          marker: 'hollow',
        },
        { id: 'paint', label: 'Paint', column: 100, side: 'below', marker: 'filled' },
      ],
    },
  ],
  links: [{ source: 'review', target: 'paint', label: 'handoff' }],
  width: 101,
  height: 2,
  style: 'unicode',
  warnings: [],
};

const ART = renderAsciiTimeline(TIMELINE);
const editors: Editor[] = [];

beforeAll(() => {
  if (typeof globalThis.PointerEvent !== 'undefined') return;
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventStub as typeof PointerEvent;
});

function makeEditor(editable = true, art = ART): Editor {
  const editor = new Editor({
    editable,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      TimelineViewExtension,
    ],
    content: markdownToTiptap(`\`\`\`timeline\n${art}\n\`\`\`\n`),
  });
  editors.push(editor);
  return editor;
}

function blockIdOf(editor: Editor): string {
  const entries = TIMELINE_VIEW_KEY.getState(editor.state)?.entries ?? [];
  expect(entries).toHaveLength(1);
  return entries[0].id;
}

function renderWidget(editable = true): Editor {
  const editor = makeEditor(editable);
  render(<TimelineEditorWidget editor={editor} blockId={blockIdOf(editor)} />);
  return editor;
}

function timelineOf(editor: Editor): AsciiTimeline {
  let fence = '';
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'codeBlock') return true;
    fence = node.textContent;
    return false;
  });
  return parseAsciiTimeline(fence);
}

function eventOf(editor: Editor, id: string) {
  return timelineOf(editor)
    .tracks.flatMap((track) => track.events)
    .find((event) => event.id === id);
}

function trackOf(editor: Editor, id: string) {
  return timelineOf(editor).tracks.find((track) => track.id === id);
}

afterEach(() => {
  cleanup();
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe('TimelineEditorWidget', () => {
  it('creates, renames, selects, and deletes timeline lines', async () => {
    const editor = renderWidget();
    expect(screen.queryByRole('textbox', { name: 'Rename line: Kernel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename line: Kernel' }));
    expect(
      (screen.getByRole('textbox', { name: 'Rename line: Kernel' }) as HTMLInputElement).value,
    ).toBe('Kernel');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename line: Kernel' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('textbox', { name: 'Rename line: Kernel' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Add line/ }));

    await waitFor(() => expect(trackOf(editor, 'new-line')).toBeTruthy());
    expect(timelineOf(editor).tracks).toHaveLength(3);
    expect(trackOf(editor, 'new-line')?.events).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Edit New event, New line/ })).toBeTruthy();
    const lineName = screen.getByRole('textbox', {
      name: 'Rename line: New line',
    }) as HTMLInputElement;
    expect(lineName.value).toBe('New line');

    fireEvent.change(lineName, { target: { value: 'Release' } });
    fireEvent.blur(lineName);
    await waitFor(() => expect(trackOf(editor, 'new-line')?.label).toBe('Release'));
    expect(screen.getByRole('group', { name: 'Release timeline rail' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete line: Release' }));
    await waitFor(() => expect(trackOf(editor, 'new-line')).toBeUndefined());
    expect(timelineOf(editor).tracks).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Rename line: Kernel' })).toBeTruthy();
  });

  it('selects different dots, including a cadence-only dot, and exposes branches', async () => {
    const editor = makeEditor();
    const rendered = render(<TimelineEditorWidget editor={editor} blockId={blockIdOf(editor)} />);

    const start = screen.getByRole('button', { name: /Edit Start, Kernel/ });
    await waitFor(() => expect(start.getAttribute('aria-pressed')).toBe('true'));

    const review = screen.getByRole('button', { name: /Edit Review, Kernel/ });
    fireEvent.click(review);
    expect(review.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Review');

    const cadence = screen.getByRole('button', { name: /Edit f, Client/ });
    fireEvent.click(cadence);
    expect(cadence.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('f');

    const branchList = screen.getByRole('list', { name: 'Timeline branches' });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(branchList.textContent).toContain('review');
    expect(branchList.textContent).toContain('paint');
    expect(branchList.textContent).toContain('handoff');
    expect(
      rendered.container.querySelectorAll('.squisq-ascii-timeline-branches path'),
    ).toHaveLength(1);
  });

  it('rewrites label and callout text on blur while preserving the event id and branch', async () => {
    const editor = renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /Edit Review, Kernel/ }));

    const label = screen.getByLabelText('Label') as HTMLInputElement;
    fireEvent.change(label, { target: { value: 'Gate' } });
    fireEvent.blur(label);

    await waitFor(() => expect(eventOf(editor, 'review')?.label).toBe('Gate'));
    expect(timelineOf(editor).links).toEqual([
      { source: 'review', target: 'paint', label: 'handoff' },
    ]);

    const callout = screen.getByLabelText('Callout text') as HTMLTextAreaElement;
    fireEvent.change(callout, { target: { value: 'Interpolate the latest snapshot' } });
    fireEvent.blur(callout);

    await waitFor(() =>
      expect(eventOf(editor, 'review')?.description).toBe('Interpolate the latest snapshot'),
    );
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Gate');
    expect(
      screen.getByRole('button', { name: /Edit Gate, Kernel/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('adds one point on an armed rail, then returns to selection mode', async () => {
    const editor = renderWidget();
    const rail = screen.getByRole('group', { name: 'Kernel timeline rail' });
    rail.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 0,
        left: 100,
        top: 0,
        right: 500,
        bottom: 40,
        width: 400,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect;

    const addPoint = screen.getByRole('button', { name: 'Add point to Kernel timeline' });
    expect(addPoint.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(addPoint);
    expect(addPoint.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Click the line to add a point · Esc to cancel')).toBeTruthy();

    fireEvent.click(rail, { clientX: 240 });

    await waitFor(() => expect(eventOf(editor, 'new-event')?.column).toBe(35));
    const marker = screen.getByRole('button', { name: /Edit New event, Kernel/ });
    expect(marker.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('New event');
    expect(screen.getByText('New timeline point added. Edit its text below.')).toBeTruthy();
    expect(addPoint.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Use + to add a point · Drag dots to move')).toBeTruthy();

    fireEvent.click(rail, { clientX: 400 });
    await Promise.resolve();
    expect(timelineOf(editor).tracks[0].events).toHaveLength(3);
    expect(eventOf(editor, 'new-event-2')).toBeUndefined();
  });

  it('previews a dragged dot and commits its new position only on drop', async () => {
    const editor = renderWidget();
    const rail = screen.getByRole('group', { name: 'Kernel timeline rail' });
    rail.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 0,
        left: 100,
        top: 0,
        right: 500,
        bottom: 40,
        width: 400,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect;

    const review = screen.getByRole('button', { name: /Edit Review, Kernel/ });
    fireEvent.pointerDown(review, { pointerId: 7, button: 0, clientX: 300 });
    fireEvent.pointerMove(review, { pointerId: 7, clientX: 400 });

    await waitFor(() =>
      expect(review.closest('.squisq-ascii-timeline-point')?.getAttribute('style')).toContain(
        '75%',
      ),
    );
    expect(eventOf(editor, 'review')?.column).toBe(50);
    expect(screen.queryAllByRole('button', { name: /Add point to Kernel at/ })).toHaveLength(0);

    fireEvent.pointerUp(review, { pointerId: 7, button: 0, clientX: 400 });

    await waitFor(() => expect(eventOf(editor, 'review')?.column).toBe(75));
    expect(screen.getByText('Review moved to 75 percent.')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /Edit Review, Kernel, 75 percent/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('cancels a pointer drag without rewriting the timeline', async () => {
    const editor = renderWidget();
    const rail = screen.getByRole('group', { name: 'Kernel timeline rail' });
    rail.getBoundingClientRect = () =>
      ({ left: 0, right: 400, top: 0, bottom: 40, width: 400, height: 40 }) as DOMRect;
    const before = JSON.stringify(editor.state.doc.toJSON());
    const review = screen.getByRole('button', { name: /Edit Review, Kernel/ });

    fireEvent.pointerDown(review, { pointerId: 8, button: 0, clientX: 200 });
    fireEvent.pointerMove(review, { pointerId: 8, clientX: 320 });
    fireEvent.pointerCancel(review, { pointerId: 8 });

    await waitFor(() => expect(screen.getByText('Timeline point move cancelled.')).toBeTruthy());
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
    expect(eventOf(editor, 'review')?.column).toBe(50);
  });

  it('always exposes a keyboard-reachable add-point control for each track', async () => {
    const editor = renderWidget();
    const addPoint = screen.getByRole('button', { name: 'Add point to Kernel timeline' });
    fireEvent.click(addPoint);
    expect(addPoint.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Add point to Kernel at 25 percent' }));

    await waitFor(() => expect(eventOf(editor, 'new-event')?.column).toBe(25));
    expect(screen.getByRole('button', { name: /Edit New event, Kernel/ })).toBeTruthy();
    expect(addPoint.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps dots selectable but prevents every mutation in read-only mode', async () => {
    const editor = renderWidget(false);
    const before = JSON.stringify(editor.state.doc.toJSON());
    expect(screen.getByText('Read only')).toBeTruthy();

    const review = screen.getByRole('button', { name: /Edit Review, Kernel/ });
    fireEvent.click(review);
    expect(review.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Review');
    expect(
      (screen.getByLabelText('Label').closest('fieldset') as HTMLFieldSetElement).disabled,
    ).toBe(true);

    const rail = screen.getByRole('group', { name: 'Kernel timeline rail' });
    fireEvent.click(rail, { clientX: 200 });
    await Promise.resolve();
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
    expect(screen.queryByRole('button', { name: /Add point to Kernel at/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add point to Kernel timeline' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add line/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename line: Kernel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete line: Kernel' })).toBeNull();
  });

  it('reacts when a mounted editor toggles between editable and read-only', async () => {
    const editor = renderWidget();
    expect(screen.getByRole('button', { name: 'Add point to Kernel timeline' })).toBeTruthy();

    editor.setEditable(false);
    await screen.findByText('Read only');
    expect(screen.queryByRole('button', { name: 'Add point to Kernel timeline' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add line/ })).toBeNull();
    expect(
      (screen.getByLabelText('Label').closest('fieldset') as HTMLFieldSetElement).disabled,
    ).toBe(true);

    editor.setEditable(true);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add point to Kernel timeline' })).toBeTruthy(),
    );
  });

  it('retains parsed timeline identity across unrelated editor transactions', async () => {
    const editor = makeEditor();
    const blockId = blockIdOf(editor);
    const observed: TimelineViewData[] = [];
    function Probe() {
      const data = useTimelineData(editor, blockId);
      if (data) observed.push(data);
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(observed.length).toBeGreaterThan(0));
    const first = observed[observed.length - 1];

    act(() => {
      editor.commands.insertContentAt(0, '<p>Unrelated content</p>');
    });

    await waitFor(() => expect(observed.length).toBeGreaterThan(1));
    expect(observed[observed.length - 1]).toBe(first);
    expect(observed[observed.length - 1]?.timeline).toBe(first.timeline);
  });

  it('pauses visual mutations when source cannot be rewritten losslessly', async () => {
    const unsafeArt = `${ART}\nbranch: review -> missing : preserve me`;
    const editor = makeEditor(true, unsafeArt);
    render(<TimelineEditorWidget editor={editor} blockId={blockIdOf(editor)} />);
    const before = JSON.stringify(editor.state.doc.toJSON());

    expect(screen.getByText('Source repair needed')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Visual editing paused');
    expect(screen.queryByRole('button', { name: 'Add point to Kernel timeline' })).toBeNull();
    expect(
      (screen.getByLabelText('Label').closest('fieldset') as HTMLFieldSetElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Edit Review, Kernel/ }));
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Review');
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
  });

  it('keeps mounted widget input events out of the underlying ProseMirror selection', async () => {
    const editor = makeEditor();
    render(<EditorContent editor={editor} />);

    const review = await screen.findByRole('button', { name: /Edit Review, Kernel/ });
    fireEvent.click(review);
    const label = screen.getByLabelText('Label') as HTMLInputElement;
    fireEvent.change(label, { target: { value: 'Gate' } });
    fireEvent.blur(label);

    await waitFor(() => expect(eventOf(editor, 'review')?.label).toBe('Gate'));
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(editor.state.doc.firstChild?.textContent).toContain('Gate');
  });
});
