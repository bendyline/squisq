/**
 * RawEditor
 *
 * Monaco-based raw markdown editor. Provides full VS Code-like editing
 * experience with syntax highlighting, minimap, and bracket matching.
 * Syncs changes back to EditorContext on every keystroke (debounced).
 */

import { useRef, useCallback, useEffect } from 'react';
import Editor, { type OnMount, type OnChange, type BeforeMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useEditorContext } from './EditorContext';
import { getAvailableTemplates } from '@bendyline/squisq/doc';
import { suggestIcons, resolveIcon, iconGlyph } from '@bendyline/squisq/icons';
import { SQUISQ_MEDIA_MIME, parseSquisqMediaPayload } from './mediaDragMime';
import { useMonacoLoader } from './useMonacoLoader';

// Monaco is loaded lazily through `useMonacoLoader` (see the hook for the
// rationale). The type-only `import type * as monaco from 'monaco-editor'`
// above gives us `monaco.editor.IStandaloneCodeEditor`, `monaco.Range`,
// etc. for typing without pulling the package into the static module
// graph — which is the whole point: a consumer importing `JsonEditor` or
// a type from the package barrel no longer drags ~9MB of language
// services into the resolver.
//
// Consumers that *do* want the raw editor can still slim the bundle by
// aliasing `monaco-editor` to a custom entry in their bundler config.
// For example with Vite:
//
//   resolve: { alias: [{ find: /^monaco-editor$/, replacement: './monaco-slim.ts' }] }
//
// Where monaco-slim.ts re-exports 'monaco-editor/esm/vs/editor/editor.api'
// plus only the language contributions needed (e.g. markdown, javascript).

// Squisq Monaco themes: same syntax highlighting as vs / vs-dark, but with
// Monaco's internal gutter (line numbers + folding margin) and overview
// ruler tinted to match the side-pane "desk" colors so the canvas's
// internal furniture blends with its surroundings. The seam color is the
// 1px line Monaco draws between the white canvas and the overview ruler;
// matches the `::after` border on `.margin` so both sides of the canvas
// frame look the same.
const SQUISQ_LIGHT_GUTTER = '#dcd8d0';
const SQUISQ_DARK_GUTTER = '#0f1219';
const SQUISQ_LIGHT_SEAM = '#b0a99a';
const SQUISQ_DARK_SEAM = '#2a3144';

const SQUISQ_THEMES: Record<string, string> = {
  vs: 'squisq-light',
  'vs-dark': 'squisq-dark',
};

export interface RawEditorProps {
  /** Monaco editor theme (default: 'vs-dark') */
  theme?: string;
  /** Show minimap (default: false) */
  minimap?: boolean;
  /** Font size in pixels (default: 14) */
  fontSize?: number;
  /** Word wrap setting (default: 'on') */
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  /** Additional class name for the container */
  className?: string;
  /**
   * Chat-composer mode: Enter fires this callback (submit) and Cmd/Ctrl+Enter
   * inserts a newline. When undefined, behaves normally.
   */
  submitOnEnter?: () => void;
  /** Make Monaco read-only (no edits, no cursor blink). */
  readOnly?: boolean;
}

/**
 * Raw markdown editor using Monaco Editor.
 * Binds to the shared EditorContext for source synchronization.
 */
