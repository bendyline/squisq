/**
 * RepairableDiagramExtension: a broken box-art fence gets a repair entry (and
 * the inline button); applying the repair rewrites it to clean, `diagram`-
 * tagged art that the AsciiDiagramExtension then claims. One undo restores the
 * original broken bytes.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { detectAsciiDiagram } from '@bendyline/squisq/doc';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { AsciiDiagramExtension, ASCII_DIAGRAM_KEY } from '../AsciiDiagramExtension';
import { RepairableDiagramExtension, REPAIRABLE_KEY } from '../RepairableDiagramExtension';
import { applyRepairCommand } from '../asciiDiagramCommands';

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

// Broken box art: labels overflow + collide, so the columns desync row-to-row
// and conservative detection declines it.
const BROKEN = [
  '┌──────────┐   ┌──────────┐',
  '│ @scope/alpha-svc  │   │ @scope/beta-svc   │',
  '│ one      │   │ two      │',
  '└────┬─────┘   └────┬─────┘',
  '     │              │',
  '     ▼              ▼',
  '┌────────────────────────────┐',
  '│ @scope/gamma-store         │',
  '│ persists                   │',
  '└────────────────────────────┘',
].join('\n');

const CLEAN = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

let editors: Editor[] = [];

function makeEditor(md: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      AsciiDiagramExtension,
      RepairableDiagramExtension.configure({ onRepair: applyRepairCommand }),
    ],
    content: markdownToTiptap(md),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
});

const fenced = (art: string) => '```\n' + art + '\n```\n';

function fenceOf(editor: Editor): { text: string; language: string | null } {
  let text = '';
  let language: string | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock' && text === '') {
      text = node.textContent;
      language = (node.attrs as { language?: string | null }).language ?? null;
      return false;
    }
    return true;
  });
  return { text, language };
}

function repairId(editor: Editor): string | undefined {
  return REPAIRABLE_KEY.getState(editor.state)?.entries[0]?.id;
}

describe('RepairableDiagramExtension', () => {
  it('registers a repair entry for broken box art', () => {
    const editor = makeEditor(fenced(BROKEN));
    expect(REPAIRABLE_KEY.getState(editor.state)?.entries.length).toBe(1);
    // …and the AsciiDiagramExtension does NOT claim it (garbled labels).
    expect(ASCII_DIAGRAM_KEY.getState(editor.state)?.entries.length).toBe(0);
  });

  it('offers no button for a CLEAN diagram (the canvas handles it)', () => {
    const editor = makeEditor(fenced(CLEAN));
    expect(REPAIRABLE_KEY.getState(editor.state)?.entries.length).toBe(0);
    expect(ASCII_DIAGRAM_KEY.getState(editor.state)?.entries.length).toBe(1);
  });

  it('offers no button for ordinary prose fences', () => {
    const editor = makeEditor(fenced('just some\nplain prose\nlines here'));
    expect(REPAIRABLE_KEY.getState(editor.state)?.entries.length).toBe(0);
  });

  it('repairs the fence into clean, diagram-tagged art the canvas then claims', () => {
    const editor = makeEditor(fenced(BROKEN));
    const id = repairId(editor)!;
    expect(applyRepairCommand(editor, id)).toBe(true);

    const fence = fenceOf(editor);
    // Language promoted to the explicit `diagram` tag.
    expect(fence.language).toBe('diagram');
    // The art is now a clean, detectable diagram with the recovered labels.
    const detection = detectAsciiDiagram(fence.text);
    expect(detection.isDiagram).toBe(true);
    expect(fence.text).toContain('@scope/alpha-svc');
    expect(fence.text).toContain('@scope/gamma-store');
    // The repairable entry is gone; the AsciiDiagramExtension now claims it.
    expect(REPAIRABLE_KEY.getState(editor.state)?.entries.length).toBe(0);
    expect(ASCII_DIAGRAM_KEY.getState(editor.state)?.entries.length).toBe(1);
  });

  it('does not repair while the editor is read-only (BUG B)', () => {
    // The banner button may outlive the render that mounted it: a host can
    // flip the editor read-only between paint and click.
    const editor = makeEditor(fenced(BROKEN));
    const id = repairId(editor)!;
    const before = JSON.stringify(editor.state.doc.toJSON());

    editor.setEditable(false);

    expect(applyRepairCommand(editor, id)).toBe(false);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);

    editor.setEditable(true);
    expect(applyRepairCommand(editor, id)).toBe(true);
  });

  it('one undo restores the original broken art', () => {
    const editor = makeEditor(fenced(BROKEN));
    const before = fenceOf(editor).text;
    applyRepairCommand(editor, repairId(editor)!);
    expect(fenceOf(editor).text).not.toBe(before);
    editor.commands.undo();
    expect(fenceOf(editor).text).toBe(before);
    // …and it is a repair candidate again, NOT still claimed as a diagram
    // (the relaxed hysteresis gate must reject the garbled art).
    expect(REPAIRABLE_KEY.getState(editor.state)?.entries.length).toBe(1);
    expect(ASCII_DIAGRAM_KEY.getState(editor.state)?.entries.length).toBe(0);
  });

  it('is inert when disabled', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ heading: false }),
        RepairableDiagramExtension.configure({ enabled: false }),
      ],
      content: markdownToTiptap(fenced(BROKEN)),
    });
    editors.push(editor);
    expect(REPAIRABLE_KEY.getState(editor.state)).toBeUndefined();
  });
});
