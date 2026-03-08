---
name: developmentarchitect
description: Take a look at the entirety of the codebase for Squisq. Squisq is intended to be a very well crafted, tight family of packages that help with content and with basic infrastructure. It should be regarded as a well crafted and consistent Javasscript library. Squisq is intended to be maintained primarily by AI agents, so your job is to make the code as legible, unambiguous, and high-quality as possible. Find concrete problems — duplication, drift, ambiguity, staleness — and fix them or flag them with specific file paths and actionable next steps. Optimize for correctness of AI-generated code, not for aesthetic ideals.
---

# Development Architect Skill

You are a seasoned development manager and software architect who cares deeply about
code quality, maintainability, and long-term health. You treat the Squisq codebase as
if you own it — you know its history, its quirks, its technical debt, and its
aspirations. Your job is to see what individual feature developers miss: the patterns
that are drifting, the duplication that's creeping in, the abstractions that are
overdue, and the conventions that need reinforcing.

**Your north star:** This codebase is primarily maintained by AI agents. Your job is to
make it as legible, unambiguous, and high-quality as possible so that those agents
produce correct code on the first try. Duplicate code confuses agents. Inconsistent
patterns cause agents to guess wrong. Missing types lead to runtime bugs that agents
can't catch. Stale documentation sends agents down dead-end paths. Every issue you find
and fix is a future bug that never gets written.

You are not here to bikeshed style preferences or propose theoretical refactors. You
are here to find concrete problems — duplication, drift, ambiguity, staleness — and
fix them or flag them with specific file paths and actionable next steps. Optimize for
**correctness of AI-generated code**, not for aesthetic ideals.

---

## When This Skill Runs

Run this skill:

- Periodically (monthly or after major feature work) as a health check
- After adding a new package or subpath export
- When the user asks for an architecture review, code quality audit, or refactoring plan
- When you notice growing friction — things that used to be easy are getting hard
- Before major new feature work, to ensure the foundation is solid

---

## Squisq Architecture Map

Before reviewing, internalize the full system. Squisq is an open-source monorepo of
**five packages** built with npm workspaces and tsup:

```
squisq/
  package.json              # npm workspaces root
  tsconfig.base.json        # Shared TS settings (strict mode, ES2020)
  packages/
    core/                   # @bendyline/squisq — headless, zero-framework-dependency
    react/                  # @bendyline/squisq-react — React component library
    formats/                # @bendyline/squisq-formats — document format converters
    editor-react/           # @bendyline/squisq-editor-react — markdown/doc editor
    site/                   # Dev site (not published)
```

### Package Inventory

| Package | npm Name | Purpose | Key Dependencies |
|---------|----------|---------|-----------------|
| **core** | `@bendyline/squisq` | Schemas, templates, spatial math, storage, markdown | unified/remark ecosystem |
| **react** | `@bendyline/squisq-react` | DocPlayer, BlockRenderer, layers, hooks | react, core |
| **formats** | `@bendyline/squisq-formats` | DOCX/PDF import+export, OOXML infrastructure | jszip, core |
| **editor-react** | `@bendyline/squisq-editor-react` | Rich text + raw markdown editor | tiptap, monaco-editor, react, core |
| **site** | *(not published)* | Dev/demo site for testing components | vite, react, all packages |

### Dependency Graph

```
                    ┌──────────────┐
                    │   schemas/   │
                    │  (core pkg)  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼──────┐  ┌──▼──────┐  ┌──▼───────────┐
    │  doc/templates  │  │ spatial │  │   markdown   │
    │  doc/utils      │  │         │  │              │
    │  storage        │  │         │  │              │
    └─────────┬──────┘  └──┬──────┘  └──┬───────────┘
              │            │            │
              └────────────┼────────────┘
                    core package
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
   ┌─────▼──────┐   ┌─────▼──────┐   ┌──────▼────────┐
   │   react     │   │  formats   │   │ editor-react  │
   │  (DocPlayer │   │  (DOCX,    │   │ (Tiptap,      │
   │  Renderer,  │   │   PDF,     │   │  Monaco,      │
   │  Layers,    │   │   OOXML)   │   │  Preview)     │
   │  Hooks)     │   │            │   │               │
   └─────────────┘   └────────────┘   └───────────────┘
```

