# Theming a Squisq editor

Squisq has **two independent palettes**, and knowing which one you want saves
a lot of override-chasing:

|                                   | What it dresses                                                                                 | How you set it                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Document theme** (`Theme`)      | The page/slides being edited — its type, colors, backgrounds, art direction                     | A `Theme` object on the doc (`squisq-theme` frontmatter, `themeId`, custom themes) |
| **Chrome palette** (`--squisq-*`) | The furniture around it — toolbar, tabs, menus, dialogs, pickers, outline, timeline, status bar | CSS custom properties your app sets                                                |

They are separate on purpose. A host app wants the editor's chrome to match
_its_ product; the document keeps the _author's_ theme. Changing one never
moves the other.

This page is about the chrome palette.

## The short version

```css
.my-app {
  --squisq-accent: #b0724c;
  --squisq-accent-hover: #996142;
  --squisq-accent-strong: #8a5537;
  --squisq-accent-soft: #f0d4bf;
  --squisq-accent-subtle: #faf0e8;
  --squisq-accent-border: #d8a986;
  --squisq-text-on-accent: #fff;
}
```

That alone recolors every active toolbar key, selected tab, focus ring,
primary button, selected outline row, checked box, drop target and progress
fill in the editor — plus the layout designer, block-properties popover,
template gallery and preview gutter, because those per-feature families
default to the core tokens.

Add the neutral ramp and the editor stops reading as an embedded foreign
product:

```css
.my-app {
  --squisq-surface: #fdfaf4; /* panels, menus, cards */
  --squisq-surface-hover: #f1e9e1;
  --squisq-surface-raised: #e8dfd7;
  --squisq-surface-sunken: #f3eede;
  --squisq-border: #d6cdb0;
  --squisq-border-subtle: #e6dfc9;
  --squisq-text: #2a2419;
  --squisq-text-muted: #6b614a;
}
```

## Scoping — why one plain class is enough

Every token in `styles/chrome.css` is declared inside `:where()`, which has
**zero specificity**. Your `.my-app { … }` (specificity 0,1,0) beats it, and
so does anything else. You never have to out-specify `.squisq-editor-shell`,
and you never need `!important`.

Light values bind on `:root` and on `[data-theme='light']`. Dark values bind
on **any** `[data-theme='dark']` element. That second point matters more than
it looks: menus, dialogs, flyouts and the recorder **portal to
`document.body`**, outside the editor shell. They stamp their own
`data-theme`, so they pick the palette up wherever they land — including
portals your host does not know exist.

If your app stamps `data-theme` on `<html>`, the whole editor flips with it
for free.

## Token reference

### Ink

| Token                  | Use                                                    |
| ---------------------- | ------------------------------------------------------ |
| `--squisq-text-strong` | Headings, the active row, emphasis                     |
| `--squisq-text`        | Body copy                                              |
| `--squisq-text-soft`   | Labels, secondary controls                             |
| `--squisq-text-muted`  | Captions, help text, inactive icons                    |
| `--squisq-text-faint`  | Placeholders and disabled text — should read as absent |

### Surfaces

| Token                     | Use                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `--squisq-bg`             | The shell's own canvas                                                                            |
| `--squisq-surface`        | The face of a panel, menu or card                                                                 |
| `--squisq-surface-subtle` | A faint tint above the surface                                                                    |
| `--squisq-surface-sunken` | Pressed into a surface — wells, tracks, code blocks                                               |
| `--squisq-surface-hover`  | Hover step                                                                                        |
| `--squisq-surface-raised` | Pressed/active step                                                                               |
| `--squisq-input-bg`       | Text inputs and selects                                                                           |
| `--squisq-row-hover`      | List and table row hover                                                                          |
| `--squisq-desk-bg`        | The "desk" the editing page floats on — WYSIWYG backing, block card, preview gutter, outline pane |
| `--squisq-desk-rail`      | The timeline rail, which sits _back_ from the desk                                                |
| `--squisq-desk-border`    | Edges between desk surfaces                                                                       |

### Lines

`--squisq-border-subtle` (hairline separators) · `--squisq-border` (default
control edge) · `--squisq-border-strong` (an edge that must be seen).

### State families

`accent`, `danger`, `warning` and `success` share one shape:

- `--squisq-<state>` — the fill, and the color of a state icon
- `--squisq-<state>-hover`
- `--squisq-<state>-strong` — state-colored **text** on a light ground, which
  needs more contrast than the fill does
- `--squisq-<state>-soft` — tinted fill behind selected/flagged content
- `--squisq-<state>-subtle` — the faintest wash, for a hovered row
- `--squisq-<state>-border`
- `--squisq-text-on-accent` / `--squisq-text-on-danger`

`--squisq-focus-ring` defaults to the accent; point it somewhere else if your
accent is also your selected-row fill (a ring the same color as the fill it
sits on is invisible).

### Deliberately not derived from the accent

Some colors carry meaning that survives rebranding, so they are their own
tokens and they do **not** follow `--squisq-accent`:

- `--squisq-proof-spelling` / `-grammar` / `-style` — the three squiggle hues.
  They have to stay tellable apart from each other _and_ from the accent.
- `--squisq-clip-audio` / `-video` / `-video-strip` — timeline clips are
  colored by media kind, so a crowded rail stays readable at a glance.
- `--squisq-find-match` and friends — identical in both themes on purpose. A
  search hit is a marker pen on the text; a reader scanning for the next match
  should not have to relearn its color when the app flips theme.
- `--squisq-mention-bg` / `-text` — a mention marks a person. Reusing the
  accent would make every mention look like a selected control.
- `--squisq-tag-*` — the `{[template]}` annotation chip.
- `--squisq-media-well` — the letterbox behind video. Deep in both themes; a
  light field around a video frame reads as a rendering fault.

### Depth

`--squisq-shadow-rgb` is the one color every elevation is built from, so a
warm or dark host palette retints all of them at once. `--squisq-shadow-sm`,
`-md`, `-lg` and `--squisq-scrim` derive from it.

### Per-feature families

`--squisq-layout-*` (custom layout designer), `--squisq-block-props-*` (block
properties popover, transition picker, timeline item menu),
`--squisq-preview-*` (inline preview gutter),
`--squisq-template-gallery-*`, `--squisq-image-editor-*`,
`--squisq-editor-*` (floating controls over media), and the legacy aliases
`--squisq-fg`, `--squisq-hover-bg`, `--squisq-panel-bg`, `--squisq-surface-muted`,
`--squisq-danger-bg`, `--squisq-danger-text`.

**These all default to the core tokens.** Bind them only when you want that
surface to differ from the rest of the chrome.

## Exceptions worth knowing

- **The image editor is a dark room in both themes.** A photo is judged
  against a neutral dark field; a light surround shifts perceived exposure.
  It keeps `--squisq-image-editor-*`, which you can still rebind — they simply
  do not follow `--squisq-surface`.
- **The teleprompter's float window is a separate document.** Its CSS is
  injected into a Document-PiP or popup window that never loads the editor
  stylesheet, so it carries literal fallbacks by necessity. Theme it through
  `--squisq-prompter-*`.
- **The document is not chrome.** Links, headings and prose inside the page
  come from the `Theme`, not from these tokens. If you want the edited
  document recolored, change the theme.
