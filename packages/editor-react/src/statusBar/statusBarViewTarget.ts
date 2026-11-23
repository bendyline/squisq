/**
 * The status bar's view region, shared through context: the status bar puts
 * its region's element here, and the active view reads it to portal its own
 * status and controls in (StatusBarViewSlot.tsx holds the provider and the
 * portal component).
 */

import { createContext, useContext } from 'react';

export interface StatusBarViewSlotValue {
  /** The status bar's view region, or null when no status bar is mounted. */
  target: HTMLElement | null;
  /** Ref callback the status bar puts on its view region. */
  setTarget: (element: HTMLElement | null) => void;
}

export const StatusBarViewSlotContext = createContext<StatusBarViewSlotValue | null>(null);

/**
 * Where a view puts its status and controls: the status bar's view region, or
 * null when there is no status bar to put them in (the view then draws them
 * in place).
 */
export function useStatusBarViewTarget(): HTMLElement | null {
  return useContext(StatusBarViewSlotContext)?.target ?? null;
}

/** The ref callback for the status bar's own view region (undefined outside a provider). */
export function useStatusBarViewRegionRef(): ((element: HTMLElement | null) => void) | undefined {
  return useContext(StatusBarViewSlotContext)?.setTarget;
}
