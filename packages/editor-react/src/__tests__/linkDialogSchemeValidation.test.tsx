/**
 * @vitest-environment jsdom
 *
 * The link dialog used to accept any string as a URL. Typing
 * `javascript:alert(1)` inserted it verbatim — in the Raw/Monaco path
 * straight into the markdown as `[text](javascript:…)`.
 *
 * That was never a live XSS: core's `sanitizeUrl` refuses
 * javascript/vbscript/data (even via `extraLinkSchemes`), and
 * `MarkdownRenderer` re-sanitizes every href at RENDER time, so the link
 * is inert in the player and in exported standalone HTML. The real defect
 * was silence — the author was allowed to write a link that would never
 * resolve anywhere, with no feedback.
 *
 * These tests pin the dialog to core's policy rather than a hand-rolled
 * copy of it, which is the part that could drift.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { sanitizeUrl } from '@bendyline/squisq/markdown';
import { LinkDialog } from '../LinkDialog';

function renderDialog(props: Partial<React.ComponentProps<typeof LinkDialog>> = {}): {
  onConfirm: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  render(
    <LinkDialog
      mode="insert"
      initialText="click me"
      initialUrl=""
      onConfirm={onConfirm}
      onClose={() => {}}
      {...props}
    />,
  );
  return { onConfirm };
}

const urlField = () => screen.getByPlaceholderText('https://example.com');
const submitBtn = () => screen.getByRole('button', { name: 'Insert' });

function typeUrl(value: string): void {
  fireEvent.change(urlField(), { target: { value } });
}

describe('LinkDialog — URL scheme validation', () => {
  it('blocks javascript: with a visible error instead of silently confirming', () => {
    const { onConfirm } = renderDialog();
    typeUrl('javascript:alert(1)');

    const error = screen.getByRole('alert');
    expect(error.textContent).toContain('javascript:');
    expect(urlField().getAttribute('aria-invalid')).toBe('true');
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);

    // Enter must not smuggle it past the disabled button.
    fireEvent.submit(urlField().closest('form')!);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each(['vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://host/f'])(
    'blocks %s — exactly what the renderer would drop',
    (bad) => {
      // Premise guard: this suite is only meaningful if core also refuses it.
      expect(sanitizeUrl(bad, 'link')).toBeNull();
      const { onConfirm } = renderDialog();
      typeUrl(bad);
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.click(submitBtn());
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['https://example.com', 'absolute http(s)'],
    ['mailto:a@b.com', 'mailto'],
    ['tel:+15551234', 'tel'],
    ['#section', 'in-page anchor'],
    ['resume.md', 'relative sibling'],
    ['./notes/x.md', 'explicit relative'],
    ['../parent.md', 'parent relative'],
  ])('still allows %s (%s)', (good) => {
    // Premise guard: the renderer keeps these, so the dialog must too.
    expect(sanitizeUrl(good, 'link')).not.toBeNull();
    const { onConfirm } = renderDialog();
    typeUrl(good);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submitBtn());
    expect(onConfirm).toHaveBeenCalledWith('click me', good);
  });

  it('does not nag before a scheme is even typed', () => {
    renderDialog();
    typeUrl('java'); // no colon yet — not a scheme, just a relative path so far
    expect(screen.queryByRole('alert')).toBeNull();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(false);
  });

  it('leaves an empty URL alone — callers read it as unlink / no-op', () => {
    const { onConfirm } = renderDialog({ mode: 'update', initialUrl: 'https://example.com' });
    typeUrl('');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onConfirm).toHaveBeenCalledWith('click me', '');
  });

  it('honors a host scheme via linkSchemes, matching what that host will render', () => {
    // Without the allowance the renderer drops it, so the dialog must object…
    expect(sanitizeUrl('workspace-nav:src/a.ts', 'link')).toBeNull();
    const { onConfirm } = renderDialog();
    typeUrl('workspace-nav:src/a.ts');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('accepts a host scheme when the host declared it', () => {
    const { onConfirm } = renderDialog({ linkSchemes: ['workspace-nav'] });
    typeUrl('workspace-nav:src/a.ts');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(submitBtn());
    expect(onConfirm).toHaveBeenCalledWith('click me', 'workspace-nav:src/a.ts');
  });

  it('refuses javascript: even when a host tries to allow it via linkSchemes', () => {
    // core's NEVER_ALLOWED_SCHEMES wins over extraLinkSchemes; because the
    // dialog defers to core rather than keeping its own list, it inherits that
    // guarantee instead of having to restate it.
    expect(
      sanitizeUrl('javascript:alert(1)', 'link', { extraLinkSchemes: ['javascript'] }),
    ).toBeNull();
    const { onConfirm } = renderDialog({ linkSchemes: ['javascript'] });
    typeUrl('javascript:alert(1)');
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(submitBtn());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('recovers: fixing the URL re-enables Insert', () => {
    const { onConfirm } = renderDialog();
    typeUrl('javascript:alert(1)');
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
    typeUrl('https://example.com');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(submitBtn());
    expect(onConfirm).toHaveBeenCalledWith('click me', 'https://example.com');
  });
});
