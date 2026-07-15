/**
 * Floating-teleprompter window manager — framework-free.
 *
 * Capability ladder, best first:
 *   1. `document-pip` — Document Picture-in-Picture (Chromium 116+,
 *      Firefox 151+): a true always-on-top window hosting live DOM; the
 *      React surface portals into it.
 *   2. `video-pip`   — canvas → `captureStream(0)` → `<video>` →
 *      `requestPictureInPicture()` (Safari's only always-on-top path;
 *      `webkitSetPresentationMode` fallback). Read-only: the main
 *      window draws frames and calls `requestFrame()` on analysis
 *      ticks — never rAF, which throttles under occlusion.
 *   3. `popup`       — `window.open` (positionable, not always-on-top).
 *   4. `docked`      — no float.
 *
 * Every tier is feature-detected at open time and falls through to the
 * next on ANY failure. All interactive state stays in the main window;
 * floats are render targets only.
 */

import type { FloatTier } from './types';

interface DocumentPictureInPictureApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

interface WindowWithDocPip extends Window {
  documentPictureInPicture?: DocumentPictureInPictureApi;
}

interface WebKitVideoElement extends HTMLVideoElement {
  webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitPresentationMode?: string;
}

interface CaptureTrackWithRequestFrame extends MediaStreamTrack {
  requestFrame?: () => void;
}

export interface FloatOpenOptions {
  width: number;
  height: number;
  /** Try this tier first; the ladder continues below it on failure. */
  preferredTier?: FloatTier;
  title: string;
}

export interface CanvasSink {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Push the freshly drawn canvas frame into the PiP video. */
  requestFrame: () => void;
}

export type FloatEvent = 'closed' | 'tierchange';

export interface FloatingWindowManager {
  readonly tier: FloatTier;
  readonly isOpen: boolean;
  /** Resolves with the tier that actually opened ('docked' if none could). */
  open(opts: FloatOpenOptions): Promise<FloatTier>;
  /** Idempotent; restores docked and emits 'closed'. */
  close(): void;
  /** Portal container for 'document-pip' | 'popup'; null otherwise. */
  getPortalTarget(): HTMLElement | null;
  /** Canvas sink for 'video-pip'; null otherwise. */
  getCanvasSink(): CanvasSink | null;
  on(event: FloatEvent, cb: (tier: FloatTier) => void): () => void;
  /** Tear everything down (unmount); like close() but silent-safe. */
  dispose(): void;
}

/** Feature-detect the available float tiers, best first. */
export function detectFloatTiers(): FloatTier[] {
  const tiers: FloatTier[] = [];
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if ((window as WindowWithDocPip).documentPictureInPicture) tiers.push('document-pip');
    const video = document.createElement('video') as WebKitVideoElement;
    const stdPip =
      document.pictureInPictureEnabled === true &&
      typeof video.requestPictureInPicture === 'function';
    const webkitPip =
      typeof video.webkitSetPresentationMode === 'function' &&
      (video.webkitSupportsPresentationMode?.('picture-in-picture') ?? true);
    const canCapture =
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
    if ((stdPip || webkitPip) && canCapture) tiers.push('video-pip');
    if (typeof window.open === 'function') tiers.push('popup');
  }
  tiers.push('docked');
  return tiers;
}

interface ActiveFloat {
  tier: FloatTier;
  portalTarget: HTMLElement | null;
  canvasSink: CanvasSink | null;
  dispose: () => void;
}

