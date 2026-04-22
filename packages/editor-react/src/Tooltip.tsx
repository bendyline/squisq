/**
 * TooltipLayer
 *
 * A single portal-mounted tooltip that activates on hover over any element
 * with a `data-tooltip` attribute. Shorter delay than native browser
 * tooltips and fires regardless of window focus, making toolbar hints feel
 * immediate. Mount once near the root of the editor shell.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 180;

interface TooltipState {
  label: string;
  top: number;
  left: number;
}

export function TooltipLayer() {
  const [state, setState] = useState<TooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTargetRef = useRef<HTMLElement | null>(null);
  // Visibility tracked in a ref so `handleOver` can decide whether to swap
  // the label immediately vs. re-delay — reading it from state would force
  // the effect to re-run (and re-register all listeners) on every change.
  const visibleRef = useRef(false);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const hide = () => {
      clearTimer();
      currentTargetRef.current = null;
      visibleRef.current = false;
      setState(null);
    };

    const show = (el: HTMLElement, label: string) => {
      const rect = el.getBoundingClientRect();
      visibleRef.current = true;
      setState({
        label,
        top: rect.bottom + 6,
        left: rect.left + rect.width / 2,
      });
    };

    const handleOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tooltip]');
      if (!el) return;
      if (el === currentTargetRef.current) return;
      const label = el.getAttribute('data-tooltip');
      if (!label) return;

      // Switching from one tooltip target to another: if a tooltip is
      // already visible, swap the label immediately (no re-delay).
      const wasVisible = visibleRef.current;
      currentTargetRef.current = el;
      clearTimer();

      if (wasVisible) {
        show(el, label);
      } else {
        timerRef.current = setTimeout(() => {
          if (currentTargetRef.current === el && document.body.contains(el)) {
            show(el, label);
          }
        }, SHOW_DELAY_MS);
      }
    };

    const handleOut = (e: MouseEvent) => {
      const target = currentTargetRef.current;
      if (!target) return;
      const related = e.relatedTarget as Node | null;
      // Still hovering inside the same target (e.g. moved over a child)
      if (related && target.contains(related)) return;
      // Moving to another element with a tooltip — handleOver will swap in.
      const relatedTooltip = (related as Element | null)?.closest?.('[data-tooltip]');
      if (relatedTooltip) return;
      hide();
    };

    const handleScroll = () => hide();
    const handleBlur = () => hide();

    document.addEventListener('mouseover', handleOver);
    document.addEventListener('mouseout', handleOut);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('blur', handleBlur);

    return () => {
      clearTimer();
      document.removeEventListener('mouseover', handleOver);
      document.removeEventListener('mouseout', handleOut);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  if (!state) return null;

  return createPortal(
    <div
      role="tooltip"
      className="squisq-tooltip"
      style={{
        position: 'fixed',
        top: state.top,
        left: state.left,
      }}
    >
      {state.label}
    </div>,
    document.body,
  );
}
