/**
 * Sample markdown documents for the dev site.
 */

/**
 * Content zip samples — fetched at runtime, unpacked into a ContentContainer.
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

export const SAMPLES: Record<string, string> = {
  // Single-block fixture for E2E tests that drive the full export
  // pipeline. Kept intentionally tiny — one block hits the 3-second
  // `minDuration` floor in markdownToDoc, which at 15 fps is ~45
  // frames, so the encode finishes well inside the default Playwright
  // timeout. Don't add anything that would inflate this — it exists
  // purely to keep `e2e/video-export.spec.ts` fast.
  'e2e-tiny': `# Tiny\n`,
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
  'hello-world': `# Hello World

Welcome to the **Squisq Editor**. This is a simple markdown document.

## Getting Started

Start editing this document in any of the three views:

1. **Raw** — Direct markdown source editing with Monaco
2. **Editor** — WYSIWYG rich text editing with Tiptap
3. **Preview** — See how the document maps to blocks

### Tips

- Use \`Ctrl+1/2/3\` to switch views
- The toolbar provides quick formatting shortcuts
- Check the Debug panel to inspect the parsed AST

---

*Happy editing!*
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

This is a section header — great for dividing a document into chapters.

## The Big Number {[statHighlight colorScheme=green]}

**42%** — The percentage of developers who prefer visual block editors over raw markup.

## A Famous Quote {[quote]}

> "The best way to predict the future is to invent it."
> — Alan Kay

## Did You Know? {[factCard]}

**Honey never spoils.** Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible, thanks to its low moisture and acidic pH.

## Side by Side {[twoColumn]}

**Markdown** is lightweight and portable, while **WYSIWYG** editors offer instant visual feedback. Both approaches have their place in modern workflows.

## A Pivotal Moment {[dateEvent mood=celebratory]}

**July 20, 1969** — Humanity set foot on the Moon for the first time when Apollo 11 landed in the Sea of Tranquility.

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

**Squisq** — A family of open-source libraries for document rendering, spatial utilities, and format conversion.

## East vs West {[comparisonBar leftLabel="East Coast" leftValue=58 rightLabel="West Coast" rightValue=42 unit="%"]}

Regional comparison shown as a horizontal bar, perfect for A/B data.

## Highlighted Passage {[pullQuote]}

> "Simplicity is the ultimate sophistication."
> — Leonardo da Vinci

## Video Clip {[videoWithCaption videoSrc="https://example.com/sample.mp4" videoAlt="Demo video" clipStart=0 clipEnd=10 caption="A short demonstration"]}

A captioned video block for embedding media clips.

## Video Quote {[videoPullQuote text="Technology is best when it brings people together." attribution="Matt Mullenweg"]}

A dramatic quote overlaid on a background video.
`,
  'diagram-family-tree': `# Family Tree Demo

A small genealogy diagram. Each child heading under the \`{[diagram]}\` parent becomes a node; \`connectsTo\` links them.

## Family Tree {[diagram]}

### Grandparent {#grandparent x=400 y=80}

The eldest known ancestor.

### Parent A {#parent-a x=240 y=260 connectsTo=grandparent}

### Parent B {#parent-b x=560 y=260 connectsTo=grandparent}

### Child 1 {#child-1 x=120 y=440 connectsTo=parent-a:born}

### Child 2 {#child-2 x=360 y=440 connectsTo=parent-a:born}

### Child 3 {#child-3 x=600 y=440 connectsTo=parent-b:born}

## After the diagram

Regular body content continues here.
`,
  'diagram-architecture': `# Architecture Sketch

A node diagram with typed connections.

## System Overview {[diagram]}

### API Server {#api x=300 y=120 connectsTo=db:reads,cache:reads,queue:publishes}

### Database {#db x=80 y=320}

### Cache {#cache x=300 y=320}

### Job Queue {#queue x=520 y=320 connectsTo=worker:dispatches}

### Worker {#worker x=520 y=520 connectsTo=db:writes}
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
};

// ── Custom template demo ──────────────────────────────────────

/**
 * Build a markdown doc that pre-defines a `hero` custom template in
 * frontmatter and uses it on a block. Computed at module init so the
 * base64-encoded definition is always in sync with the underlying
 * Layer array.
 */
function buildCustomTemplateDemo(): string {
  const heroLayers = [
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
  const heroDef = {
    name: 'hero',
    label: 'Hero Section',
    description: 'Large title with body below — uses {title} and {content}.',
    viewport: { width: 1920, height: 1080 },
    layers: heroLayers,
  };
  const payload = encodeForFrontmatter([heroDef]);
  return `---
title: Custom Template Demo
squisq-custom-templates: "${payload}"
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

function encodeForFrontmatter(value: unknown): string {
  // UTF-8 safe: `btoa` only accepts Latin1 so we route through
  // TextEncoder first. Mirror of `utf8ToBase64` in
  // packages/core/src/doc/customTemplatesFrontmatter.ts so the
  // round-trip stays bit-identical to the canonical encoder.
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return globalThis.btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}
