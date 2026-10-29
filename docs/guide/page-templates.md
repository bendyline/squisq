---
title: HTML page templates
description: Publish a document inside your own web page — your site's header, navigation, footer, and stylesheet — using an HTML file with slots.
---

# HTML page templates

When you publish a document as a web page, you usually want it to look like the rest of your
site: the same header and navigation, the same footer, the same stylesheet. A **page template**
is an ordinary HTML file from your site with a `<slot>` element where the document goes. The
document's HTML is placed into that slot, and everything else in your file is kept exactly as
you wrote it.

Page templates hold the plain, text-first rendition of a document — the one
[Document mode](display-modes.md#document) shows: headings, paragraphs, lists, tables, images,
and embedded videos. Your stylesheet decides how it looks.

## A complete example

A template, saved as `post-template.html` at the root of a site:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title><slot name="title">Untitled</slot> · Harbor Notes</title>
    <meta name="description" content="" />
    <meta property="og:title" content="" />
    <link rel="stylesheet" href="site.css" />
  </head>
  <body>
    <header class="site-header">
      <a href="index.html"><img src="images/logo.svg" alt="Harbor Notes" /></a>
      <nav><a href="index.html">Home</a> <a href="archive/">Archive</a></nav>
    </header>
    <main>
      <p class="byline">By <slot name="author">the harbor office</slot></p>
      <slot><p>The article goes here.</p></slot>
    </main>
    <footer>© 2026 North Harbor Authority</footer>
  </body>
</html>
```

A document that uses it:

```markdown
---
title: Spring Survey Results
description: Boat counts and berth use from the spring season.
author: Ines Duarte
squisq-output-template: post-template.html
---

# Spring Survey Results

**1,284** vessels passed the breakwater this spring.

- North berth: 412 arrivals
- Ferry berth: 365 arrivals
```

Published as `posts/spring-survey.html`, the page comes out like this (shortened: the block of
CSS the document's own content needs is cut, and the inserted body is indented for reading):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Spring Survey Results · Harbor Notes</title>
    <meta name="description" content="Boat counts and berth use from the spring season." />
    <meta property="og:title" content="Spring Survey Results" />
    <style data-squisq>
      /* … */
    </style>
    <link rel="stylesheet" href="../site.css" />
  </head>
  <body>
    <header class="site-header">
      <a href="../index.html"><img src="../images/logo.svg" alt="Harbor Notes" /></a>
      <nav><a href="../index.html">Home</a> <a href="../archive/">Archive</a></nav>
    </header>
    <main>
      <p class="byline">By Ines Duarte</p>
      <!-- squisq:content -->
      <h1>Spring Survey Results</h1>
      <p><strong>1,284</strong> vessels passed the breakwater this spring.</p>
      <ul>
        <li><p>North berth: 412 arrivals</p></li>
        <li><p>Ferry berth: 365 arrivals</p></li>
      </ul>
      <!-- /squisq:content -->
    </main>
    <footer>© 2026 North Harbor Authority</footer>
  </body>
</html>
```

Everything the template wrote by hand is still there. The slots were filled, the title and
description reached the `<head>`, and every relative link now works from the `posts/` folder.

## The slot contract

| In the template                        | Becomes                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `<slot></slot>` (no name)              | The document's body. A template needs exactly one.                                                                   |
| `<slot name="title"></slot>`           | The document's title, as text                                                                                        |
| `<slot name="author"></slot>`, …       | A value with that name from the publishing app — usually the document's frontmatter field of the same name — as text |
| Content between `<slot>` and `</slot>` | Fallback, shown when the slot has no value                                                                           |
| `<slot/>`                              | An empty slot, written the way Astro and JSX authors are used to                                                     |

- **Values are text.** A value is escaped before it goes in, so a frontmatter field can never
  add markup to your page.
- **Fallbacks keep the file previewable.** Open the template straight in a browser and you see
  its placeholders: "Untitled", "the harbor office", "The article goes here."
- **Which values a named slot can use is up to the app that publishes the page.** Anything it
  doesn't supply shows the slot's fallback, or nothing.
- **Slots that aren't page structure are left alone.** A `<slot>` inside a `<template>`
  element (a web component's shadow tree), inside SVG or MathML, in a comment, or in a script is
  not a page template slot.

## What else the template receives

**The title.** `<title>` can't contain elements, so slots written inside it are filled as text —
`<title><slot name="title">Untitled</slot> · Harbor Notes</title>` in the example. A `<title>`
with no slot is replaced by the document's title, and a template with no `<title>` at all gets
one.

**Description and social metadata.** If the template declares them, these `<meta>` tags get the
document's values:

| Tag                                                                  | Receives        |
| -------------------------------------------------------------------- | --------------- |
| `<meta name="description">`, `og:description`, `twitter:description` | The description |
| `og:title`, `twitter:title`                                          | The title       |

A tag the template doesn't declare is not added, and a document with no description leaves the
template's own description in place.

**The CSS the content needs.** Some of a document's constructs need a little CSS of their own —
side-by-side features, video players, inline SVG pictures, icons. It goes in a
`<style data-squisq>` block placed just before your first stylesheet, so your CSS comes later
and wins. Nothing from the document's theme is added: no fonts, colors, or page styles.

## Byte for byte

The template is never parsed and rewritten. Apart from the slots, the `<title>`, the metadata
values, the added CSS, and the relative URLs described next, every byte of your file comes
through unchanged — indentation, comments, inline scripts, analytics snippets, and all.

## Relative URLs

A template is written relative to its own location, but the pages generated from it can live
anywhere in the site. Relative URLs in these attributes are rewritten to resolve the same way
from the generated page's folder: `href`, `src`, `srcset`, `imagesrcset`, `poster`, `action`,
`formaction`, `cite`, `data`, `background`, and `xlink:href`. In the example, `site.css` became
`../site.css` for a page in `posts/`.

These are left alone:

- Absolute URLs (`https://…`), other schemes (`mailto:…`), and root-relative paths (`/about`)
- Fragments (`#top`) and query-only links (`?page=2`)
- Paths that climb out of the site's folder
- Values containing `{{`, so another templating system's placeholders survive

Nothing is rewritten when the template and the page are in the same folder.

## Content markers and re-importing

The document's body is wrapped in two comments, `<!-- squisq:content -->` and
`<!-- /squisq:content -->`. When you import a page built from a template back into Squiggly
Square, only what lies between the markers becomes the document; your header, navigation, and
footer are left behind. As with any HTML import, the page's `<title>` and description become the
document's `title` and `description`. See [Import and export](import-export.md).

## When a template can't be used

A template that breaks the slot rules is refused, with each problem reported by line number:

| Problem                     | Message                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| No unnamed slot             | The template has no unnamed `<slot>` for the document content.                     |
| Two or more unnamed slots   | The template has more than one unnamed `<slot>`; the content can appear only once. |
| A slot inside a slot        | A `<slot>` cannot be placed inside another `<slot>`.                               |
| A stray closing tag         | A `</slot>` has no matching `<slot>`.                                              |
| A slot that is never closed | A `<slot>` is never closed; write `<slot></slot>` or `<slot/>`.                    |

A file counts as a page template as soon as it has a `<slot>` outside a `<template>` element —
an ordinary web page has no reason to carry one.

## Choosing a template for a document

A document names its template in the frontmatter:

```yaml
squisq-output-template: _templates/post.html
```

The value is the template's path, as the app that publishes your documents lists it. Use
`squisq-output-template: none` to publish a document without the template the app would
otherwise apply by default.

In the editor, apps that publish with page templates add a **Page template** field to
**Document settings**. It lists the templates the app found — "No page templates found" when
there are none — and the app's default, if it has one, with **None** to opt out of it. Choosing
an entry writes `squisq-output-template` for you.

> [!NOTE]
> Page templates are applied by the app that publishes the page. The demo editor on this site,
> and the `squisq` command line, don't offer them; building your own publishing step is covered
> in [Static sites](../developers/guides/static-sites.md).

These docs are a working example: every page here is a Markdown file placed into one page
template, [`docs/_theme/page.html`](../_theme/page.html), by
[`buildDocsSite.ts`](../../packages/site/src/docsSite/buildDocsSite.ts).
