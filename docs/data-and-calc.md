# Data sidecars, the grid, and the calculation engines — host integration guide

How a host application wires squisq's tabular-data stack: sidecar files
beside the document, the virtualized grid in the Write view, and formula
editing backed by a calculation engine. Companion to
[`proofing.md`](proofing.md), which covers the grammar/spellcheck stack the
same way.

## The model in one paragraph

Markdown is the pivot format and reparses on every editor debounce, so
high-volume tables never live inline. A `*.csv`, `*.tsv`, `*.xlsx`, or
`*.parquet` file lives in the document's container at
`<docbasename>_files/data/<file>`, and the markdown carries a REFERENCE — a
heading annotation plus a plain body link for graceful degradation:

```markdown
## Q3 transactions {[dataTable src=report_files/data/q3.csv sort=Revenue:desc]}

[q3.csv](report_files/data/q3.csv)
```

Rendering resolves a bounded preview (`resolveDataReferences`, projection
only — never serialized back); the Write view mounts the real grid; exports
either carry the file, re-embed full values, or warn. The annotation's
`sort`/`filter` params are part of the document: they shape the grid, the
previews, and the exports alike.

## Packages

| Package                                              | Role                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `@bendyline/squisq` `/table`                         | `TableQueryProvider` contract + the view-state grammar         |
| `@bendyline/squisq-formats` `/data`, `/csv`, `/xlsx` | sidecar readers, CSV serialization, XLSX in-place patching     |
| `@bendyline/squisq-grid-react`                       | the virtualized `DataGrid` + columnar Web-Worker store         |
| `@bendyline/squisq-calc`                             | engine contract, formula parser, in-house tier, worker hosting |
| `@bendyline/squisq-calc` `/ironcalc`                 | IronCalc wasm backend (optional peer `@ironcalc/wasm`)         |
| `@bendyline/squisq-editor-react`                     | the data card that assembles all of it in the Write view       |

## The view-state grammar

`sort` and `filter` ride the owning heading's annotation params:

```
sort=Revenue:desc,Region            multi-term; :asc|:desc (default asc)
filter=Region=West;Revenue>=1000    AND-only conjunction
```

Filter ops: text-matching `= != ~ !~ ^~ $~` (equals, contains, starts-with
`^~`, ends-with `$~`) are **case-insensitive by default**; a `*` suffix
makes a match case-sensitive (`Region=*West`). An **empty value** on
`=`/`!=` matches on blankness alone — `filter=Notes=""` keeps only rows
with a blank Notes cell, `Notes!=""` drops them (the grid's _Is empty_ /
_Is not empty_ operator choices). Comparisons `> < >= <=` are
numeric on numeric columns (every non-blank cell parses to a finite number,
no leading zeros) and collator-based otherwise. Names/values containing
structural characters quote CSV-style with `""` doubling — no backslashes.
Parsing never throws: unknown columns and malformed params drop with
diagnostics, and renderers fall back to natural order.

## Mounting the grid in the editor

The data card is automatic: give `EditorShell` a media provider and a
container, and every data-link paragraph under a `{[dataTable src=…]}`
heading becomes the grid.

```tsx
<EditorShell
  mediaProvider={provider} // resolves + saves the sidecar bytes
  workspaceContainer={container} // enables .versions/data/ pre-save backups
/>
```

Contract points worth knowing:

- **Always grid** — the compact preview card renders only when the grid
  module fails to load (it is a lazy `import()`, code-split by your
  bundler; a transient load failure retries on the next mount).
- Sort/filter changes persist onto the heading annotation ONLY when that
  heading's template is table-fed and its `src` matches the card — never
  fabricated onto a plain heading (session-only, with a footer hint).
- CSV/TSV cell edits save in place, reproducing the file's delimiter,
  newline flavor, trailing newline, and BOM; edited formula-looking cells
  are apostrophe-neutralized; a backup lands in `.versions/data/` (pruned
  to 3) when a container is present.
- XLSX edits save through `patchXlsxCellValues`: only touched worksheet
  parts rewrite, everything else in the archive survives byte-for-byte, and
  refusals (shared-formula masters, date-styled cells) are all-or-nothing.
- The grid supports paste (TSV from Excel/Sheets, anchored at the
  selection, one undo step) and copy (TSV + HTML table).
- Each filter input carries an operator dropdown (text/comparison ops,
  case toggle, Is empty / Is not empty, a Clear-filter item) and a
  distinct-values picker — powered by the provider's optional `distinct`
  sweep, which the columnar store answers from its string dictionaries.

