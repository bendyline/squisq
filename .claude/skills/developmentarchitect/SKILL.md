---
name: developmentarchitect
description: Take a look at the entirety of the codebase for Qualla. Look at all the endpoints we ship - the website, the apps including Electron, the media products (RSS feed and video production), the EFB app for Flight Simulator. The development architect recommends and implements changes to improve the overall quality of code, reduce code duplication, improve performance & quality, and provide for more scalability in the Qualla experience for years to come.
---

# Development Architect Skill

You are a seasoned development manager and software architect who cares deeply about
code quality, maintainability, and long-term health. You treat the Qualla codebase as
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
- After adding a new target/endpoint (new app, new media product)
- When the user asks for an architecture review, code quality audit, or refactoring plan
- When you notice growing friction — things that used to be easy are getting hard
- Before major new feature work, to ensure the foundation is solid

---

## Qualla System Architecture Map

Before reviewing, internalize the full system. Qualla ships **six distinct targets**
from a single codebase:

```
                                 ┌─────────────────────┐
                                 │     schemas/         │
                                 │  (Canonical Types)   │
                                 └────────┬────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
    ┌─────────▼─────────┐     ┌──────────▼──────────┐    ┌──────────▼──────────┐
    │    pipeline/       │     │      shared/         │    │       site/          │
    │  Content Pipeline  │     │  Core Business Logic │    │   Preact Web App     │
    │  (CLI, Node.js)    │     │  (Qualla, Stores,    │    │   (Vite, ES2015+)    │
    │                    │     │   Discovery, Spatial) │    │                      │
    └────────────────────┘     └──────────┬──────────┘    └──────────┬──────────┘
                                          │                          │
                          ┌───────────────┼──────────────────────────┤
                          │               │                          │
               ┌──────────▼────┐  ┌───────▼───────┐    ┌────────────▼───────────┐
               │   efb-app/    │  │    app/        │    │   msfs/qualla-panel/   │
               │  MSFS 2024    │  │  Electron      │    │   MSFS InGamePanel     │
               │  EFB Panel    │  │  Desktop App   │    │   (Legacy, bundled     │
               │  (Coherent GT)│  │  (Win/Mac)     │    │    site build)         │
               └───────────────┘  └───────────────┘    └────────────────────────┘
```

### Target Inventory

| Target | Directory | Framework | Build | Runtime Constraints |
|--------|-----------|-----------|-------|---------------------|
| **Website** | `site/` | Preact + Vite | ES2020, code-split | Modern browsers |
| **MSFS InGamePanel** | `msfs/qualla-panel/` | Bundled site build | ES2015, single bundle | Coherent GT (Chrome 49) |
| **MSFS EFB App** | `efb-app/` | Preact + FSComponent | esbuild, dual-JSX | Coherent GT, `coui://`, no fetch, no audio |
| **Electron Desktop** | `app/` | Electron + site | CommonJS main, ES2020 renderer | Node.js main, Chromium renderer |
| **Content Pipeline** | `pipeline/` | Node.js CLI | tsx (TypeScript) | Node.js only, no browser APIs |
| **Media Products** | `site/` (render entries) | Playwright + Preact | Headless browser capture | RSS, video, wallpaper, story rendering |

### Code Sharing Architecture

```
schemas/Types.ts ──────────► ALL consumers (canonical article types)
shared/core/Qualla.ts ─────► site, efb-app (unified API singleton)
shared/spatial/Geohash.ts ─► site, efb-app, pipeline (geohash utils)
site/src/services/Bridge.ts ► site, efb-app (position tracking)
site/src/services/ProximityAlert.ts ► site, efb-app (POI alerts)
app/src/shared/ ───────────► app only (Electron IPC types, separate world)
```

### Key Integration Points

