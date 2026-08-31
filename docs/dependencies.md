# Packages and Dependencies

Everything about bringing third-party code into Squisq: how to install, how to
add or update a dependency, and the supply-chain controls that gate both.

**Read this before any package management** — adding, removing or updating a
dependency, running `npm audit fix`, editing `overrides`, or otherwise touching
`package-lock.json`.

## The four rules

1. **Install with `npm run install:safe`**, never a bare `npm install`.
2. **Every version is pinned exactly.** No `^`, no `~` (peer dependencies excepted).
3. **No version younger than 7 days** may appear in the lockfile.
4. **Install scripts do not run**, except for an explicitly reviewed allowlist.

Rules 3 and 4 are the two halves of the same posture: the allowlist stops a
hijacked package from _executing_ at install time, and the cooldown stops us
from _adopting_ it in the first place.

## Installing

```bash
npm run install:safe       # npm install + run allowlisted install scripts (esbuild)
```

`.npmrc` sets `ignore-scripts=true`, so a bare `npm install` will succeed but
**leave esbuild's native binary missing** — the next `npm run build` then fails
with "Cannot find module @esbuild/<platform>".

For CI or clean reproducible installs:

```bash
npm ci && node scripts/run-install-allowlist.mjs
```

`.npmrc` also sets `workspaces-update=false`, so `npm install` will not
rewrite workspace package versions behind your back.

## Exact version pinning

`.npmrc`'s `save-exact=true` pins every dependency added via `npm install <pkg>`
to a single version. A range would let a routine `npm ci` silently pick up a
release nobody reviewed — the same door the cooldown closes from the other side.

**peerDependencies stay explicit ranges** (e.g. `react ^18.0.0 || ^19.0.0`).
A library has to be flexible about the versions its consumers bring; that is a
compatibility declaration, not an install instruction, and nothing resolves it
in this repo.

## Dependency cooldown (no version younger than a week)

Every version resolved in `package-lock.json` — direct and transitive, prod and
dev — must have been published at least **7 days** ago.

**Why.** The dominant npm supply-chain attack is account or token takeover: an
attacker publishes a malicious patch release of a reputable package and waits
for the ecosystem to pull it in. Those releases are loud and short-lived — they
get reported, unpublished, or superseded within hours to a couple of days.
Waiting a week means the ecosystem has already had a look at anything we
install. It costs nothing but latency.

### Running it

```bash
npm run deps:cooldown        # versions this branch ADDS/CHANGES vs the base ref
npm run deps:cooldown:all    # full audit of every resolved version in the lockfile
```

Both wrap [`scripts/check-dependency-age.mjs`](../scripts/check-dependency-age.mjs),
which reads publish timestamps from the npm registry itself. The changed-only
mode is a handful of lookups; the full audit fetches one packument per distinct
package name and takes a minute or two (results are cached under
`node_modules/.cache/squisq/`, and publish times are immutable so a hit is
always valid).

Useful flags: `--base <ref>`, `--min-age-days <n>`, `--json`, `--lockfile <path>`,
`--registry <url>`, `--no-cache`. `--help` prints the full list.

### Exit codes

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| 0    | every checked version satisfies the cooldown                                   |
| 1    | policy violation — a version is too young, or the registry cannot date it      |
| 2    | operational failure — bad arguments, unreadable lockfile, registry unreachable |

1 and 2 are deliberately distinct: **"we could not check" must never be
mistaken for "we checked and it is fine."**

### CI

[`.github/workflows/dependency-cooldown.yml`](../.github/workflows/dependency-cooldown.yml)
runs the changed-only check on every PR that touches a manifest or the lockfile,
plus a weekly full-lockfile sweep as a backstop for anything that reaches `main`
without passing the PR gate. `npm run all` runs the full audit too.

The workflow deliberately does not `npm ci` — installing is the act being gated.

### `npm audit` and `npm audit fix`

**This is the check `npm audit fix` trips**, and that is working as intended:
it will adopt an advisory fix published minutes ago, and a freshly-published
artifact is exactly the shape of the attack. After any `npm audit fix`, run
`npm run deps:cooldown` before committing the lockfile.

When it reports a violation, in order of preference:

1. **Wait out the window** and re-run `npm run install:safe`.
2. **Pin to the newest version that is already old enough** — often an earlier
   patch in the same line carries the same fix.
3. **Add an exception** (below) — only for an actively exploited CVE.

### Exceptions

Sometimes a same-day release genuinely cannot wait. Add an entry to the
`EXCEPTIONS` array in
[`scripts/check-dependency-age.mjs`](../scripts/check-dependency-age.mjs),
pinned to the exact `name` **and** `version`, with a `reason` recording what
forced it and who read the diff:

```js
const EXCEPTIONS = [
  {
    name: 'some-pkg',
    version: '1.2.4',
    reason: 'CVE-2026-00000, actively exploited; 1.2.4 diff reviewed 2026-08-31.',
  },
];
```

An exception is a decision to trust code the ecosystem has not vetted yet, so
read the diff first. Never use a range — the point is that one specific artifact
was reviewed. Exceptions self-expire: once the version ages past the window it
passes on its own, and the script then reports the entry as stale so it gets
deleted.

## Install-script allowlist

Every third-party install / preinstall / postinstall script is disabled by
default. An attacker who compromises a transitive dep cannot ship a malicious
postinstall and have it execute on developer machines or CI runners.

