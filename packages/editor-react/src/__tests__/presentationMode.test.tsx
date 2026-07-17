/**
 * @vitest-environment jsdom
 */

import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EditorProvider } from '../EditorContext';
import {
  PresentationModeControl,
  PresentationModeProvider,
} from '../presentation/PresentationMode';

function Harness({
  allowWindow,
  allowFullscreen,
}: {
  allowWindow?: boolean;
  allowFullscreen?: boolean;
} = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} data-testid="shell">
      <PresentationModeProvider
        rootRef={rootRef}
        allowWindow={allowWindow}
        allowFullscreen={allowFullscreen}
      >
        <PresentationModeControl />
        <div data-testid="content">Preview</div>
      </PresentationModeProvider>
    </div>
  );
}

function renderHarness(props?: { allowWindow?: boolean; allowFullscreen?: boolean }) {
  return render(
    <EditorProvider initialMarkdown="# Presentation" initialView="preview">
      <Harness {...props} />
    </EditorProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PresentationModeControl', () => {
  it('omits presentation destinations disabled by the host', () => {
    renderHarness({ allowWindow: false, allowFullscreen: false });

    expect(screen.getByRole('button', { name: 'Present: Fill Squisq' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Presentation options' })).toBeNull();
    expect(screen.queryByText('New window')).toBeNull();
    expect(screen.queryByText('Browser full screen')).toBeNull();
  });

  it('chooses the launch behavior from an accessible radio menu', () => {
    renderHarness();

    expect(screen.getByRole('button', { name: 'Present: Fill Squisq' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));

    const menu = screen.getByRole('menu', { name: 'Presentation options' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual([
      'Fill SquisqUse the entire Squisq control.',
      'New windowOpen an audience view synced to this one.',
      'Browser full screenBrowser full screen is unavailable.',
    ]);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1]);

    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(items[1], tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(screen.queryByRole('menu', { name: 'Presentation options' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Presentation options' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
    const reopenedMenu = screen.getByRole('menu', { name: 'Presentation options' });

    fireEvent.click(within(reopenedMenu).getByRole('menuitemradio', { name: /New window/ }));
    expect(screen.getByRole('button', { name: 'Present: New window' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Presentation options' })).toBeNull();
  });

  it('fills only the Squisq shell and exits on Escape', async () => {
    renderHarness();
    const shell = screen.getByTestId('shell');
    const launchButton = screen.getByRole('button', { name: 'Present: Fill Squisq' });

    launchButton.focus();
    fireEvent.click(launchButton);
    expect(shell.getAttribute('data-presentation-mode')).toBe('control');
    const exitButton = screen.getByRole('button', { name: 'Exit presentation mode' });
    expect(document.activeElement).toBe(exitButton);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(shell.hasAttribute('data-presentation-mode')).toBe(false));
    expect(screen.getByRole('button', { name: 'Present: Fill Squisq' })).toBeTruthy();
    expect(document.activeElement).toBe(launchButton);
  });

  it('tracks native fullscreen exit from the browser', async () => {
    const originalRequest = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'requestFullscreen',
    );
    const originalExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    const originalElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    let fullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
      }),
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });

    try {
      renderHarness();
      fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
      fireEvent.click(
        screen.getByRole('menuitemradio', { name: /Browser full screen.*Use the browser/ }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Present: Browser full screen' }));

      const shell = screen.getByTestId('shell');
      await waitFor(() => expect(requestFullscreen).toHaveBeenCalledWith());
      await waitFor(() => expect(shell.getAttribute('data-presentation-mode')).toBe('fullscreen'));

      fullscreenElement = null;
      fireEvent(document, new Event('fullscreenchange'));
      await waitFor(() => expect(shell.hasAttribute('data-presentation-mode')).toBe(false));
    } finally {
      if (originalRequest) {
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', originalRequest);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
      }
      if (originalExit) Object.defineProperty(document, 'exitFullscreen', originalExit);
      else Reflect.deleteProperty(document, 'exitFullscreen');
      if (originalElement) Object.defineProperty(document, 'fullscreenElement', originalElement);
      else Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });

  it('keeps fullscreen presentation active when browser exit is rejected', async () => {
    const originalRequest = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'requestFullscreen',
    );
    const originalExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    const originalElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    let fullscreenElement: Element | null = null;
    let requestedRoot: Element | null = null;
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = requestedRoot;
      }),
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(async () => {
        throw new Error('exit denied');
      }),
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });

    try {
      renderHarness();
      requestedRoot = screen.getByTestId('shell');
      fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Browser full screen/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Present: Browser full screen' }));
      await waitFor(() =>
        expect(screen.getByTestId('shell').getAttribute('data-presentation-mode')).toBe(
          'fullscreen',
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Stop presentation' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('could not exit full screen'),
      );
      expect(screen.getByTestId('shell').getAttribute('data-presentation-mode')).toBe('fullscreen');

      fullscreenElement = null;
      fireEvent(document, new Event('fullscreenchange'));
    } finally {
      if (originalRequest) {
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', originalRequest);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
      }
      if (originalExit) Object.defineProperty(document, 'exitFullscreen', originalExit);
      else Reflect.deleteProperty(document, 'exitFullscreen');
      if (originalElement) Object.defineProperty(document, 'fullscreenElement', originalElement);
      else Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });

  it('opens a same-origin audience window and cleans up when it closes', async () => {
    const popupDocument = document.implementation.createHTMLDocument('');
    const popupEvents = new EventTarget();
    let closed = false;
    const popup = {
      document: popupDocument,
      get closed() {
        return closed;
      },
      close: vi.fn(() => {
        closed = true;
      }),
      focus: vi.fn(),
      addEventListener: popupEvents.addEventListener.bind(popupEvents),
      removeEventListener: popupEvents.removeEventListener.bind(popupEvents),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);

    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /New window/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Present: New window' }));

    const shell = screen.getByTestId('shell');
    await waitFor(() => expect(shell.getAttribute('data-presentation-mode')).toBe('window'));
    expect(popupDocument.querySelector('#squisq-presentation-root')).toBeTruthy();
    expect(popupDocument.querySelector('[aria-label="Exit presentation mode"]')).toBeTruthy();

    // Re-selecting the checked destination only closes the menu; it must not
    // tear down the active audience window.
    fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /New window/ }));
    expect(shell.getAttribute('data-presentation-mode')).toBe('window');
    expect(popup.close).not.toHaveBeenCalled();

    popupEvents.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(shell.hasAttribute('data-presentation-mode')).toBe(false));
  });

  it('reports a blocked audience window without entering presentation', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /New window/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Present: New window' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('presentation window was blocked'),
    );
    expect(screen.getByTestId('shell').hasAttribute('data-presentation-mode')).toBe(false);
  });

  it('cleans up when popup initialization fails after the portal is prepared', async () => {
    const popupDocument = document.implementation.createHTMLDocument('');
    const popupEvents = new EventTarget();
    let closed = false;
    const popup = {
      document: popupDocument,
      get closed() {
        return closed;
      },
      close: vi.fn(() => {
        closed = true;
      }),
      focus: vi.fn(() => {
        throw new Error('focus failed');
      }),
      addEventListener: popupEvents.addEventListener.bind(popupEvents),
      removeEventListener: popupEvents.removeEventListener.bind(popupEvents),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);

    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /New window/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Present: New window' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('presentation window was blocked'),
    );
    expect(screen.getByTestId('shell').hasAttribute('data-presentation-mode')).toBe(false);
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popupDocument.querySelector('[aria-label="Exit presentation mode"]')).toBeNull();
  });
});
