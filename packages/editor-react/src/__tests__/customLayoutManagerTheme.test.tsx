/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../EditorContext', () => ({
  useEditorContext: () => ({
    colorScheme: 'dark',
    mediaProvider: null,
    doc: null,
    markdownSource: '',
    setMarkdownSource: vi.fn(),
  }),
}));

// The regression is at the manager's portaled theme boundary; the designer's
// interaction surface is unrelated and expensive to mount for this assertion.
vi.mock('../customTemplates/TemplateDesigner', () => ({
  TemplateDesigner: () => <div data-testid="template-designer" />,
}));

import { CustomLayoutManager } from '../customTemplates/CustomLayoutManager';

describe('CustomLayoutManager theme propagation', () => {
  it('copies the editor dark scheme onto its portaled theme scope', () => {
    render(<CustomLayoutManager onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Custom layouts' });
    expect(dialog.getAttribute('data-theme')).toBe('dark');
    expect(dialog.classList.contains('squisq-editor-shell')).toBe(true);
    expect(screen.getByTestId('template-designer')).toBeTruthy();
  });
});
