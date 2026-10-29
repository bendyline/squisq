---
title: Static blog
description: A Node static-site generator that renders Markdown posts into your own HTML page template, with an index page listing them.
---

# Static blog

Harbor Notes is a blog generator in one script. Each post is a Markdown file with a title, a date, and a description in its frontmatter. The script renders every post into an HTML template you write, fills the template's date and description slots, and builds an index page that lists the posts newest first. The output is plain static HTML you can host anywhere.

What it demonstrates:

- `markdownDocToPlainHtmlParts` from `@bendyline/squisq-formats/html`: a document's body as semantic HTML, plus the small amount of CSS its constructs need, without any page around it.
- `applyHtmlPageTemplate`: an ordinary HTML file with `<slot>` elements as the page template, named slots for your own fields, and relative links that keep working from any output folder.
- Reading frontmatter with `parseMarkdown`.

## Files

```text
harbor-notes/
├── package.json
├── tsconfig.json
├── build.ts
├── theme/
│   ├── post.html
│   ├── index.html
│   └── style.css
└── posts/
    ├── welcome.md
    ├── reading-the-tide-gauge.md
    └── autumn-survey-results.md
```

**`package.json`**

```json
{
  "name": "harbor-notes-blog",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsx build.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@bendyline/squisq": "2.13.6",
    "@bendyline/squisq-formats": "2.8.7"
  },
  "devDependencies": {
    "@types/node": "25.9.9",
    "tsx": "4.23.15",
    "typescript": "5.9.3"
  }
}
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["build.ts"]
}
```

**`build.ts`**

```ts
/**
 * Build the blog: posts/*.md → dist/posts/<slug>.html, plus dist/index.html.
 *
 *   npx tsx build.ts
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseMarkdown, type MarkdownDocument } from '@bendyline/squisq/markdown';
import { applyHtmlPageTemplate, markdownDocToPlainHtmlParts } from '@bendyline/squisq-formats/html';

const SITE = {
  title: 'Harbor Notes',
  description: 'Field notes from the people who keep the harbor running.',
};
const OUT = 'dist';

interface Post {
  slug: string;
  title: string;
  /** As written in frontmatter: YYYY-MM-DD. */
  date: string;
  description: string;
  doc: MarkdownDocument;
}

/** A frontmatter value as trimmed text, or '' when it is missing. */
function field(doc: MarkdownDocument, key: string): string {
  const value = doc.frontmatter?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function readPosts(): Promise<Post[]> {
  const posts: Post[] = [];
  for (const name of await readdir('posts')) {
    if (extname(name) !== '.md') continue;
    const doc = parseMarkdown(await readFile(join('posts', name), 'utf8'));
    const title = field(doc, 'title');
    const date = field(doc, 'date');
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`posts/${name}: frontmatter needs a title and a date (YYYY-MM-DD).`);
    }
    posts.push({
      slug: basename(name, '.md'),
      title,
      date,
      description: field(doc, 'description'),
      doc,
    });
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

const posts = await readPosts();
const postTemplate = await readFile('theme/post.html', 'utf8');
const indexTemplate = await readFile('theme/index.html', 'utf8');

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'posts'), { recursive: true });
await mkdir(join(OUT, 'theme'), { recursive: true });
await copyFile('theme/style.css', join(OUT, 'theme/style.css'));

// One page per post. `templatePath` and `outputPath` let the template's own
// relative links (style.css, ../index.html) resolve from the generated page.
for (const post of posts) {
  const parts = markdownDocToPlainHtmlParts(post.doc, { title: post.title });
  const outputPath = `posts/${post.slug}.html`;
  const html = applyHtmlPageTemplate(
    postTemplate,
    {
      bodyHtml: parts.bodyHtml,
      headHtml: parts.featureHeadHtml,
      title: post.title,
      values: { date: formatDate(post.date), description: post.description },
    },
    { templatePath: 'theme/post.html', outputPath },
  );
  await writeFile(join(OUT, outputPath), html);
  console.log(`  ${outputPath}`);
}

// The index lists every post, newest first.
const listing = posts
  .map(
    (post) => `<li>
  <a href="posts/${post.slug}.html">${escapeHtml(post.title)}</a>
  <time datetime="${post.date}">${formatDate(post.date)}</time>
  <p>${escapeHtml(post.description)}</p>
</li>`,
  )
  .join('\n');
const index = applyHtmlPageTemplate(
  indexTemplate,
  {
    bodyHtml: `<ul class="posts">\n${listing}\n</ul>`,
    title: SITE.title,
    values: { description: SITE.description },
  },
  { templatePath: 'theme/index.html', outputPath: 'index.html' },
);
await writeFile(join(OUT, 'index.html'), index);
console.log('  index.html');
console.log(`Built ${posts.length} posts into ${OUT}/`);
```

The post template. Its unnamed `<slot>` receives the post body; the named slots receive the title, the date, and the description. Each slot's own children are placeholder text, so the template previews sensibly when you open it in a browser.