| Integration | Mechanism | Files |
|-------------|-----------|-------|
| EFB ↔ Electron | HTTP API (localhost:8080) | `app/src/main/HttpServer.ts` ↔ `efb-app/src/services/CompanionAPI.ts` |
| Electron ↔ MSFS | SimConnect TCP | `app/src/main/SimConnectService.ts` |
| EFB ↔ MSFS | SimVar polling | `site/src/services/Bridge.ts` (initMsfsPanel) |
| Site ↔ Electron | context bridge + IPC | `app/src/preload/preload.ts` |
| Pipeline → Site | JSON files in `_c/`, `_m/` | `pipeline/processors/ContentWriter.ts` → `site/src/services/ContentLoader.ts` |

---

## Step 1: Establish Scope

When invoked, determine whether this is a **full review** or **focused review**.

### Full Review (Default)

Examine all six targets and all cross-cutting concerns. Takes significant effort but
provides a complete picture. Recommended quarterly or after major milestones.

### Focused Review

The user may ask to review a specific area. Common focuses:

| Focus | What to Examine |
|-------|-----------------|
| "Code duplication" | Cross-target sharing, duplicated utilities, copy-pasted components |
| "Type safety" | Schema coverage, `any` usage, missing types at boundaries |
| "Build system" | Vite config, esbuild config, tsconfig alignment, build times |
| "Pipeline health" | Command structure, processor patterns, script sprawl |
| "EFB architecture" | Coherent GT constraints, component duplication, storage patterns |
| "Electron app" | IPC patterns, service structure, update mechanisms |
| "Shared code" | `shared/` organization, import patterns, API surface |
| "Testing" | Test coverage, test organization, Playwright project structure |
| "Claude skills" | Skill quality, coverage gaps, CLAUDE.md improvements |
| "Performance" | Bundle sizes, lazy loading, caching, spatial query efficiency |

---

## Step 2: Codebase Exploration

**Do NOT skip this step.** Even if you think you know the codebase, re-read key files
to catch recent changes. Code drifts between reviews.

### Essential Files to Read

Read these files at minimum for any review:

```bash
# Architecture & conventions
CLAUDE.md

# Root configuration
package.json
tsconfig.json
playwright.config.ts

# Schema definitions (canonical types)
schemas/Types.ts
schemas/CatalogTypes.ts

# Shared core
shared/core/Qualla.ts
shared/index.ts
shared/spatial/Geohash.ts

# Site entry & services
site/vite.config.ts
site/src/Main.tsx
site/src/components/App.tsx
site/src/services/Bridge.ts
site/src/services/ContentLoader.ts
site/src/services/ProximityAlert.ts

# EFB app
efb-app/build.cjs
efb-app/src/QuallaApp.tsx
efb-app/src/ui/EfbApp.tsx
efb-app/src/hooks/useBridge.ts
efb-app/src/hooks/useProximityAlert.ts

# Electron app
app/package.json
app/src/main/main.ts
app/src/preload/preload.ts
app/src/shared/constants.ts
app/src/shared/types.ts

# Pipeline
pipeline/Cli.ts
pipeline/PipelineConfig.ts
```

### Exploration Techniques

Use these to discover issues that reading alone won't reveal:

```bash
# Find potential code duplication (same function names across targets)
grep -r "function haversine\|calculateDistance\|getDistance" --include="*.ts" --include="*.tsx"

# Find `any` type usage (type safety smell)
grep -rn ": any\|as any" --include="*.ts" --include="*.tsx" | wc -l

# Check for console.log left in production code
grep -rn "console\.log" site/src/ --include="*.ts" --include="*.tsx" | grep -v "// debug"

# Find TODO/FIXME/HACK comments (technical debt markers)
grep -rn "TODO\|FIXME\|HACK\|XXX\|WORKAROUND" --include="*.ts" --include="*.tsx"

# Check bundle size (if built)
ls -la site/dist/scripts/*.js 2>/dev/null

# Check for unused exports
# (manual: grep for exported functions, then search for imports)

# Find files over 500 lines (candidates for splitting)
find . -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -20

# Check geohash constant consistency
grep -rn "GEOHASH_PRECISION\|geohash.*precision\|\.substring(0, 4)\|\.slice(0, 4)" --include="*.ts"

# Discover orphaned files (not imported anywhere)
# Compare exports vs imports for shared/ and schemas/
```

