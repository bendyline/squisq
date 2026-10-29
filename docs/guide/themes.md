---
title: Themes
description: Choose the colors, fonts, motion, and page style for a whole document, and design custom themes of your own.
---

# Themes

A theme dresses the whole document at once: its colors, fonts, corner shapes, image grading,
animations, slide transitions, background atmosphere, and the art direction of its
[Page view](page-mode.md). Your Markdown never mentions a color or a font. Change the theme and
every block changes with it.

Here is one block in the default **Standard** theme:

```markdown preview
## Morning at the north pier {[leftFeature]}

![Fishing boats tied up at the north pier](images/harbor.svg)

The first boats leave at 5:40, and by seven the pier is quiet again except for the gulls.
```

The same block in **Documentary**, with serif type on a dark ground and a muted, partly
black-and-white grade on the photo:

```markdown preview theme=documentary nosource
## Morning at the north pier {[leftFeature]}

![Fishing boats tied up at the north pier](images/harbor.svg)

The first boats leave at 5:40, and by seven the pier is quiet again except for the gulls.
```

In **Tech Dark**, with monospace titles, neon accents, a cool grade, and a faint grid:

```markdown preview theme=tech-dark nosource
## Morning at the north pier {[leftFeature]}

![Fishing boats tied up at the north pier](images/harbor.svg)

The first boats leave at 5:40, and by seven the pier is quiet again except for the gulls.
```

And in **Gezellig**, warm and cozy, with cream text and a soft film grain:

```markdown preview theme=gezellig nosource
## Morning at the north pier {[leftFeature]}

![Fishing boats tied up at the north pier](images/harbor.svg)

The first boats leave at 5:40, and by seven the pier is quiet again except for the gulls.
```

## Built-in themes

```squisq-docs
theme-list
```

**Standard** is the default: system fonts only, black on white, and deliberately calm motion.
**Standard Dark** is the same design on a dark ground.

## What a theme controls

