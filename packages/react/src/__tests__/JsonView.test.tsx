import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { JsonView } from '../jsonView';
import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';

describe('JsonView', () => {
  it('renders an object schema as labeled rows', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Page Title' },
        active: { type: 'boolean' },
      },
    };
    const { container } = render(
      <JsonView schema={schema} value={{ title: 'Hello', active: true }} />,
    );
    expect(container.textContent).toContain('Page Title');
    expect(container.textContent).toContain('Hello');
    expect(container.textContent).toContain('On');
  });

  it('renders an array of primitives as chips', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'array',
      items: { type: 'string' },
    };
    const { container } = render(<JsonView schema={schema} value={['a', 'b', 'c']} />);
    expect(container.querySelectorAll('.squisq-jv-chip')).toHaveLength(3);
  });

  it('renders an array of objects as cards with itemLabel.fromField', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: { type: 'string' },
        },
        squisq: { itemLabel: { fromField: 'heading' } },
      },
    };
    const { container } = render(
      <JsonView
        schema={schema}
        value={[
          { heading: 'Section A', body: 'Body A' },
          { heading: 'Section B', body: 'Body B' },
        ]}
      />,
    );
    const cards = container.querySelectorAll('.squisq-jv-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Section A');
    expect(cards[1].textContent).toContain('Section B');
  });

  it('renders a color value as a swatch + hex', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'string',
      format: 'color',
    };
    const { container } = render(<JsonView schema={schema} value="#ff0080" />);
    const swatch = container.querySelector('.squisq-jv-color__swatch') as HTMLElement | null;
    expect(swatch).not.toBeNull();
    expect(swatch?.style.background).toContain('rgb(255, 0, 128)');
    expect(container.textContent).toContain('#ff0080');
  });

  it('hides fields whose squisq.hidden rule matches', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: {
        showAuthor: { type: 'boolean' },
        authorName: {
          type: 'string',
          squisq: { hidden: { field: 'showAuthor', truthy: false } },
        },
      },
    };
    const visible = render(
      <JsonView
        schema={schema}
        value={{ showAuthor: true, authorName: 'Alex' }}
      />,
    );
    expect(visible.container.textContent).toContain('Alex');

    const hidden = render(
      <JsonView
        schema={schema}
        value={{ showAuthor: false, authorName: 'Alex' }}
      />,
    );
    expect(hidden.container.textContent).not.toContain('Alex');
  });

  it('renders empty values as the em-dash placeholder', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
    };
    const { container } = render(<JsonView schema={schema} value={{}} />);
    expect(container.textContent).toContain('—');
  });

  it('respects squisq.enumLabels when displaying enum values', () => {
    const schema: SquisqAnnotatedSchema = {
      type: 'string',
      enum: ['s', 'm', 'l'],
      squisq: { enumLabels: { s: 'Small', m: 'Medium', l: 'Large' } },
    };
    const { container } = render(<JsonView schema={schema} value="m" />);
    expect(container.textContent).toContain('Medium');
  });
});
