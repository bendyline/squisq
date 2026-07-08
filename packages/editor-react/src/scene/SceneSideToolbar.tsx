/**
 * SceneSideToolbar — placement wrapper for a `SceneBlockToolbar` beside an
 * *inline* diagram / drawing / layout canvas.
 *
 * The toolbar normally floats as an always-open vertical column in the page's
 * right gutter (`.squisq-scene-side-toolbar`, positioned at `left: 100%`). That
 * only works when the gutter is wide enough to hold the 180px column; on a
 * narrow editor — or in a host whose page fills most of the width — the column
 * overhangs the editor's clipping edge and gets cut off.
 *
 * So we measure the real gutter (the gap between the canvas's right edge and
 * the nearest horizontally-clipping ancestor) rather than guessing from a
 * viewport breakpoint, since page width / centering / host chrome all move it:
 *   • Fits  — render the column as-is (the common, wider case).
 *   • Clips — render the toolbar as a compact horizontal bar in normal flow
 *     above the canvas (`.squisq-scene-inline-toolbar`). It stays visible and
 *     is never clipped; it just costs a small strip of vertical space.
 *
 * A normal-flow bar is used rather than an on-demand overlay popover because
 * absolutely-positioned content overlapping the React Flow canvas fails to
 * paint in some hosts (the diagram's own maximize overlay hits the same wall),
 * whereas in-flow content always renders.
 *
 * Only the inline placement adapts. Maximized mode has a full screen to reserve
 * a static right column, so the widgets render the bare
 * `.squisq-scene-side-toolbar` there and never mount this wrapper.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Horizontal room the gutter must have to host the open column, kept in sync
 * with `.squisq-scene-side-toolbar` in scene.css (12px `margin-left` + 180px
 * `width`) plus a few px of breathing room so we fall back to the bar just
 * before the column would touch the clip edge.
 */
const SIDE_TOOLBAR_FIT_PX = 12 + 180 + 4;

interface SceneSideToolbarProps {
  /** The `SceneBlockToolbar` element built by the host widget. */
  children: ReactNode;
}

export function SceneSideToolbar({ children }: SceneSideToolbarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Measure whether the right gutter can host the column. The column is
  // absolutely positioned at the shell's right edge, so its clipping depends on
  // `shellRight` vs. the nearest ancestor that clips horizontally — recomputed
  // whenever the editor body resizes (window resize, outline toggle, etc.).
  // Switching to the in-flow bar changes shell *height*, not `shellRight`, so
  // there's no measure↔collapse loop.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const shell = wrap.closest('.squisq-scene-shell') as HTMLElement | null;
    const clip = wrap.closest('.squisq-editor-content') as HTMLElement | null;
    const measure = () => {
      if (!shell) return;
      const shellRight = shell.getBoundingClientRect().right;
      const clipRight = clip
        ? clip.getBoundingClientRect().right
        : document.documentElement.clientWidth;
      setCollapsed(clipRight - shellRight < SIDE_TOOLBAR_FIT_PX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    const target = clip ?? shell;
    if (target) ro.observe(target);
    if (shell && shell !== target) ro.observe(shell);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div ref={wrapRef} className={collapsed ? 'squisq-scene-inline-toolbar' : 'squisq-scene-side-toolbar'}>
      {children}
    </div>
  );
}

export default SceneSideToolbar;
