/**
 * Sample markdown documents for the dev site.
 */

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

  'template-annotations': `---
document-render-as: landscape
---

# Story: Climate Report {[titleBlock]}

An overview of recent climate data and trends.

## Temperature Trends {[chart colorScheme=warm]}

Average global temperatures have risen by 1.2°C since pre-industrial times.
The past decade was the warmest on record.

- 2023: +1.48°C above baseline
- 2022: +1.15°C above baseline
- 2021: +1.11°C above baseline

## Key Finding {[statHighlight]}

**1.5°C** — The Paris Agreement target that scientists warn we may breach by 2030.

## Expert Commentary {[quoteBlock]}

> "We are in uncharted territory. The data is clear and the urgency is now."
> — Dr. Jane Smith, Climate Research Institute

## Regional Comparison {[comparisonBar]}

Arctic regions are warming **four times faster** than the global average,
while tropical regions experience more modest but still significant changes.

## How You Can Help {[listBlock]}

- Reduce energy consumption at home
- Support renewable energy initiatives
- Advocate for policy change
- Plant trees and protect green spaces
- Educate others about climate science

## What's Next {[sectionHeader]}

Plain heading section with no special template — uses the default layout.
`,
};