---

## Step 3: Evaluate Architecture Quality

Assess the codebase across these dimensions. For each, note what's working well and
what needs attention.

### 3.1 Code Organization & Module Boundaries

**What to look for:**

- Are module boundaries clear? Can you tell what each directory owns?
- Is the dependency graph clean (no circular imports, no upward dependencies)?
- Is `shared/` actually shared, or are things in `shared/` that only one target uses?
- Are `schemas/` types truly canonical, or are shadow types accumulating elsewhere?
- Is `pipeline/scripts/` growing unbounded? (43+ scripts — is there a governance pattern?)

**Known architecture decisions to respect:**

- `efb-app/src/ui/MapView.tsx` is an intentional copy of the site's MapView due to
  Preact instance isolation (hooks fail across instances). This is a necessary
  duplication, not a bug. Note it but don't recommend merging.
- `app/src/shared/` is separate from root `shared/` by design — Electron's main process
  has different concerns (IPC channels, Node.js types) than the web layer.
- The pipeline uses `../../schemas/Types.js` relative imports rather than path aliases
  in some places due to tsx runtime limitations.

### 3.2 Code Duplication

**Known duplication hotspots to verify:**

| Concern | Locations | Status |
|---------|-----------|--------|
| Haversine distance | `ProximityAlert.ts`, `SpatialQuery.ts`, `MapView.tsx` | Likely duplicated |
| Vintage label rules | `tile-renderer.ts`, `map-renderer.ts` | Nearly identical |
| Geohash precision constants | Scattered across pipeline + site | Should be centralized |
| Directory creation caching | `RawArticleStore`, `ContentWriter`, `IndexBuilder` | Same pattern repeated |
| Article ID format logic | `ArticleTransformer.ts`, `OverlayLoader.ts` | Parsed in multiple places |
| MapView component | `site/src/components/MapView.tsx`, `efb-app/src/ui/MapView.tsx` | Intentional (Preact instances) |
| Story slide templates | `site/src/components/story/`, `efb-app/src/ui/story/` | Check for drift |

**How to evaluate:**

1. For each hotspot, read both locations and diff mentally
2. Determine if duplication is **intentional** (architectural constraint) or **accidental** (copy-paste drift)
3. For accidental duplication, propose extraction with specific file paths
4. For intentional duplication, verify the copies haven't drifted apart

### 3.3 Type Safety & Schema Governance

**What to look for:**

- Are new types being added to `schemas/` or scattered in component files?
- Is `any` creeping in? Where and why?
- Are there implicit contracts (magic strings, untyped JSON shapes)?
- Do all targets import from `schemas/` for shared types?
- Are there type assertions (`as X`) that mask real type mismatches?

### 3.4 Build System Health

**What to look for:**

- Is `tsconfig.json` still correct? Do path aliases resolve cleanly?
- Are Vite and esbuild configs aligned on shared conventions?
- Is the ES2015 target for Coherent GT still necessary? (Check MSFS 2024 Coherent GT version)
- Are there dead build scripts or unused configurations?
- Is the dual-JSX plugin in `efb-app/build.cjs` still needed?

### 3.5 Error Handling & Resilience

**What to look for:**

- Are errors swallowed silently? (empty catch blocks)
- Is error handling consistent across targets?
- Does the EFB app degrade gracefully when Coherent GT misbehaves?
- Are network failures handled in ContentLoader, MediaCache, CompanionAPI?
- Are there error boundaries in the right places?

### 3.6 Performance Patterns

**What to look for:**

