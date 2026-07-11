/**
 * React binding over {@link createFloatingWindowManager}: exposes the
 * current tier + portal target as state and guarantees the float closes
 * when the owning view unmounts (mode switch, Use-tab exit, shell
 * teardown).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createFloatingWindowManager,
  detectFloatTiers,
  type CanvasSink,
  type FloatingWindowManager,
} from './floatingWindow';
import type { FloatTier } from './types';

export interface FloatingWindowHandle {
  tier: FloatTier;
  isOpen: boolean;
  /** Non-docked tiers this browser supports, best first. */
  supportedTiers: FloatTier[];
  portalTarget: HTMLElement | null;
  canvasSink: CanvasSink | null;
  open: (preferredTier?: FloatTier) => Promise<void>;
  close: () => void;
}

const FLOAT_WIDTH = 380;
const FLOAT_HEIGHT = 540;

export function useFloatingWindow(styleCss: string): FloatingWindowHandle {
  const managerRef = useRef<FloatingWindowManager | null>(null);
  if (managerRef.current === null) {
    managerRef.current = createFloatingWindowManager({ styleCss });
  }
  const manager = managerRef.current;

  const [tier, setTier] = useState<FloatTier>('docked');
  const supportedTiers = useMemo(() => detectFloatTiers().filter((t) => t !== 'docked'), []);

  useEffect(() => {
    const offChange = manager.on('tierchange', setTier);
    const offClosed = manager.on('closed', setTier);
    return () => {
      offChange();
      offClosed();
      manager.dispose();
    };
  }, [manager]);

  const open = useCallback(
    async (preferredTier?: FloatTier) => {
      await manager.open({
        width: FLOAT_WIDTH,
        height: FLOAT_HEIGHT,
        title: 'Squisq Teleprompter',
        ...(preferredTier !== undefined ? { preferredTier } : {}),
      });
    },
    [manager],
  );

  const close = useCallback(() => manager.close(), [manager]);

  return {
    tier,
    isOpen: manager.isOpen,
    supportedTiers,
    portalTarget: manager.getPortalTarget(),
    canvasSink: manager.getCanvasSink(),
    open,
    close,
  };
}
