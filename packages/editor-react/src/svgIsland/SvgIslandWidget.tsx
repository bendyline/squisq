/**
 * The Write-view widget for an SVG island: the picture (core's sanitized
 * markup, as an image), and a Source view — a Monaco XML editor — that edits
 * the fence body live. The fence itself stays hidden; it is the only thing
 * persisted, and only the author's edits ever change it.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { parseSvgIsland } from '@bendyline/squisq/markdown';
import { SvgIslandImage } from '@bendyline/squisq-react';
import { Icon } from '../Icon';
import { DiagramMaximizedOverlay } from '../diagram/DiagramMaximizedOverlay';
import { SceneBlockToolbar, type SceneBlockAction } from '../scene/SceneBlockToolbar';
import { SceneSideToolbar } from '../scene/SceneSideToolbar';
import { FenceMonacoEditor } from '../codeSnippet/FenceMonacoEditor';
import { useEditorEditable, useHostColorScheme } from '../codeSnippet/fenceEditorHooks';
import {
  findSvgIslandBlockPos,
  isSvgIslandNode,
  isSvgIslandSourceVisible,
  replaceSvgIslandText,
  toggleSvgIslandSource,
} from './SvgIslandExtension';
import { describeSvgIslandRemovals } from './svgIslandRemovals';

// Each mount gets its own Monaco model namespace (see CodeSnippetWidget).
let nextModelInstanceId = 0;

interface SvgIslandView {
  source: string;
  sourceVisible: boolean;
}

/** The fence body and Source toggle, re-read after every transaction. */
function useSvgIslandView(editor: Editor, blockId: string): SvgIslandView | null {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onTransaction = () => setVersion((value) => value + 1);
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  return useMemo(() => {
    const pos = findSvgIslandBlockPos(editor, blockId);
    if (pos === null) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !isSvgIslandNode(node)) return null;
    return {
      source: node.textContent,
      sourceVisible: isSvgIslandSourceVisible(editor, blockId),
    };
    // `version` is the transaction-backed invalidation token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blockId, version]);
}

/** Fit the source's lines (20px each, plus Monaco's padding), 120–480px. */
function sourceEditorHeight(source: string): number {
  return Math.max(120, Math.min(480, source.split('\n').length * 20 + 20));
}

export interface SvgIslandWidgetProps {
  editor: Editor;
  blockId: string;
  host?: HTMLElement | null;
}

export function SvgIslandWidget({ editor, blockId, host }: SvgIslandWidgetProps) {
  const view = useSvgIslandView(editor, blockId);
  const editable = useEditorEditable(editor);
  const colorScheme = useHostColorScheme(host);
  const [modelInstanceId] = useState(() => ++nextModelInstanceId);
  const [maximized, setMaximized] = useState(false);
  const source = view?.source ?? null;
  const result = useMemo(() => (source === null ? null : parseSvgIsland(source)), [source]);

  if (view === null || source === null || result === null) return null;
  const { sourceVisible } = view;

  // A fence that is not an island has nothing to show but its source.
  const showSource = sourceVisible || !result.ok;
  const actions: SceneBlockAction[] = [
    {
      id: 'svg-source',
      label: 'Source',
      icon: <Icon icon="fa-solid fa-code" />,
      title: showSource ? 'Hide SVG source' : 'Edit SVG source',
      active: showSource,
      disabled: !result.ok,
      onClick: () => toggleSvgIslandSource(editor, blockId),
    },
    {
      id: 'svg-expand',
      label: 'Expand',
      icon: <Icon icon="fa-solid fa-expand" />,
      title: 'Show larger',
      disabled: !result.ok,
      onClick: () => setMaximized(true),
    },
  ];
  const toolbar = <SceneBlockToolbar actions={actions} />;
  const picture = <SvgIslandImage source={source} className="squisq-svg-island-picture" />;

  if (maximized) {
    return (
      <div className="squisq-diagram-inline-placeholder">
        <DiagramMaximizedOverlay host={host ?? null} onClose={() => setMaximized(false)}>
          <div className="squisq-scene-block-max squisq-svg-island-max">
            <div className="squisq-svg-island-max-picture">{picture}</div>
            <div className="squisq-scene-side-toolbar">{toolbar}</div>
          </div>
        </DiagramMaximizedOverlay>
      </div>
    );
  }

  const removed = result.ok ? describeSvgIslandRemovals(result.diagnostics) : '';
  return (
    <div className="squisq-scene-shell squisq-svg-island-shell">
      <SceneSideToolbar>{toolbar}</SceneSideToolbar>
      <div className="squisq-svg-island-preview">{picture}</div>
      {showSource && (
        <div className="squisq-svg-island-source" style={{ height: sourceEditorHeight(source) }}>
          <FenceMonacoEditor
            modelPath={`inmemory://squisq/svg-island/${modelInstanceId}/${blockId}.svg`}
            language="xml"
            source={source}
            editable={editable}
            colorScheme={colorScheme}
            onChange={(value) => {
              if (editable) replaceSvgIslandText(editor, blockId, value);
            }}
            ariaLabel="SVG source editor"
          />
        </div>
      )}
      {showSource && removed && (
        <p className="squisq-svg-island-removed" role="status">
          Removed when shown: {removed}. Scripts, links, external references and anything that could
          load from the network never render.
        </p>
      )}
    </div>
  );
}
