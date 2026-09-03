/**
 * Shared DOM containment for the interactive widgets that the fence-widget
 * families (ascii diagram, tree, timeline, mermaid) mount over a hidden code
 * fence via a ProseMirror widget decoration.
 *
 * Why this exists: a widget host is `contentEditable="false"` inside a
 * contentEditable ProseMirror surface, but the real form controls it contains
 * (`<input>`, `<textarea>`, `<select>`) still bubble their COMPLETE edit
 * stream up to the editor's DOM. ProseMirror's own handlers sit on
 * `view.dom`, so a `beforeinput`/`paste`/`compositionend` that originated in
 * a widget's rename field is ALSO interpreted as text insertion at the
 * document selection — the user types in the widget and the characters land
 * in the document. Stopping propagation at the host boundary is what keeps
 * the two edit surfaces separate.
 *
 * `keydown`/`keyup`/`pointerdown`/`mousedown` are contained for the same
 * reason: they drive ProseMirror's keymap and selection handling.
 *
 * This must stay ONE list used by every host — it drifted into three
 * divergent copies once already (only the timeline stopped the composition /
 * paste stream, so IME and paste edits leaked out of the diagram and tree
 * widgets).
 */

/**
 * Every event a mounted fence widget must keep to itself. Ordered
 * pointer → key → text-input → composition → clipboard.
 *
 * `copy` belongs with `cut`/`paste`: ProseMirror installs its own `copy`
 * handler on `view.dom` that serializes the DOCUMENT selection into the
 * clipboard, and since it sits on an ancestor it runs after a widget's own
 * copy handler — whichever `setData` runs last wins, so a Ctrl/Cmd-C inside
 * a widget (a selected grid range, a diagram label field) would ship the
 * document selection instead of the widget's. Its absence while `cut` and
 * `paste` were contained was an oversight, not a decision.
 */
export const FENCE_WIDGET_CONTAINED_EVENTS = [
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
  'copy',
  'paste',
  'cut',
] as const;

/**
 * Stop every contained event at `container` so interaction inside a mounted
 * fence widget never reaches the ProseMirror editor that hosts it.
 *
 * Call once, on the host element created by a widget decoration, before
 * mounting React into it.
 */
export function containFenceWidgetEvents(container: HTMLElement): void {
  for (const eventName of FENCE_WIDGET_CONTAINED_EVENTS) {
    container.addEventListener(eventName, (event) => event.stopPropagation());
  }
}
