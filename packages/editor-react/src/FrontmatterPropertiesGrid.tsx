/**
 * FrontmatterPropertiesGrid
 *
 * Name/value rows for a document's own frontmatter properties, with a delete
 * button per row and **+ Add property** beneath. Controlled and presentational:
 * the caller owns the draft rows and decides when they are written — the
 * Write view's tray writes a row as focus leaves it, Document settings writes
 * every row on Save. See `frontmatterProperties.ts` for the model.
 */

import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { newPropertyRow, type PropertyRow } from './frontmatterProperties';

export interface FrontmatterPropertiesGridProps {
  rows: readonly PropertyRow[];
  onRowsChange: (rows: PropertyRow[]) => void;
  /** Name errors by row id (from `validatePropertyRows`); shown under the row. */
  errors?: ReadonlyMap<string, string>;
  /** Show names and values as text, with no add or delete. */
  readOnly?: boolean;
  /** Focus left a row for somewhere outside it. */
  onRowLeave?: (rowId: string) => void;
  /** A key pressed in a row's name or value box. */
  onRowKeyDown?: (rowId: string, event: KeyboardEvent<HTMLInputElement>) => void;
  /**
   * A row's delete button was pressed. Defaults to removing the row from
   * `rows`; the tray writes the removal instead.
   */
  onDeleteRow?: (rowId: string) => void;
  /** Prefix for element ids, unique per grid on the page. */
  idPrefix: string;
  /** Accessible name for the group. */
  ariaLabel?: string;
}

type FocusTarget = { rowId: string; field: 'name' } | { rowId: null; field: 'add' };

export function FrontmatterPropertiesGrid({
  rows,
  onRowsChange,
  errors,
  readOnly = false,
  onRowLeave,
  onRowKeyDown,
  onDeleteRow,
  idPrefix,
  ariaLabel = 'Properties',
}: FrontmatterPropertiesGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  // Focus moves after the render that adds or removes the row.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    // Row ids come from `frontmatterProperties` (`property-12`): selector-safe.
    const selector =
      target.field === 'add'
        ? '.squisq-fm-props-add'
        : `[data-row-id="${target.rowId}"] .squisq-fm-props-name`;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const updateRow = (id: string, patch: Partial<Pick<PropertyRow, 'key' | 'text'>>) =>
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addRow = () => {
    const row = newPropertyRow();
    pendingFocus.current = { rowId: row.id, field: 'name' };
    onRowsChange([...rows, row]);
  };

  const deleteRow = (id: string) => {
    const index = rows.findIndex((row) => row.id === id);
    const neighbour = rows[index + 1] ?? rows[index - 1];
    pendingFocus.current = neighbour
      ? { rowId: neighbour.id, field: 'name' }
      : { rowId: null, field: 'add' };
    if (onDeleteRow) onDeleteRow(id);
    else onRowsChange(rows.filter((row) => row.id !== id));
  };

  const handleRowBlur = (id: string) => (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    onRowLeave?.(id);
  };

  if (readOnly) {
    return (
      <div className="squisq-fm-props" role="group" aria-label={ariaLabel}>
        {rows.length === 0 ? (
          <p className="squisq-fm-props-empty">No properties.</p>
        ) : (
          <dl className="squisq-fm-props-list">
            {rows.map((row) => (
              <div key={row.id} className="squisq-fm-props-row squisq-fm-props-row--static">
                <dt className="squisq-fm-props-static">{row.key}</dt>
                <dd className="squisq-fm-props-static">{row.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="squisq-fm-props" role="group" aria-label={ariaLabel}>
      {rows.length > 0 && (
        <div className="squisq-fm-props-grid">
          <div className="squisq-fm-props-head" aria-hidden="true">
            <span>Name</span>
            <span>Value</span>
          </div>
          {rows.map((row) => {
            const error = errors?.get(row.id);
            const errorId = `${idPrefix}-${row.id}-error`;
            const hintId = `${idPrefix}-${row.id}-hint`;
            const name = row.key.trim() || 'new property';
            return (
              <div
                key={row.id}
                className="squisq-fm-props-row"
                data-row-id={row.id}
                data-invalid={error ? '' : undefined}
                onBlur={handleRowBlur(row.id)}
              >
                <input
                  type="text"
                  className="squisq-fm-props-input squisq-fm-props-name"
                  value={row.key}
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                  onKeyDown={(event) => onRowKeyDown?.(row.id, event)}
                  aria-label="Property name"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  placeholder="name"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                />
                {row.kind === 'nested' ? (
                  <span
                    className="squisq-fm-props-nested"
                    title="This value has more structure than a text box can hold. Edit it in Source."
                  >
                    {row.text} · edit in Source
                  </span>
                ) : (
                  <input
                    type="text"
                    className="squisq-fm-props-input squisq-fm-props-value"
                    value={row.text}
                    onChange={(event) => updateRow(row.id, { text: event.target.value })}
                    onKeyDown={(event) => onRowKeyDown?.(row.id, event)}
                    aria-label={`Value of ${name}`}
                    aria-describedby={row.kind === 'list' ? hintId : undefined}
                    placeholder="value"
                    autoComplete="off"
                  />
                )}
                <button
                  type="button"
                  className="squisq-fm-props-delete"
                  // Keep focus where it is: a blur first would write the row
                  // and then delete it from a source that no longer matches.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => deleteRow(row.id)}
                  aria-label={`Delete property ${name}`}
                  title="Delete property"
                >
                  ×
                </button>
                {row.kind === 'list' && (
                  <span id={hintId} className="squisq-fm-props-hint">
                    Separate items with commas
                  </span>
                )}
                {error && (
                  <span id={errorId} className="squisq-fm-props-error">
                    {error}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="squisq-fm-props-add" onClick={addRow}>
        + Add property
      </button>
    </div>
  );
}
