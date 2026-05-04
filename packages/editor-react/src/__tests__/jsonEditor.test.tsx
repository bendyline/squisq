import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';
import { JsonEditor } from '../jsonEditor';

function Controlled<T>({
  schema,
  initial,
  onValueChange,
}: {
  schema: SquisqAnnotatedSchema;
  initial: T;
  onValueChange?: (next: T) => void;
}) {
  const [value, setValue] = useState<T>(initial);
  return (
    <JsonEditor
      schema={schema}
      value={value}
      onChange={(v) => {
        setValue(v as T);
        onValueChange?.(v as T);
      }}
    />
  );
}

describe('JsonEditor', () => {
  it('renders text input and propagates edits through onChange', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: { title: { type: 'string', title: 'Title' } },
    };
    const onChange = vi.fn();
    render(<Controlled schema={schema} initial={{ title: 'Hi' }} onValueChange={onChange} />);
    const input = screen.getByDisplayValue('Hi') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(onChange).toHaveBeenLastCalledWith({ title: 'Hello' });
  });

  it('toggles a boolean via the toggle control', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: { active: { type: 'boolean', title: 'Active' } },
    };
    const onChange = vi.fn();
    render(<Controlled schema={schema} initial={{ active: false }} onValueChange={onChange} />);
    const button = screen.getByRole('button', { pressed: false });
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith({ active: true });
  });

  it('hides fields whose hidden rule matches', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: {
        showAuthor: { type: 'boolean', title: 'Show author' },
        authorName: {
          type: 'string',
          title: 'Author name',
          squisq: { hidden: { field: 'showAuthor', truthy: false } },
        },
      },
    };
    const { container } = render(
      <Controlled schema={schema} initial={{ showAuthor: false, authorName: 'Alex' }} />,
    );
    expect(container.textContent).not.toContain('Author name');
  });

  it('selecting a different segmented option commits the new enum value', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: {
        size: { type: 'string', title: 'Size', enum: ['s', 'm', 'l'] },
      },
    };
    const onChange = vi.fn();
    render(<Controlled schema={schema} initial={{ size: 's' }} onValueChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'l' }));
    expect(onChange).toHaveBeenLastCalledWith({ size: 'l' });
  });

  it('card-stack: + Add appends, × Remove removes, ↑↓ reorder', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          title: 'Sections',
          items: {
            type: 'object',
            properties: { heading: { type: 'string' } },
            squisq: { itemLabel: { fromField: 'heading' } },
          },
          squisq: { control: 'card-stack', addLabel: '+ Add section' },
        },
      },
    };
    const onChange = vi.fn();
    render(
      <Controlled
        schema={schema}
        initial={{ sections: [{ heading: 'A' }, { heading: 'B' }] }}
        onValueChange={onChange}
      />,
    );

    // + Add appends a new empty item.
    fireEvent.click(screen.getByText('+ Add section'));
    expect(onChange).toHaveBeenLastCalledWith({
      sections: [{ heading: 'A' }, { heading: 'B' }, { heading: '' }],
    });

    // × on the first card removes it.
    const removeButtons = screen.getAllByLabelText('Remove');
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenLastCalledWith({
      sections: [{ heading: 'B' }, { heading: '' }],
    });

    // ↓ on the first card reorders.
    const downs = screen.getAllByLabelText('Move down');
    fireEvent.click(downs[0]);
    expect(onChange).toHaveBeenLastCalledWith({
      sections: [{ heading: '' }, { heading: 'B' }],
    });
  });

  it('chip-bin: typing + Enter appends, × removes', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          squisq: { control: 'chip-bin', addLabel: '+ Add tag' },
        },
      },
    };
    const onChange = vi.fn();
    render(<Controlled schema={schema} initial={{ tags: ['one'] }} onValueChange={onChange} />);

    const addInput = screen.getByPlaceholderText('+ Add tag');
    fireEvent.change(addInput, { target: { value: 'two' } });
    fireEvent.keyDown(addInput, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ tags: ['one', 'two'] });

    fireEvent.click(screen.getByLabelText('Remove one'));
    expect(onChange).toHaveBeenLastCalledWith({ tags: ['two'] });
  });

  it('omitting onChange disables every editor', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: { title: { type: 'string', title: 'Title' } },
    };
    const onChange = vi.fn();
    // Use a sniffer onChange we can verify is never called by simulating an
    // attempted change. We render WITHOUT passing onChange to JsonEditor.
    render(<JsonEditor schema={schema} value={{ title: 'Hi' }} />);
    const input = screen.getByDisplayValue('Hi') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'changed' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
