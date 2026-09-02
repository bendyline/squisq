# @bendyline/squisq-calc

Spreadsheet calculation for squisq documents: the engine adapter contract
(`CalcEngine` — staleness, spill roles, evaluation budgets, cycle policy),
an Excel formula parser, and a pure-TypeScript in-house evaluator tier
(`createInHouseEngine`) covering the function families that dominate
real-world workbooks (lookup, aggregation, logical, text, date).

Zero runtime dependencies; runs in the browser and Node. The IronCalc
wasm backend implements the same contract behind the
`@bendyline/squisq-calc/ironcalc` subpath — `@ironcalc/wasm` is an
optional peer reached only via dynamic import, so the root entry (and any
host that never creates an IronCalc engine) pays zero wasm bytes.

Part of the [squisq](https://github.com/bendyline/squisq) monorepo. MIT
licensed.
