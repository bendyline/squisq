/**
 * The table kernel — sort/filter/window/edit over transferred typed columns.
 *
 * SHIPPING CONSTRAINT: this function's SOURCE is the worker. It is embedded
 * via `tableKernel.toString()` into a Blob URL (`buildKernelSource`), the
 * same zero-asset pattern as the teleprompter's PCM worklet — editor
 * packages ship no runtime asset files, and URL-based workers would force
 * bundler configuration onto every host. Therefore:
 *
 *  - the function must reference NOTHING from module scope (all helpers are
 *    nested; only web-worker globals like `Intl` are used);
 *  - tsup must never minify this package (mangled `toString()` output);
 *    both properties are pinned by tests in `kernel.test.ts`.
 *
 * Semantics mirror `applyTableViewState` in `@bendyline/squisq/table`
 * (numeric compare on number columns, collator-ranked dictionary compare on
 * text, blanks last regardless of direction, stable sort with source-index
 * tie-break, filter-then-sort) — parity is a tested property, not an
 * aspiration. Type/collation rules are COPIED here by necessity (zero
 * imports); the parity suite is what keeps the copies honest.
 *
 * Edits mutate columns in place and NEVER re-permute: a row teleporting out
 * from under the caret mid-entry is hostile. `applyEdits` reports
 * `staleView` when an edited cell touched an active sort/filter column so
 * the UI can offer an explicit refresh.
 */

// ── Protocol types (erased at runtime — safe for the toString contract) ──

export interface KernelColumnPayload {
  name: string;
  kind: 'number' | 'string' | 'date' | 'boolean';
  /** number/boolean: values; string/date: dictionary codes (−1 = blank). */
  data: Float64Array | Int32Array | Uint8Array;
  valid?: Uint8Array;
  dict?: string[];
}

export interface KernelSortTerm {
  col: number;
  dir: 'asc' | 'desc';
}

export interface KernelFilterClause {
  col: number;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | '~' | '!~' | '^~' | '$~';
  value: string;
  /** Case-sensitive text matching (the grammar's `*` modifier). */
  caseSensitive?: boolean;
}

export interface KernelCellEdit {
  rowId: number;
  col: number;
  value: number | string | boolean | null;
}

export type KernelRequest =
  | { type: 'init'; seq: number; columns: KernelColumnPayload[]; rowCount: number }
  | { type: 'setView'; seq: number; sort: KernelSortTerm[]; filter: KernelFilterClause[] }
  | { type: 'rows'; seq: number; start: number; count: number }
  | { type: 'applyEdits'; seq: number; edits: KernelCellEdit[] }
  | { type: 'distinct'; seq: number; col: number; limit: number }
  | { type: 'dispose' };

export type KernelCell = number | string | boolean | null;

export type KernelResponse =
  | { type: 'ready'; seq: number }
  | { type: 'viewResult'; seq: number; viewRowCount: number }
  | { type: 'rowsResult'; seq: number; start: number; rowIds: number[]; cells: KernelCell[][] }
  | { type: 'editResult'; seq: number; staleView: boolean }
  | {
      type: 'distinctResult';
      seq: number;
      values: string[];
      totalDistinct: number;
      hasBlank: boolean;
    }
  | { type: 'error'; seq: number; message: string };

/** The structural slice of a worker global scope the kernel needs. */
export interface KernelScope {
  onmessage: ((event: { data: KernelRequest }) => void) | null;
  postMessage(message: KernelResponse): void;
}

// ── The kernel ───────────────────────────────────────────────────────

