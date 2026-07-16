/**
 * Sample markdown documents for the dev site.
 */

import { writeCustomTemplatesToFrontmatter } from '@bendyline/squisq/doc';
import type {
  CustomTemplateDefinition,
  CustomTemplateLayer,
  Layer,
} from '@bendyline/squisq/schemas';
import { DIAGRAM_GALLERY_SAMPLE } from './diagramGallerySample';

/**
 * Content zip samples -- fetched at runtime, unpacked into a ContentContainer.
 * Each entry maps a sample key to its URL under `/samples/` (served from repo-root samplecontent/).
 */
export interface ContentSample {
  label: string;
  url: string;
}

export const CONTENT_SAMPLES: Record<string, ContentSample> = {
  'issaquah-highlands': {
    label: 'Issaquah Highlands',
    url: '/samples/issaquah-highlands.dbk',
  },
};

/**
 * Optional display labels for inline {@link SAMPLES} entries. When a key is
 * absent here the dropdown falls back to `key.replace(/-/g, ' ')`. Use this
 * only when the derived label doesn't read well (e.g. parentheses, casing).
 */
export const SAMPLE_LABELS: Record<string, string> = {
  'about-squisq': 'About SquigglySquare (squisq)',
  'e2e-tiny': 'E2E tiny',
  'e2e-gif': 'E2E gif',
  'e2e-tasklist': 'E2E tasklist',
  'teleprompter-demo': 'Teleprompter (Narrate mode)',
};

