import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  EditorInsertMenuItems,
  EditorInsertMenuProvider,
  useEditorInsertMenuItems,
} from '../InsertMenuItems';

function Actions({ disabled, onSelect }: { disabled: boolean; onSelect: () => void }) {
  useEditorInsertMenuItems([{ id: 'speech', label: 'Text from narration', disabled, onSelect }]);
  return null;
}
function Harness({
  disabled = false,
  onSelect = () => undefined,
  show = true,
}: {
  disabled?: boolean;
  onSelect?: () => void;
  show?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <EditorInsertMenuProvider>
      {show && <Actions disabled={disabled} onSelect={onSelect} />}
      <button onClick={() => setOpen(true)}>Insert</button>
      {open && <EditorInsertMenuItems onClose={() => setOpen(false)} />}
    </EditorInsertMenuProvider>
  );
}
afterEach(cleanup);
describe('host Insert actions', () => {
  it('opens a host action and closes the Insert menu', () => {
    const select = vi.fn();
    render(<Harness onSelect={select} />);
    fireEvent.click(screen.getByText('Insert'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Text from narration' }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
  it('uses the latest callback and removes unmounted registrations', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Harness onSelect={first} />);
    view.rerender(<Harness onSelect={second} />);
    fireEvent.click(screen.getByText('Insert'));
    fireEvent.click(screen.getByRole('menuitem'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    view.rerender(<Harness show={false} />);
    fireEvent.click(screen.getByText('Insert'));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
  it('does not invoke disabled actions', () => {
    const select = vi.fn();
    render(<Harness disabled onSelect={select} />);
    fireEvent.click(screen.getByText('Insert'));
    fireEvent.click(screen.getByRole('menuitem'));
    expect(select).not.toHaveBeenCalled();
  });
});
