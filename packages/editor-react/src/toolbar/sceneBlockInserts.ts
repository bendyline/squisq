import type { Editor as TiptapEditor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import {
  DEFAULT_MERMAID_DIAGRAM_TYPE,
  mermaidDiagramMarkdown,
} from '../mermaid/mermaidDiagramTypes';
import { CODE_SNIPPET_FOCUS_INSERTED_META } from '../codeSnippet/codeSnippetFocus';

// ─── Scene-block inserts (diagram / drawing / layout) ───

/**
 * A freshly-inserted layout starts with one centered text layer so the
 * canvas isn't a blank surface. Each layer is a readable child sub-block
 * (`### {#id} {[type …]}`); a text layer's content is its markdown body.
 * Coordinates are absolute within the 1920×1080 scene viewport
 * (`SceneBlockWidget`). See `scene/commands/layoutCommands.ts`.
 */
const LAYOUT_STARTER_TEXT_PARAMS =
  'x=360 y=380 width=1200 height=320 fontSize=64 fontWeight=bold align=center valign=middle color="#1e293b"';
/** Multi-line markdown for a new layout (raw / code views). */
export const LAYOUT_STARTER_MARKDOWN = `\n## Layout {[layout]}\n\n### {#text-1} {[text ${LAYOUT_STARTER_TEXT_PARAMS}]}\n\nLayout\n`;

/**
 * Starter art for a new diagram — diagrams are authored as ASCII-art code
 * fences (the fence is the source of truth; `AsciiDiagramExtension` mounts
 * the interactive canvas over it). This exact art is the codec's own
 * canonical rendering of a two-node flow, so it re-parses and re-renders
 * byte-stably. The leading rows/columns are deliberate: ASCII has no
 * separate canvas-origin metadata, so this persisted gutter gives the first
 * node real grid space to move north/west. Without it, content-fit makes the
 * node look centered while its authored coordinate is still (0, 0), and a
 * drag into the apparent margin clamps straight back to that corner.
 */
const DIAGRAM_STARTER_ART = [
  '',
  '',
  '        ┌─────────┐',
  '        │  Start  │',
  '        └────┬────┘',
  '             │',
  '             ▼',
  '        ┌────┴────┐',
  '        │  Next   │',
  '        └─────────┘',
].join('\n');
/**
 * Fenced form for raw / code views — tagged with the explicit `diagram`
 * language so the block's identity survives markdown ↔ Tiptap round-trips
 * (the language class round-trips; fence meta does not).
 */
export const DIAGRAM_STARTER_MARKDOWN = '\n```diagram\n' + DIAGRAM_STARTER_ART + '\n```\n';

/** Insert a starter ASCII-diagram code fence after the current top-level block. */
export function insertAsciiDiagramBlock(editor: TiptapEditor): void {
  insertFenceBlock(editor, DIAGRAM_STARTER_ART, 'diagram');
}

/** Default source for callers that invoke the legacy single-click action. */
const MERMAID_STARTER_ART = DEFAULT_MERMAID_DIAGRAM_TYPE.starter;
export const MERMAID_STARTER_MARKDOWN = mermaidDiagramMarkdown(MERMAID_STARTER_ART);

/** Insert a Mermaid fence that MermaidDiagramExtension turns into the complex canvas. */
export function insertMermaidDiagramBlock(
  editor: TiptapEditor,
  source = MERMAID_STARTER_ART,
): void {
  insertFenceBlock(editor, source, 'mermaid');
}

/**
 * Starter art for a new file tree — an ASCII tree fence (the fence is the
 * source of truth; `TreeViewExtension` mounts the interactive outline).
 */
const TREE_STARTER_ART = ['src/', '├── index.ts', '└── utils/', '    └── helpers.ts'].join('\n');
export const TREE_STARTER_MARKDOWN = '\n```tree\n' + TREE_STARTER_ART + '\n```\n';

/** Insert a starter ASCII tree code fence after the current top-level block. */
export function insertTreeBlock(editor: TiptapEditor): void {
  insertFenceBlock(editor, TREE_STARTER_ART, 'tree');
}

/** Starter multi-event rail for the authored timeline view. */
const TIMELINE_STARTER_ART =
  'Milestones: ● Start {#start} ─────● Review {#review} ─────● Ship {#ship} ───►';
export const TIMELINE_STARTER_MARKDOWN = '\n```timeline\n' + TIMELINE_STARTER_ART + '\n```\n';

/** Insert a starter ASCII timeline code fence after the current top-level block. */
export function insertTimelineBlock(editor: TiptapEditor): void {
  insertFenceBlock(editor, TIMELINE_STARTER_ART, 'timeline');
}

/**
 * Insert a code fence after the current top-level block. `lang` tags the
 * fence's `language` attribute — pass the explicit authored-view tag so its
 * identity round-trips through markdown and Tiptap.
 */
export interface InsertFenceBlockOptions {
  /** Ask the ordinary-code-fence widget to focus its Monaco model at the body end. */
  focusInsertedCodeSnippet?: boolean;
}

export function insertFenceBlock(
  editor: TiptapEditor,
  art: string,
  lang?: string,
  options: InsertFenceBlockOptions = {},
): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const codeBlockType = state.schema.nodes.codeBlock;
      if (!codeBlockType) return false;
      const attrs = lang ? { language: lang } : null;
      const block = codeBlockType.create(attrs, state.schema.text(art));
      const { $from } = state.selection;
      const insertPos = $from.depth > 0 ? $from.after(1) : state.doc.content.size;
      if (dispatch) {
        tr.insert(insertPos, block);
        if (options.focusInsertedCodeSnippet) {
          tr.setMeta(CODE_SNIPPET_FOCUS_INSERTED_META, insertPos);
        }
      }
      return true;
    })
    .run();
}