export const SAMPLES: Record<string, string> = {
  // Single-block fixture for E2E tests that drive the full export
  // pipeline. Kept intentionally tiny -- one block hits the 3-second
  // `minDuration` floor in markdownToDoc, which at 15 fps is ~45
  // frames, so the encode finishes well inside the default Playwright
  // timeout. Don't add anything that would inflate this -- it exists
  // purely to keep `e2e/video-export.spec.ts` fast.
  'e2e-tiny': `# Tiny\n`,
  // Two visibly different half-second blocks for proving that GIF export
  // produces multiple image frames without making the browser E2E expensive.
  'e2e-gif': `# Blue {duration=0.5}\n\nFirst frame.\n\n# Orange {duration=0.5}\n\nSecond frame.\n`,
  // Task-list fixture for `e2e/task-list.spec.ts`. GFM checkboxes the WYSIWYG
  // editor must render as `<input type="checkbox">` (one unchecked, one
  // checked). Loaded as a sample -- the deterministic way the app ingests
  // markdown -- rather than typed into Monaco, which races the controlled
  // editor's value pipeline (see that test for the history).
  'e2e-tasklist': `# Tasks\n\n- [ ] open task\n- [x] closed task\n`,
  // Used by the timeline e2e: a block with an embedded <video> the timeline
  // should surface and let the author re-time / move between blocks.
  'timeline-media': `# One {duration=10}

Intro text.

<video src="video/clip.webm" controls></video>

# Two {duration=10}

More text.

# Three {duration=10}

End.
`,
  // Narrate-mode demo: opens straight into the teleprompter (frontmatter
  // display-mode) with varied-length spoken prose -- short punchy lines and
  // one long paragraph -- to exercise voice pacing, plus a list so list-item
  // pauses show up. ~200 words keeps the script scrollable but quick to read.
  'teleprompter-demo': `---
title: Teleprompter Demo
display-mode: narrate
---

# Welcome to the Teleprompter

Read this aloud at your own pace. When voice pacing is on, the prompter follows your voice -- speed up and it speeds up, pause and it waits for you.

Short lines are easy. This one is longer, winding through a few extra clauses so the pacing controller has to keep tracking your syllables across a full breath of continuous reading before you finally reach the period.

## How to Use It

Press start, take a breath, and begin reading. The highlighted word marks where the prompter thinks you are.

- Use the arrow keys to nudge the script if it drifts
- Drag the speed slider to match your natural pace
- Pop the prompter out and park it next to your camera

## The Finish

End on a steady, confident line. When you stop speaking, the prompter stops with you. That is the whole trick.
`,

  'hello-world': `# Hello World

Welcome to the **Squisq Editor**. This is a simple markdown document.

## Getting Started

Start editing this document in any of the three views:

1. **Raw** -- Direct markdown source editing with Monaco
2. **Editor** -- WYSIWYG rich text editing with Tiptap
3. **Preview** -- See how the document maps to blocks

### Tips

- Use \`Ctrl+1/2/3\` to switch views
- The toolbar provides quick formatting shortcuts
- Check the Debug panel to inspect the parsed AST

---

*Happy editing!*
`,

  'about-squisq': `---
title: About SquigglySquare
display-mode: slideshow
document-render-as: landscape
---
# About SquigglySquare {[title]}

SquigglySquare -- **squisq** for short -- turns plain Markdown into designed, animated documents. Write prose the way you always have, annotate a heading with a squiggly-square tag, and get a slide, a video frame, a diagram, or a drawing.

## The Philosophy {[sectionHeader colorScheme=blue]}

Author in the Markdown you already know. You can focus on your thoughts; layer on presentation only when you need it. Every tag is optional, reversible, and lossless -- delete one and you are left with clean Markdown, never a broken file.

## One Document, Three Views {[list colorScheme=teal]}

- **Raw** -- the Markdown source, with autocomplete for every tag and parameter
- **Editor** -- WYSIWYG rich-text editing
- **Play** -- the same content rendered as a slideshow or video

## The Anatomy of a Tag {[sectionHeader colorScheme=purple]}

A squiggly-square tag is a trailing annotation on a heading. It has the shape \`{[<block type> <parameter>=<value> ...]}\`. The heading text and the body beneath it supply the **content**; the tag chooses the **template** and sets **style** and **timing**.

## Content Comes From Markdown {[factCard]}

You almost never type the content *into* the tag. Write it as ordinary Markdown under the heading -- the template reads it. The tag is where design lives -- the sampler below shows several block types in action.

## A Sampler of Block Types {[sectionHeader colorScheme=orange]}

The blocks below are all live -- each heading picks a different template. Keep paging through Slideshow mode to see them render.

### The Big Number {[statHighlight colorScheme=green stat="42%\\*" detail="\\* statistic randomly made up :)"]}

**42%** of teams prefer visual blocks over raw slides.

### A Famous Quote {[quote]}

> "The best way to predict the future is to invent it."
> -- Alan Kay

### Honey Never Spoils {[factCard]}

Archaeologists have found 3,000-year-old honey in Egyptian tombs still perfectly edible -- its low moisture and acidic pH make it inhospitable to bacteria.

### East vs. West {[comparisonBar leftLabel="East" leftValue=58 rightLabel="West" rightValue=42 unit="%"]}

Numeric comparisons render as paired bars -- great for A/B data at a glance.

### Squisq, Defined {[definitionCard colorScheme=orange]}

**Squisq** -- a family of open-source libraries for turning Markdown into designed, animated documents.

### One Sentence, Full Screen {[fullBleedQuote colorScheme=purple]}

Sometimes a single line deserves the whole canvas.

## Parameters: Style {[sectionHeader colorScheme=green]}

Most templates accept a \`colorScheme\` drawn from the active theme: \`blue\`, \`green\`, \`purple\`, \`red\`, \`orange\`, or \`teal\`. Because the colors come from the theme, your document stays consistent when you switch themes -- no hard-coded hex to hunt down.

## Parameters: Motion {[sectionHeader colorScheme=blue]}

Add a \`transition\` to control how one block gives way to the next: \`transition=fade\`. Pair a \`transitionDirection\` with directional effects -- \`transition=push transitionDirection=left\` -- and tune the pace with \`transitionDuration=0.7\`. There are dozens of types (fade, push, wipe, zoom, doors, cube, vortex, and more) and eight directions (\`left\`, \`right\`, \`up\`, \`down\`, \`in\`, \`out\`, \`horizontal\`, \`vertical\`).

## A Gentle Fade {[quote transition=fade transitionDuration=0.8]}

> "This block was tagged transition=fade -- it dissolves into view."

## Pushes In From the Left {[factCard transition=push transitionDirection=left]}

And this one used \`transition=push transitionDirection=left\` -- watch the edge as it enters.

## Arrives With a Vortex {[fullBleedQuote colorScheme=teal transition=vortex]}

A dramatic \`transition=vortex\` for a dramatic line.

## Parameters: Timing {[sectionHeader colorScheme=red]}

In video mode every block sits on a clock. \`startTime=1:30\` pins when a block begins and \`duration=5\` sets how long it holds. Times accept plain seconds (\`5\`), milliseconds (\`1500ms\`), or \`mm:ss\` (\`01:30\`).

## Inline Icons {[factCard]}

A FontAwesome name inside a squiggly-square becomes an icon right in your prose: {[rocket]} {[paintbrush]} {[wand-magic-sparkles]} {[github]} {[youtube]}. Qualify a name that lives in two styles -- \`{[fa-solid:star]}\` -- and unknown or ambiguous names stay as plain text, so writing \`{[notathing]}\` is never swallowed.

## Diagrams From Headings {[factCard]}

A few tags turn **child** headings into parts. Under \`{[diagram]}\`, each \`###\` becomes a node and \`connectsTo=\` draws the edges; under \`{[drawing]}\`, children are shapes such as \`{[rectangle]}\` joined by \`{[arrow from=… to=…]}\`. Load the **diagram family tree**, **diagram architecture**, or **drawing org chart** samples to see them rendered.

## Guidelines {[list colorScheme=teal]}

- Start in Markdown; add tags only where design matters
- Let the heading and body carry content; let the tag carry style
- Prefer \`colorScheme\` over hard-coded colors so themes stay in control
- Use transitions sparingly -- motion should guide the eye, not fight for it
- Keep every tag reversible: strip them all and you still have a clean document

## Author once. Render everywhere. {[fullBleedQuote colorScheme=blue]}

That is the whole idea behind SquigglySquare.

## Explore SquigglySquare {[list colorScheme=teal]}

- [squigglysquare.com](https://squigglysquare.com)
- {[github]} [GitHub repository](https://github.com/bendyline/squisq)
- [Create an Issue](https://github.com/bendyline/squisq/issues/new)
`,

  'features-demo': `# Features Demo

This sample demonstrates all the markdown features supported by Squisq.

## Inline Formatting

This paragraph has **bold text**, *italic text*, ~~strikethrough~~, and \`inline code\`.

You can also combine **bold and *italic* text** together.

## Lists

### Unordered List

- First item
- Second item with **bold**
- Third item
  - Nested item A
  - Nested item B

### Ordered List

1. Step one
2. Step two
3. Step three

### Task List

- [x] Completed task
- [ ] Pending task
- [x] Another done

## Blockquotes

> This is a blockquote. It can contain **formatted** text.
>
> It can span multiple paragraphs.

## Code

Inline: \`const x = 42;\`

Block:

\`\`\`typescript
interface MarkdownDocument {
  type: 'document';
  children: MarkdownBlockNode[];
}
\`\`\`

## Tables

| Feature | Status | Notes |
|---------|--------|-------|
| Headings | ✅ | H1-H6 |
| Lists | ✅ | UL, OL, Task |
| Tables | ✅ | GFM |
| Code | ✅ | Inline + Block |

## Links and Images

Visit [Squisq on GitHub](https://github.com/example/squisq) for more.

---

That's the full feature set!
`,

  'block-templates': `# Block Templates Demo

This document shows how the heading hierarchy maps to Doc blocks.

## Introduction

This introduction section becomes a block. The paragraph content is
stored in the block's \`contents\` property.

## Statistics

### Revenue Growth

Revenue grew by **42%** year over year, exceeding all expectations.

### User Adoption

The platform reached **1 million** active users in Q3.

## Deep Dive

### Architecture

The system uses a microservices architecture with the following components:

1. API Gateway
2. Auth Service
3. Content Service
4. Search Index

### Performance

Response times improved across all endpoints:

| Endpoint | Before | After |
|----------|--------|-------|
| /api/search | 450ms | 120ms |
| /api/content | 200ms | 45ms |
| /api/auth | 150ms | 30ms |

## Conclusion

> The results speak for themselves. The architecture redesign
> delivered significant improvements across every metric.

This concluding section wraps up the presentation.
`,

  'deep-nesting': `# Document with Deep Nesting

## Section A

Content under Section A.

### Subsection A.1

Content under A.1.

#### Detail A.1.1

Deep content about a specific topic.

#### Detail A.1.2

Another focused detail.

### Subsection A.2

Content under A.2.

## Section B

Content under Section B.

### Subsection B.1

Some content here.

### Subsection B.2

More content here.

#### Detail B.2.1

##### Even Deeper B.2.1.1

This is deeply nested content to test the hierarchy handling.

###### Maximum Depth H6

H6 is the deepest heading level in markdown.

## Section C

Final top-level section with a simple paragraph.
`,

  'all-templates': `---
document-render-as: landscape
---

# All Squisq Templates {[title]}

A showcase of every built-in template.

## Section One {[sectionHeader colorScheme=blue]}

This is a section header -- great for dividing a document into chapters.

## The Big Number {[statHighlight colorScheme=green]}

**42%** -- The percentage of developers who prefer visual block editors over raw markup.

## A Famous Quote {[quote]}

> "The best way to predict the future is to invent it."
> -- Alan Kay

## Did You Know? {[factCard]}

**Honey never spoils.** Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible, thanks to its low moisture and acidic pH.

## Side by Side {[twoColumn]}

**Markdown** is lightweight and portable, while **WYSIWYG** editors offer instant visual feedback. Both approaches have their place in modern workflows.

## A Pivotal Moment {[dateEvent mood=celebratory]}

**July 20, 1969** -- Humanity set foot on the Moon for the first time when Apollo 11 landed in the Sea of Tranquility.

## Photo Showcase {[imageWithCaption imageSrc="https://picsum.photos/seed/squisq/800/600" imageAlt="Sample landscape" caption="A beautiful landscape photograph"]}

A captioned image block for featuring photography.

## Map View {[map center="48.8566,2.3522" zoom=12 title="Paris, France"]}

An interactive map tile centered on a point of interest.

## Bold Statement {[fullBleedQuote colorScheme=purple]}

Sometimes you just need one sentence that fills the entire screen.

## Key Steps {[list colorScheme=teal]}

- Design the content structure
- Write compelling copy
- Choose the right templates
- Preview and iterate
- Publish with confidence

## Photo Gallery {[photoGrid]}

A grid layout for showcasing multiple images side by side.

## Vocabulary {[definitionCard colorScheme=orange]}

**Squisq** -- A family of open-source libraries for document rendering, spatial utilities, and format conversion.

## East vs West {[comparisonBar leftLabel="East Coast" leftValue=58 rightLabel="West Coast" rightValue=42 unit="%"]}

Regional comparison shown as a horizontal bar, perfect for A/B data.

## Highlighted Passage {[pullQuote]}

> "Simplicity is the ultimate sophistication."
> -- Leonardo da Vinci

## Video Clip {[videoWithCaption videoSrc="https://example.com/sample.mp4" videoAlt="Demo video" clipStart=0 clipEnd=10 caption="A short demonstration"]}

A captioned video block for embedding media clips.

## Video Quote {[videoPullQuote text="Technology is best when it brings people together." attribution="Matt Mullenweg"]}

A dramatic quote overlaid on a background video.
`,
  'diagram-family-tree': `# Family Tree Demo

A small genealogy diagram. Diagrams are ASCII-art code fences: each box is a node, lines and arrows are connections, and text beside a line (\`│ born\`) is the connection's label. The WYSIWYG editor renders the fence as an interactive canvas and writes edits back as art.

## Family Tree

\`\`\`
                    ┌─────────────┐
                    │ Grandparent │
                    └─────┬─┬─────┘
                          ▲ ▲
             ┌────────────┘ │
             │              └───────┐
        ┌────┴─────┐           ┌────┴─────┐
        │ Parent A │           │ Parent B │
        └───┬─┬────┘           └───────┬──┘
            ▲ ▲                        ▲
     ┌──────┘ │                        │ born
     │ born   └───────┐                │
     │                │ born           │
┌────┴────┐      ┌────┴────┐      ┌────┴────┐
│ Child 1 │      │ Child 2 │      │ Child 3 │
└─────────┘      └─────────┘      └─────────┘
\`\`\`

## After the diagram

Regular body content continues here.
`,
  'diagram-architecture': `# Architecture Sketch

A node diagram with typed connections -- labels ride the lines, either embedded (\`── reads ──\`) or beside a vertical (\`│ dispatches\`).

## System Overview

\`\`\`
               ┌────────────┐
               │ API Server │
               └───┬─┬─┬────┘
     ┌─── reads ───┘ │ │
     │         reads │ │
     │               │ └─ publishes ─┐
     ▼               ▼               ▼
┌────┴─────┐   ┌─────┴─┐       ┌─────┴─────┐
│ Database │   │ Cache │       │ Job Queue │
└────┬─────┘   └───────┘       └─────┬─────┘
     ▲                               │
     │                               │
     └────────── writes ──────────┐  │ dispatches
                                  │  │
                                  │  ▼
                               ┌──┴──┴──┐
                               │ Worker │
                               └────────┘
\`\`\`
`,
  'diagram-nested-cluster': `# Nested Containers

A box drawn around other boxes becomes a container -- it groups its children on the canvas and survives round-trips as a surrounding box (the kind of diagram AI assistants emit).

## Inference Fleet

\`\`\`
┌────────────── Inference Cluster ───────────────┐
│                                                │
│ ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│ │ Worker A │   │ Worker B │   │ Worker C │     │
│ └────┬─────┘   └────┬─────┘   └────┬─────┘     │
│      │              │              │           │
│      ▼              ▼              ▼           │
│ ┌────┴─────┐   ┌────┴─────┐   ┌────┴─────┐     │
│ │ Queue A  │   │ Queue B  │   │ Queue C  │     │
│ └──────────┘   └──────────┘   └──────────┘     │
│                                                │
└────────────────────────────────────────────────┘
\`\`\`
`,
  'diagram-gallery': DIAGRAM_GALLERY_SAMPLE,
  'tree-project-scaffold': `# Project Scaffold

An ASCII file tree renders as an interactive filesystem treeview -- edit it as an outline (add / rename / indent / move / delete items); the fence stays the source of truth.

## Source Layout

\`\`\`
my-app/
├── public/
│   └── index.html
├── src/
│   ├── App.tsx
│   ├── index.tsx
│   └── components/
│       ├── Header.tsx
│       └── Footer.tsx
├── package.json
└── tsconfig.json
\`\`\`
`,
  'tree-gallery': `# Tree Gallery

A cross-section of AI-style trees -- each fence renders as an interactive filesystem-style treeview.

## File Tree

\`\`\`
service/
├── main.go       # entrypoint
├── config.yaml   # runtime config
├── handlers/     # HTTP handlers
│   └── users.go
└── go.mod
\`\`\`

## Dependency Tree

\`\`\`
express@4.18.2
├── body-parser@1.20.1
│   ├── bytes@3.1.2
│   └── qs@6.11.0
├── cookie@0.5.0
└── debug@2.6.9
    └── ms@2.0.0
\`\`\`

## Category Outline

\`\`\`
Animals
├── Mammals
│   ├── Dogs
│   └── Cats
├── Birds
│   ├── Eagles
│   └── Sparrows
└── Reptiles
    └── Snakes
\`\`\`
`,
  'diagram-legacy-headings': `# Legacy Heading Diagram

The pre-ASCII heading syntax (\`{[diagram]}\` + child headings with \`x=\`/\`y=\`/\`connectsTo=\`) still renders in the preview/player, but has no canvas editor -- new diagrams are authored as ASCII fences.

## System Overview {[diagram]}

### API Server {#api x=300 y=120 connectsTo=db:reads,cache:reads}

### Database {#db x=80 y=320}

### Cache {#cache x=300 y=320}
`,
  'diagram-broken': `# Broken Diagram (Repair Demo)

Real-world ASCII architecture art is often *half-broken* -- here a rename widened the labels past their boxes, so the columns desync row-to-row and no clean diagram can be parsed. Squisq renders it faithfully as a code block and offers a **⟳ Repair as diagram** button that reconstructs a clean, editable diagram.

\`\`\`
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ @scope/gateway-service  │   │ @scope/orders-service   │   │ @scope/billing-service  │
│ edge, auth   │   │ checkout     │   │ invoices     │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌────────────────────────────────────────────────────┐
│ @scope/event-bus                                    │
│ pub/sub backbone                                    │
└────────────────────────┬───────────────────────────┘
                         ▼
              ┌──────────────────────┐
              │ @scope/analytics-warehouse │
              │ rollups              │
              └──────────────────────┘
\`\`\`

Click **Repair** above the block to turn it into an interactive canvas.
`,
  'drawing-org-chart': `# Org Chart Demo

A free-form drawing. Each child heading under the \`{[drawing]}\` parent is a shape; \`from\`/\`to\` connectors join them.

## Org chart {[drawing]}

### CEO {#ceo} {[rectangle x=360 y=80 width=200 height=100]}

### CTO {#cto} {[rectangle x=160 y=320 width=200 height=100]}

### COO {#coo} {[rectangle x=560 y=320 width=200 height=100]}

### reports to {[arrow from=cto to=ceo]}

### also reports {[arrow from=coo to=ceo]}

## After the drawing

Regular body content continues here.
`,
  'custom-template-demo': buildCustomTemplateDemo(),
  // v1.5 "inline everything": every `{[…]}` param below is authored as a
  // plain string and coerced to the template's typed input at parse time
  // (numbers, `lat,lng` pairs, `label|sublabel` pairs). The map's markers
  // -- an array of objects, which the yaml subset can't express -- ride in a
  // ```json data fence. The statHighlight is a STANDALONE annotation: a
  // paragraph that is nothing but `{[…]}`, so it becomes its own block with
  // no heading.
  'inline-everything': `# Inline Everything

Everything on this page is authored with inline, string-valued annotation
params -- no JSON hand-editing required. The parser coerces each one to the
template's typed shape.

## Find Us {[map center="47.6,-122.3" zoom=11]}

\`\`\`json data
{
  "markers": [
    { "lat": 47.6062, "lng": -122.3321, "label": "Seattle", "icon": "star" },
    { "lat": 47.6205, "lng": -122.3493, "label": "Space Needle" }
  ]
}
\`\`\`

## Two Ways to Brew {[twoColumn left="Espresso|Bold & rich" right="Filter|Bright & clean"]}

Same beans, two extractions -- the \`left\`/\`right\` params coerce from
\`label|sublabel\` strings into the column objects the template expects.

{[statHighlight colorScheme=green stat="98%" description="of params need no JSON"]}

A standalone annotation: this paragraph is nothing but the \`{[…]}\`, so it
renders as its own stat block without a heading above it.
`,
  'gallery-template-demo': buildGalleryTemplateDemo(),
};