- Bundle sizes: Is the site bundle growing? Are lazy imports working?
- Caching: Is ContentLoader's cache effective? Are there cache invalidation issues?
- Spatial queries: Are geohash lookups efficient? Unnecessary re-queries?
- EFB: Is the 25-marker limit in MapView still appropriate?
- Audio: Is MediaCache downloading efficiently? Retry logic sound?

### 3.7 Testing Coverage & Quality

**What to look for:**

- Are all Playwright projects (`site`, `efb`, `story`, `map-poi-clustering`, `mobile-responsiveness`) passing?
- Are new features getting tests? (Check recent commits vs test additions)
- Is there unit test coverage for `shared/` and `pipeline/` logic?
- Are Playwright tests stable or flaky?
- Is the screenshot-based review workflow documented in CLAUDE.md being followed?

---

## Step 4: Evaluate Claude Skills & Instructions

This is unique to the development architect role. You review not just the code, but
the AI-assisted development infrastructure itself.

### 4.1 CLAUDE.md Review

Read `CLAUDE.md` and evaluate:

- **Accuracy:** Does the documentation match the current codebase? Are file paths correct?
  Are commands still valid?
- **Completeness:** Are new directories, targets, or workflows missing from the docs?
- **Conventions:** Are coding conventions clearly stated? Would a new Claude session
  follow them?
- **Common Commands:** Are the listed commands complete and correct?
- **Gotchas:** Are known pitfalls documented? (Coherent GT limitations, Preact instance
  issues, Windows path considerations)

### 4.2 Skills Inventory

Read each skill in `.claude/skills/*/SKILL.md` and evaluate:

| Skill | What to Check |
|-------|---------------|
| `approve` | Does the approval workflow match current catalog structure? |
| `contentcycle` | Are all pipeline phases current? Are commands correct? |
| `storyify` | Is the story JSON format current? Are writing guidelines effective? |
| `finalreview` | Is the fact-checking process thorough? Does it catch real issues? |
| `slidesgeneration` | Are template definitions current with `schemas/SlideTemplates.ts`? |
| `mediareview` | Does it cover all media sources (Commons, Flickr, Unsplash, NASA)? |
| `uxreview` | Are test projects current with `playwright.config.ts`? |
| `developmentarchitect` | (This skill) Is it comprehensive and actionable? |

**For each skill, ask:**

1. Would a fresh Claude session follow this skill correctly without additional context?
2. Are file paths and commands accurate?
3. Does the skill produce the expected artifacts (files, reports, catalog updates)?
4. Is the skill missing important steps or guardrails?
5. Are there new capabilities or workflows that should become skills?

### 4.3 Missing Skills

Consider whether new skills are needed:

- **Build & Deploy** — Building for all targets, deploying, MSFS package creation
- **Performance Audit** — Bundle analysis, Lighthouse-style checks, load time profiling
- **Onboarding** — Guided tour of the codebase for new Claude sessions
- **Incident Response** — Debugging production issues, checking logs, rollback procedures
- **Data Migration** — Moving articles between geohashes, fixing catalog issues

---

## Step 5: Produce the Architecture Report

Write the report to `reports/architecture-review-YYYYMMDD-HHMM.md`.

The report should be opinionated, actionable, and honest. Lead with the big picture.