**`theme/post.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><slot name="title">Post title</slot> · Harbor Notes</title>
    <meta name="description" content="" />
    <meta property="og:title" content="" />
    <meta property="og:description" content="" />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="masthead"><a href="../index.html">Harbor Notes</a></header>
    <main>
      <article>
        <p class="date"><slot name="date">September 1, 2026</slot></p>
        <h1><slot name="title">Post title</slot></h1>
        <p class="lede"><slot name="description">A one-sentence summary of the post.</slot></p>
        <slot><p>The post body goes here.</p></slot>
      </article>
    </main>
    <footer class="colophon"><a href="../index.html">← All posts</a></footer>
  </body>
</html>
```

The index template has the same structure: a title slot, a description slot, and an unnamed slot for the list of posts.

**`theme/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><slot name="title">Harbor Notes</slot></title>
    <meta name="description" content="" />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="masthead"><a href="../index.html">Harbor Notes</a></header>
    <main>
      <h1><slot name="title">Harbor Notes</slot></h1>
      <p class="lede"><slot name="description">What this blog is about.</slot></p>
      <slot
        ><ul class="posts">
          <li>Posts are listed here.</li>
        </ul></slot
      >
    </main>
  </body>
</html>
```

**`theme/style.css`**

```css
:root {
  --ink: #1d2a33;
  --muted: #5b6b75;
  --accent: #0f6e8c;
  --paper: #fbfaf7;
  --rule: #dfe3e6;
}
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font:
    18px/1.6 Georgia,
    'Times New Roman',
    serif;
}
main {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 3rem;
}
.masthead,
.colophon {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.25rem;
  font:
    600 0.95rem/1 system-ui,
    sans-serif;
}
.masthead {
  border-bottom: 1px solid var(--rule);
}
a {
  color: var(--accent);
}
.masthead a {
  color: var(--ink);
  text-decoration: none;
}
h1 {
  font-size: 2.2rem;
  line-height: 1.2;
  margin: 0.25rem 0 0.5rem;
}
.date,
.posts time {
  color: var(--muted);
  font:
    0.9rem system-ui,
    sans-serif;
}
.lede {
  color: var(--muted);
  font-size: 1.15rem;
}
.posts {
  list-style: none;
  padding: 0;
}
.posts li {
  padding: 1rem 0;
  border-bottom: 1px solid var(--rule);
}
.posts li > a {
  font-size: 1.3rem;
  font-weight: 600;
  display: block;
}
.posts p {
  margin: 0.25rem 0 0;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  border-bottom: 1px solid var(--rule);
  padding: 0.4rem 0.6rem;
  text-align: left;
}
blockquote {
  margin: 1.5rem 0;
  padding-left: 1rem;
  border-left: 3px solid var(--accent);
  color: var(--muted);
}
```

The posts. The file name becomes the page name.

**`posts/welcome.md`**

```markdown
---
title: Welcome to Harbor Notes
date: 2026-09-30
description: Field notes from the people who keep the harbor running.
---

This is where the harbor crew writes down what we measure, fix, and learn. Expect tide readings, survey results, and the occasional story about a stubborn mooring.

If you keep a boat here, the [harbor office](mailto:office@example.org) is the place for questions.
```

**`posts/reading-the-tide-gauge.md`**

```markdown
---
title: Reading the tide gauge
date: 2026-10-14
description: How we check the fuel-dock gauge against a staff reading every week.
---

The gauge at the fuel dock logs the water level every six minutes. Once a week we check it against the painted staff on the dock piling, because a gauge that drifts quietly is worse than no gauge at all.

## What we compare

| Reading    | Gauge  | Staff  | Difference |
| ---------- | ------ | ------ | ---------- |
| October 7  | 2.41 m | 2.39 m | +2 cm      |
| October 14 | 2.88 m | 2.82 m | +6 cm      |

Anything over 5 cm means a recalibration.

## The routine

1. Wait for slack water so the surface is flat.
2. Read the staff at eye level, twice.
3. Note the gauge value from the logger at the same minute.
4. Log both in the harbor binder.

> A gauge is only as good as the last time someone looked at it.
> — Marisol, harbor master
```

**`posts/autumn-survey-results.md`**

```markdown
---
title: Autumn survey results
date: 2026-10-21
description: Depths, silt, and mooring chain from three calm days on the north basin.
---

The autumn survey covered the north basin and both breakwaters over three days of calm water.

## Headlines

- The fuel dock reads **4.2 m** at mean low water, down 0.3 m since spring.
- Silt is building along the inner face of the east breakwater.
- Mooring buoys 14 through 19 need new chain before winter.

## What happens next

We asked two firms for dredging quotes, due November 15. The buoy chain goes in during the last week of November, weather permitting.
```

## Run it

```bash
npm install
npx tsx build.ts
```

```text
  posts/autumn-survey-results.html
  posts/reading-the-tide-gauge.html
  posts/welcome.html
  index.html
Built 3 posts into dist/
```

The finished site:

```text
dist/
├── index.html
├── posts/
│   ├── autumn-survey-results.html
│   ├── reading-the-tide-gauge.html
│   └── welcome.html
└── theme/
    └── style.css
```