// ── Custom template demo ──────────────────────────────────────

/**
 * Build a markdown doc that pre-defines a `hero` custom template in
 * frontmatter and uses it on a block. Computed at module init so the
 * base64-encoded definition is always in sync with the underlying
 * Layer array.
 */
function buildCustomTemplateDemo(): string {
  const heroLayers: Layer[] = [
    {
      id: 'hero-title',
      type: 'text',
      position: { x: '6%', y: '20%', width: '88%' },
      content: {
        text: '{title}',
        style: {
          fontSize: 96,
          fontWeight: 'bold',
          color: '#0f172a',
          textAlign: 'left',
        },
      },
    },
    {
      id: 'hero-body',
      type: 'text',
      position: { x: '6%', y: '52%', width: '88%' },
      content: {
        text: '{content}',
        style: { fontSize: 36, color: '#475569', textAlign: 'left' },
      },
    },
    {
      id: 'hero-accent',
      type: 'shape',
      position: { x: '6%', y: '14%', width: '6%', height: '2%' },
      content: { shape: 'rect', fill: '#6366f1' },
    },
  ];
  const heroDef: CustomTemplateDefinition = {
    name: 'hero',
    label: 'Hero Section',
    description: 'Large title with body below -- uses {title} and {content}.',
    viewport: { width: 1920, height: 1080 },
    layers: heroLayers,
  };
  // Compact JSON, stored unquoted so it round-trips through the
  // line-based frontmatter parser and stays human-readable.
  const payload = writeCustomTemplatesToFrontmatter([heroDef]);
  return `---
title: Custom Template Demo
squisq-custom-templates: ${payload}
---

# Custom Templates Demo

This sample demonstrates a user-authored \`hero\` template defined in
frontmatter. Blocks tagged with \`{[hero]}\` render via that template;
\`{title}\` and \`{content}\` placeholders substitute each block's data.

## Welcome to Squisq {[hero]}

A small editor for big ideas. Author once, render everywhere.

## Why custom templates? {[hero]}

Templates capture brand voice and layout once, then every block in
your doc can use them. No more copy-pasting positions across slides.
`;
}

