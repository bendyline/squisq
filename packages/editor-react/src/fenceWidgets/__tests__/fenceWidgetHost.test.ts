/**
 * The containment contract every fence-widget host relies on: a mounted
 * widget's edit stream must never reach the ProseMirror editor that hosts it,
 * or the browser/IME interprets it a SECOND time as text insertion at the
 * document selection.
 */

import { describe, expect, it } from 'vitest';
import { containFenceWidgetEvents, FENCE_WIDGET_CONTAINED_EVENTS } from '../fenceWidgetHost';

/**
 * Hardcoded ON PURPOSE. Deriving this from FENCE_WIDGET_CONTAINED_EVENTS would
 * make the test tautological: shrinking the constant would shrink the
 * assertions with it and the suite would pass against the very drift it is
 * meant to catch (verified — an earlier version of this test did exactly that).
 */
const MUST_BE_CONTAINED = [
  'pointerdown',
  'mousedown',
  'keydown',
  'keyup',
  'beforeinput',
  'input',
  'change',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'paste',
  'cut',
];

describe('containFenceWidgetEvents', () => {
  it('stops every contained event before it reaches an ancestor', () => {
    const editorDom = document.createElement('div');
    const host = document.createElement('div');
    const input = document.createElement('input');
    host.appendChild(input);
    editorDom.appendChild(host);
    document.body.appendChild(editorDom);

    const escaped: string[] = [];
    for (const name of MUST_BE_CONTAINED) {
      editorDom.addEventListener(name, () => escaped.push(name));
    }

    containFenceWidgetEvents(host);

    // Dispatch from the innermost control — the realistic origin.
    for (const name of MUST_BE_CONTAINED) {
      input.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
    }

    expect(escaped).toEqual([]);
    editorDom.remove();
  });

  it('covers the text-input, composition and clipboard stream, not just pointer/keys', () => {
    // Regression guard for the drift that started this: the diagram and tree
    // hosts stopped ONLY mousedown + keydown, so IME/paste/beforeinput leaked.
    expect([...FENCE_WIDGET_CONTAINED_EVENTS].sort()).toEqual([...MUST_BE_CONTAINED].sort());
  });

  it('leaves unrelated events free to bubble', () => {
    const editorDom = document.createElement('div');
    const host = document.createElement('div');
    editorDom.appendChild(host);
    containFenceWidgetEvents(host);

    let seen = false;
    editorDom.addEventListener('focusin', () => {
      seen = true;
    });
    host.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(seen).toBe(true);
  });
});