export function createFloatingWindowManager(deps: { styleCss: string }): FloatingWindowManager {
  let active: ActiveFloat | null = null;
  // Bumped by every open()/close()/dispose(). Opening a float is async (PiP
  // permission, requestWindow, video.play), and the window can be closed,
  // superseded, or the whole manager disposed while those awaits are pending.
  // An attempt whose generation is stale must dispose the float it just
  // opened instead of adopting it — otherwise `active` points at a float
  // nobody asked for, or (after dispose) an always-on-top window with an
  // empty root, no owner, and nothing left that would ever close it.
  let generation = 0;
  let disposed = false;
  const listeners: Record<FloatEvent, Set<(tier: FloatTier) => void>> = {
    closed: new Set(),
    tierchange: new Set(),
  };

  const emit = (event: FloatEvent, tier: FloatTier) => {
    for (const cb of listeners[event]) cb(tier);
  };

  /** Handles user-initiated closes (PiP ✕, popup close, navigation). */
  const handleExternalClose = () => {
    if (!active) return;
    const closing = active;
    active = null;
    closing.dispose();
    emit('tierchange', 'docked');
    emit('closed', 'docked');
  };

  const openerPageHide = () => manager.close();
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', openerPageHide);
  }

  const writeFloatDocument = (doc: Document, title: string): HTMLElement => {
    doc.title = title;
    const style = doc.createElement('style');
    style.textContent = `${deps.styleCss}\nhtml,body{margin:0;height:100%;}#squisq-float-root{height:100%;display:flex;}`;
    doc.head.appendChild(style);
    const root = doc.createElement('div');
    root.id = 'squisq-float-root';
    doc.body.appendChild(root);
    return root;
  };

  const openDocumentPip = async (opts: FloatOpenOptions): Promise<ActiveFloat> => {
    const api = (window as WindowWithDocPip).documentPictureInPicture;
    if (!api) throw new Error('Document PiP unavailable');
    const pip = await api.requestWindow({ width: opts.width, height: opts.height });
    // Copy same-origin stylesheets so editor chrome vars resolve; the
    // injected styleCss below is what the surface actually depends on.
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n');
        const style = pip.document.createElement('style');
        style.textContent = rules;
        pip.document.head.appendChild(style);
      } catch {
        if (sheet.href) {
          const link = pip.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          pip.document.head.appendChild(link);
        }
      }
    }
    const root = writeFloatDocument(pip.document, opts.title);
    pip.addEventListener('pagehide', handleExternalClose);
    return {
      tier: 'document-pip',
      portalTarget: root,
      canvasSink: null,
      dispose: () => {
        pip.removeEventListener('pagehide', handleExternalClose);
        try {
          pip.close();
        } catch {
          // Already closed by the user.
        }
      },
    };
  };

  const openVideoPip = async (opts: FloatOpenOptions): Promise<ActiveFloat> => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(opts.width * (window.devicePixelRatio || 1));
    canvas.height = Math.round(opts.height * (window.devicePixelRatio || 1));
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') {
      throw new Error('canvas.captureStream unavailable');
    }
    ctx.fillStyle = '#101014';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let stream: MediaStream;
    let requestFrame: () => void;
    try {
      stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as CaptureTrackWithRequestFrame;
      if (typeof track.requestFrame === 'function') {
        const pushFrame = track.requestFrame.bind(track);
        requestFrame = () => pushFrame();
      } else {
        // No manual-frame API: fall back to a 30 fps capture; draws still
        // happen on analysis ticks so content stays audio-clock driven.
        stream = canvas.captureStream(30);
        requestFrame = () => undefined;
      }
    } catch {
      stream = canvas.captureStream(30);
      requestFrame = () => undefined;
    }

    const video = document.createElement('video') as WebKitVideoElement;
    video.muted = true;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.width = `${opts.width}px`;
    video.srcObject = stream;
    document.body.appendChild(video);

    const cleanupDom = () => {
      video.pause();
      video.srcObject = null;
      video.remove();
      for (const track of stream.getTracks()) track.stop();
    };

    try {
      await video.play();
      requestFrame();
      if (typeof video.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
        video.addEventListener('leavepictureinpicture', handleExternalClose);
      } else if (typeof video.webkitSetPresentationMode === 'function') {
        video.webkitSetPresentationMode('picture-in-picture');
        video.addEventListener('webkitpresentationmodechanged', () => {
          if (video.webkitPresentationMode === 'inline') handleExternalClose();
        });
      } else {
        throw new Error('No video PiP API');
      }
    } catch (err: unknown) {
      cleanupDom();
      throw err instanceof Error ? err : new Error(String(err));
    }

    return {
      tier: 'video-pip',
      portalTarget: null,
      canvasSink: { canvas, width: canvas.width, height: canvas.height, requestFrame },
      dispose: () => {
        video.removeEventListener('leavepictureinpicture', handleExternalClose);
        if (document.pictureInPictureElement === video) {
          void document.exitPictureInPicture().catch(() => undefined);
        } else if (
          typeof video.webkitSetPresentationMode === 'function' &&
          video.webkitPresentationMode === 'picture-in-picture'
        ) {
          video.webkitSetPresentationMode('inline');
        }
        cleanupDom();
      },
    };
  };

  const openPopup = (opts: FloatOpenOptions): ActiveFloat => {
    const popup = window.open(
      '',
      'squisq-teleprompter',
      `popup=yes,width=${opts.width},height=${opts.height}`,
    );
    if (!popup) throw new Error('Popup blocked');
    const root = writeFloatDocument(popup.document, opts.title);
    popup.addEventListener('pagehide', handleExternalClose);
    popup.focus();
    return {
      tier: 'popup',
      portalTarget: root,
      canvasSink: null,
      dispose: () => {
        popup.removeEventListener('pagehide', handleExternalClose);
        try {
          popup.close();
        } catch {
          // Already closed.
        }
      },
    };
  };

  const manager: FloatingWindowManager = {
    get tier() {
      return active?.tier ?? 'docked';
    },
    get isOpen() {
      return active !== null;
    },
    async open(opts: FloatOpenOptions): Promise<FloatTier> {
      manager.close();
      if (disposed) return 'docked';
      const attempt = ++generation;
      // Stale once a close/dispose/newer open has bumped the generation.
      const superseded = () => generation !== attempt || disposed;
      const supported = detectFloatTiers();
      const ladder =
        opts.preferredTier && supported.includes(opts.preferredTier)
          ? [opts.preferredTier, ...supported.filter((t) => t !== opts.preferredTier)]
          : supported;
      for (const tier of ladder) {
        if (tier === 'docked') break;
        if (superseded()) return 'docked';
        let opened: ActiveFloat | null = null;
        try {
          if (tier === 'document-pip') opened = await openDocumentPip(opts);
          else if (tier === 'video-pip') opened = await openVideoPip(opts);
          else if (tier === 'popup') opened = openPopup(opts);
        } catch {
          opened = null; // fall through to the next tier
        }
        if (!opened) continue;
        if (superseded()) {
          // Resolved too late to be wanted. Dispose it here — assigning it to
          // `active` would resurrect a float past its close/dispose.
          opened.dispose();
          return 'docked';
        }
        active = opened;
        emit('tierchange', active.tier);
        return active.tier;
      }
      if (superseded()) return 'docked';
      emit('tierchange', 'docked');
      return 'docked';
    },
    close() {
      // Bump unconditionally: a close during an in-flight open must invalidate
      // it even though there is no `active` float to tear down yet.
      generation++;
      if (!active) return;
      const closing = active;
      active = null;
      closing.dispose();
      emit('tierchange', 'docked');
      emit('closed', 'docked');
    },
    getPortalTarget() {
      return active?.portalTarget ?? null;
    },
    getCanvasSink() {
      return active?.canvasSink ?? null;
    },
    on(event: FloatEvent, cb: (tier: FloatTier) => void) {
      listeners[event].add(cb);
      return () => {
        listeners[event].delete(cb);
      };
    },
    dispose() {
      manager.close();
      // Latch: listeners are gone after this, so a float resolving later has
      // no owner and no way to report itself. `superseded()` reads this and
      // disposes it on arrival.
      disposed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', openerPageHide);
      }
      listeners.closed.clear();
      listeners.tierchange.clear();
    },
  };

  return manager;
}