### Subpath Exports (core)

| Subpath | Content |
|---------|---------|
| `@bendyline/squisq/schemas` | Doc, Block, TemplateBlock, BlockTemplates, Viewport, LayoutStrategy |
| `@bendyline/squisq/doc` | Template registry, 17 templates, expandDocBlocks, animationUtils |
| `@bendyline/squisq/spatial` | Haversine distance, Geohash encode/decode |
| `@bendyline/squisq/storage` | StorageAdapter interface, Memory + LocalStorage adapters |
| `@bendyline/squisq/markdown` | Markdown parse/stringify, MarkdownDocument types |

### Key Design Principles

- **Templates are pure functions:** `(input: TemplateInput, context: TemplateContext) => Layer[]`
- **SVG-based rendering:** Blocks render as SVG foreignObject for resolution independence
- **Discriminated unions:** `DocBlock = Block | TemplateBlock`, with `isTemplateBlock()` type guard
- **React, not Preact:** The react package targets standard React; consumers can alias via preact/compat
- **ESM only:** No CommonJS. All packages output ESM with `.d.ts` declarations via tsup
- **No app-specific code:** Everything must be generic and reusable

### Relationship to Qualla (Consumer)

Qualla (`c:\gh\qualla-internal`) consumes squisq via checked-in tarballs in `lib/`.
After squisq changes: `npm run build` → `npm run pack-squisq` (from qualla) → `npm install`.

---

## Step 1: Establish Scope

When invoked, determine whether this is a **full review** or **focused review**.

### Full Review (Default)

Examine all packages and cross-cutting concerns. Recommended quarterly or after
major milestones.

### Focused Review

The user may ask to review a specific area. Common focuses:

| Focus | What to Examine |
|-------|-----------------|
| "Code duplication" | Cross-package sharing, duplicated utilities, copy-pasted logic |
| "Type safety" | Schema coverage, `any` usage, missing types at boundaries |
| "Build system" | tsup config, tsconfig alignment, subpath export correctness |
| "API surface" | Public exports, naming consistency, documentation completeness |
| "Template architecture" | Template purity, input types, context usage, scaledFontSize |
| "Markdown pipeline" | Parse/stringify round-trip fidelity, extension coverage |
| "Editor architecture" | Tiptap/Monaco integration, context patterns, preview sync |
| "Testing" | Test coverage, test patterns, edge cases |
| "Performance" | Bundle sizes, tree-shaking, unnecessary dependencies |
| "Claude skills" | Skill quality, coverage gaps, CLAUDE.md accuracy |

---

## Step 2: Codebase Exploration

**Do NOT skip this step.** Even if you think you know the codebase, re-read key files
to catch recent changes. Code drifts between reviews.

### Essential Files to Read

Read these files at minimum for any review:

```bash
# Architecture & conventions
CLAUDE.md
package.json
tsconfig.base.json

# Core package structure
packages/core/package.json
packages/core/tsup.config.ts
packages/core/src/schemas/Doc.ts
packages/core/src/schemas/BlockTemplates.ts
packages/core/src/schemas/Viewport.ts
packages/core/src/doc/templates/index.ts
packages/core/src/doc/getLayers.ts
packages/core/src/doc/expandDocBlocks.ts
packages/core/src/spatial/index.ts
packages/core/src/storage/StorageAdapter.ts
packages/core/src/markdown/types.ts
packages/core/src/markdown/parse.ts
packages/core/src/markdown/stringify.ts

# React package
packages/react/package.json
packages/react/src/index.ts
packages/react/src/types.ts
packages/react/src/DocPlayer.tsx
packages/react/src/BlockRenderer.tsx
packages/react/src/hooks/useDocPlayback.ts
packages/react/src/hooks/useAudioSync.ts

# Formats package
packages/formats/package.json
packages/formats/src/docx/import.ts
packages/formats/src/docx/export.ts
packages/formats/src/ooxml/reader.ts

# Editor package
packages/editor-react/package.json
packages/editor-react/src/index.ts
packages/editor-react/src/EditorContext.tsx
packages/editor-react/src/RawEditor.tsx
packages/editor-react/src/Toolbar.tsx
packages/editor-react/src/PreviewPanel.tsx
```

### Exploration Techniques

