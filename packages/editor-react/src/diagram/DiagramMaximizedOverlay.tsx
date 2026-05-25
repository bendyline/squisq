/**
 * DiagramMaximizedOverlay — full-editor overlay that hosts the diagram
 * canvas when the user clicks the maximize button.
 *
 * Positions over the closest `position: relative` / `position: absolute`
 * ancestor (in practice, the editor shell's root). `Esc` and an overlay
 * close button both call `onClose`.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DiagramMaximizedOverlayProps {
  /** DOM node to portal into. Falls back to document.body. */
  host?: HTMLElement | null;
  /** Closes the overlay (e.g., returns to inline view). */
  onClose: () => void;
  children: React.ReactNode;
}

export function DiagramMaximizedOverlay({ host, onClose, children }: DiagramMaximizedOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const target = host ?? (typeof document !== 'undefined' ? document.body : null);
  if (!target) return null;

  return createPortal(
    <div className="squisq-diagram-maximized-overlay">
      <div className="squisq-diagram-maximized-content">{children}</div>
    </div>,
    target,
  );
}

export default DiagramMaximizedOverlay;
