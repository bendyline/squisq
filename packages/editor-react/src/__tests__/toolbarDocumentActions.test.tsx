/**
 * @vitest-environment jsdom
 */
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { EditorProvider } from '../EditorContext';
import { Toolbar } from '../Toolbar';
import { useToolbarDocumentAction } from '../toolbar/DocumentActions';

const BUTTON_WIDTH = 30;
const ROW_HEIGHT = 28;
// The lane in these tests holds Insert and thirteen formatting buttons, all
// 30px wide; jsdom has no stylesheet, so gaps and separators measure zero.
const LANE_WIDTH = 200;
// Three built-in document actions, open; and the folded menu's trigger.
const GROUP_OPEN = 3 * BUTTON_WIDTH;
const GROUP_FOLDED = 45;

function rect(left: number, right: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right,
    top: 0,
    bottom: ROW_HEIGHT,
    width: right - left,
    height: ROW_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect;
}

const EMPTY_RECT = { ...rect(0, 0), bottom: 0, height: 0 } as DOMRect;

function laneButtons(element: Element): HTMLElement[] {
  const container = element.closest('.squisq-toolbar-actions');
  if (!container) return [];
  return [
    ...container.querySelectorAll<HTMLElement>(
      ':scope > .squisq-toolbar-group:not(.squisq-toolbar-contextual) > .squisq-toolbar-button',
    ),
  ];
}

/**
 * Lay the row out: the lane `laneWidth` wide with its buttons in a row, then
 * the document-actions group on the same row — `open` wide, or `folded` wide
 * once folded — plus `transient` px of content that stays in either state.
 */
function layOut({
  laneWidth = LANE_WIDTH,
  open = GROUP_OPEN,
  folded = GROUP_FOLDED,
  transient = 0,
}: { laneWidth?: number; open?: number; folded?: number; transient?: number } = {}): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    if (this.classList.contains('squisq-toolbar-actions')) return rect(0, laneWidth);
    if (this.getAttribute('data-toolbar-item') === 'documentActions') {
      const width =
        (this.getAttribute('data-toolbar-folded') === 'true' ? folded : open) + transient;
      return rect(laneWidth, laneWidth + width);
    }
    if (this.hasAttribute('data-toolbar-transient')) return rect(0, transient);
    if (this.classList.contains('squisq-toolbar-button')) {
      const ordinal = laneButtons(this).indexOf(this as HTMLElement);
      if (ordinal >= 0) return rect(ordinal * BUTTON_WIDTH, (ordinal + 1) * BUTTON_WIDTH);
    }
    return EMPTY_RECT;
  });
}

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function overflowed(name: string): boolean {
  return screen
    .getByRole('button', { name, hidden: true })
    .classList.contains('squisq-toolbar-button--overflowed');
}

function group(): HTMLElement {
  return screen.getByRole('group', { name: 'Document actions' });
}

function isFolded(): boolean {
  return group().getAttribute('data-toolbar-folded') === 'true';
}

function openDocumentMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Document actions' }));
  const menu = document.querySelector<HTMLElement>('.squisq-toolbar-document-menu');
  expect(menu).not.toBeNull();
  return menu!;
}

function menuRows(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

/** A host document action with a menu of its own, like DocBlocks' Export. */
function HostExport({ onPdf }: { onPdf: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { folded, submenuContainer, closeMenu } = useToolbarDocumentAction(
    { id: 'export', label: 'Export', submenu: true },
    ref,
  );
  const items: ReactNode = (
    <>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          closeMenu();
          onPdf();
        }}
      >
        PDF
      </button>
      <button type="button" role="menuitem" tabIndex={-1} disabled>
        Word
      </button>
    </>
  );
  return (
    <div ref={ref}>
      {!folded && (
        <button type="button" className="squisq-toolbar-button" aria-label="Export">
          E
        </button>
      )}
      {submenuContainer && createPortal(items, submenuContainer)}
    </div>
  );
}

/** A host action whose playback controls stay on the row while folded. */
function HostTransport() {
  const ref = useRef<HTMLDivElement>(null);
  useToolbarDocumentAction({ id: 'speech', label: 'Read aloud', submenu: true }, ref);
  return (
    <div ref={ref}>
      <div data-toolbar-transient="" role="group" aria-label="Reading aloud" />
    </div>
  );
}

function renderToolbar(slotDocumentActions?: ReactNode) {
  render(
    <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
      <Toolbar slotDocumentActions={slotDocumentActions} />
    </EditorProvider>,
  );
}