// ── Gallery custom template (v1.5 attr + repeat tokens) ────────

/**
 * Build a markdown doc whose \`gallery\` custom template exercises the
 * v1.5 token additions:
 *   - \`{attr:key|default}\` -- reads a per-block annotation attribute
 *     (\`{[gallery subtitle="…"]}\`), falling back to the pipe default.
 *   - a \`repeat\` layer -- cloned once per image in the block body, laid
 *     out in a row, resolving per-item \`{item:src}\` / \`{item}\` tokens.
 */
function buildGalleryTemplateDemo(): string {
  const galleryLayers: CustomTemplateLayer[] = [
    {
      id: 'gallery-title',
      type: 'text',
      position: { x: '6%', y: '8%', width: '88%' },
      content: {
        text: '{title}',
        style: { fontSize: 72, fontWeight: 'bold', color: '#0f172a', textAlign: 'left' },
      },
    },
    {
      id: 'gallery-subtitle',
      type: 'text',
      position: { x: '6%', y: '22%', width: '88%' },
      content: {
        // {attr:subtitle} reads the block's `{[gallery subtitle="…"]}`
        // annotation; the pipe default renders when it's absent.
        text: '{attr:subtitle|Featured work}',
        style: { fontSize: 32, color: '#475569', textAlign: 'left' },
      },
    },
    {
      id: 'gallery-thumb',
      type: 'image',
      position: { x: '6%', y: '38%', width: '26%', height: '46%' },
      content: { src: '{item:src}', alt: '{item}', fit: 'cover' },
      // Cloned once per image in the block body, laid out left-to-right.
      repeat: { source: 'images', direction: 'row', gap: 24, max: 3 },
    },
  ];
  const galleryDef: CustomTemplateDefinition = {
    name: 'gallery',
    label: 'Image Gallery',
    description: 'Title + subtitle over a row of thumbnails -- uses {attr:…} and a repeat layer.',
    viewport: { width: 1920, height: 1080 },
    layers: galleryLayers,
  };
  const payload = writeCustomTemplatesToFrontmatter([galleryDef]);
  return `---
title: Gallery Template Demo
squisq-custom-templates: ${payload}
---

# Gallery Custom Template

The \`gallery\` template (defined in frontmatter) reads a per-block
\`subtitle\` attribute via \`{attr:subtitle|Featured work}\` and clones one
thumbnail per image in the block body via a \`repeat\` layer.

## Northwest Trails {[gallery subtitle="Three favorite hikes"]}

![Rattlesnake Ledge](https://picsum.photos/seed/trail1/600/800)
![Mount Si](https://picsum.photos/seed/trail2/600/800)
![Poo Poo Point](https://picsum.photos/seed/trail3/600/800)

## Studio Work {[gallery]}

No \`subtitle\` here -- the template falls back to its default label.

![Piece one](https://picsum.photos/seed/art1/600/800)
![Piece two](https://picsum.photos/seed/art2/600/800)
`;
}
