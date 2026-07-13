/**
 * Registry and ownership behavior for TimelineViewExtension. These tests
 * exercise the stable position registry that keeps the mounted editor alive
 * across unrelated edits and its own canonical fence rewrites.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import {
  TimelineViewExtension,
  TIMELINE_VIEW_KEY,
  findTimelineBlockPos,
} from '../TimelineViewExtension';
import { AsciiDiagramExtension, ASCII_DIAGRAM_KEY } from '../../asciiDiagram/AsciiDiagramExtension';
import { replaceAsciiFenceText } from '../../asciiDiagram/asciiDiagramCommands';
import { TreeViewExtension, TREEVIEW_KEY } from '../../treeview/TreeViewExtension';

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

const TIMELINE = 'Milestones: ● Start {#start} ─────● Review {#review} ─────● Ship {#ship} ───►';
const TIMELINE_B = 'Releases: ● Alpha {#alpha} ─────○ Beta {#beta} ───►';
const ONE_POINT_TIMELINE = 'Milestones: ● Start {#start} ─────►';
const TREE = ['src/', '├── index.ts', '└── utils/', '    └── math.ts'].join('\n');
const DIAGRAM = [
  '┌────────┐',
  '│ Alpha  │',
  '└────┬───┘',
  '     ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

let editors: Editor[] = [];

function makeEditor(markdown: string, options?: { enabled?: boolean }): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      AsciiDiagramExtension,
      options ? TimelineViewExtension.configure(options) : TimelineViewExtension,
      TreeViewExtension,
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

const timelineEntries = (editor: Editor) => TIMELINE_VIEW_KEY.getState(editor.state)?.entries ?? [];
const diagramEntries = (editor: Editor) => ASCII_DIAGRAM_KEY.getState(editor.state)?.entries ?? [];
const treeEntries = (editor: Editor) => TREEVIEW_KEY.getState(editor.state)?.entries ?? [];

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

describe('TimelineViewExtension registry', () => {
  it('detects untagged and explicit timeline fences with distinct block ids', () => {
    const editor = makeEditor(
      '```\n' + TIMELINE + '\n```\n\n```timeline\n' + TIMELINE_B + '\n```\n',
    );

    const entries = timelineEntries(editor);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it('ignores real-language and non-timeline fences', () => {
    const editor = makeEditor(
      '```ts\n' + TIMELINE + '\n```\n\n```\nplain code\nwithout a timeline\n```\n',
    );
    expect(timelineEntries(editor)).toHaveLength(0);
  });

  it('is mutually exclusive with diagram and tree fence editors', () => {
    const editor = makeEditor(
      '```\n' + TIMELINE + '\n```\n\n```\n' + DIAGRAM + '\n```\n\n```\n' + TREE + '\n```\n',
    );

    expect(timelineEntries(editor)).toHaveLength(1);
    expect(diagramEntries(editor)).toHaveLength(1);
    expect(treeEntries(editor)).toHaveLength(1);
  });

  it('keeps a block id stable when content above shifts its position', () => {
    const editor = makeEditor('Before.\n\n```\n' + TIMELINE + '\n```\n');
    const [before] = timelineEntries(editor);

    editor.commands.insertContentAt(0, '<p>Inserted above</p>');

    const [after] = timelineEntries(editor);
    expect(after.id).toBe(before.id);
    expect(after.pos).toBeGreaterThan(before.pos);
    expect(findTimelineBlockPos(editor, before.id)).toBe(after.pos);
  });

  it('survives a self-rewrite that promotes the fence language', () => {
    const editor = makeEditor('```text\n' + TIMELINE + '\n```\n');
    const [before] = timelineEntries(editor);
    const rewritten = TIMELINE.replace('Review', 'Verify');

    expect(replaceAsciiFenceText(editor, before.pos, rewritten, 'timeline')).toBe(true);

    const [after] = timelineEntries(editor);
    expect(after.id).toBe(before.id);
    expect(findTimelineBlockPos(editor, before.id)).toBe(after.pos);
    expect(fenceOf(editor)).toEqual({ text: rewritten, language: 'timeline' });
  });

  it('keeps an already registered fence interactive after it degrades to one point', () => {
    const editor = makeEditor('```\n' + TIMELINE + '\n```\n');
    const [before] = timelineEntries(editor);

    expect(replaceAsciiFenceText(editor, before.pos, ONE_POINT_TIMELINE)).toBe(true);

    const entries = timelineEntries(editor);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(before.id);
  });

  it('drops a registered fence after an invalid rewrite', () => {
    const editor = makeEditor('```\n' + TIMELINE + '\n```\n');
    const [entry] = timelineEntries(editor);

    expect(replaceAsciiFenceText(editor, entry.pos, 'plain text\nno points or rail')).toBe(true);
    expect(timelineEntries(editor)).toHaveLength(0);
  });

  it('enabled: false leaves the extension inert', () => {
    const editor = makeEditor('```timeline\n' + TIMELINE + '\n```\n', { enabled: false });
    expect(TIMELINE_VIEW_KEY.getState(editor.state)).toBeUndefined();
  });
});