export function RawEditor({
  theme = 'vs',
  minimap = false,
  fontSize = 14,
  wordWrap = 'on',
  className,
  submitOnEnter,
  readOnly = false,
}: RawEditorProps) {
  const { markdownSource, setMarkdownSource, setMonacoEditor, language, mentionProvider } =
    useEditorContext();
  const { monaco: monacoNs, ready: monacoReady } = useMonacoLoader();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const isExternalUpdate = useRef(false);
  const completionDisposable = useRef<monaco.IDisposable | null>(null);
  const mentionCompletionDisposable = useRef<monaco.IDisposable | null>(null);
  const iconCompletionDisposable = useRef<monaco.IDisposable | null>(null);
  const iconGlyphDecorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const keyDisposable = useRef<monaco.IDisposable | null>(null);
  // Ref so the keydown handler always sees the latest callback.
  const submitOnEnterRef = useRef(submitOnEnter);
  useEffect(() => {
    submitOnEnterRef.current = submitOnEnter;
  }, [submitOnEnter]);
  // Ref so the completion provider — registered once at mount — always
  // sees the latest mentionProvider without needing to unregister.
  const mentionProviderRef = useRef(mentionProvider);
  useEffect(() => {
    mentionProviderRef.current = mentionProvider;
  }, [mentionProvider]);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme('squisq-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editorGutter.background': SQUISQ_LIGHT_GUTTER,
        'editorOverviewRuler.background': SQUISQ_LIGHT_GUTTER,
        'editorOverviewRuler.border': SQUISQ_LIGHT_SEAM,
        'minimap.background': SQUISQ_LIGHT_GUTTER,
      },
    });
    monaco.editor.defineTheme('squisq-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editorGutter.background': SQUISQ_DARK_GUTTER,
        'editorOverviewRuler.background': SQUISQ_DARK_GUTTER,
        'editorOverviewRuler.border': SQUISQ_DARK_SEAM,
        'minimap.background': SQUISQ_DARK_GUTTER,
      },
    });
  }, []);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      setMonacoEditor(editor);
      editor.focus();

      // Dispose any previous completion provider (from a prior mount)
      completionDisposable.current?.dispose();
      completionDisposable.current = null;
      mentionCompletionDisposable.current?.dispose();
      mentionCompletionDisposable.current = null;
      iconCompletionDisposable.current?.dispose();
      iconCompletionDisposable.current = null;

      // Register the `{[template]}` completion provider only for markdown
      // files — it's meaningless for TypeScript, JSON, Python, etc.
      if (language === 'markdown') {
        const templates = getAvailableTemplates();
        completionDisposable.current = monaco.languages.registerCompletionItemProvider('markdown', {
          triggerCharacters: ['['],
          provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
            const lineContent = model.getLineContent(position.lineNumber);

            // Only trigger inside a heading line that has {[ before the cursor
            if (!/^#{1,6}\s/.test(lineContent)) return { suggestions: [] };

            const textBeforeCursor = lineContent.substring(0, position.column - 1);
            const textAfterCursor = lineContent.substring(position.column - 1);
            const bracketIdx = textBeforeCursor.lastIndexOf('{[');
            if (bracketIdx === -1) return { suggestions: [] };

            // When Monaco's bracket auto-pair has already produced the
            // closing `]}` we just leave it in place and skip the
            // suffix — otherwise accepting `sectionHeader` on
            // `{[gi]}` would yield `{[sectionHeader]}]}`.
            const closingMatch = textAfterCursor.match(/^\]\}/);
            const suffix = closingMatch ? '' : ']}';

            const startCol = bracketIdx + 3; // after {[
            const range = new monaco.Range(
              position.lineNumber,
              startCol,
              position.lineNumber,
              position.column,
            );

            const suggestions = templates.map((name) => ({
              label: name,
              filterText: name,
              kind: monaco.languages.CompletionItemKind.Value,
              insertText: name + suffix,
              range,
              detail: 'Block template',
              sortText: name,
            }));

            return { suggestions };
          },
        });

        // `@mention` completion — queries the shared MentionProvider. Keep
        // this in its own registration so we can dispose it independently
        // of the template provider, and so the trigger character is just
        // `@` (not `[`).
        mentionCompletionDisposable.current = monaco.languages.registerCompletionItemProvider(
          'markdown',
          {
            triggerCharacters: ['@'],
            async provideCompletionItems(model, position) {
              const provider = mentionProviderRef.current;
              if (!provider) return { suggestions: [] };
              const lineContent = model.getLineContent(position.lineNumber);
              const textBeforeCursor = lineContent.substring(0, position.column - 1);
              const atIdx = textBeforeCursor.lastIndexOf('@');
              if (atIdx === -1) return { suggestions: [] };
              // `@` must be at line start or preceded by whitespace/punct —
              // skip e.g. email addresses like `foo@bar`.
              if (atIdx > 0) {
                const prevChar = textBeforeCursor[atIdx - 1];
                if (!/[\s\p{P}]/u.test(prevChar)) return { suggestions: [] };
              }
              const query = textBeforeCursor.slice(atIdx + 1);
              // Only fire for short queries — once the user has typed
              // a full word, the popover gets noisy.
              if (query.length > 40) return { suggestions: [] };
              if (/\s/.test(query)) return { suggestions: [] };

              let candidates;
              try {
                candidates = await provider(query);
              } catch {
                return { suggestions: [] };
              }

              const range = new monaco.Range(
                position.lineNumber,
                atIdx + 1,
                position.lineNumber,
                position.column,
              );

              return {
                suggestions: candidates.map((c) => ({
                  label: `@${c.label}`,
                  kind: monaco.languages.CompletionItemKind.User,
                  insertText: `@[${c.label}](${c.scheme}:${c.id}) `,
                  range,
                  ...(c.description ? { detail: c.description } : {}),
                  sortText: c.label,
                })),
              };
            },
          },
        );

        // FontAwesome icon completion. Fires inside any `{[…]}` opener
        // anywhere in the doc (not just headings — icons are inline).
        // Suggestions cover the whole FA Free catalog filtered by the
        // partial token; we cap at 50 to keep the popup readable. The
        // template provider above still handles heading lines, so on
        // a `## Title {[…]}` the user sees both template names AND
        // icons interleaved by the regular Monaco filter.
        iconCompletionDisposable.current = monaco.languages.registerCompletionItemProvider(
          'markdown',
          {
            triggerCharacters: ['['],
            provideCompletionItems(model, position) {
              const lineContent = model.getLineContent(position.lineNumber);
              const textBeforeCursor = lineContent.substring(0, position.column - 1);
              const textAfterCursor = lineContent.substring(position.column - 1);
              const bracketIdx = textBeforeCursor.lastIndexOf('{[');
              if (bracketIdx === -1) return { suggestions: [] };
              // Bail if any `]` already closes this annotation between
              // `{[` and the cursor — we'd be past the token, not in it.
              const between = textBeforeCursor.slice(bracketIdx + 2);
              if (between.includes(']')) return { suggestions: [] };
              // Tokens are alphanumeric + `-_:`; anything else means
              // we're not inside an icon (probably a code/link bracket).
              if (between && !/^[a-zA-Z0-9_:-]*$/.test(between)) {
                return { suggestions: [] };
              }
              const query = between.toLowerCase();

              // When Monaco's bracket auto-pair has already produced a
              // closing `]}` we don't want to insert another — but we
              // also don't want to consume the existing one, since
              // then we'd have to re-emit it and the round-trip is
              // brittle. Leave the closing in place and just insert
              // the bare token; if no closing exists yet, append it.
              const closingMatch = textAfterCursor.match(/^\]\}/);
              const suffix = closingMatch ? '' : ']}';

              const range = new monaco.Range(
                position.lineNumber,
                bracketIdx + 3, // after `{[`
                position.lineNumber,
                position.column,
              );

              const top = suggestIcons(query, 50);
              return {
                suggestions: top.map((m, i) => ({
                  // Embed the FA codepoint as the first character of
                  // the label. CSS targets the suggest widget with
                  // FontAwesome as a font fallback, so the codepoint
                  // renders as the glyph and the name renders in the
                  // editor's normal font.
                  label: {
                    label: `${iconGlyph(m.entry)}  ${m.token}`,
                    description: `fa-${m.entry.family}`,
                  },
                  // `filterText` excludes the glyph + spacing so Monaco
                  // filters against the actual icon name only.
                  filterText: m.token,
                  kind: monaco.languages.CompletionItemKind.Constant,
                  insertText: `${m.token}${suffix}`,
                  range,
                  detail: m.entry.label,
                  // Documentation pane (rendered when Monaco's
                  // suggestion preview is expanded) shows a large
                  // version of the glyph alongside the canonical token.
                  documentation: {
                    value: `<i class="fa-${m.entry.family} fa-${m.entry.name}" style="font-size: 2em; display: inline-block; margin-right: 8px; vertical-align: middle"></i> **${m.token}** *(${m.entry.label})*`,
                    isTrusted: true,
                    supportHtml: true,
                  },
                  // Sort key: 1-digit score prefix keeps "starts with"
                  // matches above "contains" / keyword matches.
                  sortText: `${m.score}${String(i).padStart(4, '0')}`,
                })),
              };
            },
          },
        );
      }

      // Chat-composer mode: intercept Enter before Monaco inserts a newline.
      // Cmd/Ctrl+Enter falls through so the native newline still works.
      keyDisposable.current?.dispose();
      keyDisposable.current = editor.onKeyDown((e) => {
        if (e.keyCode !== monaco.KeyCode.Enter) return;
        if (!submitOnEnterRef.current) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        submitOnEnterRef.current();
      });

      // Attach native drop listeners for in-app MediaBin drags. Monaco's own
      // drop handling doesn't know about our custom MIME type, so we insert
      // markdown image syntax explicitly in the capture phase.
      dropCleanupRef.current?.();
      const domNode = editor.getDomNode();
      if (domNode) {
        const onDragOver = (e: DragEvent) => {
          if (e.dataTransfer?.types.includes(SQUISQ_MEDIA_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        };
        const onDrop = (e: DragEvent) => {
          const dt = e.dataTransfer;
          if (!dt) return;
          const raw = dt.getData(SQUISQ_MEDIA_MIME);
          if (!raw) return;
          const payload = parseSquisqMediaPayload(raw);
          if (!payload || !payload.mimeType.startsWith('image/')) return;

          e.preventDefault();
          e.stopPropagation();

          const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
          const position = target?.position ?? editor.getPosition();
          if (!position) return;

          const markdown = `![${payload.alt}](${payload.name})`;
          editor.executeEdits('squisq-media-drop', [
            {
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
              text: markdown,
              forceMoveMarkers: true,
            },
          ]);
          editor.focus();
        };
        domNode.addEventListener('dragover', onDragOver, true);
        domNode.addEventListener('drop', onDrop, true);
        dropCleanupRef.current = () => {
          domNode.removeEventListener('dragover', onDragOver, true);
          domNode.removeEventListener('drop', onDrop, true);
        };
      }
    },
    [setMonacoEditor, language],
  );

  // Unregister on unmount
  useEffect(() => {
    return () => {
      setMonacoEditor(null);
      completionDisposable.current?.dispose();
      completionDisposable.current = null;
      mentionCompletionDisposable.current?.dispose();
      mentionCompletionDisposable.current = null;
      iconCompletionDisposable.current?.dispose();
      iconCompletionDisposable.current = null;
      iconGlyphDecorations.current?.clear();
      iconGlyphDecorations.current = null;
      dropCleanupRef.current?.();
      dropCleanupRef.current = null;
      keyDisposable.current?.dispose();
      keyDisposable.current = null;
    };
  }, [setMonacoEditor]);

  const handleChange: OnChange = useCallback(
    (value) => {
      if (isExternalUpdate.current) return;
      if (value !== undefined) {
        setMarkdownSource(value);
      }
    },
    [setMarkdownSource],
  );

  // When external changes happen (e.g. from WYSIWYG), update Monaco
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      const currentValue = editor.getValue();
      if (currentValue !== markdownSource) {
        isExternalUpdate.current = true;
        editor.setValue(markdownSource);
        isExternalUpdate.current = false;
      }
    }
  }, [markdownSource]);

  // ── Inline FontAwesome glyph decorations ────────────
  // Walk the markdown source on every change, find each resolvable
  // `{[icon-name]}` span, and overlay the actual glyph (via Monaco's
  // `before:` content decoration) just before the brackets. The CSS
  // classes `.fa-glyph-decoration-<family>` set the per-family font
  // and weight; the codepoint character is the decoration's content.
  useEffect(() => {
    const editor = editorRef.current;
    // `monacoNs` is read from the lazy loader's state rather than a
    // top-level import. Re-run when it transitions from null → loaded
    // so decorations show up the moment monaco is in hand.
    if (!editor || !monacoNs) return;
    if (language !== 'markdown') return;
    const model = editor.getModel();
    if (!model) return;

    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    const lines = model.getLineCount();
    const re = /\{\[([a-zA-Z0-9_:-]+)\]\}/g;
    for (let line = 1; line <= lines; line++) {
      const text = model.getLineContent(line);
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const icon = resolveIcon(match[1]);
        if (!icon) continue;
        const glyph = iconGlyph(icon);
        if (!glyph) continue;
        // Position the decoration as a zero-width range at the `{`
        // of the matched token. `before.contentText` renders the
        // glyph as content prepended visually to that position.
        const col = match.index + 1; // Monaco columns are 1-based
        decorations.push({
          range: new monacoNs.Range(line, col, line, col),
          options: {
            before: {
              content: glyph,
              inlineClassName: `fa-glyph-decoration-${icon.family}`,
            },
          },
        });
      }
    }

    if (!iconGlyphDecorations.current) {
      iconGlyphDecorations.current = editor.createDecorationsCollection(decorations);
    } else {
      iconGlyphDecorations.current.set(decorations);
    }
  }, [markdownSource, language, monacoNs]);

  const effectiveTheme = SQUISQ_THEMES[theme] ?? theme;

  // Wait for the lazy monaco namespace + `loader.config()` to settle
  // before mounting `<Editor>`. Without this gate, the @monaco-editor/
  // react singleton loader would fall back to its built-in CDN fetch
  // for any consumer that hasn't aliased monaco-editor — which is the
  // exact regression the lazy-loading move is meant to avoid.
  if (!monacoReady) {
    return (
      <div
        className={className}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--squisq-editor-muted-foreground, #6a6258)',
          fontSize: 13,
        }}
        data-testid="raw-editor"
        data-monaco-loading
      >
        Loading editor…
      </div>
    );
  }

  return (
    <div className={className} style={{ width: '100%', height: '100%' }} data-testid="raw-editor">
      <Editor
        defaultLanguage={language}
        value={markdownSource}
        theme={effectiveTheme}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontSize,
          wordWrap,
          minimap: { enabled: minimap },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: { indentation: true },
          padding: { top: 12, bottom: 12 },
          // Markdown's tokenizer classifies most body text as "string"
          // or "comment" context, which suppresses `quickSuggestions`
          // by default. Enable in all three so our `{[icon]}` and
          // `@mention` typeaheads keep firing as the user types past
          // the trigger character.
          quickSuggestions: { other: true, comments: true, strings: true },
          suggestOnTriggerCharacters: true,
          // Breathing room between the gutter and the first character.
          // Done via Monaco's own option so cursor + hit-testing stay in
          // sync — CSS-padding `.view-lines` shifts the text but not the
          // cursors layer, which causes the cursor to drift left of the
          // model column. Monaco's default is 10. We set 22 (12 extra),
          // and CSS paints the rightmost 12px of the gutter as canvas
          // color so the breathing room looks like it sits *inside* the
          // canvas rather than widening the gutter.
          lineDecorationsWidth: 22,
          readOnly,
          domReadOnly: readOnly,
        }}
      />
    </div>
  );
}