export function tableKernel(scope: KernelScope): void {
  type Column = KernelColumnPayload & {
    rank?: Int32Array;
    lower?: string[];
    codeByValue?: Map<string, number>;
  };

  let columns: Column[] = [];
  let rowCount = 0;
  let perm: number[] = [];
  let activeSort: KernelSortTerm[] = [];
  let activeFilter: KernelFilterClause[] = [];

  const collator = new Intl.Collator(undefined, { numeric: true });

  // Copy of the shared numeric-text rule (see module header re: parity).
  function isNumericText(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    if (/^0\d/.test(trimmed)) return false;
    return Number.isFinite(Number(trimmed));
  }

  function ensureRank(column: Column): Int32Array {
    if (!column.rank || column.rank.length !== (column.dict?.length ?? 0)) {
      const dict = column.dict ?? [];
      const order = dict.map((_, index) => index);
      order.sort((a, b) => collator.compare(dict[a]!, dict[b]!));
      const rank = new Int32Array(dict.length);
      for (let position = 0; position < order.length; position++) {
        rank[order[position]!] = position;
      }
      column.rank = rank;
    }
    return column.rank;
  }

  function ensureLower(column: Column): string[] {
    if (!column.lower || column.lower.length !== (column.dict?.length ?? 0)) {
      column.lower = (column.dict ?? []).map((value) => value.toLowerCase());
    }
    return column.lower;
  }

  function isBlank(column: Column, row: number): boolean {
    if (column.kind === 'number' || column.kind === 'boolean') {
      return !column.valid || column.valid[row] === 0;
    }
    return (column.data as Int32Array)[row]! < 0;
  }

  function cellText(column: Column, row: number): string {
    if (isBlank(column, row)) return '';
    if (column.kind === 'number') return String((column.data as Float64Array)[row]);
    if (column.kind === 'boolean') return (column.data as Uint8Array)[row] === 1 ? 'true' : 'false';
    return column.dict![(column.data as Int32Array)[row]!]!;
  }

  function cellValue(column: Column, row: number): KernelCell {
    if (isBlank(column, row)) return null;
    if (column.kind === 'number') return (column.data as Float64Array)[row]!;
    if (column.kind === 'boolean') return (column.data as Uint8Array)[row] === 1;
    return column.dict![(column.data as Int32Array)[row]!]!;
  }

  function matches(row: number, clause: KernelFilterClause): boolean {
    const column = columns[clause.col];
    if (!column) return true;
    const valueTrim = clause.value.trim();
    const blank = isBlank(column, row);
    // Text ops fold case unless the clause is `*`-marked case-sensitive.
    const fold = (text: string): string => (clause.caseSensitive ? text : text.toLowerCase());
    // Dictionary columns get the cached lowercase form on the ci path.
    const textFor = (): string => {
      if (!clause.caseSensitive && (column.kind === 'string' || column.kind === 'date') && !blank) {
        // Trim at use: the reference implementation matches on trimmed cell
        // text for every op, and parity is the contract.
        return ensureLower(column)[(column.data as Int32Array)[row]!]!.trim();
      }
      return fold(cellText(column, row).trim());
    };

    switch (clause.op) {
      case '=': {
        if (valueTrim === '') return blank;
        if (blank) return false;
        if (column.kind === 'number' && isNumericText(valueTrim)) {
          return (column.data as Float64Array)[row] === Number(valueTrim);
        }
        return textFor() === fold(valueTrim);
      }
      case '!=':
        return !matches(row, { ...clause, op: '=' });
      case '~':
        if (blank) return false;
        return textFor().includes(fold(valueTrim));
      case '!~':
        return !matches(row, { ...clause, op: '~' });
      case '^~':
        if (blank) return false;
        return textFor().startsWith(fold(valueTrim));
      case '$~':
        if (blank) return false;
        return textFor().endsWith(fold(valueTrim));
      default: {
        if (blank) return false;
        let comparison: number;
        if (column.kind === 'number' && isNumericText(valueTrim)) {
          comparison = (column.data as Float64Array)[row]! - Number(valueTrim);
        } else {
          comparison = collator.compare(cellText(column, row).trim(), valueTrim);
        }
        if (clause.op === '>') return comparison > 0;
        if (clause.op === '<') return comparison < 0;
        if (clause.op === '>=') return comparison >= 0;
        return comparison <= 0;
      }
    }
  }

  function recomputeView(): void {
    const ids: number[] = [];
    for (let row = 0; row < rowCount; row++) {
      let pass = true;
      for (const clause of activeFilter) {
        if (!matches(row, clause)) {
          pass = false;
          break;
        }
      }
      if (pass) ids.push(row);
    }

    if (activeSort.length > 0) {
      for (const term of activeSort) {
        const column = columns[term.col];
        if (column && (column.kind === 'string' || column.kind === 'date')) ensureRank(column);
      }
      ids.sort((a, b) => {
        for (const term of activeSort) {
          const column = columns[term.col];
          if (!column) continue;
          const aBlank = isBlank(column, a);
          const bBlank = isBlank(column, b);
          if (aBlank || bBlank) {
            if (aBlank && bBlank) continue;
            return aBlank ? 1 : -1; // blanks last, direction-independent
          }
          let comparison: number;
          if (column.kind === 'number') {
            comparison = (column.data as Float64Array)[a]! - (column.data as Float64Array)[b]!;
          } else if (column.kind === 'boolean') {
            comparison = (column.data as Uint8Array)[a]! - (column.data as Uint8Array)[b]!;
          } else {
            const rank = column.rank!;
            comparison =
              rank[(column.data as Int32Array)[a]!]! - rank[(column.data as Int32Array)[b]!]!;
          }
          if (comparison !== 0) return term.dir === 'desc' ? -comparison : comparison;
        }
        return a - b; // explicit stability
      });
    }

    perm = ids;
  }

  function applyEdit(edit: KernelCellEdit): void {
    const column = columns[edit.col];
    if (!column || edit.rowId < 0 || edit.rowId >= rowCount) return;
    if (column.kind === 'number') {
      const blank = edit.value === null || edit.value === '';
      column.valid![edit.rowId] = blank ? 0 : 1;
      (column.data as Float64Array)[edit.rowId] = blank ? 0 : Number(edit.value);
      return;
    }
    if (column.kind === 'boolean') {
      const blank = edit.value === null || edit.value === '';
      column.valid![edit.rowId] = blank ? 0 : 1;
      (column.data as Uint8Array)[edit.rowId] = edit.value === true ? 1 : 0;
      return;
    }
    if (edit.value === null || edit.value === '') {
      (column.data as Int32Array)[edit.rowId] = -1;
      return;
    }
    const text = String(edit.value);
    if (!column.codeByValue) {
      column.codeByValue = new Map<string, number>();
      (column.dict ?? []).forEach((value, code) => column.codeByValue!.set(value, code));
    }
    let code = column.codeByValue.get(text);
    if (code === undefined) {
      code = column.dict!.length;
      column.dict!.push(text);
      column.codeByValue.set(text, code);
      // New dictionary entry: rank/lower caches are stale.
      column.rank = undefined;
      column.lower = undefined;
    }
    (column.data as Int32Array)[edit.rowId] = code;
  }

  scope.onmessage = (event: { data: KernelRequest }) => {
    const message = event.data;
    try {
      if (message.type === 'init') {
        columns = message.columns.map((payload) => ({ ...payload }));
        rowCount = message.rowCount;
        activeSort = [];
        activeFilter = [];
        recomputeView();
        scope.postMessage({ type: 'ready', seq: message.seq });
        return;
      }
      if (message.type === 'setView') {
        activeSort = message.sort;
        activeFilter = message.filter;
        recomputeView();
        scope.postMessage({
          type: 'viewResult',
          seq: message.seq,
          viewRowCount: perm.length,
        });
        return;
      }
      if (message.type === 'rows') {
        const start = Math.max(0, message.start);
        const end = Math.min(perm.length, start + message.count);
        const rowIds: number[] = [];
        const cells: KernelCell[][] = [];
        for (let index = start; index < end; index++) {
          const rowId = perm[index]!;
          rowIds.push(rowId);
          cells.push(columns.map((column) => cellValue(column, rowId)));
        }
        scope.postMessage({ type: 'rowsResult', seq: message.seq, start, rowIds, cells });
        return;
      }
      if (message.type === 'applyEdits') {
        const touched = new Set<number>();
        for (const edit of message.edits) {
          applyEdit(edit);
          touched.add(edit.col);
        }
        const staleView =
          activeSort.some((term) => touched.has(term.col)) ||
          activeFilter.some((clause) => touched.has(clause.col));
        scope.postMessage({ type: 'editResult', seq: message.seq, staleView });
        return;
      }
      if (message.type === 'distinct') {
        // Full-SOURCE distinct sweep (not the filtered view — a value picker
        // must offer values the current filter hides). Dictionary columns
        // are nearly free: collect USED codes (edits can orphan dictionary
        // entries) and order by the collator rank the sort already builds.
        const column = columns[message.col];
        const limit = Math.max(1, message.limit);
        let hasBlank = false;
        let values: string[] = [];
        let totalDistinct = 0;
        if (column && (column.kind === 'string' || column.kind === 'date')) {
          const dict = column.dict ?? [];
          const used = new Uint8Array(dict.length);
          const codes = column.data as Int32Array;
          for (let row = 0; row < rowCount; row++) {
            const code = codes[row]!;
            if (code < 0) hasBlank = true;
            else used[code] = 1;
          }
          const rank = ensureRank(column);
          const present: number[] = [];
          for (let code = 0; code < used.length; code++) {
            if (used[code] === 1) present.push(code);
          }
          present.sort((a, b) => rank[a]! - rank[b]!);
          totalDistinct = present.length;
          values = present.slice(0, limit).map((code) => dict[code]!);
        } else if (column && column.kind === 'number') {
          const data = column.data as Float64Array;
          const seen = new Set<number>();
          for (let row = 0; row < rowCount; row++) {
            if (!column.valid || column.valid[row] === 0) hasBlank = true;
            else seen.add(data[row]!);
          }
          const sorted = [...seen].sort((a, b) => a - b);
          totalDistinct = sorted.length;
          values = sorted.slice(0, limit).map((value) => String(value));
        } else if (column) {
          let sawTrue = false;
          let sawFalse = false;
          const data = column.data as Uint8Array;
          for (let row = 0; row < rowCount; row++) {
            if (!column.valid || column.valid[row] === 0) hasBlank = true;
            else if (data[row] === 1) sawTrue = true;
            else sawFalse = true;
          }
          if (sawFalse) values.push('false');
          if (sawTrue) values.push('true');
          totalDistinct = values.length;
          values = values.slice(0, limit);
        }
        scope.postMessage({
          type: 'distinctResult',
          seq: message.seq,
          values,
          totalDistinct,
          hasBlank,
        });
        return;
      }
      if (message.type === 'dispose') {
        columns = [];
        perm = [];
        rowCount = 0;
      }
    } catch (err) {
      const seq = 'seq' in message ? message.seq : -1;
      scope.postMessage({
        type: 'error',
        seq,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/** The worker source: the kernel applied to the worker's own global scope. */
export function buildKernelSource(): string {
  return `(${tableKernel.toString()})(self);`;
}
