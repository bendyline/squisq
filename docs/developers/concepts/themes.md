---
title: Themes
description: The Theme object, the built-in themes, how a document's theme is resolved, and how to create, validate, and store custom themes in code.
---

# Themes

A theme is the visual identity of a document: its colors, fonts, corner radii and shadows, how
things move, and how its page view is art-directed. One `Theme` object drives every rendition —
slides, pages, dashboards, video, and the PPTX and HTML exports — and every built-in template reads
it, so switching the theme restyles the whole document without touching its content.

```markdown preview theme=gezellig
## Opening night {[title subtitle="The Harbor Playhouse, spring season"]}

## Seats sold {[statHighlight]}

**1,240** seats sold before the curtain went up on the first night.

## From the director {[quote]}

> We built the set from driftwood the tide brought in. — Ines Duarte
```

Authors choose a theme with the `squisq-theme` frontmatter key; see [Themes](../../guide/themes.md)
for the author's view. This page covers the object and the functions around it, all exported from
`@bendyline/squisq/schemas` unless noted.

## The built-in themes

```squisq-docs
theme-list
```

`THEMES` holds them keyed by id, `DEFAULT_THEME_ID` is `'standard'`, and `DEFAULT_THEME` is that
theme. The two `standard` themes use only system fonts and keep ambient motion off.

## The `Theme` object

A theme is plain JSON — the built-ins are JSON files, and a custom theme has exactly the same
shape.