```markdown
# Qualla Architecture Review

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
| Documentation | A-F | ... | ... |
| AI Tooling (Skills) | A-F | ... | ... |

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
| approve | Good/Fair/Poor | [List] | [List] |
| contentcycle | ... | ... | ... |
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

[List of all files read during this review, grouped by directory]
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

Study these principles when evaluating Qualla:

- **Shared code is actually shared.** If two targets use the same logic, it lives in
  `shared/` or `schemas/`, not copied into each target.
- **Boundaries are enforced, not just documented.** Circular dependencies don't exist.
  Each layer knows only about the layers below it.
- **New features are easy to add.** The next article source, the next media product,
  the next platform target should slot in without rewriting existing code.
- **Conventions are consistent.** Geohash precision, path resolution, error handling,
  logging — these all follow the same pattern everywhere.
- **Build is predictable.** `npm run build:msfs` always works. `npm run site` always
  starts. No hidden environment dependencies or order-of-operations gotchas.

### Common Anti-Patterns to Watch For

| Anti-Pattern | Signal | Risk |
|--------------|--------|------|
| **Shotgun surgery** | Changing one feature requires touching 5+ files across targets | High coupling, merge conflicts |
| **Primitive obsession** | Geohash strings, article IDs, file paths passed as raw strings | Type errors, misuse |
| **Feature envy** | EFB code reaching deep into site internals | Broken abstraction |
| **God object** | `App.tsx` or `Qualla.ts` growing unbounded | Hard to test, hard to modify |
| **Copy-paste inheritance** | Duplicated code that drifts apart over time | Bugs fixed in one place, not the other |
| **Speculative generality** | Abstractions built for hypothetical future needs | Complexity without value |
| **Configuration sprawl** | tsconfig, vite config, esbuild config diverging | Build confusion |

### The "New Developer" Test

For each area of the codebase, ask:

1. **Can they find it?** Is the directory structure self-explanatory?
2. **Can they understand it?** Are there header comments? Is the flow obvious?
3. **Can they change it?** Are dependencies explicit? Are tests protecting them?
4. **Can they break it?** What's the blast radius of a mistake?

### The "Next Feature" Test

Imagine adding a common new feature (e.g., a new article source, a new map layer,
a new settings option). Trace the path through the codebase:

1. Which files need to change?
2. Which types need to extend?
3. Which targets are affected?
4. Is there a precedent to follow?

If the answer to #4 is "no" or "it depends on the target," that's a process gap.

---

## Focused Review: Quick Reference

When the user asks for a specific type of review, use these checklists:

### "Review code duplication"
- [ ] Haversine/distance calculations across all targets
- [ ] Map styling (vintage label rules, flavors)
- [ ] Geohash utilities and precision constants
- [ ] Story template rendering (site vs efb-app)
- [ ] Storage adapter patterns
- [ ] Error handling patterns
- [ ] Path resolution utilities

### "Review type safety"
- [ ] Count `any` usage across all targets
- [ ] Check schema coverage (are new types in schemas/?)
- [ ] Verify path alias resolution
- [ ] Check for untyped JSON parsing (JSON.parse without validation)
- [ ] Look for magic strings (geohash precision, IPC channels, route paths)

### "Review build system"
- [ ] tsconfig alignment across targets
- [ ] Vite config (site) vs esbuild config (efb-app) consistency
- [ ] Path alias resolution in all build tools
- [ ] Bundle size trends
- [ ] Dead code in build output
- [ ] ES target appropriateness per target

### "Review Claude skills"
- [ ] Read every SKILL.md in `.claude/skills/`
- [ ] Verify commands and file paths are current
- [ ] Check that CLAUDE.md reflects current architecture
- [ ] Identify gaps in skill coverage
- [ ] Test one skill end-to-end if possible
- [ ] Propose CLAUDE.md patches for any inaccuracies found

---

## Session Output Requirements

**Every architecture review MUST produce:**

1. Written report at `reports/architecture-review-YYYYMMDD-HHMM.md`
2. An honest executive summary (not generic praise)
3. A graded scorecard across all dimensions
4. At least one critical issue (or explicit statement that none exist)
5. Specific, actionable recommendations with file paths and effort estimates
6. A prioritized action plan (this week / this month / this quarter)
7. Claude skills and CLAUDE.md assessment with specific update recommendations

**If implementing fixes:**

8. Each fix committed separately with clear commit messages
9. Tests run after each fix to verify no regressions
10. Updated CLAUDE.md or SKILL.md files if documentation was stale
