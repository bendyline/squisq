/** Real Tiptap coverage for parse -> op -> render -> verified fence rewrite. */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseAsciiTimeline } from '@bendyline/squisq/doc';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { TIMELINE_VIEW_KEY, TimelineViewExtension } from '../TimelineViewExtension';
import { applyTimelineCommand, isTimelineSourceSafeForSemanticEdit } from '../timelineCommands';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

const ART = [
  'Milestones: ● Start {#start} ─────● Review {#review} ─────►',
  '',
  'branch: start -> review : flow',
].join('\n');

let editors: Editor[] = [];

function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      TimelineViewExtension,
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

function firstBlockId(editor: Editor): string {
  const state = TIMELINE_VIEW_KEY.getState(editor.state);
  expect(state?.entries).toHaveLength(1);
  return state!.entries[0].id;
}

function fenceOf(editor: Editor): { text: string; language: string | null } {
  let text = '';
  let language: string | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'codeBlock' || text) return true;
    text = node.textContent;
    language = (node.attrs as { language?: string | null }).language ?? null;
    return false;
  });
  return { text, language };
}

describe('applyTimelineCommand', () => {
  it('adds a point, returns its id, and promotes the language in one rewrite', () => {
    const editor = makeEditor('```text\n' + ART + '\n```\n');
    const blockId = firstBlockId(editor);
    expect(fenceOf(editor).language).toBe('text');

    const result = applyTimelineCommand(editor, blockId, {
      kind: 'addEvent',
      trackId: 'milestones',
      position: 0.5,
      label: 'Build',
    });

    expect(result).toEqual({ applied: true, eventId: 'build' });
    expect(fenceOf(editor).language).toBe('timeline');
    const parsed = parseAsciiTimeline(fenceOf(editor).text);
    expect(parsed.tracks[0].events.map((event) => event.id)).toContain('build');
  });

  it('updates text and keeps the selected id and branch endpoint stable', () => {
    const editor = makeEditor('```timeline\n' + ART + '\n```\n');
    const result = applyTimelineCommand(editor, firstBlockId(editor), {
      kind: 'updateEvent',
      eventId: 'start',
      patch: { label: 'Boot', description: 'Initialize the world', marker: 'diamond' },
    });

    expect(result).toEqual({ applied: true });
    const timeline = parseAsciiTimeline(fenceOf(editor).text);
    expect(timeline.tracks[0].events[0]).toMatchObject({
      id: 'start',
      label: 'Boot',
      description: 'Initialize the world',
      marker: 'diamond',
    });
    expect(timeline.links[0]).toMatchObject({ source: 'start', target: 'review' });
  });

  it('removes a point and its incident branch', () => {
    const editor = makeEditor('```timeline\n' + ART + '\n```\n');
    const result = applyTimelineCommand(editor, firstBlockId(editor), {
      kind: 'removeEvent',
      eventId: 'review',
    });

    expect(result).toEqual({ applied: true });
    const timeline = parseAsciiTimeline(fenceOf(editor).text);
    expect(timeline.tracks[0].events.map((event) => event.id)).toEqual(['start']);
    expect(timeline.links).toEqual([]);
  });

  it('keeps the block id stable over language promotion', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const before = firstBlockId(editor);
    const result = applyTimelineCommand(editor, before, {
      kind: 'updateEvent',
      eventId: 'start',
      patch: { label: 'Boot' },
    });
    expect(result.applied).toBe(true);
    expect(firstBlockId(editor)).toBe(before);
    expect(fenceOf(editor).language).toBe('timeline');
  });

  it('one undo restores the exact original fence bytes', () => {
    const editor = makeEditor('```text\n' + ART + '\n```\n');
    const blockId = firstBlockId(editor);
    const before = fenceOf(editor);
    expect(
      applyTimelineCommand(editor, blockId, {
        kind: 'updateEvent',
        eventId: 'start',
        patch: { label: 'Boot' },
      }).applied,
    ).toBe(true);
    expect(fenceOf(editor)).not.toEqual(before);

    editor.commands.undo();
    expect(fenceOf(editor)).toEqual(before);
  });

  it('leaves the document untouched for invalid/no-op commands', () => {
    const editor = makeEditor('```timeline\n' + ART + '\n```\n');
    const blockId = firstBlockId(editor);
    const before = JSON.stringify(editor.state.doc.toJSON());

    expect(
      applyTimelineCommand(editor, blockId, {
        kind: 'addEvent',
        trackId: 'milestones',
        position: 0,
      }),
    ).toEqual({ applied: false });
    expect(
      applyTimelineCommand(editor, blockId, {
        kind: 'updateEvent',
        eventId: 'missing',
        patch: { label: 'Nope' },
      }),
    ).toEqual({ applied: false });
    expect(
      applyTimelineCommand(editor, 'timeline-999', {
        kind: 'removeEvent',
        eventId: 'start',
      }),
    ).toEqual({ applied: false });
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
  });

  it('blocks edits when parse warnings represent unresolved source', () => {
    const unresolved = ART + '\nbranch: review -> missing : preserve this declaration';
    const editor = makeEditor('```timeline\n' + unresolved + '\n```\n');
    const before = fenceOf(editor);

    expect(
      applyTimelineCommand(editor, firstBlockId(editor), {
        kind: 'updateEvent',
        eventId: 'start',
        patch: { label: 'Boot' },
      }),
    ).toEqual({ applied: false, reason: 'unsafe-source' });
    expect(fenceOf(editor)).toEqual(before);
  });

  it.each([
    {
      name: 'an ignored prose line',
      art: ART + '\nauthor-note: preserve this raw line',
    },
    {
      name: 'an unrecognized inline attribute',
      art: ART.replace('{#start}', '{#start mood=urgent}'),
    },
  ])('blocks edits that would drop $name', ({ art }) => {
    const editor = makeEditor('```timeline\n' + art + '\n```\n');
    const before = fenceOf(editor);

    expect(
      applyTimelineCommand(editor, firstBlockId(editor), {
        kind: 'updateEvent',
        eventId: 'start',
        patch: { label: 'Boot' },
      }),
    ).toEqual({ applied: false, reason: 'unsafe-source' });
    expect(fenceOf(editor)).toEqual(before);
  });

  it.each([
    {
      name: 'punctuation after an otherwise valid id',
      art: ART.replace('{#start}', '{#start !!!}'),
    },
    {
      name: 'an invalid known attribute value made only from represented tokens',
      art: ART.replace('{#start}', '{#start side=Start}'),
    },
    {
      name: 'duplicate attributes',
      art: ART.replace('{#start}', '{#start side=above side=below}'),
    },
    {
      name: 'a malformed metadata block',
      art: ART.replace('{#start}', '{#start side=above'),
    },
  ])('fails closed for $name', ({ art }) => {
    const editor = makeEditor('```timeline\n' + art + '\n```\n');
    const before = fenceOf(editor);

    expect(
      applyTimelineCommand(editor, firstBlockId(editor), {
        kind: 'updateEvent',
        eventId: 'start',
        patch: { label: 'Boot' },
      }),
    ).toEqual({ applied: false, reason: 'unsafe-source' });
    expect(fenceOf(editor)).toEqual(before);
  });

  it.each([
    { name: 'a punctuation-only row', suffix: '!!!' },
    { name: 'ignored prose whose token already exists', suffix: 'Start' },
  ])('fails closed for $name', ({ suffix }) => {
    const art = `${ART}\n${suffix}`;
    const editor = makeEditor('```timeline\n' + art + '\n```\n');
    const before = fenceOf(editor);

    expect(
      applyTimelineCommand(editor, firstBlockId(editor), {
        kind: 'updateEvent',
        eventId: 'review',
        patch: { label: 'Gate' },
      }),
    ).toEqual({ applied: false, reason: 'unsafe-source' });
    expect(fenceOf(editor)).toEqual(before);
  });

  it('audits the supported 400-line maximum without quadratic reparsing', () => {
    const art = Array.from(
      { length: 400 },
      (_, index) =>
        `Track ${index}: ● A${index} {#a${index}} ─────────● B${index} {#b${index}} ─────►`,
    ).join('\n');
    const timeline = parseAsciiTimeline(art);
    const started = performance.now();

    expect(isTimelineSourceSafeForSemanticEdit(art, timeline)).toBe(true);
    // The former line-deletion probe took >1 s locally at this size. Leave a
    // generous CI margin while still guarding against reintroducing O(n²)
    // whole-document parsing into the synchronous editor path.
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('rejects stale commands after the editor becomes read-only', () => {
    const editor = makeEditor('```timeline\n' + ART + '\n```\n');
    const blockId = firstBlockId(editor);
    editor.setEditable(false);
    const before = fenceOf(editor);

    expect(
      applyTimelineCommand(editor, blockId, {
        kind: 'updateEvent',
        eventId: 'start',
        patch: { label: 'Boot' },
      }),
    ).toEqual({ applied: false, reason: 'read-only' });
    expect(fenceOf(editor)).toEqual(before);
  });
});
