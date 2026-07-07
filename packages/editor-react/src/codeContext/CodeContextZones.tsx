import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorContext } from '../EditorContext';
import { CodeContextZoneManager } from './CodeContextZoneManager';
import { CodeContextSectionView } from './CodeContextSectionView';
import type { ZoneSpec } from './diffContextSections';
import type { CodeContext, CodeContextSection } from './types';

/**
 * Bridges a host-supplied {@link CodeContext} onto the live Monaco editor:
 * owns a {@link CodeContextZoneManager} per editor instance, reconciles zones
 * when the context prop changes, and portals a `CodeContextSectionView` into
 * each zone's dom node. Mounted by EditorShell in code mode; also exported
 * for hosts composing a custom shell around `RawEditor`.
 */
export function CodeContextZones({ options }: { options: CodeContext }) {
  const { monacoEditor } = useEditorContext();
  const [manager, setManager] = useState<CodeContextZoneManager | null>(null);
  // Bumped whenever the zone set changes so portals rebuild.
  const [, setZonesVersion] = useState(0);
  // Expansion state per section id: seeded from defaultExpanded the first
  // time an id appears; the user's toggle wins afterwards.
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    if (!monacoEditor) return;
    const mgr = new CodeContextZoneManager(monacoEditor);
    const off = mgr.onDidChangeZones(() => setZonesVersion((v) => v + 1));
    setManager(mgr);
    return () => {
      off();
      mgr.dispose();
      setManager(null);
    };
  }, [monacoEditor]);

  const fileTop = options.fileTop;
  const sections = options.sections;

  // Resolved render list: fileTop pinned above line 1 at ordinal 0, then the
  // host's sections in array order.
  const resolved = useMemo(() => {
    const out: Array<{ spec: ZoneSpec; section: Omit<CodeContextSection, 'line'> }> = [];
    if (fileTop) {
      out.push({ spec: { id: fileTop.id, line: 0, ordinal: 0 }, section: fileTop });
    }
    sections?.forEach((s, i) => {
      out.push({ spec: { id: s.id, line: s.line, ordinal: i + 1 }, section: s });
    });
    return out;
  }, [fileTop, sections]);

  useEffect(() => {
    if (!manager) return;
    manager.sync(resolved.map((r) => r.spec));
    // Seed expansion defaults for ids we haven't seen before (sections can
    // arrive after mount).
    setExpandedById((prev) => {
      let next: Record<string, boolean> | null = null;
      for (const { section } of resolved) {
        if (seenIds.current.has(section.id)) continue;
        seenIds.current.add(section.id);
        if (section.defaultExpanded) {
          next = next ?? { ...prev };
          next[section.id] = true;
        }
      }
      return next ?? prev;
    });
  }, [manager, resolved]);

  const onToggleSection = options.onToggleSection;
  const handleToggle = useCallback(
    (id: string) => {
      setExpandedById((prev) => {
        const expanded = !prev[id];
        onToggleSection?.(id, expanded);
        return { ...prev, [id]: expanded };
      });
    },
    [onToggleSection],
  );

  const handleMeasure = useCallback(
    (id: string, px: number) => manager?.setHeight(id, px),
    [manager],
  );

  const handleRevealLine = useCallback(
    (line: number) => {
      monacoEditor?.revealLineInCenter(line);
      monacoEditor?.setPosition({ lineNumber: line, column: 1 });
    },
    [monacoEditor],
  );

  if (!manager) return null;
  return (
    <>
      {resolved.map(({ section }) => {
        const domNode = manager.getDomNode(section.id);
        if (!domNode) return null;
        return createPortal(
          <CodeContextSectionView
            key={section.id}
            section={section}
            expanded={!!expandedById[section.id]}
            onToggle={handleToggle}
            linkSchemes={options.linkSchemes}
            onLinkClick={options.onLinkClick}
            onRevealLine={handleRevealLine}
            onMeasure={handleMeasure}
          />,
          domNode,
          section.id,
        );
      })}
    </>
  );
}
