import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { PaginatedDocView } from '../PaginatedDocView.js';

function configureScroller(container: HTMLElement, scroller: HTMLElement): void {
  const pageNodes = Array.from(container.querySelectorAll<HTMLElement>('.squisq-paginated-page'));
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(scroller, 'scrollLeft', { configurable: true, writable: true, value: 0 });
  pageNodes.forEach((page, index) => {
    Object.defineProperty(page, 'offsetLeft', { configurable: true, value: index * 100 });
  });
  Object.defineProperty(scroller, 'scrollTo', {
    configurable: true,
    value: ({ left = 0 }: ScrollToOptions) => {
      scroller.scrollLeft = left;
      fireEvent.scroll(scroller);
    },
  });
}

describe('PaginatedDocView', () => {
  it('renders pages with accessible navigation and an indicator', async () => {
    const onPageChange = vi.fn();
    const { container, getByRole } = render(
      <PaginatedDocView
        pages={[
          { key: 'one', label: 'First', content: <p>First page</p> },
          { key: 'two', label: 'Second', content: <p>Second page</p> },
        ]}
        focusOnMount={false}
        onPageChange={onPageChange}
      />,
    );
    const scroller = getByRole('region', { name: 'Document pages' });
    configureScroller(container, scroller);

    expect(container.querySelectorAll('.squisq-paginated-page')).toHaveLength(2);
    expect(container.textContent).toContain('1 / 2');
    fireEvent.click(getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(container.textContent).toContain('2 / 2'));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('supports arrow-key navigation', async () => {
    const { container, getByRole } = render(
      <PaginatedDocView
        pages={[
          { key: 'one', label: 'First', content: 'One' },
          { key: 'two', label: 'Second', content: 'Two' },
        ]}
        focusOnMount={false}
      />,
    );
    const scroller = getByRole('region');
    configureScroller(container, scroller);
    fireEvent.keyDown(scroller, { key: 'ArrowRight' });
    await waitFor(() => expect(container.textContent).toContain('2 / 2'));
    fireEvent.keyDown(scroller, { key: 'ArrowLeft' });
    await waitFor(() => expect(container.textContent).toContain('1 / 2'));
  });

  it('does not let an earlier smooth-scroll frame undo rapid navigation', async () => {
    const { container, getByRole } = render(
      <PaginatedDocView
        pages={[
          { key: 'one', label: 'First', content: 'One' },
          { key: 'two', label: 'Second', content: 'Two' },
          { key: 'three', label: 'Third', content: 'Three' },
        ]}
        focusOnMount={false}
      />,
    );
    const scroller = getByRole('region');
    const pageNodes = Array.from(container.querySelectorAll('.squisq-paginated-page'));
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(scroller, 'scrollTo', { configurable: true, value: vi.fn() });
    pageNodes.forEach((page, index) => {
      Object.defineProperty(page, 'offsetLeft', { configurable: true, value: index * 100 });
    });

    fireEvent.click(getByRole('button', { name: 'Next page' }));
    fireEvent.click(getByRole('button', { name: 'Next page' }));
    scroller.scrollLeft = 100;
    fireEvent.scroll(scroller);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(container.textContent).toContain('1 / 3');
    scroller.scrollLeft = 200;
    fireEvent.scroll(scroller);

    await waitFor(() => expect(container.textContent).toContain('3 / 3'));
  });
});
