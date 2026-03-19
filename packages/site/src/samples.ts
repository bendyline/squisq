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

# All Squisq Templates {[titleBlock]}

A showcase of every built-in template.

## Section One {[sectionHeader colorScheme=blue]}

This is a section header — great for dividing a document into chapters.

## The Big Number {[statHighlight colorScheme=green]}

**42%** — The percentage of developers who prefer visual block editors over raw markup.

## A Famous Quote {[quoteBlock]}

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

## Map View {[mapBlock center="48.8566,2.3522" zoom=12 title="Paris, France"]}

An interactive map tile centered on a point of interest.

## Bold Statement {[fullBleedQuote colorScheme=purple]}

Sometimes you just need one sentence that fills the entire screen.

## Key Steps {[listBlock colorScheme=teal]}

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
};
