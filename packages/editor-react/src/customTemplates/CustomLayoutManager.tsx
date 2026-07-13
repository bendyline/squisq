/**
 * CustomLayoutManager — a near-full-window modal for managing custom
 * layouts (templates). The left rail lists every layout available to the
 * document — those inlined in the doc and those saved to the browser
 * library — plus a "New layout" button. The right pane embeds the
 * existing {@link TemplateDesigner} (in `embedded` mode) so the selected
 * layout can be authored in place.
 *
 * The manager seeds its own {@link CustomTemplateProvider} from the
 * active doc (via {@link useDocCustomTemplates}) so it works whether or
 * not the host already mounted a provider — the toolbar that opens it
 * sits outside the WYSIWYG editor's provider.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CustomTemplateDefinition, MediaProvider } from '@bendyline/squisq/schemas';
import {
  CustomTemplateProvider,
  useCustomTemplates,
  type CustomTemplateContextValue,
} from './CustomTemplateContext';
import { TemplateDesigner, type DesignerSaveTarget } from './TemplateDesigner';
import { TemplateThumbnail } from './thumbnail';
import { useDocCustomTemplates } from './useDocCustomTemplates';
import { useEditorContext } from '../EditorContext';

export interface CustomLayoutManagerProps {
  /** Close the manager. */
  onClose: () => void;
}

/**
 * A picked sidebar entry: `'new'` for the blank-slate designer, or an
 * existing template tagged by which pool it came from.
 *
 * `def` carries the definition directly for the just-saved case: the doc
 * re-parses on a 150ms debounce (see EditorContext), so immediately after
 * a save the doc-template list is briefly stale. Holding the saved
 * definition here lets the designer re-seed from it without waiting for —
 * or racing — that re-parse. User-initiated selections omit `def` and
 * resolve from the (by-then fresh) list.
 */
type Selection =
  | 'new'
  | { source: 'doc' | 'library'; name: string; def?: CustomTemplateDefinition };

export function CustomLayoutManager({ onClose }: CustomLayoutManagerProps) {
  const { docTemplates, onDocTemplatesChange } = useDocCustomTemplates();
  const { mediaProvider, colorScheme } = useEditorContext();

  // Close on Escape, mirroring the other editor dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="squisq-editor-shell squisq-layout-manager-overlay"
      data-theme={colorScheme}
      role="dialog"
      aria-modal="true"
      aria-label="Custom layouts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="squisq-layout-manager-panel">
        <header className="squisq-layout-manager-header">
          <h2 className="squisq-layout-manager-title">Custom layouts</h2>
          <button
            type="button"
            className="squisq-template-designer-close"
            onClick={onClose}
            aria-label="Close custom layouts"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>
        <CustomTemplateProvider
          docTemplates={docTemplates}
          onDocTemplatesChange={onDocTemplatesChange}
        >
          <ManagerBody mediaProvider={mediaProvider} />
        </CustomTemplateProvider>
      </div>
    </div>,
    document.body,
  );
}

/** Inner body — runs under the provider so it can read/write both pools. */
function ManagerBody({ mediaProvider }: { mediaProvider: MediaProvider | null }) {
  const ctx = useCustomTemplates();
  // The provider is mounted just above by CustomLayoutManager, so this is
  // never null in practice; narrow defensively rather than asserting.
  if (!ctx) return null;
  return <ManagerContent ctx={ctx} mediaProvider={mediaProvider} />;
}

