/** @vitest-environment jsdom */
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWidgetRoot } from '../widgetRoot';

afterEach(() => {
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error('widget exploded');
}

describe('mountWidgetRoot', () => {
  it('keeps a widget render error inside the block', async () => {
    // React's development build re-dispatches errors a boundary catches as
    // window error events; production does not. Assert what the boundary
    // owns: the block shows the fallback and the error reached it.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', swallow);
    const container = document.createElement('div');

    await act(async () => {
      mountWidgetRoot(container, 'drawing', createElement(Boom));
    });

    window.removeEventListener('error', swallow);
    expect(container.querySelector('.squisq-widget-error')?.textContent).toContain(
      "This drawing can't be displayed here",
    );
    expect(
      error.mock.calls.some((call) =>
        String(call[0]).includes('[squisq-editor] The drawing widget failed to render:'),
      ),
    ).toBe(true);
  });

  it('does not render another root from inside a render', async () => {
    // ProseMirror builds widget DOM while React renders the editor, so a
    // synchronous root.render there is a nested update React warns about.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    function Host() {
      mountWidgetRoot(container, 'diagram', createElement('span', null, 'drawn'));
      return null;
    }

    await act(async () => {
      render(createElement(Host));
    });

    expect(container.textContent).toBe('drawn');
    expect(
      error.mock.calls.some((call) => String(call[0]).includes('Render methods should be a pure')),
    ).toBe(false);
  });

  it('never renders a widget unmounted before its first render', async () => {
    const container = document.createElement('div');
    await act(async () => {
      const root = mountWidgetRoot(container, 'tree', createElement('span', null, 'late'));
      root.unmount();
    });
    expect(container.textContent).toBe('');
  });
});