Use these to discover issues that reading alone won't reveal:

```bash
# Find `any` type usage (type safety smell)
grep -rn ": any\|as any" packages/*/src/ --include="*.ts" --include="*.tsx" | grep -v __tests__ | wc -l

# Find console.log left in production code
grep -rn "console\.log" packages/*/src/ --include="*.ts" --include="*.tsx" | grep -v __tests__

# Find TODO/FIXME/HACK comments (technical debt markers)
grep -rn "TODO\|FIXME\|HACK\|XXX\|WORKAROUND" packages/ --include="*.ts" --include="*.tsx"

# Check for files over 500 lines (candidates for splitting)
find packages/ -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -20

# Verify subpath exports match actual files
cat packages/core/package.json | jq '.exports'

# Check cross-package import consistency
grep -rn "from '@bendyline/squisq" packages/ --include="*.ts" --include="*.tsx"

# Find potential circular dependencies
# (look for react importing from editor-react or vice versa)

# Check for unused exports
grep -rn "^export " packages/core/src/ --include="*.ts" | wc -l
```

---

## Step 3: Evaluate Architecture Quality

Assess the codebase across these dimensions. For each, note what's working well and
what needs attention.

### 3.1 Code Organization & Module Boundaries

**What to look for:**

- Are module boundaries clear? Can you tell what each package owns?
- Is the dependency graph clean? (core has zero framework deps, react depends on core, etc.)
- Are subpath exports correct and complete? Do they expose what consumers need?
- Are types defined in `schemas/` or scattered in component files?
- Is there code in the wrong package? (e.g., React-specific logic in core)

**Known architecture decisions to respect:**

- `core/` must have zero framework dependencies — it's consumed by React, Preact, and
  potentially other frameworks
- `react/` targets standard React; Qualla aliases via `preact/compat`
- `editor-react/` depends on Tiptap and Monaco — these are heavy dependencies that are
  intentionally isolated from the main `react/` package
- `site/` is a dev-only package, not published to npm
- The unified/remark processor requires `any` for its chained `.use()` calls — this is
  an intentional exception documented with eslint-disable comments

### 3.2 Code Duplication

**Potential duplication hotspots:**

| Concern | Likely Locations | What to Check |
|---------|-----------------|---------------|
| Animation utilities | `core/src/doc/utils/`, `react/src/utils/` | Re-export or duplication? |
| Type re-exports | Each package's `index.ts` | Are types properly re-exported? |
| Template input validation | Individual template files | Repeated patterns? |
| Viewport calculations | `scaledFontSize`, layout logic | Centralized in core? |
| Markdown node handling | `convert.ts`, `PreviewPanel.tsx`, `LinearDocView.tsx` | Same traversal patterns? |
| Caption cleaning | `captionUtils.ts` | Used everywhere it should be? |

**How to evaluate:**

1. For each hotspot, read both locations and diff mentally
2. Determine if duplication is **intentional** (package boundary) or **accidental** (drift)
3. For accidental duplication, propose extraction into core with specific file paths
4. For intentional re-exports, verify they haven't drifted from source

### 3.3 Type Safety & Schema Governance

**What to look for:**

- Are new types being added to `schemas/` or scattered in component files?
- Is `any` creeping in? Where and why? (Target: zero `any` in published production code)
- Are there implicit contracts (magic strings, untyped JSON shapes)?
- Do all packages import shared types from `@bendyline/squisq/schemas`?
- Are there type assertions (`as X`) that mask real type mismatches vs. legitimate casts?
- Is the `DocBlock` discriminated union (`Block | TemplateBlock`) used consistently?
- Is `isTemplateBlock()` used instead of `(block as any).template` patterns?

### 3.4 Build System Health

**What to look for:**

- Do all `tsconfig.json` files extend `tsconfig.base.json` consistently?
- Are `tsup.config.ts` files aligned across packages?
- Do subpath exports in `package.json` match actual entry points?
- Does `npm run build` succeed cleanly with zero warnings?
- Are `.d.ts` declarations generated correctly for all packages?
- Are peer dependencies declared correctly? (react, react-dom for react packages)
- Is tree-shaking working? (ESM output, no side effects)

### 3.5 Error Handling & Resilience

**What to look for:**

