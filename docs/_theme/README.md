# Writing the documentation site

The Markdown under `docs/` is published at [squigglysquare.com/docs/](https://squigglysquare.com/docs/),
beside the demo editor. The site is built by Squisq itself —
`packages/site/src/docsSite/buildDocsSite.ts` renders each page with the plain-HTML exporter and
places it into [`page.html`](page.html) with `applyHtmlPageTemplate` — and is wired into the demo
site's Vite build, so `npm run dev` serves it at `/docs/` and `npm run build` writes it to
`packages/site/dist/docs/`.

```bash
npm run docs:check                          # broken links, missing anchors, failed examples
npm run docs:check -- --out /tmp/site       # write the site; serve /tmp/site to browse it
npm run docs:check -- --layers blocks/quote.md   # what each live example on a page renders
```

`packages/site/src/__tests__/docsSite.test.ts` runs in `npm test` and fails on any problem
`docs:check` reports, on a built-in template with no gallery page, and on leftover `STUB`/`TODO`
text.

## Files

| Path                         | What it is                                                      |
| ---------------------------- | --------------------------------------------------------------- |
| `_theme/nav.json`            | Navigation: the tabs, their sections, and every published page  |
| `_theme/page.html`           | The HTML page template every page is placed into                |
| `_theme/docs.css`, `docs.js` | Styles and the runtime (search, live previews, copy buttons)    |
| `index.md`                   | The docs home page                                              |
| `guide/`                     | For authors: the format, the editor, presenting, sharing        |
| `blocks/<id>.md`             | One page per built-in template — required for every template    |
| `developers/`                | For developers: concepts, guides, sample apps                   |
| `API.md`                     | The API reference, split into one page per package (`api/…`)    |
| `images/`                    | Illustrations live examples may use (`images/harbor.svg`, …)    |
| other top-level `*.md`       | Published when listed in `nav.json`; otherwise linked on GitHub |

A page is published only when `nav.json` lists it (block pages are listed automatically). Links
between pages are ordinary relative `.md` links — `[tags](../guide/tags.md#block-settings)` — and
are rewritten to `.html`. Links to repository files that are not published pages
(`../packages/core/src/doc/markdownToDoc.ts`) become GitHub links. Every link and `#anchor` is
checked; anchors follow GitHub's heading slugs.

## Page conventions

- Start with frontmatter `title:` (optional — the first `#` heading is used otherwise) and a
  one-sentence `description:` (used for search results and link previews), then one `# H1`.
- Use `##` and `###` for sections; they form the "On this page" list.
- Write Squiggly Square tags in code: `` `{[quote]}` ``. A bare `{[github]}` in prose renders as an
  icon, and a bare `{[quote]}` stays literal text.
- Avoid reference-style links (`[text][ref]`) and raw HTML links; neither is rewritten.
- Callouts use GitHub's syntax: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`,
  `> [!CAUTION]`.

## Live examples

A `markdown` fence with `preview` in its info string is shown as code **and** rendered live by the
standalone player, with an **Open in editor** link that opens the snippet in the demo editor:

````markdown
```markdown preview
## A Famous Quote {[quote]}

> The best way to predict the future is to invent it.
> — Alan Kay
```
````

The snippet is converted exactly as the editor previews a document (`markdownToDoc` +
`buildPreviewDoc`). Flags after `preview`:

| Flag                | Effect                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| `preview`           | Slideshow (default)                                                    |
| `preview=page`      | Page view — the scrolling, variable-height rendition                   |
| `preview=dashboard` | Dashboard — every block on one canvas                                  |
| `aspect=portrait`   | Stage shape: `landscape` (default), `portrait`, `square`, `tall` (4:5) |
| `theme=<id>`        | Render in a built-in theme (`documentary`, `gezellig`, …)              |
| `cover`             | Keep the synthesized cover slide (examples drop it by default)         |
| `nosource`          | Show only the preview, not the code                                    |

Readers can switch every preview on a page to another theme. Examples that need pictures use the
illustrations in `images/` by relative path — `![Harbor](images/harbor.svg)` or
`imageSrc=images/harbor.svg` — and they resolve both in the docs and in the editor.

The first live example on a block page is also that template's thumbnail in the gallery.

## Generated content

A `squisq-docs` fence is replaced by content generated from core's catalogs, so these tables never
drift from the code:

| Fence body             | Generates                                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| `template-params`      | On a block page, its template's parameter table (else appended at end) |
| `template-params <id>` | The parameter table for `<id>`                                         |
| `block-settings`       | The settings every block accepts (timing, transitions, builds)         |
| `template-list`        | Every built-in template with its tag and description                   |
| `theme-list`           | Every built-in theme with its id and description                       |
| `block-gallery`        | The gallery's grouped cards with live thumbnails                       |

Block pages (`blocks/<id>.md`, frontmatter `template: <id>`) also get the template's description,
tag, and body policy under their H1 automatically.
