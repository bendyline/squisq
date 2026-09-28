import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';

afterEach(cleanup);

function SourceProbe() {
  const { markdownSource } = useEditorContext();
  return <pre data-testid="source">{markdownSource}</pre>;
}

// A catering quote converted from Word: remark escaped every dollar and the
// hashtag line, and the Write view used to show all of those backslashes.
const QUOTE = 'Croissants are \\$3.50 and muffins \\$4.00.\n\n\\#RiseAndCrumb #BakeryLife\n';

describe('WysiwygEditor backslash escapes', () => {
  it('shows escaped characters bare and keeps the escapes in the source', async () => {
    render(
      <EditorProvider initialMarkdown={QUOTE} initialView="wysiwyg">
        <WysiwygEditor />
        <SourceProbe />
      </EditorProvider>,
    );

    const editor = await screen.findByTestId('wysiwyg-editor');
    await waitFor(() => expect(editor.textContent).toContain('$3.50'));
    expect(editor.textContent).toContain('Croissants are $3.50 and muffins $4.00.');
    expect(editor.textContent).toContain('#RiseAndCrumb #BakeryLife');
    expect(editor.textContent).not.toContain('\\');
    // The mark survived Tiptap's schema, so the way back out has it too.
    expect(editor.querySelectorAll('span[data-md-escape]')).toHaveLength(3);
    expect(screen.getByTestId('source').textContent).toContain('\\$3.50 and muffins \\$4.00');
  });
});