function ManagerContent({
  ctx,
  mediaProvider,
}: {
  ctx: CustomTemplateContextValue;
  mediaProvider: MediaProvider | null;
}) {
  const { docTemplates, libraryTemplates, upsertDocTemplate, upsertLibraryTemplate } = ctx;

  // The doc and library pools are listed in full and kept separate — a
  // layout can legitimately exist in both (the doc's inlined copy and a
  // reusable library copy), so saving a doc layout "to library" produces
  // a visible second entry rather than silently merging into the doc one.

  // Default selection: first doc layout, else first library layout, else
  // the blank-slate "new" designer.
  const [selection, setSelection] = useState<Selection>(() => {
    if (docTemplates[0]) return { source: 'doc', name: docTemplates[0].name };
    if (libraryTemplates[0]) return { source: 'library', name: libraryTemplates[0].name };
    return 'new';
  });

  // Resolve the selected definition (undefined for the "new" slate). A
  // `def` carried on the selection wins over the list lookup so a freshly
  // saved layout shows immediately, before the doc re-parse lands.
  const selected: CustomTemplateDefinition | undefined =
    selection === 'new'
      ? undefined
      : (selection.def ??
        (selection.source === 'doc' ? docTemplates : libraryTemplates).find(
          (t) => t.name === selection.name,
        ));

  const handleSave = useCallback(
    (def: CustomTemplateDefinition, target: DesignerSaveTarget) => {
      if (target === 'doc') upsertDocTemplate(def);
      else upsertLibraryTemplate(def);
      // After saving, select the just-saved layout so the list highlights
      // it and further edits target the same entry (rather than the blank
      // "new" slate). Carry the saved def so the designer re-seeds from it
      // even while the doc re-parse (debounced) is still in flight.
      setSelection({ source: target === 'doc' ? 'doc' : 'library', name: def.name, def });
    },
    [upsertDocTemplate, upsertLibraryTemplate],
  );

  const isActive = (source: 'doc' | 'library', name: string) =>
    selection !== 'new' && selection.source === source && selection.name === name;

  const renderItem = (def: CustomTemplateDefinition, source: 'doc' | 'library') => (
    <button
      key={`${source}:${def.name}`}
      type="button"
      className={`squisq-layout-manager-item${
        isActive(source, def.name) ? ' squisq-layout-manager-item--active' : ''
      }`}
      onClick={() => setSelection({ source, name: def.name })}
    >
      <span className="squisq-layout-manager-item-thumb">
        <TemplateThumbnail def={def} />
      </span>
      <span className="squisq-layout-manager-item-text">
        <span className="squisq-layout-manager-item-label">{def.label || def.name}</span>
        <span className="squisq-layout-manager-item-name">{def.name}</span>
      </span>
    </button>
  );

  return (
    <div className="squisq-layout-manager-body">
      <aside className="squisq-layout-manager-sidebar">
        <button
          type="button"
          className={`squisq-layout-manager-new${
            selection === 'new' ? ' squisq-layout-manager-new--active' : ''
          }`}
          onClick={() => setSelection('new')}
        >
          + New layout
        </button>

        {docTemplates.length > 0 && (
          <>
            <div className="squisq-layout-manager-section-title">This document</div>
            <div className="squisq-layout-manager-list">
              {docTemplates.map((def) => renderItem(def, 'doc'))}
            </div>
          </>
        )}

        {libraryTemplates.length > 0 && (
          <>
            <div className="squisq-layout-manager-section-title">Library</div>
            <div className="squisq-layout-manager-list">
              {libraryTemplates.map((def) => renderItem(def, 'library'))}
            </div>
          </>
        )}

        {docTemplates.length === 0 && libraryTemplates.length === 0 && (
          <p className="squisq-layout-manager-empty-hint">
            No custom layouts yet. Design one on the right and save it to this document or your
            library.
          </p>
        )}
      </aside>

      <div className="squisq-layout-manager-main">
        <TemplateDesigner
          // Remount when the selection changes so the designer re-seeds
          // its internal state from the newly chosen definition.
          key={selection === 'new' ? 'new' : `${selection.source}:${selection.name}`}
          embedded
          initial={selected}
          mediaProvider={mediaProvider}
          // A layout already in the doc just "Save"s; a new or library
          // layout reads "Save to this doc" since saving adds it.
          primarySaveLabel={
            selection !== 'new' && selection.source === 'doc' ? 'Save' : 'Save to this doc'
          }
          onSave={handleSave}
          onClose={() => {
            /* embedded: the manager frame owns dismissal */
          }}
        />
      </div>
    </div>
  );
}
