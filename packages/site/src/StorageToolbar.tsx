/**
 * StorageToolbar — Slot-based document storage controls.
 *
 * Provides a dropdown to select from 10 document slots plus Save/Load/Clear
 * buttons. Each slot can hold a markdown document and associated media.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SlotMeta } from './slotStorage';
import {
  SLOT_COUNT,
  getAllSlotMeta,
  saveSlot,
  loadSlot,
  clearSlot,
} from './slotStorage';

// ============================================
// Types
// ============================================

interface StorageToolbarProps {
  /** Current markdown source to save */
  currentSource: string;
  /** Called when a slot is loaded */
  onLoad: (markdown: string) => void;
  /** Whether the site is in dark mode */
  isDark: boolean;
  /** Currently active slot (lifted to parent for MediaProvider) */
  activeSlot: number | null;
  /** Called when user selects a slot */
  onSlotChange: (slot: number | null) => void;
}

// ============================================
// Styles
// ============================================

function btnStyle(isDark: boolean, variant: 'default' | 'primary' | 'danger' = 'default'): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 12,
    padding: '2px 8px',
    cursor: 'pointer',
    border: 'none',
    borderRadius: 3,
  };

  switch (variant) {
    case 'primary':
      return { ...base, background: '#2563eb', color: '#fff' };
    case 'danger':
      return { ...base, background: isDark ? '#7f1d1d' : '#fecaca', color: isDark ? '#fca5a5' : '#991b1b' };
    default:
      return {
        ...base,
        background: isDark ? '#374151' : '#e5e7eb',
        color: isDark ? '#d1d5db' : '#374151',
      };
  }
}

// ============================================
// Component
// ============================================

export function StorageToolbar({
  currentSource,
  onLoad,
  isDark,
  activeSlot,
  onSlotChange,
}: StorageToolbarProps) {
  const [slotMetas, setSlotMetas] = useState<(SlotMeta | null)[]>(Array(SLOT_COUNT).fill(null));
  const [status, setStatus] = useState<string>('');
  const statusTimer = useRef<ReturnType<typeof setTimeout>>();

  // Load slot metadata on mount and after mutations
  const refreshMetas = useCallback(async () => {
    setSlotMetas(await getAllSlotMeta());
  }, []);

  useEffect(() => {
    refreshMetas();
  }, [refreshMetas]);

  // Flash a status message for 2 seconds
  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(''), 2000);
  }, []);

  const handleSlotSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    onSlotChange(val === '' ? null : parseInt(val, 10));
  }, [onSlotChange]);

  const handleSave = useCallback(async () => {
    if (activeSlot === null) return;
    await saveSlot(activeSlot, currentSource);
    await refreshMetas();
    flash(`Saved to Slot ${activeSlot + 1}`);
  }, [activeSlot, currentSource, refreshMetas, flash]);

  const handleLoad = useCallback(async () => {
    if (activeSlot === null) return;
    const markdown = await loadSlot(activeSlot);
    if (markdown !== null) {
      onLoad(markdown);
      flash(`Loaded Slot ${activeSlot + 1}`);
    } else {
      flash('Slot is empty');
    }
  }, [activeSlot, onLoad, flash]);

  const handleClear = useCallback(async () => {
    if (activeSlot === null) return;
    await clearSlot(activeSlot);
    await refreshMetas();
    flash(`Cleared Slot ${activeSlot + 1}`);
  }, [activeSlot, refreshMetas, flash]);

  // Build dropdown options
  const slotOptions = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const meta = slotMetas[i];
    const label = meta
      ? `${meta.name} (${new Date(meta.lastModified).toLocaleDateString()})`
      : `Slot ${i + 1} — empty`;
    return { value: i, label };
  });

  const slotIsEmpty = activeSlot !== null && slotMetas[activeSlot] === null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
        Storage:
        <select
          value={activeSlot === null ? '' : activeSlot}
          onChange={handleSlotSelect}
          style={{
            fontSize: 12,
            padding: '2px 6px',
            background: isDark ? '#374151' : '#fff',
            color: isDark ? '#e5e7eb' : '#1f2937',
            border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
            borderRadius: 3,
            maxWidth: 200,
          }}
        >
          <option value="">– none –</option>
          {slotOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {activeSlot !== null && (
        <>
          <button style={btnStyle(isDark, 'primary')} onClick={handleSave} title="Save current document to this slot">
            Save
          </button>
          <button
            style={btnStyle(isDark)}
            onClick={handleLoad}
            disabled={slotIsEmpty}
            title={slotIsEmpty ? 'Slot is empty' : 'Load document from this slot'}
          >
            Load
          </button>
          <button
            style={btnStyle(isDark, 'danger')}
            onClick={handleClear}
            disabled={slotIsEmpty}
            title={slotIsEmpty ? 'Slot is empty' : 'Clear this slot'}
          >
            Clear
          </button>
        </>
      )}

      {status && (
        <span style={{ fontSize: 11, color: isDark ? '#9ca3af' : '#6b7280', fontStyle: 'italic' }}>
          {status}
        </span>
      )}
    </div>
  );
}
