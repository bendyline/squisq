---
template: tree
description: The Tree block draws a file tree or outline, written as plain-text art in a code fence or as a nested list, as a folder-style tree view.
---

# Tree

Use Tree for anything shaped like folders: a project's files, a site map, the sections of a
report, the collections of a museum. You write it the way it's usually written in plain text,
with `├──` and `└──` connectors or a nested bullet list, and the block draws it as a tree view
with folder and file icons, connector lines, and the heading as its title. For things joined by
arrows rather than nested, use [Diagram](diagram.md).

````markdown preview
## The harbor survey project

```tree
harbor-survey/
├── README.md        # how to run the survey
├── data/
│   ├── soundings.csv
│   └── tides-2025.csv
└── report/
    ├── draft.md
    └── figures/
```
````

A section whose body is only a tree fence gets this template automatically, as here; add
`{[tree]}` to the heading when you want to set parameters.

## How it reads your section

- **The fence** — one code fence of tree art in the body. Each line is an item, and its
  indentation or connectors set its depth. These forms all work:
  - box-drawing connectors: `├──`, `└──`, `│`
  - ASCII connectors: `|--`, `` `-- ``, `+--`
  - plain indentation, or indented bullets
- **A nested list** — with the `{[tree]}` tag, a nested bullet list in the body works too: each
  bullet is an item and its sub-bullets are its children.
- **Folders** — an item ending in `/`, or one with children, is drawn as a folder; others are
  files.
- **Comments** — text after `#`, `<--`, or `//` is shown as a muted note beside the item, when
  there are at least two spaces before the marker. With just one space, the marker is part of
  the name, so `C# bindings` stays whole.
- **Heading** — the title above the tree.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports keep it.

In the player, folders can be collapsed and expanded with a click; exported images and videos
show the tree fully expanded. In [page view](../guide/display-modes.md#page) the tree is drawn
just as on the slide.

### Getting a fence recognized

Tag the fence ` ```tree ` and it is always read as a tree, even one that is only indented. An
untagged fence, or one tagged `text`, `txt`, `plaintext`, `plain`, or `ascii`, is read as a tree
only when it uses connector lines such as `├──` or `|--`. Fences tagged with a programming
language always stay code. A fence with box corners (`┌`, `┐`, `┘`) is read as a
[Diagram](diagram.md), never a tree; `└` is fine, since trees use it as an elbow.

## Examples

### An outline from a list

With the tag, an ordinary nested list becomes a tree. Items with children become folders.

```markdown preview
## Museum collections {[tree]}

- Maritime
  - Ship models
  - Navigation instruments
  - Harbor photographs
- Natural history
  - Birds of the Sound
  - Tide pools
- Archives
```

### Indentation only

A ` ```tree ` fence can skip the connectors: two-space indents are enough.

````markdown preview
## The annual report {[tree colorScheme=teal]}

```tree
Annual report/
  Letter from the director
  Year in review/
    Exhibitions
    Education programs
    Conservation
  Financials/
    Statement of activities
    Donors
```
````

## Parameters

```squisq-docs
template-params
```

- `colorScheme` colors the folder icons and folder names.
- `items` is filled in from the fence or list; you never set it in the tag.

## Tips

- **Keep it to about fifteen rows on a slide.** Longer trees fit in page view, or split them by
  folder across sections.
- **Mark folders with a trailing slash.** `data/` reads as a folder even before it has
  contents.
- **Align comments with spaces.** Two or more spaces before `#` make it a comment, and lining
  them up keeps the source readable too.
- **Edit it as an outline.** In the editor's Write view, the tree becomes an outline you can add
  to, rename, indent, outdent, reorder, and collapse, and the fence text is rewritten to match.

## Related

- [Trees](../guide/diagrams.md#trees) — the full fence syntax
- [List](list.md) — a plain bulleted or numbered list on a card
- [Diagram](diagram.md) — boxes and arrows
- [Timeline](timeline.md) — events along a time axis
