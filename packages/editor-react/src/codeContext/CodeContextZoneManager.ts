import type { editor as MonacoEditorNs } from 'monaco-editor';
import { type ZoneSpec, diffContextSections } from './diffContextSections';

type MonacoEditor = MonacoEditorNs.IStandaloneCodeEditor;

/**
 * Owns the Monaco view zones behind the code-context sections. React-free —
 * the React layer portals content into the zone dom nodes it hands out and
 * feeds measured heights back via {@link setHeight}.
 *
 * Zone mechanics this leans on (monaco 0.50):
 * - `changeViewZones` batches adds/removes/layouts into one whitespace
 *   re-layout.
 * - `layoutZone(id)` re-reads the zone delegate, so mutating our own
 *   delegate's `afterLineNumber`/`heightInPx` then calling layoutZone both
 *   moves and resizes without remove/re-add churn (expanded DOM survives).
 * - Zone dom nodes live in `.view-zones` (absolutely positioned, offscreen
 *   ones display:none'd by Monaco). They sit BELOW `.view-lines` in hit-test
 *   order, so the stylesheet raises `.squisq-ccx-zone` with a z-index and
 *   `pointer-events: auto` to make section content clickable.
 * - Model swaps invalidate zone ids; the owner listens to onDidChangeModel
 *   and rebuilds.
 */
export class CodeContextZoneManager {
  private readonly editor: MonacoEditor;
  private entries = new Map<
    string,
    {
      zoneId: string;
      delegate: MonacoEditorNs.IViewZone;
      domNode: HTMLDivElement;
      spec: ZoneSpec;
    }
  >();
  private listeners = new Set<() => void>();
  private modelListener: { dispose(): void } | null = null;
  private disposed = false;

  /** Initial height estimate for a strip; the ResizeObserver corrects it. */
  static readonly INITIAL_HEIGHT_PX = 28;

  constructor(editor: MonacoEditor) {
    this.editor = editor;
    // A model swap (file change / external reset) invalidates every zone id.
    // Drop our bookkeeping; the next sync() recreates zones against the new
    // model.
    this.modelListener = editor.onDidChangeModel(() => {
      this.entries.clear();
      this.emit();
    });
  }

  /** Reconcile the live zones against `specs` in one changeViewZones batch. */
  sync(specs: ZoneSpec[]): void {
    if (this.disposed) return;
    const prev = [...this.entries.values()].map((e) => e.spec);
    const { add, remove, move } = diffContextSections(prev, specs);
    if (add.length === 0 && remove.length === 0 && move.length === 0) return;

    this.editor.changeViewZones((accessor) => {
      for (const id of remove) {
        const entry = this.entries.get(id);
        if (!entry) continue;
        accessor.removeZone(entry.zoneId);
        this.entries.delete(id);
      }
      for (const spec of move) {
        const entry = this.entries.get(spec.id);
        if (!entry) continue;
        entry.spec = spec;
        entry.delegate.afterLineNumber = Math.max(spec.line - 1, 0);
        setOrdinal(entry.delegate, spec.ordinal);
        accessor.layoutZone(entry.zoneId);
      }
      for (const spec of add) {
        const domNode = document.createElement('div');
        domNode.className = 'squisq-ccx-zone';
        domNode.dataset.sectionId = spec.id;
        const delegate: MonacoEditorNs.IViewZone = {
          afterLineNumber: Math.max(spec.line - 1, 0),
          heightInPx: CodeContextZoneManager.INITIAL_HEIGHT_PX,
          domNode,
          suppressMouseDown: true,
        };
        setOrdinal(delegate, spec.ordinal);
        const zoneId = accessor.addZone(delegate);
        this.entries.set(spec.id, { zoneId, delegate, domNode, spec });
      }
    });
    this.emit();
  }

  /** Measured-content feedback: resize the zone to fit its rendered DOM. */
  setHeight(id: string, px: number): void {
    if (this.disposed) return;
    const entry = this.entries.get(id);
    if (!entry) return;
    const height = Math.max(Math.ceil(px), 1);
    if (Math.abs((entry.delegate.heightInPx ?? 0) - height) < 1) return;
    entry.delegate.heightInPx = height;
    this.editor.changeViewZones((accessor) => {
      accessor.layoutZone(entry.zoneId);
    });
  }

  getDomNode(id: string): HTMLDivElement | undefined {
    return this.entries.get(id)?.domNode;
  }

  liveIds(): string[] {
    return [...this.entries.keys()];
  }

  /** Fires after sync/model-change so the React layer rebuilds its portals. */
  onDidChangeZones(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.modelListener?.dispose();
    this.modelListener = null;
    if (this.entries.size > 0) {
      try {
        this.editor.changeViewZones((accessor) => {
          for (const entry of this.entries.values()) accessor.removeZone(entry.zoneId);
        });
      } catch {
        // Editor already disposed — its zones died with it.
      }
    }
    this.entries.clear();
    this.listeners.clear();
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }
}

/**
 * `ordinal` orders zones sharing an afterLineNumber (monaco 0.50 supports it
 * but the public IViewZone typing lags behind) — hence the structural write.
 */
function setOrdinal(zone: MonacoEditorNs.IViewZone, ordinal: number): void {
  (zone as MonacoEditorNs.IViewZone & { ordinal?: number }).ordinal = ordinal;
}