/**
 * Insert a block-level heading carrying a Scene template (`diagram` /
 * `drawing` / `layout`) at the top level, after the block the caret sits
 * in. Going through a command (rather than `insertContent` at the caret)
 * keeps the heading from being coerced into inline text when the caret is
 * nested inside a list item or other block. The matching extension
 * (DiagramExtension / SceneBlockExtension) then mounts the editable canvas
 * right below it.
 */
export function insertTemplateHeading(
  editor: TiptapEditor,
  opts: { template: string; text: string; level?: number; blockAttrs?: string | null },
): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const headingType = state.schema.nodes.heading;
      if (!headingType) return false;
      const heading = headingType.create(
        {
          level: opts.level ?? 2,
          dataTemplate: opts.template,
          dataBlockAttrs: opts.blockAttrs ?? null,
        },
        state.schema.text(opts.text),
      );
      const { $from } = state.selection;
      const insertPos = $from.depth > 0 ? $from.after(1) : state.doc.content.size;
      if (dispatch) {
        tr.insert(insertPos, heading);
        // Drop the caret into the new heading's text so it can be renamed.
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      }
      return true;
    })
    .run();
}

/**
 * Insert a `{[layout]}` block seeded with one text layer. The layer is a
 * child sub-block heading (`### {#text-1} {[text …]}`) whose markdown body
 * ("Layout") is the text content — the readable counterpart to the old
 * base64 `layers=` blob. The parent + child + body go in as one fragment so
 * the layout widget mounts with the seed already present.
 */
export function insertLayoutBlock(editor: TiptapEditor): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const headingType = state.schema.nodes.heading;
      const paragraphType = state.schema.nodes.paragraph;
      if (!headingType || !paragraphType) return false;
      const parent = headingType.create(
        { level: 2, dataTemplate: 'layout' },
        state.schema.text('Layout'),
      );
      const child = headingType.create({
        level: 3,
        dataTemplate: 'text',
        dataTemplateParams: LAYOUT_STARTER_TEXT_PARAMS,
        dataBlockAttrs: '#text-1',
      });
      const body = paragraphType.create(null, state.schema.text('Layout'));
      const { $from } = state.selection;
      const insertPos = $from.depth > 0 ? $from.after(1) : state.doc.content.size;
      if (dispatch) {
        tr.insert(insertPos, Fragment.fromArray([parent, child, body]));
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      }
      return true;
    })
    .run();
}