| Field              | Holds                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`    | Always `'1'` today                                                                                                                                                                        |
| `id`, `name`       | The id documents select and the display name; optional `description`                                                                                                                      |
| `colors`           | `primary`, `secondary`, `background`, `backgroundLight`, `text`, `textMuted`, `highlight`, `warning`                                                                                      |
| `typography`       | `titleFont`, `bodyFont`, optional `monoFont` and `captionFont`, as `{ stackId }` (a curated font stack) or `{ custom: { name, fallback } }`; scales, line heights, title weight           |
| `style`            | `borderRadius`, `textShadow`, `overlayOpacity`, `animationSpeed`, `blockPadding`, an `imageTreatment` photo grade, picture-in-picture framing                                             |
| `renderStyle`      | `name`; default text and image animations; `ambientMotion` (slow Ken Burns on cover imagery); `motionProfile`; `defaultTransition`; `layoutOverrides`; per-template `templateHints`       |
| `colorSchemes`     | Named `{ bg, text, accent }` sets — `blue`, `green`, … — that blocks select with `colorScheme=`                                                                                           |
| `persistentLayers` | Atmosphere drawn on every slide: `bottomLayers` and `topLayers` such as a gradient, a pattern, film grain, a vignette                                                                     |
| `pageStyle`        | Page-view art direction: a design `family`, `tokens` (column widths, spacing, dividers, hero style, heading treatment, …), per-section and per-template overrides, and an accent rotation |
| `seedColors`       | Optional authoring seeds a customizer derives the palette from                                                                                                                            |
| `basedOn`          | The built-in a custom theme was compiled from                                                                                                                                             |

The full type is in the [API reference](../../API.md#subpath-schemas).

## Resolving a theme

| Function                                  | Returns                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `resolveTheme(id, registry?)`             | The theme for an id: a registered theme, else a built-in, else `DEFAULT_THEME`. Never throws |
| `resolveThemeForDoc(doc, id?, registry?)` | The theme a document should render with (from `@bendyline/squisq/doc`)                       |
| `getThemeSummaries(registry?)`            | `{ id, name, description }` for every built-in plus registered themes — for pickers          |
| `getAvailableThemes(registry?)`           | The ids alone                                                                                |
| `createThemeRegistry()`                   | A registry you own, for host themes that aren't in any document                              |

`resolveThemeForDoc` is the one to use when rendering a document. It takes the explicit `id` if you
pass one, else the document's `themeId` (from `squisq-theme`, or the legacy `themeId` / `theme`
keys), and looks it up in the document's own custom themes first, then your registry, then the
built-ins. It accepts a `Doc` or a `MarkdownDocument`, so exporters can resolve before building a
`Doc`.

```ts
import { createTheme, createThemeRegistry, THEMES } from '@bendyline/squisq/schemas';
import { markdownToDoc, resolveThemeForDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';

const registry = createThemeRegistry();
registry.register(createTheme(THEMES.bold, { id: 'harbor-board', name: 'Harbor Board' }));

const doc = markdownToDoc(parseMarkdown('---\nsquisq-theme: harbor-board\n---\n# Minutes\n'));
resolveThemeForDoc(doc, undefined, registry).id; // 'harbor-board'
resolveThemeForDoc(doc, 'magazine').id; // 'magazine' — an explicit id wins
```

The registry validates each theme on `register` and stores a frozen copy, so later changes to your
object don't leak into rendering.

Where the theme is applied:

- `DocPlayer`, `LinearDocView`, and `DashboardView` resolve the document's theme themselves (with
  `resolveThemeForDoc`) when you don't pass `theme`.
- `materializeBlockLayers`, `materializePageSections`, and `materializeDashboard` take a `theme`
  option and default to `DEFAULT_THEME`.
- `convert()` takes a `themeId` option; the exporters resolve it against the document's custom
  themes and an optional `themeRegistry`.

## Creating themes

**`createTheme(base, overrides)`** deep-merges overrides onto a theme. Without an `id` in the
overrides, the result is `'<base id>-custom'`.

```ts
import { createTheme, THEMES } from '@bendyline/squisq/schemas';

const warmStandard = createTheme(THEMES.standard, {
  id: 'standard-warm',
  name: 'Standard, warm',
  colors: { primary: '#c2410c', highlight: '#f59e0b' },
});
```

**`compileTheme(partial, { base?, contrast? })`** fills in and validates a partial theme. It
inherits everything you don't set from `base` (or from the neutral `STARTER_THEME`), records
`basedOn`, derives a page style if none is given, and throws if the result is invalid. Give it
`seedColors` and it derives every color slot you don't set explicitly — with `contrast` of
`'subtle'`, `'balanced'` (default), or `'high'`:

```ts
import { compileTheme, THEMES } from '@bendyline/squisq/schemas';

const harbor = compileTheme(
  {
    id: 'harbor',
    name: 'Harbor',
    seedColors: { primary: '#0b6e99', background: '#fdfcf8', text: '#1d2a33' },
  },
  { base: THEMES.minimalist },
);
harbor.colors.backgroundLight; // derived from the background seed
harbor.basedOn; // 'minimalist'
```

Seed a `background` when you want a light theme: with only a `primary` seed, the derived
background is dark. Supplying `colorSchemes` replaces the base's schemes rather than merging, so a
removed accent really disappears.

## Validating and serializing

| Function                      | Behavior                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| `validateTheme(value)`        | `{ valid, errors: { path, message }[], theme? }` — never throws   |
| `assertTheme(value, source?)` | The value typed as `Theme`, or throws listing the errors          |
| `parseTheme(json)`            | Parses a JSON string and asserts it                               |
| `serializeTheme(theme)`       | Stable, pretty-printed JSON that round-trips through `parseTheme` |

Validate any theme that comes from outside your code — an upload, a URL, local storage.

## Custom themes in a document

A document can carry its own themes, so it renders the same way anywhere it goes. They live in the
`squisq-custom-themes` frontmatter key as compact JSON keyed by id, and `squisq-theme` selects
one:

```ts
import { writeCustomThemesToFrontmatter } from '@bendyline/squisq/doc';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';

const source = setFrontmatterValues('# Harbor survey\n\nThe north pier, surveyed in June.\n', {
  'squisq-custom-themes': writeCustomThemesToFrontmatter([harbor])!,
  'squisq-theme': 'harbor',
});
```

`markdownToDoc` decodes them into `doc.customThemes` (`readCustomThemesFromFrontmatter` does the
same for raw frontmatter, keeping only themes that validate), and `resolveThemeForDoc` finds them
first. Custom templates work the same way; see [Templates](templates.md#custom-templates).
[Custom themes](../../guide/themes.md#custom-themes) shows the author-facing designer, and
`inferThemeFromFile` from `@bendyline/squisq-formats/infer` builds a theme from a Word,
PowerPoint, or Excel file (see [Formats](formats.md#theme-and-layout-inference)).

## Theme helpers for templates

Templates never hard-code a color, font, or shadow; they ask the theme through helpers in
`@bendyline/squisq/doc`, each taking the [template context](templates.md#the-template-context):

| Helper                                                   | Use                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `resolveColorScheme(context, name)`                      | A named color scheme, falling back to the theme's first                    |
| `themedFontSize(px, context, isTitle)`                   | A size designed at 1920×1080, scaled for the viewport and theme typography |
| `getThemeFont(context, role)`                            | The CSS font stack for `'title'`, `'body'`, or `'mono'`                    |
| `themedSurfaceGradient(context)`, `themedScrim(context)` | Surfaces and scrims that suit light and dark themes alike                  |
| `shouldUseShadow(context)`                               | Whether this theme wants shadows                                           |
| `themedEntrance(context, layerType, fallback)`           | The theme's default entrance animation, keeping the template's timing      |
| `themedImageTreatment(context, override)`                | The photo grade for an image layer                                         |
| `getTemplateHint(context, template, key, fallback)`      | A per-template value from `renderStyle.templateHints`                      |

At render time, `materializeBlockLayers` also applies the theme's `renderStyle` to the layers a
template returns — scaling animation durations by `style.animationSpeed` and, when `ambientMotion`
is on, giving full-bleed cover images a gentle Ken Burns — and adds the theme's persistent layers.
Explicit animations in a template always win.

## Document themes and editor chrome

Themes style the **document**. The editor's toolbar, menus, dialogs, and panels use a separate set
of `--squisq-*` CSS custom properties, so your app can give the chrome its own palette while
documents keep their authors' themes. See [Editor chrome theming](../../theming.md).