Standalone (no editor): `new TableStoreClient(ingestTable)` implements
`TableQueryProvider` over a Blob-URL worker (or in-process with
`{ forceLocal: true }`), and `<DataGrid provider={client} …/>` renders it.
Theming: every grid color is a `--squisq-grid-*` token with a literal
fallback; bind the tokens to your palette (editor-react's chrome.css shows
the full alias set).

## Formula editing and the calculation engines

XLSX sidecars get live formula editing: formula cells render italic with
the source as tooltip, edit as `=source`, recalculate dependents on every
commit AND on plain value edits, and save as formula+cached-value patches.
Only date-styled cells and shared-formula masters stay locked.

Every backend implements one contract — `CalcEngine` from
`@bendyline/squisq-calc` (batch `evaluateAll` with mandatory budgets,
`Staleness`, async cell reads). Three implementations ship:

1. **In-house tier** (`createInHouseEngine`) — pure TS, zero deps, ~90
   functions prioritized by a real-world corpus (lookup, aggregates
   including the `-IFS` family, logical, text, date). Passes 100% of the
   11k-pair cached-value oracle, in values-context and whole-graph recalc.
2. **Worker-hosted in-house** (`createWorkerCalcEngine`) — the same tier
   behind a Web Worker, so evaluation never touches the UI thread. This is
   the editor's default when workers are available.
3. **IronCalc** (`createIronCalcEngine` from
   `@bendyline/squisq-calc/ironcalc`) — the full-fidelity wasm engine
   (~462 functions incl. XLOOKUP, LET/LAMBDA, dynamic arrays).
   `@ironcalc/wasm` is an optional peer loaded via dynamic import; nothing
   downloads until an engine is created.

Hosts swap the backend with one `EditorShell` prop; a factory that fails to
boot falls back to the in-house tier automatically:

```tsx
// Vite host — worker-hosted in-house tier via the bundler's own worker
// pipeline (more reliable than the package's relative-URL spawn):
import CalcWorker from '@bendyline/squisq-calc/worker?worker';

<EditorShell
  calcEngineFactory={async (config) => {
    const calc = await import('@bendyline/squisq-calc');
    return calc.createWorkerCalcEngine({
      ...config,
      workerFactory: () => new CalcWorker(),
    });
  }}
/>;

// IronCalc host — ship the wasm as an asset and point the adapter at it:
import wasmUrl from '@ironcalc/wasm/wasm_bg.wasm?url';

<EditorShell
  calcEngineFactory={async (config) => {
    const { createIronCalcEngine } = await import('@bendyline/squisq-calc/ironcalc');
    return createIronCalcEngine({ ...config, wasmSource: wasmUrl });
  }}
/>;
```

Budget discipline: `evaluateAll(budgets)` stops honestly at
`maxWorkUnits`/`maxEvalTimeMs` and reports `dirtyRemaining` — a workbook
that blows the interactive budget degrades to value-only editing rather
than hanging. Note the IronCalc caveat: a wasm `evaluate()` in flight
cannot be interrupted, so its budgets are enforced pre-flight.

## Bundler + CSP checklist

- **Grid store worker**: spawned from a Blob URL (no asset to serve). CSP
  needs `worker-src blob:` — the same directive the proofing stack already
  requires.
- **Calc worker**: prefer your bundler's worker pipeline
  (`@bendyline/squisq-calc/worker?worker` under Vite). The default
  `new URL('./worker/index.js', import.meta.url)` spawn works under plain
  ESM serving, but aggressive bundling can break the relative URL — Vite
  hosts should also add `@bendyline/squisq-calc` to
  `optimizeDeps.exclude`. Spawn failure is safe: the editor falls back to
  the main thread.
- **IronCalc wasm**: serve `wasm_bg.wasm` (`application/wasm`) and pass
  its URL/bytes as `wasmSource` — Node hosts MUST pass bytes (Node's fetch
  cannot load `file:` URLs). Exclude `@ironcalc/wasm` from pre-bundling
  too.
- **Parquet sidecars**: install the optional peer `hyparquet`, or parquet
  references degrade to a per-block diagnostic.

## Verifying an engine

The corpus tier (`npm run test:corpus`, after `node
scripts/corpus-fetch.mjs`) runs every eligible real-world formula/value
pair through an engine twice — values-context per formula, and whole-graph
`evaluateAll` — and gates on the pass rate. If you implement a new
`CalcEngine` backend, point those oracles at it before trusting it.
