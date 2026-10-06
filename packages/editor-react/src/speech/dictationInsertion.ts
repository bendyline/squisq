/**
 * Literal-text insertion of dictated phrases.
 *
 * A transcript is TEXT, never markdown: a spoken "star" that a recognizer
 * renders as `*`, or a `#` at the start of a phrase, must not become emphasis
 * or a heading. So both surfaces insert through the same paths proofing's
 * "apply suggestion" and the context menu's Paste use — Tiptap
 * `tr.insertText`, Monaco `executeEdits` between undo stops — and each phrase
 * is exactly ONE undo step.
 *
 * Insertion is non-destructive: a phrase lands at the END of the current
 * selection (the caret, when collapsed) rather than replacing it. Phrases
 * arrive seconds after they were spoken, and a selection the user made in the
 * meantime — to read something, or to copy it — must not be clobbered.
 */

import type { Editor as TiptapEditor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { editor as MonacoEditorNs } from 'monaco-editor';

type MonacoEditor = MonacoEditorNs.IStandaloneCodeEditor;

/** Stand-in for "an inline object (image, mention, icon) precedes the caret". */
const INLINE_OBJECT = '￼';

/** Trim a transcript and collapse every whitespace run (newlines included) to one space. */
export function normalizeDictatedText(transcript: string): string {
  return transcript.replace(/\s+/g, ' ').trim();
}

/**
 * Gezel's spacing rule: a phrase gets a single leading space unless the caret
 * is at the start of a block/line (`charBefore === null`) or right after
 * whitespace. Closing punctuation that a recognizer emitted as its own phrase
 * attaches to the previous word rather than floating after a space.
 */
export function needsLeadingSpace(charBefore: string | null, text: string): boolean {
  if (charBefore === null || charBefore === '') return false;
  if (/\s/.test(charBefore)) return false;
  if (/^[.,;:!?…)\]}]/.test(text)) return false;
  return true;
}

/**
 * The trailing half of the rule, for a caret moved into the middle of text: a
 * phrase dictated right before a word gets a space after it, so it doesn't
 * fuse with that word. Whitespace, closing punctuation and the end of the
 * block/line need none.
 */
export function needsTrailingSpace(charAfter: string | null): boolean {
  if (charAfter === null || charAfter === '') return false;
  if (/\s/.test(charAfter)) return false;
  return !/^[.,;:!?…)\]}]/.test(charAfter);
}

export interface DictatedInsertion {
  /** The exact string to insert. */
  text: string;
  /** Where the caret lands, as an offset into `text` (before any trailing space). */
  caret: number;
}

/**
 * What to insert for a transcript at a caret between `charBefore` and
 * `charAfter` (`null` = block/line boundary), or `null` when the transcript is
 * blank — there is nothing to insert.
 */
export function composeDictatedInsertion(
  charBefore: string | null,
  transcript: string,
  charAfter: string | null = null,
): DictatedInsertion | null {
  const words = normalizeDictatedText(transcript);
  if (!words) return null;
  const lead = needsLeadingSpace(charBefore, words) ? ' ' : '';
  const trail = needsTrailingSpace(charAfter) ? ' ' : '';
  return { text: `${lead}${words}${trail}`, caret: lead.length + words.length };
}

/**
 * Whether moving focus into the editor would steal it from some OTHER editable
 * control — a dialog's text field, a canvas textbox. A button (the microphone
 * itself) or the page body is fair game: dictation is "typing into the
 * editor", so after the first phrase the caret should be live there.
 */
function focusIsInOtherEditable(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    return true;
  }
  return active instanceof HTMLElement && active.isContentEditable;
}

function charBeforeInTiptap($pos: ResolvedPos): string | null {
  if ($pos.parentOffset === 0) return null;
  const before = $pos.nodeBefore;
  if (!before) return null;
  if (before.isText) return before.text ? before.text.slice(-1) : null;
  if (before.type.name === 'hardBreak') return null;
  return INLINE_OBJECT;
}

function charAfterInTiptap($pos: ResolvedPos): string | null {
  if ($pos.parentOffset === $pos.parent.content.size) return null;
  const after = $pos.nodeAfter;
  if (!after) return null;
  if (after.isText) return after.text ? after.text.charAt(0) : null;
  if (after.type.name === 'hardBreak') return null;
  return INLINE_OBJECT;
}

/**
 * Insert a dictated phrase into the Write view at the caret as literal text,
 * as one undo step. Returns false when nothing was inserted (blank transcript,
 * destroyed or non-editable editor).
 */
export function insertDictationIntoTiptap(editor: TiptapEditor, transcript: string): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const { state } = editor;
  let pos = state.selection.to;
  let $pos = state.doc.resolve(pos);
  if (!$pos.parent.inlineContent) {
    // A node selection (an image, a widget block) leaves the caret between
    // blocks. Land in the nearest text position after it instead.
    const near = Selection.near($pos, 1);
    if (!(near instanceof TextSelection)) return false;
    pos = near.head;
    $pos = near.$head;
  }
  const insertion = composeDictatedInsertion(
    charBeforeInTiptap($pos),
    transcript,
    charAfterInTiptap($pos),
  );
  if (insertion === null) return false;

  const alreadyFocused = editor.view.hasFocus();
  const chain =
    alreadyFocused || focusIsInOtherEditable() ? editor.chain() : editor.chain().focus();
  const inserted = chain
    .command(({ tr }) => {
      // Start a fresh history event, so this phrase never merges into the
      // user's typing (or the previous phrase) inside the grouping window.
      closeHistory(tr);
      tr.insertText(insertion.text, pos, pos);
      tr.setSelection(TextSelection.create(tr.doc, pos + insertion.caret));
      tr.scrollIntoView();
      return true;
    })
    .run();
  // …and seal it, so the user's next keystroke starts its own event too. The
  // seal carries no content; `addToHistory: false` guarantees it never becomes
  // (or lends an appended plugin step to) an undo event of its own.
  if (inserted && !editor.isDestroyed) {
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  }
  return inserted;
}

/**
 * Insert a dictated phrase into the Source view at the caret as literal text,
 * as one undo step (`executeEdits` between undo stops). Returns false when
 * nothing was inserted.
 */
export function insertDictationIntoMonaco(editor: MonacoEditor, transcript: string): boolean {
  const model = editor.getModel();
  if (!model) return false;
  const selection = editor.getSelection();
  const caret = selection
    ? { lineNumber: selection.endLineNumber, column: selection.endColumn }
    : editor.getPosition();
  if (!caret) return false;
  const line = model.getLineContent(caret.lineNumber);
  const charBefore = caret.column > 1 ? line.charAt(caret.column - 2) : null;
  const charAfter = caret.column <= line.length ? line.charAt(caret.column - 1) : null;
  const insertion = composeDictatedInsertion(charBefore, transcript, charAfter);
  if (insertion === null) return false;

  const range = {
    startLineNumber: caret.lineNumber,
    startColumn: caret.column,
    endLineNumber: caret.lineNumber,
    endColumn: caret.column,
  };
  editor.pushUndoStop();
  const applied = editor.executeEdits('squisq-dictation', [
    { range, text: insertion.text, forceMoveMarkers: true },
  ]);
  editor.pushUndoStop();
  if (applied === false) return false;
  const end = { lineNumber: caret.lineNumber, column: caret.column + insertion.caret };
  editor.setPosition(end);
  editor.revealPositionInCenterIfOutsideViewport(end);
  if (!editor.hasTextFocus() && !focusIsInOtherEditable()) editor.focus();
  return true;
}
