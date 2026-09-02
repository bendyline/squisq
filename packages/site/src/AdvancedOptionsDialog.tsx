/**
 * Advanced options for the dev harness — currently one lever: which
 * calculation engine backs XLSX formula editing in the data-card grid.
 *
 *  - **In-house** (default): the pure-TS tier from `@bendyline/squisq-calc`
 *    (~85 functions, zero downloads).
 *  - **IronCalc**: the full-fidelity wasm engine (~462 functions incl.
 *    SUMIFS/XLOOKUP/LET/dynamic arrays), downloaded on first use.
 *
 * The choice persists in localStorage and remounts the editor so open data
 * cards rebuild their formula sessions on the selected engine.
 */

export type CalcEngineChoice = 'in-house' | 'ironcalc';

export const CALC_ENGINE_STORAGE_KEY = 'squisq-site:calcEngine';

export function loadCalcEngineChoice(): CalcEngineChoice {
  if (typeof localStorage === 'undefined') return 'in-house';
  return localStorage.getItem(CALC_ENGINE_STORAGE_KEY) === 'ironcalc' ? 'ironcalc' : 'in-house';
}

export interface AdvancedOptionsDialogProps {
  isDark: boolean;
  calcEngine: CalcEngineChoice;
  onCalcEngineChange: (choice: CalcEngineChoice) => void;
  onClose: () => void;
}

const ENGINE_OPTIONS: { value: CalcEngineChoice; label: string; description: string }[] = [
  {
    value: 'in-house',
    label: 'In-house engine',
    description:
      'Pure TypeScript, ~85 functions covering real-world lookup/aggregate/text/date ' +
      'formulas. Always available, nothing to download.',
  },
  {
    value: 'ironcalc',
    label: 'IronCalc (wasm)',
    description:
      'Full-fidelity engine with ~462 functions — SUMIFS, XLOOKUP, LET/LAMBDA, dynamic ' +
      'arrays. Downloads a ~2 MB wasm module on first use.',
  },
];

export function AdvancedOptionsDialog({
  isDark,
  calcEngine,
  onCalcEngineChange,
  onClose,
}: AdvancedOptionsDialogProps) {
  return (
    <div
      role="presentation"
      data-testid="advanced-options-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-label="Advanced options"
        data-testid="advanced-options-dialog"
        style={{
          width: 440,
          maxWidth: '92vw',
          borderRadius: 8,
          border: `1px solid ${isDark ? '#334155' : '#c9b98a'}`,
          background: isDark ? '#1e293b' : '#fffdf7',
          color: isDark ? '#e5e7eb' : '#1f2937',
          padding: '16px 20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 13,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <strong style={{ fontSize: 15 }}>Advanced options</strong>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'none',
              color: 'inherit',
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8, padding: 0 }}>
            Calculation engine (XLSX formula editing)
          </legend>
          {ENGINE_OPTIONS.map((option) => (
            <label
              key={option.value}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '8px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background:
                  calcEngine === option.value ? (isDark ? '#31435f' : '#f3ebd6') : 'transparent',
                marginBottom: 6,
              }}
            >
              <input
                type="radio"
                name="calc-engine"
                value={option.value}
                checked={calcEngine === option.value}
                onChange={() => onCalcEngineChange(option.value)}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontWeight: 600 }}>{option.label}</span>
                <br />
                <span style={{ opacity: 0.75 }}>{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Switching remounts the editor; unsaved grid edits are discarded.
        </div>
      </div>
    </div>
  );
}