| Part          | What it sets                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Colors        | Background, text, muted text, primary and secondary colors, and a highlight                                |
| Typography    | Title and body fonts, their relative sizes, line height, and caption type                                  |
| Style         | Corner radius, text shadows, overlay strength, animation speed, and a color grade for photos               |
| Color schemes | Named accent sets that individual blocks can pick — see [Color schemes](#color-schemes)                    |
| Motion        | How text enters, the transition between slides, and whether cover images drift — see [Motion](#motion)     |
| Atmosphere    | Layers drawn behind or over every slide: gradients, vignettes, film grain, dot or grid patterns            |
| Page style    | How [Page view](page-mode.md) lays out sections: design family, column widths, hero, headings, backgrounds |

Templates read all of this at render time. A block's own settings still win: an explicit
`transition=` on a heading, or a color scheme you choose for a block, overrides the theme's
default.

## Choosing a theme

**In the editor**, use the **Theme** picker in the Use view's toolbar, or the **Theme** field in
**Document settings**. Your choice is written to the document's frontmatter, so it travels with
the file. The pencil beside the picker opens the theme designer; see
[Custom themes](#custom-themes).

**In the frontmatter**, name the theme by its id:

```yaml
---
title: Harbor Survey 2026
squisq-theme: documentary
---
```

- Write the id exactly as listed above — lowercase, with hyphens (`morning-light`, `tech-dark`).
  The editor also understands `Morning Light` and fixes it up, but exports and other apps match
  the id exactly.
- An id that matches nothing renders in Standard.
- Older documents may use `themeId:` or `theme:` instead. Both still work; when several are
  present, `squisq-theme` wins, then `themeId`, then `theme`. When you pick a theme in the
  editor it writes `squisq-theme` and removes the older keys.
- Choosing Standard removes the key altogether, since Standard is what a document gets anyway.

An app that embeds the editor can set its own default theme for documents that name none. The
picker then lists it as **Default (theme name)**; choosing that entry removes the document's
theme so it follows the app's default, and choosing any other theme — Standard included —
pins the document to it.

## Color schemes

Every theme defines a small set of named **color schemes** — accent combinations that a block
can ask for by name with `colorScheme=`. The scheme recolors the block's accents (a statistic's
number, a header's band, a chart's first series) while the rest of the theme stays the same.

```markdown preview
## Fuel sales {[statHighlight colorScheme=orange]}

**38,400** liters sold at the fuel dock in May.

## Slack water {[definitionCard colorScheme=green]}

The short pause between tides, when the current stops and the harbor goes still.
```

The schemes each built-in theme offers:

| Themes                      | Scheme names                                          |
| --------------------------- | ----------------------------------------------------- |
| Every theme except Gezellig | `blue`, `green`, `purple`, `red`, `orange`, `teal`    |
| Gezellig                    | `terracotta`, `sage`, `amber`, `plum`, `ink`, `cream` |

Each theme draws its own version of a scheme, so `green` in Documentary is not the same green as
in Bold. A name the active theme doesn't define falls back to that theme's first scheme — a
`colorScheme=orange` block shown in Gezellig takes `terracotta`. If you plan to switch between
Gezellig and the others, test your blocks in both.

These blocks take a `colorScheme`: `sectionHeader`, `statHighlight`, `comparisonBar`,
`definitionCard`, `fullBleedQuote`, `transcript`, `dataTable`, every chart, `tree`, `timeline`,
`diagram`, and `drawing`. `twoColumn` takes `leftColor` and `rightColor`, one scheme for each
half. Each block's page in the [block gallery](../blocks/index.md) lists its parameters.

Themes use their schemes on their own, too: [Page view](page-mode.md) rotates them across
sections (a block with its own `colorScheme` keeps it), and the accent
[dashboard style](dashboards.md) tints each cell with the next scheme in turn.

## Motion

Themes decide how a slideshow moves:

- **Text entrances.** Most themes fade text in; Bold zooms it in, and Tech Dark types it out.
  The theme's animation speed makes every entrance faster or slower.
- **Transitions.** Each theme has a default transition between slides — a fade, a dissolve, or,
  in Magazine, a slide to the left. The first slide never transitions in. A heading's own
  `transition=` [setting](tags.md#block-settings) overrides the theme's.
- **Ambient motion.** Bold, Cinematic, Documentary, Magazine, Tech Dark, and Warm Earth give
  full-bleed background images a slow, gentle drift (a Ken Burns move) when the image has no
  animation of its own. Standard, Standard Dark, Minimalist, Morning Light, and Gezellig keep
  images still.

When a viewer's device is set to reduce motion, the player stops the slow drifts, zooms, and
pans in the background. Exported videos keep the theme's motion.

## Custom themes

When no built-in theme fits — your organization's colors, a client's fonts — design your own. A
custom theme starts from a built-in **base theme** and keeps its motion, layout, and page style,
so you only change what you need.

### Design a theme

1. In the Use view, open the **Theme** picker and choose **Create custom theme…** — or click the
   pencil beside the picker to start from the current theme. (A built-in theme opens as a new
   copy named "Modified …"; a custom theme opens for editing.)
2. The designer opens beside the preview, which updates as you work. Set:
   - **Name** and **Base theme**.
   - **Colors** — primary, secondary, and tertiary, plus optional background and text colors.
     The rest of the palette is derived from them.
   - **Accents** — as many accent colors as you like. Each becomes a color scheme.
   - **Typography** — heading and body fonts.
   - **Style** — border radius, animation speed, text shadow, contrast, and image grade.
3. Save it:
   - **Save to document** writes the theme into the document's frontmatter and makes it the
     active theme. Anyone who opens the file sees it, and exports use it like any built-in
     theme.
   - **Save to library** keeps it in your browser, so you can use it in other documents on this
     computer. When you pick a library theme for a document, the editor copies it into that
     document, so the file never depends on your library.

Custom themes are listed under **Custom** in the picker, with buttons to edit or delete each one.
Deleting a theme removes it from both the document and your library.

> [!NOTE]
> The accent list starts as the base theme's color schemes. Recolor one and it keeps its name,
> so `colorScheme=blue` blocks pick up your new color. An accent you add gets a generic name
> such as `accent7`, and one you remove is gone — blocks that asked for it fall back to the
> first scheme. A theme imported from an Office file names its schemes after the file's accent
> colors, `accent1` through `accent6`.

### Import a theme from an Office file

The designer's **Import from file** section takes a Word, PowerPoint, or Excel file (`.docx`,
`.pptx`, `.xlsx`) — choose one or drop it in. The file's theme colors and fonts fill in the
draft, and you can adjust them before saving.

A PowerPoint file brings its slide layouts too: distinctive layouts become
[custom templates](custom-templates.md) that are saved into the document along with the theme.
Saving to the library keeps only the theme.

Opening a PowerPoint file as a document does this automatically; see
[Import and export](import-export.md).

### How a custom theme is stored

A custom theme lives in the document's frontmatter under `squisq-custom-themes`, as one line of
JSON keyed by the theme's id. `squisq-theme` selects it like any built-in:

```text
---
title: Harbor Survey 2026
squisq-theme: custom-harbor-authority
squisq-custom-themes: {"custom-harbor-authority":{"schemaVersion":"1","id":"custom-harbor-authority","name":"Harbor Authority","basedOn":"standard","colors":{"primary":"#0b4f6c","secondary":"#405a69","background":"#f7f4ee",…},"typography":{…},"style":{…},"renderStyle":{…},"colorSchemes":{…},"pageStyle":{…}}}
---
```

The value above is shortened; a real one is a complete theme, typically a couple of thousand
characters, and the designer writes it for you. A document can carry several custom themes;
only the one `squisq-theme` names is active. A theme that is missing a required part is ignored
and the document falls back to Standard. Ids the designer creates start with `custom-`.

## Themes in exports

Every export uses the document's theme, so a file looks like the preview:

| Export                         | What the theme sets                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Video, images, HTML slideshows | Everything — the same rendering as the preview                                 |
| Plain HTML                     | The theme's fonts and colors                                                   |
| PowerPoint                     | Slide colors and backgrounds, fonts, and the deck's own theme colors and fonts |
| Word                           | Fonts, and the primary color on headings                                       |
| PDF                            | Heading, text, and link colors (on white paper); PDFs use standard fonts       |
| EPUB                           | The e-book's stylesheet                                                        |

From the command line, `--theme <id>` renders an export in another theme without changing the
document. See [Import and export](import-export.md) and the [command line](cli.md).

## For developers

The theme schema, `compileTheme`, and registering themes in your own app are covered in
[Themes for developers](../developers/concepts/themes.md). Theming the editor's own toolbar,
menus, and panels — separate from the document's theme — is covered in
[Editor chrome theming](../theming.md).
