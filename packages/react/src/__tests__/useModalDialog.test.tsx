import { fireEvent, render } from '@testing-library/react';
import { useRef, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useModalDialog } from '../hooks/useModalDialog';

interface DialogProps {
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  empty?: boolean;
}

function Dialog({ onClose, returnFocusRef, empty = false }: DialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  useModalDialog({ rootRef, dialogRef, initialFocusRef, returnFocusRef, onClose });

  return (
    <div ref={rootRef} data-testid="modal-root">
      <div ref={dialogRef} role="dialog" tabIndex={-1}>
        {empty ? null : (
          <>
            <input ref={initialFocusRef} defaultValue="selected text" />
            <button type="button">Last action</button>
          </>
        )}
      </div>
    </div>
  );
}

function Fixture({ open = true, onClose = () => undefined, empty = false }) {
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={openerRef} data-testid="opener" aria-hidden="false">
        Open
      </button>
      {open ? <Dialog onClose={onClose} returnFocusRef={openerRef} empty={empty} /> : null}
    </>
  );
}

function StackedDialogs({
  first = true,
  second = true,
  onFirstClose = vi.fn(),
  onSecondClose = vi.fn(),
}) {
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={openerRef} data-testid="opener">
        Open
      </button>
      {first && <Dialog returnFocusRef={openerRef} onClose={onFirstClose} />}
      {second && <Dialog returnFocusRef={openerRef} onClose={onSecondClose} />}
    </>
  );
}

function HiddenControlsDialog() {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog({ rootRef, dialogRef, onClose: vi.fn() });
  return (
    <div ref={rootRef}>
      <div ref={dialogRef} role="dialog" tabIndex={-1}>
        <div style={{ display: 'none' }}>
          <button>Hidden first</button>
        </div>
        <button>Visible first</button>
        <button>Visible last</button>
        <button tabIndex={-1}>Not a tab stop</button>
        <div hidden>
          <button>Hidden last</button>
        </div>
      </div>
    </div>
  );
}

describe('useModalDialog', () => {
  it('gives a child popover first refusal of Escape', () => {
    const onClose = vi.fn();
    const view = render(<Fixture onClose={onClose} />);
    const input = view.getByRole('textbox');
    input.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('only dismisses the top dialog and preserves isolation during out-of-order removal', () => {
    const onFirstClose = vi.fn();
    const onSecondClose = vi.fn();
    const view = render(
      <StackedDialogs onFirstClose={onFirstClose} onSecondClose={onSecondClose} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onFirstClose).not.toHaveBeenCalled();
    expect(onSecondClose).toHaveBeenCalledOnce();
    view.rerender(<StackedDialogs first={false} />);
    expect(view.getByTestId('opener').inert).toBe(true);
    view.rerender(<StackedDialogs first={false} second={false} />);
    expect(view.getByTestId('opener').inert).toBe(false);
    expect(view.getByTestId('opener').hasAttribute('aria-hidden')).toBe(false);
  });

  it('skips hidden descendants and negative tabindex controls when wrapping focus', () => {
    const view = render(<HiddenControlsDialog />);
    const first = view.getByRole('button', { name: 'Visible first' });
    const last = view.getByRole('button', { name: 'Visible last' });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
  it('focuses and selects the initial field, isolates siblings, then restores both', () => {
    const view = render(<Fixture />);
    const opener = view.getByTestId('opener');
    const input = view.getByRole('textbox') as HTMLInputElement;

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(opener.inert).toBe(true);
    expect(opener.getAttribute('aria-hidden')).toBe('true');

    view.rerender(<Fixture open={false} />);

    expect(opener.inert).toBe(false);
    expect(opener.getAttribute('aria-hidden')).toBe('false');
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape and prevents the key event', () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(onClose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('wraps Tab focus in both directions and recovers focus from outside', () => {
    const view = render(<Fixture />);
    const input = view.getByRole('textbox');
    const last = view.getByRole('button', { name: 'Last action' });
    const opener = view.getByTestId('opener');

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);

    input.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    opener.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });

  it('focuses the dialog itself when it has no focusable children', () => {
    const view = render(<Fixture empty />);
    const dialog = view.getByRole('dialog');

    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });
});
