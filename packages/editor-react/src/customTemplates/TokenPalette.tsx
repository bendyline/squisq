/**
 * Token palette — sidebar of click-to-place placeholder tokens shown
 * inside the TemplateDesigner. Each entry switches the Scene's
 * active tool to a corresponding TokenTool factory instance so the
 * next click on the canvas drops a pre-filled placeholder layer.
 */

interface TokenPaletteProps {
  /**
   * Currently active tool id. The palette highlights the matching
   * button so the user sees which tool is armed.
   */
  activeToolId: string;
  /** Switch the Scene's active tool. */
  onActivate: (toolId: string) => void;
}

interface TokenEntry {
  id: string;
  label: string;
  desc: string;
  preview: string;
}

const TOKENS: TokenEntry[] = [
  {
    id: 'token-title',
    label: 'Title',
    desc: "Substitutes the block's heading text.",
    preview: '{title}',
  },
  {
    id: 'token-content',
    label: 'Content',
    desc: "Substitutes the block's body text.",
    preview: '{content}',
  },
  {
    id: 'token-children',
    label: 'Children',
    desc: 'Comma-joined list of child heading titles.',
    preview: '{children}',
  },
  {
    id: 'token-image',
    label: 'Image',
    desc: "The first image found in the block's body.",
    preview: '{image:0}',
  },
];

export function TokenPalette({ activeToolId, onActivate }: TokenPaletteProps) {
  return (
    <aside className="squisq-template-designer-palette" aria-label="Placeholder tokens">
      <h3 className="squisq-template-designer-palette-title">Placeholders</h3>
      <p className="squisq-template-designer-palette-hint">
        Click a placeholder, then click on the canvas to drop it.
      </p>
      <div className="squisq-template-designer-palette-list">
        {TOKENS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`squisq-template-designer-palette-item${
              activeToolId === t.id ? ' squisq-template-designer-palette-item--active' : ''
            }`}
            onClick={() => onActivate(t.id)}
            title={t.desc}
          >
            <span className="squisq-template-designer-palette-item-preview">{t.preview}</span>
            <span className="squisq-template-designer-palette-item-label">{t.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