describe('<Toolbar> document actions', () => {
  it('sits behind one divider and stays open when the row has room', () => {
    layOut({ laneWidth: 10_000 });
    renderToolbar();

    expect(isFolded()).toBe(false);
    expect(group().firstElementChild!.classList).toContain('squisq-toolbar-separator');
    expect(overflowed('Document settings')).toBe(false);
    expect(overflowed('Custom layouts')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Document actions' })).toBeNull();
  });

  it('folds as one menu before giving up lists and headings', () => {
    // Open, the group would cost Numbered list and Heading 2 as well;
    // folded, only Heading 3 has to go.
    layOut();
    renderToolbar();

    expect(isFolded()).toBe(true);
    expect(overflowed('Document settings')).toBe(true);
    expect(overflowed('Custom layouts')).toBe(true);
    expect(screen.getByRole('button', { name: 'Document actions' })).toBeTruthy();
    expect(overflowed('Heading 3')).toBe(true);
    expect(overflowed('Numbered list')).toBe(false);
    expect(overflowed('Heading 2')).toBe(false);
    expect(overflowed('Insert')).toBe(false);
  });

  it('keeps the folded actions out of the ··· menu', () => {
    layOut();
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const overflow = document.querySelector<HTMLElement>('.squisq-toolbar-overflow-menu')!;
    expect(within(overflow).queryByText('Document settings')).toBeNull();
    expect(within(overflow).queryByText('Custom layouts')).toBeNull();
  });

  it('lists the actions in row order and runs one that is chosen', () => {
    layOut();
    renderToolbar(<HostExport onPdf={() => {}} />);

    const menu = openDocumentMenu();
    expect(menuRows(menu)).toEqual(['Document settings', 'Custom layouts', 'Export']);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Document settings' }));
    expect(document.querySelector('.squisq-toolbar-document-menu')).toBeNull();
    expect(screen.getByRole('dialog', { name: /document settings/i })).toBeTruthy();
  });

  it("drills into a host action's own menu and back", () => {
    layOut();
    const onPdf = vi.fn();
    renderToolbar(<HostExport onPdf={onPdf} />);

    let menu = openDocumentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export' }));
    menu = document.querySelector<HTMLElement>('.squisq-toolbar-document-menu')!;
    expect(menuRows(menu)).toEqual(['Export', 'PDF', 'Word']);
    expect(menu.getAttribute('aria-label')).toBe('Export');

    fireEvent.click(within(menu).getByRole('menuitem', { name: /back to document actions/i }));
    expect(menuRows(menu)).toEqual(['Document settings', 'Custom layouts', 'Export']);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'PDF' }));
    expect(onPdf).toHaveBeenCalledOnce();
    expect(document.querySelector('.squisq-toolbar-document-menu')).toBeNull();
  });

  it('steps back out of a submenu on Escape, then closes', () => {
    layOut();
    renderToolbar(<HostExport onPdf={() => {}} />);

    const menu = openDocumentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export' }));
    fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'PDF' }), { key: 'Escape' });
    expect(menuRows(menu)).toEqual(['Document settings', 'Custom layouts', 'Export']);

    fireEvent.keyDown(document.activeElement ?? menu, { key: 'Escape' });
    expect(document.querySelector('.squisq-toolbar-document-menu')).toBeNull();
  });

  it('pins the menu by its trigger-side edges, so a submenu grows away from the trigger', () => {
    layOut();
    renderToolbar(<HostExport onPdf={() => {}} />);

    const menu = openDocumentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export' }));
    // Right edge pinned and no height cap taken from the shorter top level:
    // content a host portals in later grows the box leftwards and down.
    expect(menu.style.left).toBe('auto');
    expect(menu.style.right).not.toBe('');
    expect(menu.style.bottom).toBe('auto');
    expect(Number.parseFloat(menu.style.maxHeight)).toBe(window.innerHeight - 12);
  });

  it('focuses the first submenu item once the host has rendered it', async () => {
    layOut();
    renderToolbar(<HostExport onPdf={() => {}} />);

    const menu = openDocumentMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'PDF' })),
    );
  });

  it('tells a host action to hide its own button while folded', () => {
    layOut({ laneWidth: 10_000 });
    renderToolbar(<HostExport onPdf={() => {}} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();

    vi.restoreAllMocks();
    layOut();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(isFolded()).toBe(true);
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('closes on a pointer press outside the group and its menu', () => {
    layOut();
    renderToolbar();
    const menu = openDocumentMenu();

    fireEvent.pointerDown(menu.querySelector('[role="menuitem"]')!);
    expect(document.querySelector('.squisq-toolbar-document-menu')).not.toBeNull();

    const canvas = document.createElement('div');
    document.body.appendChild(canvas);
    fireEvent.pointerDown(canvas);
    expect(document.querySelector('.squisq-toolbar-document-menu')).toBeNull();
  });

  it('leaves transient content out of the measurement', () => {
    // A 200px read-aloud transport sits in the group in both states. Counted
    // as part of the group it would make folding look like enough on its own;
    // left out, the row needs Heading 3 gone too, as without the transport.
    layOut({ transient: 200 });
    renderToolbar(<HostTransport />);

    expect(isFolded()).toBe(true);
    expect(overflowed('Heading 3')).toBe(true);
    expect(overflowed('Numbered list')).toBe(false);
  });

  it('opens Version history from the folded menu', async () => {
    layOut();
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <EditorProvider
        initialMarkdown="Intro"
        initialView="raw"
        allowRecording={false}
        workspaceContainer={container}
        allowVersioning
      >
        <Toolbar />
      </EditorProvider>,
    );

    expect(overflowed('Version history')).toBe(true);
    const menu = openDocumentMenu();
    expect(menuRows(menu)).toEqual(['Document settings', 'Custom layouts', 'Version history']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Version history' }));
    expect(await screen.findByRole('dialog', { name: 'Version history' })).toBeTruthy();
  });
});