The only scripts that run are those in the explicit allowlist at
[`scripts/run-install-allowlist.mjs`](../scripts/run-install-allowlist.mjs).
Today that is exactly one entry — `esbuild`, because tsup needs the native
binary its postinstall downloads.

**Trust is pinned to the script's CONTENT (sha256), not the package name.**
The human review happens against the script as it exists at allowlist time, but
the runner executes whatever is on disk at run time — and `esbuild` is
transitive, so a routine tsup bump could otherwise swap the executed code with
no reviewer in the loop. A version bump that leaves the reviewed bytes untouched
keeps working; any change to the executed code stops the build.

**Adding an entry:** read the install script, confirm it does only what the
package documents, add an entry with a one-line `reason`, then record the hash
with `node scripts/run-install-allowlist.mjs --print-pins`.

**After a legitimate bump trips the pin:** re-read the script, diff it against
what was reviewed, then update `reviewed.version` and `reviewed.scriptSha256`.
Do not paste a new hash without reading the diff — that defeats the control.

## Overrides

The root `package.json` `overrides` block forces a single resolved version of a
transitive package across the tree (usually to pull a vulnerable transitive dep
forward, or to collapse duplicate copies). Overridden versions are subject to
the cooldown like any other — they land in the lockfile the same way.

Keep overrides minimal and prefer bumping the direct dependency that pulls the
package in; an override is a fix applied behind the maintainer's back and has to
be re-checked on every upgrade.

## Adding a dependency

1. **Does it belong in that package?** See the per-package constraints below.
2. `npm install <pkg> -w <workspace>` — `save-exact` pins it automatically.
3. `npm run deps:cooldown` — confirm the new version is old enough.
4. `npm run notices` — regenerate `NOTICE.md`. `tests/notice-sync.test.ts` fails
   if any external direct or peer dependency of a workspace package is missing
   from it.
5. `npm run build` — per-package `THIRD_PARTY_LICENSES.txt` is regenerated as
   part of each package's build.
6. `npm run test:published` — the published-shape suite is where dependency
   mistakes surface (see "Guardrails" below).

## Updating dependencies

1. Make the change (`npm install <pkg>@<version>`, `npm audit fix`, an
   `overrides` edit — whatever it is).
2. `npm run deps:cooldown` — **always**, before committing the lockfile.
3. `npm run notices` if the dependency set changed.
4. `npm run build && npm run typecheck && npm test`.
5. If the update touched `esbuild` or anything else in the install allowlist,
   expect the content pin to trip; re-review and re-pin.

External contributors: [`CONTRIBUTING.md`](../CONTRIBUTING.md) asks for a
proposal in `specs/` rather than a direct dependency change.

## Per-package constraints

| Package        | Constraint                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `core`         | **Zero framework dependencies and no Node-specific dependencies.** Must run in a browser and in Node. |
| `formats`      | jszip, pdf-lib, pdfjs-dist; uses core's `MarkdownDocument` as the pivot format                        |
| `react`        | Targets standard React; consumers may alias `preact/compat`                                           |
| `editor-react` | `@tiptap` and `monaco-editor` are **peer** dependencies; `harper.js` is an **optional** peer          |
| `video`        | Browser-pure, no Node deps                                                                            |
| `video-react`  | `@bendyline/squisq-video`, `mp4-muxer`, `html2canvas`                                                 |
| `cli`          | `commander` + `playwright-core`                                                                       |

**Optional peers** (`harper.js`, `@ffmpeg/*`) are reached only through a dynamic
import, so a consumer that does not want the feature ships zero bytes of it.
That contract is enforced by `tests/published/harperOptionalPeer.test.ts`: no
static import in any dist JavaScript, no mention in any published declaration,
and a manifest that declares the optional peer plus a pinned devDependency.

## Guardrails you may trip

Dependency changes tend to surface in the published-shape suite
(`npm run test:published`) rather than the unit tests:

| Test                                    | What it protects                                                 |
| --------------------------------------- | ---------------------------------------------------------------- |
| `engines.test.ts`                       | published `engines.node` matches the repo Node baseline          |
| `packageShape.test.ts`                  | packages ship only runtime artifacts, licenses, bounded tarballs |
| `forbiddenImports.test.ts`              | public barrels stay free of accidental heavy static imports      |
| `isolatedLegacyDependencies.test.ts`    | bundled deps do not leak their conflicting types or peers        |
| `editorDeclarationDependencies.test.ts` | editor-react declares directly any module its public types name  |
| `harperOptionalPeer.test.ts`            | the optional-peer contract above                                 |

Plus, at the repo root: `tests/notice-sync.test.ts` and `tests/notices.test.ts`
(NOTICE.md coverage), `tests/install-allowlist.test.ts` (the content pin), and
`tests/dependency-cooldown.test.ts` (the cooldown gate itself).

## File map

| Path                                        | Role                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| `.npmrc`                                    | `save-exact`, `ignore-scripts`, `workspaces-update`    |
| `scripts/run-install-allowlist.mjs`         | install-script allowlist + content pins                |
| `scripts/check-dependency-age.mjs`          | the cooldown gate                                      |
| `scripts/generate-notices.mjs`              | `NOTICE.md` generation (`npm run notices`)             |
| `scripts/generate-bundle-licenses.mjs`      | per-package `THIRD_PARTY_LICENSES.txt` (runs in build) |
| `.github/workflows/dependency-cooldown.yml` | PR gate + weekly full sweep                            |
| root `package.json` `overrides`             | forced transitive versions                             |
