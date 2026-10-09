/** Host-owned Insert actions, scoped to one editor instance. */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

export interface EditorInsertMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}
type Getter = () => readonly EditorInsertMenuItem[];
const Registry = createContext<Set<Getter> | null>(null);

export function EditorInsertMenuProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new Set<Getter>(), []);
  return <Registry.Provider value={registry}>{children}</Registry.Provider>;
}

/** Call from a toolbar slot; callbacks retain access to the editor context. */
// eslint-disable-next-line react-refresh/only-export-components
export function useEditorInsertMenuItems(items: readonly EditorInsertMenuItem[]): void {
  const registry = useContext(Registry);
  const latest = useRef(items);
  latest.current = items;
  if (!registry) throw new Error('Insert actions require an EditorProvider.');
  useEffect(() => {
    const get = () => latest.current;
    registry.add(get);
    return () => {
      registry.delete(get);
    };
  }, [registry]);
}

export function EditorInsertMenuItems({ onClose }: { onClose: () => void }) {
  const registry = useContext(Registry);
  return (
    <>
      {Array.from(registry ?? []).flatMap((get, group) =>
        get().map((item) => (
          <button
            type="button"
            key={`${group}:${item.id}`}
            className="squisq-toolbar-overflow-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              // Read again in case host readiness changed while the menu was open.
              const current = get().find((entry) => entry.id === item.id);
              if (!current || current.disabled) return;
              onClose();
              current.onSelect();
            }}
          >
            <span className="squisq-toolbar-overflow-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        )),
      )}
    </>
  );
}
