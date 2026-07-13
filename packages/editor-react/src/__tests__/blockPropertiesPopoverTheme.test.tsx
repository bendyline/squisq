import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlockPropertiesPopover } from '../BlockPropertiesPopover';
import { TRANSITION_FLYOUT_PORTAL_ID } from '../TransitionPicker';

describe('BlockPropertiesPopover theme propagation', () => {
  it('copies dark mode and the document accent onto both portal roots', async () => {
    render(
      <BlockPropertiesPopover
        anchorRect={new DOMRect(20, 20, 20, 20)}
        blockAttrs={null}
        templateParams={null}
        colorScheme="dark"
        accentColor="#c2410c"
        onChange={vi.fn()}
        onAnnotationChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('dialog', { name: 'Block properties' });
    expect(panel.getAttribute('data-theme')).toBe('dark');
    expect(panel.style.getPropertyValue('--squisq-block-props-accent')).toBe('#c2410c');

    fireEvent.click(screen.getByRole('button', { name: /Transition:/ }));

    await waitFor(() => {
      const flyout = document.getElementById(TRANSITION_FLYOUT_PORTAL_ID);
      expect(flyout?.getAttribute('data-theme')).toBe('dark');
      expect(flyout?.style.getPropertyValue('--squisq-block-props-accent')).toBe('#c2410c');
    });
  });
});
