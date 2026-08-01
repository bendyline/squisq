/**
 * Live `enumerateDevices()` inventory plus the browser's supported-constraint
 * map, shared by every recorder surface that offers a device picker.
 *
 * Enumeration is best effort: browsers withhold labels — and sometimes ids —
 * until the first permission grant, and that grant frequently does NOT fire
 * `devicechange`. Callers holding a preview stream should therefore call
 * `refresh()` when it lands:
 *
 * ```ts
 * const { devices, refresh } = useMediaDevices();
 * useEffect(() => {
 *   if (micStream || cameraStream) refresh();
 * }, [micStream, cameraStream, refresh]);
 * ```
 */

import { useCallback, useEffect, useState } from 'react';

/** What the browser will tell us about capture devices right now. */
export interface MediaDeviceInventory {
  devices: MediaDeviceInfo[];
  /** `getSupportedConstraints()`, or null when the browser withholds it. */
  supported: Record<string, boolean> | null;
  /** Re-enumerate — call after a permission grant reveals labels. */
  refresh: () => void;
}

export function useMediaDevices(): MediaDeviceInventory {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [supported, setSupported] = useState<Record<string, boolean> | null>(null);

  const refresh = useCallback(() => {
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!mediaDevices) return;
    if (typeof mediaDevices.getSupportedConstraints === 'function') {
      setSupported(mediaDevices.getSupportedConstraints() as Record<string, boolean>);
    }
    if (typeof mediaDevices.enumerateDevices !== 'function') return;
    void mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(() => {
        // Device enumeration is permission- and policy-dependent.
      });
  }, []);

  useEffect(() => {
    refresh();
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => refresh();
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refresh]);

  return { devices, supported, refresh };
}
