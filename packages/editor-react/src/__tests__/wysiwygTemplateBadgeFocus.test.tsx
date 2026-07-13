import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';

const originalElementsFromPoint = document.elementsFromPoint;
const originalElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => null,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: originalElementsFromPoint,
  });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: originalElementFromPoint,
  });
});

describe('WysiwygEditor inline block-type picker focus', () => {
  it('restores document focus after choosing a block type', async () => {
    render(
      <EditorProvider
        initialMarkdown={'# Heading {[title]}\n\nBody text.\n'}
        initialView="wysiwyg"
        blockTagVisibility="always"
      >
        <WysiwygEditor />
      </EditorProvider>,
    );

    const editor = await screen.findByTestId('wysiwyg-editor');
    const badge = await screen.findByTitle('Change block type');
    fireEvent.mouseDown(badge);

    const search = await screen.findByRole('searchbox', { name: 'Search block types' });
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.click(screen.getByRole('option', { name: /^Quote\b/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });
});
