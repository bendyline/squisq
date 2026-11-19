/**
 * PropertiesTrayItem
 *
 * The document tray's **Properties** pill: the document's own frontmatter
 * keys (`author`, `tags`, …) as name/value rows. A row is written when focus
 * leaves it or on Enter, and a delete is written at once — each as one
 * whole-document replace, which the Write view applies as a single undoable
 * step. Escape puts a row back the way the document has it.
 *
 * The rows are drafts over the source. When the frontmatter changes — our own
 * write, an undo, an edit in Source or Document settings — they are re-derived
 * from it, keeping each row's identity (so the input being typed in stays
 * mounted and focused) and keeping any edit that has not been written yet.
 */

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FrontmatterPropertiesGrid } from '../FrontmatterPropertiesGrid';
import {
  isBlankNewRow,
  isEmptyPropertyPlan,
  isRowChanged,
  planPropertyEdits,
  reconcilePropertyRows,
  rowsFromProperties,
  validatePropertyRows,
  type CustomProperty,
  type PropertyEditPlan,
  type PropertyRow,
} from '../frontmatterProperties';
import { Icon } from '../Icon';

/** Writes a plan into the document; false when it changed nothing. */
export type WritePropertyPlan = (plan: PropertyEditPlan) => boolean;

/** Rows exactly as the document has them, leaving out the property `except`. */
function sourceRows(properties: readonly CustomProperty[], except: string | null): PropertyRow[] {
  return properties
    .filter((property) => property.key !== except)
    .map((property) => ({
      id: `source:${property.key}`,
      originalKey: property.key,
      key: property.key,
      text: property.text,
      kind: property.kind,
    }));
}

function PropertiesPanel({
  properties,
  readOnly,
  write,
  idPrefix,
}: {
  properties: readonly CustomProperty[];
  readOnly: boolean;
  write: WritePropertyPlan;
  idPrefix: string;
}) {
  const [rows, setRows] = useState<PropertyRow[]>(() => rowsFromProperties(properties));
  // Rows whose write was refused, so a missing name is reported only once
  // someone tried to keep the row; a bad name shows as it is typed.
  const [attempted, setAttempted] = useState<ReadonlySet<string>>(() => new Set());
  const loadedRef = useRef(properties);
  // New key → id of the row just written under it, so the re-derived row
  // keeps its identity (and its input keeps focus) across the write.
  const carriedRef = useRef(new Map<string, string>());

  useLayoutEffect(() => {
    const previous = loadedRef.current;
    if (previous === properties) return;
    loadedRef.current = properties;
    const carried = carriedRef.current;
    carriedRef.current = new Map();
    setRows((current) => reconcilePropertyRows(current, previous, properties, carried));
  }, [properties]);

  const allErrors = validatePropertyRows(rows);
  const errors = new Map(
    [...allErrors].filter(([id]) => {
      const row = rows.find((entry) => entry.id === id);
      return attempted.has(id) || (row !== undefined && row.key.trim() !== '');
    }),
  );

  const resetRow = (id: string) =>
    setRows((current) =>
      current.flatMap((row) => {
        if (row.id !== id) return [row];
        const property = properties.find((entry) => entry.key === row.originalKey);
        return property ? [{ ...row, key: property.key, text: property.text }] : [];
      }),
    );

  const commitRow = (id: string) => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) return;
    if (isBlankNewRow(row)) {
      setRows((current) => current.filter((entry) => entry.id !== id));
      return;
    }
    if (!isRowChanged(row, properties)) return;
    const candidate = [...sourceRows(properties, row.originalKey), row];
    if (validatePropertyRows(candidate).has(id)) {
      setAttempted((current) => new Set(current).add(id));
      return;
    }
    const plan = planPropertyEdits(properties, candidate);
    const key = row.key.trim();
    if (isEmptyPropertyPlan(plan)) {
      // Typed back to what the document already says (`Ines ` for `Ines`).
      resetRow(id);
      return;
    }
    carriedRef.current.set(key, id);
    if (!write(plan)) {
      carriedRef.current.delete(key);
      resetRow(id);
    }
  };

  const deleteRow = (id: string) => {
    const row = rows.find((entry) => entry.id === id);
    setRows((current) => current.filter((entry) => entry.id !== id));
    if (!row || row.originalKey === null) return;
    write(planPropertyEdits(properties, sourceRows(properties, row.originalKey)));
  };

  const handleKeyDown = (id: string, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRow(id);
      return;
    }
    if (event.key === 'Escape') {
      const row = rows.find((entry) => entry.id === id);
      if (!row || !isRowChanged(row, properties)) return;
      event.preventDefault();
      event.stopPropagation();
      resetRow(id);
    }
  };

  return (
    <FrontmatterPropertiesGrid
      rows={rows}
      onRowsChange={setRows}
      errors={errors}
      readOnly={readOnly}
      onRowLeave={commitRow}
      onRowKeyDown={handleKeyDown}
      onDeleteRow={deleteRow}
      idPrefix={idPrefix}
      ariaLabel="Document properties"
    />
  );
}

export function PropertiesTrayItem({
  properties,
  expanded,
  onExpandedChange,
  readOnly,
  write,
}: {
  properties: readonly CustomProperty[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  readOnly: boolean;
  write: WritePropertyPlan;
}) {
  const id = useId();
  const count = properties.length;
  return (
    <div className="squisq-document-tray-item" data-expanded={expanded || undefined}>
      <button
        type="button"
        className="squisq-document-tray-pill"
        id={`${id}-pill`}
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-panel` : undefined}
        aria-label={`Properties (${count})`}
        title="The document’s own frontmatter keys"
        onClick={() => onExpandedChange(!expanded)}
      >
        <Icon icon="fa-solid fa-tags" />
        <span className="squisq-document-tray-pill-label">Properties</span>
        <span className="squisq-document-tray-count" aria-hidden="true">
          {count}
        </span>
        <span className="squisq-document-tray-chevron" aria-hidden="true">
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      {expanded && (
        <div
          className="squisq-document-tray-panel"
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-pill`}
        >
          <PropertiesPanel
            properties={properties}
            readOnly={readOnly}
            write={write}
            idPrefix={`${id}-properties`}
          />
        </div>
      )}
    </div>
  );
}