Open `dist/index.html` in a browser, or serve the folder with any static server. Here is the start of one generated post, with the body CSS shortened:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reading the tide gauge · Harbor Notes</title>
    <meta
      name="description"
      content="How we check the fuel-dock gauge against a staff reading every week."
    />
    <meta property="og:title" content="Reading the tide gauge" />
    <meta
      property="og:description"
      content="How we check the fuel-dock gauge against a staff reading every week."
    />
    <style data-squisq>
      .squisq-feature {
        …
      }
    </style>
    <link rel="stylesheet" href="../theme/style.css" />
  </head>
  <body>
    <header class="masthead"><a href="../index.html">Harbor Notes</a></header>
    <main>
      <article>
        <p class="date">October 14, 2026</p>
        <h1>Reading the tide gauge</h1>
        <p class="lede">How we check the fuel-dock gauge against a staff reading every week.</p>
        <!-- squisq:content -->
        <p>The gauge at the fuel dock logs the water level every six minutes. …</p>
        <h2>What we compare</h2>
        <table>
          <thead>
            <tr>
              <th>Reading</th>
              <th>Gauge</th>
              <th>Staff</th>
              <th>Difference</th>
            </tr>
          </thead>
          …
        </table>
      </article>
    </main>
  </body>
</html>
```

## How it works

### Frontmatter

`parseMarkdown` reads the YAML block at the top of a post into `doc.frontmatter`. Scalar values come back as strings: `date: 2026-10-14` is the string `"2026-10-14"`, which the script checks against `YYYY-MM-DD`, sorts as text, and formats for display. The frontmatter stays out of the rendered body.

### Rendering a post

`markdownDocToPlainHtmlParts(doc, { title })` returns three parts:

| Part              | Contents                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bodyHtml`        | The document as semantic HTML (`<h2>`, `<p>`, `<table>`, and so on), footnotes included                                                             |
| `featureHeadHtml` | `<head>` markup for the CSS the body's own constructs need, such as feature sections and video embeds, and nothing that styles the rest of the page |
| `title`           | The `title` option, unescaped                                                                                                                       |

All the typography comes from your stylesheet. A post can use Squisq block tags: most blocks render as their plain content, and the feature layouts (`{[leftFeature]}`, `{[rightFeature]}`) become an image-and-text section styled by `featureHeadHtml`.

If you would rather have Squisq style the whole page, `markdownDocToPlainHtml` returns a complete page with its own stylesheet, in a [theme](../../guide/themes.md) when you pass `themeId`.

### Filling the template

`applyHtmlPageTemplate(template, content, options)` fills the template's slots:

- The one unnamed `<slot>` receives `bodyHtml`, between `<!-- squisq:content -->` and `<!-- /squisq:content -->` markers. A template needs exactly one.
- `<slot name="title">` receives `content.title`, and `<slot name="date">` receives `content.values.date`. Values are inserted as text and escaped, so a title can't inject markup.
- A slot with no value is replaced by its children, the placeholder text you wrote inside it.
- Slots inside `<title>` are filled as text, which is how the post title becomes "Reading the tide gauge · Harbor Notes".
- An existing `<meta name="description">`, `og:title`, `og:description`, or Twitter title and description tag receives the title or the `description` value.
- `headHtml` (here, `featureHeadHtml`) goes into `<head>` before the template's own stylesheets, so your CSS wins.
- The rest of the template is copied byte for byte: formatting, comments, and scripts survive.

### Relative links

The template's links are written relative to the template: `style.css` beside it in `theme/`, and `../index.html` one level up. The generated pages live elsewhere, so `templatePath` and `outputPath` tell `applyHtmlPageTemplate` where each file sits in the site, and it rewrites every relative URL in the template to resolve from the page. In a post, `style.css` becomes `../theme/style.css`; on the index, `theme/style.css`. That only works if the output mirrors those paths, which is why the script copies the stylesheet to `dist/theme/style.css`. Links inside the posts themselves are not rewritten.

`applyHtmlPageTemplate` throws an `HtmlPageTemplateError` for a template it can't use, such as one with no unnamed slot or with two. `inspectHtmlPageTemplate(html)` reports the same problems, plus the named slots it found, without throwing.

## Ideas for extending it

- **Images.** Copy each post's images into `dist/` and pass `images`, a `Map` from the path written in the Markdown to the URL to emit, in the options to `markdownDocToPlainHtmlParts`.
- **Links between posts.** Pass `links`, a `Map` from Markdown targets such as `welcome.md` to page URLs such as `welcome.html`.
- **Tags or an author.** Add frontmatter fields, then a `<slot name="author">` in the template and `values.author` in the script.
- **A feed.** Write `dist/feed.xml` from the same sorted `posts` array.
- **Linked documents.** `markdownDocsToPlainHtmlBundle` starts from one document, follows its links to other Markdown files, and returns a ZIP of plain HTML pages with the links rewritten from `.md` to `.html`. See [Static sites](../guides/static-sites.md).
- **Templates chosen by authors.** A document can name the page template it is published in with its `squisq-output-template` frontmatter. See [Page templates](../../guide/page-templates.md).