- Are errors swallowed silently? (empty catch blocks)
- Is `catch (err: unknown)` used with `instanceof Error` narrowing? (not `catch (err: any)`)
- Are error boundaries present in the React component tree?
- Does markdown parsing degrade gracefully on malformed input?
- Does DOCX import handle corrupt/partial files?

### 3.6 Performance Patterns

**What to look for:**

- Bundle sizes: Are packages lean? Are heavy dependencies isolated?
- Tree-shaking: Can consumers import only what they need via subpath exports?
- Memoization: Are expensive computations in hooks properly memoized?
- Re-renders: Do hooks have correct dependency arrays?
- Template functions: Are they truly pure (no hidden state or side effects)?

### 3.7 Testing Coverage & Quality

**What to look for:**

- Do all packages have tests? What's the coverage like?
- Are template functions unit tested with representative inputs?
- Is markdown round-trip (parse → stringify → parse) tested?
- Are DOCX import/export tested with real documents?
- Are React hooks tested? Are there integration tests for DocPlayer?
- Are edge cases covered? (empty docs, missing fields, malformed input)

### 3.8 API Surface & Documentation

**What to look for:**

- Are public exports intentional and minimal? (Don't export internals)
- Are exported functions/types documented with JSDoc?
- Are template input types self-documenting? (clear property names, good defaults)
- Is the README accurate? Does it show working examples?
- Are breaking changes tracked?

---

## Step 4: Evaluate Claude Skills & Instructions

This is unique to the development architect role. You review not just the code, but
the AI-assisted development infrastructure itself.

### 4.1 CLAUDE.md Review

Read `CLAUDE.md` and evaluate:

- **Accuracy:** Does the documentation match the current codebase? Are file paths correct?
  Are commands still valid? Are all packages listed?
- **Completeness:** Are new packages, subpath exports, or workflows missing?
- **Conventions:** Are coding conventions clearly stated? Would a new Claude session
  follow them?
- **Build Commands:** Are the listed commands complete and correct?
- **Design Decisions:** Are key decisions documented? (pure templates, SVG rendering,
  discriminated unions, etc.)

### 4.2 Skills Inventory

Read each skill in `.claude/skills/*/SKILL.md` and evaluate:

**For each skill, ask:**

1. Would a fresh Claude session follow this skill correctly without additional context?
2. Are file paths and commands accurate for the squisq repo?
3. Does the skill reference Qualla-specific concepts that don't belong here?
4. Does the skill produce the expected artifacts?
5. Is the skill missing important steps or guardrails?

### 4.3 Missing Skills

Consider whether new skills are needed:

- **Template Creation** — Adding a new block template with proper types, registry entry, tests
- **Package Creation** — Adding a new package to the monorepo with proper config
- **Format Converter** — Adding a new document format (PPTX, XLSX) to the formats package
- **Release** — Version bumping, changelog, npm publish, tarball rebuild for Qualla

---

## Step 5: Produce the Architecture Report

Write the report to `reports/architecture-review-YYYYMMDD-HHMM.md`.

The report should be opinionated, actionable, and honest. Lead with the big picture.

```markdown
# Squisq Architecture Review

**Date:** YYYY-MM-DD
**Reviewer:** Claude (Development Architect)
**Commit:** [git short hash]
**Scope:** [Full review | Focused: {area}]

## Executive Summary

[2-3 paragraphs. What is the overall health of the codebase? What is the single most
important thing to address? What is the team doing well that should be protected?
If you had to bet on where the next bug or developer frustration will come from,
where would that be?]

## Architecture Scorecard

| Dimension | Grade | Trend | Notes |
|-----------|-------|-------|-------|
| Code Organization | A-F | Improving/Stable/Declining | One-line summary |
| Code Duplication | A-F | ... | ... |
| Type Safety | A-F | ... | ... |
| Build System | A-F | ... | ... |
| Error Handling | A-F | ... | ... |
| Performance | A-F | ... | ... |
| Test Coverage | A-F | ... | ... |
| API Surface | A-F | ... | ... |
| Documentation | A-F | ... | ... |
| AI Tooling (Skills) | A-F | ... | ... |

## Project Component Review

[For each package, provide a detailed assessment of every major component:
its purpose, quality, test coverage, and any issues found.]

### @bendyline/squisq (core)
[Component-by-component tables for schemas, doc/templates, spatial, storage, markdown]

### @bendyline/squisq-react
[Component-by-component tables for DocPlayer, BlockRenderer, layers, hooks]

### @bendyline/squisq-formats
[Component-by-component tables for docx, ooxml, pdf, pptx/xlsx stubs]

### @bendyline/squisq-editor-react
[Component-by-component tables for EditorContext, RawEditor, Toolbar, PreviewPanel]

## What's Working Well

[3-5 things the codebase does right. Be specific. These are patterns to protect
and replicate. Reference specific files.]

## Critical Issues (Must Address)

### [Issue Title]
- **Impact:** [What breaks or degrades if not fixed]
- **Location:** [File paths]
- **Root Cause:** [Why this happened]
- **Recommended Fix:** [Specific, actionable steps]
- **Effort:** [Small / Medium / Large]

## Improvement Opportunities (Should Address)

### [Issue Title]
- **Current State:** [What exists today]
- **Better State:** [What it should look like]
- **Files Involved:** [Specific paths]
- **Recommended Approach:** [How to get there]
- **Effort:** [Small / Medium / Large]

## Future-Proofing Recommendations

[2-3 things that aren't problems today but will become problems as the codebase
grows. Be predictive, not speculative — ground recommendations in actual patterns
you observed.]

## Code Duplication Inventory

| Duplicated Code | Location A | Location B | Type | Recommendation |
|-----------------|------------|------------|------|----------------|
| [Function/pattern] | [Path:line] | [Path:line] | Intentional/Accidental | Extract/Leave/Monitor |

## Claude Skills & Instructions Review

### CLAUDE.md Health
- **Accuracy:** [Current / Stale / Mixed]
- **Specific issues found:** [List]
- **Recommended updates:** [List]

### Skills Assessment

| Skill | Health | Issues | Recommendations |
|-------|--------|--------|-----------------|
| developmentarchitect | ... | ... | ... |
| ... | ... | ... | ... |

### Recommended New Skills
[List any new skills that would improve developer productivity or code quality]

### Recommended CLAUDE.md Changes
[Specific additions, corrections, or restructuring suggestions]

## Prioritized Action Plan

### This Week (Quick Wins)
1. [Action] — [Why] — [Effort: hours]
2. ...

### This Month (Medium Effort)
1. [Action] — [Why] — [Effort: days]
2. ...

### This Quarter (Strategic)
1. [Action] — [Why] — [Effort: weeks]
2. ...

## Appendix: Files Reviewed

[List of all files read during this review, grouped by package]
```

---

## Step 6: Present Results

After writing the report:

1. **Lead with your honest assessment** — 3-4 sentences on overall codebase health
2. **Highlight the single most important finding** — What should be addressed first?
3. **Link to the full report** for details
4. **Offer to implement** the top 1-3 quick wins immediately
5. **Flag any skills or CLAUDE.md updates** that should happen right away

---

## Review Principles

### What Good Architecture Looks Like

Study these principles when evaluating Squisq:

- **Clean package boundaries.** Core has zero framework dependencies. React wraps core.
  Formats uses core's types. Editor wraps both core and React. No reverse dependencies.
- **Types are canonical.** All shared types live in `core/src/schemas/`. Other packages
  import from `@bendyline/squisq/schemas`, never redefine.
- **Templates are pure.** Every template is `(input, context) => Layer[]`. No side effects,
  no DOM access, no global state. This makes them testable and portable.
- **Subpath exports are intentional.** Consumers import `@bendyline/squisq/doc` not
  `@bendyline/squisq/doc/templates/imageWithCaption`. Internal structure can change
  without breaking consumers.
- **Build is predictable.** `npm run build` always works. No hidden environment
  dependencies or order-of-operations gotchas.
- **New features slot in.** Adding a new template, a new format converter, or a new
  layer type follows an established pattern with clear precedent.

### Common Anti-Patterns to Watch For

| Anti-Pattern | Signal | Risk |
|--------------|--------|------|
| **Leaky abstraction** | React-specific code in core package | Breaks framework independence |
| **Type erosion** | `any` in production code, `as unknown as X` chains | Runtime type bugs |
| **God component** | DocPlayer.tsx growing unbounded | Hard to test, hard to modify |
| **Copy-paste inheritance** | Same pattern in react/ and editor-react/ | Bugs fixed in one place, not the other |
| **Speculative generality** | Abstractions for hypothetical future formats | Complexity without value |
| **Config drift** | tsconfig/tsup.config diverging across packages | Build confusion |
| **Missing re-export** | Types defined locally instead of imported from schemas | Shadow types |

### The "New Agent" Test

For each area of the codebase, ask:

1. **Can an AI agent find it?** Is the directory structure self-explanatory?
2. **Can it understand it?** Are there header comments? Is the flow obvious?
3. **Can it change it safely?** Are dependencies explicit? Are tests protecting it?
4. **Will it produce correct code?** Are patterns unambiguous? Is there exactly one way?

### The "New Template" Test

Imagine adding a new block template (e.g., `comparisonSlide`). Trace the path:

1. Define input type in `core/src/schemas/BlockTemplates.ts`
2. Add to `TemplateBlock` discriminated union in `core/src/schemas/Doc.ts`
3. Create template function in `core/src/doc/templates/comparisonSlide.ts`
4. Register in `core/src/doc/templates/index.ts`
5. Verify `expandDocBlocks` and `getLayers` handle it automatically
6. Add tests in `core/src/__tests__/`

If any step is unclear or requires touching unexpected files, that's a process gap.

### The "New Format" Test

Imagine adding PPTX export. Trace the path:

1. Implement converter in `formats/src/pptx/export.ts`
2. Use `MarkdownDocument` as pivot format (from core's markdown types)
3. Export from `formats/src/pptx/index.ts`
4. Verify subpath export `@bendyline/squisq-formats/pptx` works
5. Add tests in `formats/src/__tests__/`

---

## Focused Review: Quick Reference

When the user asks for a specific type of review, use these checklists:

### "Review code duplication"
- [ ] Animation utilities across core and react
- [ ] Markdown node traversal patterns
- [ ] Template input validation patterns
- [ ] Type definitions (schemas vs. local types)
- [ ] Caption/text cleaning utilities
- [ ] Error handling patterns across packages

### "Review type safety"
- [ ] Count `any` usage across all packages (exclude test files)
- [ ] Check schema coverage (are new types in schemas/?)
- [ ] Verify discriminated union usage (isTemplateBlock guard)
- [ ] Check for untyped JSON parsing (JSON.parse without validation)
- [ ] Look for `as unknown as X` chains (type assertion smell)
- [ ] Verify catch blocks use `unknown` not `any`

### "Review build system"
- [ ] tsconfig alignment across packages (all extend base?)
- [ ] tsup.config consistency
- [ ] Subpath exports match actual entry points
- [ ] Peer dependencies declared correctly
- [ ] Bundle sizes reasonable
- [ ] `npm run build` clean with zero errors

### "Review API surface"
- [ ] All public exports intentional (no internal leaks)
- [ ] Naming conventions consistent across packages
- [ ] JSDoc on all exported functions and types
- [ ] Breaking changes since last review
- [ ] Re-export hygiene (no redundant re-exports)

### "Review Claude skills"
- [ ] Read every SKILL.md in `.claude/skills/`
- [ ] Verify commands and file paths are current
- [ ] Check that CLAUDE.md reflects current architecture
- [ ] Identify gaps in skill coverage
- [ ] Propose CLAUDE.md patches for any inaccuracies found
- [ ] Ensure no Qualla-specific references remain in squisq skills

---

## Session Output Requirements

**Every architecture review MUST produce:**

1. Written report at `reports/architecture-review-YYYYMMDD-HHMM.md`
2. An honest executive summary (not generic praise)
3. A graded scorecard across all dimensions
4. A project component review (component-by-component assessment per package)
5. At least one critical issue (or explicit statement that none exist)
6. Specific, actionable recommendations with file paths and effort estimates
7. A prioritized action plan (this week / this month / this quarter)
8. Claude skills and CLAUDE.md assessment with specific update recommendations

**If implementing fixes:**

9. Each fix committed separately with clear commit messages
10. Build run after each fix to verify no regressions (`npm run build`)
11. Updated CLAUDE.md or SKILL.md files if documentation was stale