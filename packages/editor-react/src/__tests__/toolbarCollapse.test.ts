import { describe, expect, it } from 'vitest';
import { BUTTONS } from '../toolbar/toolbarButtons';
import {
  TOOLBAR_COLLAPSE_ORDER,
  chooseCollapsedItems,
  requiredRowWidth,
  type CollapseLayout,
} from '../toolbar/toolbarCollapse';

const LANE: CollapseLayout['groups'] = [
  { items: ['bold', 'italic', 'strikethrough'], separated: true },
  { items: ['ul', 'ol'], separated: true },
  { items: ['h1', 'h2', 'h3'], separated: true },
  { items: ['quote', 'code', 'superscript', 'subscript', 'hr'], separated: true },
  { items: ['insert'], separated: true },
];

function layout(budget: number, overrides: Partial<CollapseLayout> = {}): CollapseLayout {
  return {
    groups: LANE,
    chrome: [],
    widthOf: () => 32,
    separatorWidth: 13,
    groupGap: 2,
    laneGap: 2,
    rowGap: 1,
    triggerWidth: 32,
    budget,
    ...overrides,
  };
}

describe('TOOLBAR_COLLAPSE_ORDER', () => {
  it('gives every inline toolbar button a deliberate priority', () => {
    const inline = BUTTONS.filter((b) => b.group !== 'media').map((b) => b.id);
    expect(inline.filter((id) => !TOOLBAR_COLLAPSE_ORDER.includes(id))).toEqual([]);
  });

  it('drops Subscript and Superscript first and Insert last', () => {
    const buttons = TOOLBAR_COLLAPSE_ORDER.filter((id) => !id.startsWith('contextual:'));
    expect(buttons.slice(0, 2)).toEqual(['subscript', 'superscript']);
    expect(TOOLBAR_COLLAPSE_ORDER[TOOLBAR_COLLAPSE_ORDER.length - 1]).toBe('insert');
  });
});

describe('chooseCollapsedItems', () => {
  it('collapses nothing when everything fits', () => {
    const all = layout(10_000);
    expect(chooseCollapsedItems(all).size).toBe(0);
    expect(requiredRowWidth(all, new Set())).toBeLessThan(10_000);
  });

  it('collapses a prefix of the priority order as the row narrows', () => {
    let previous = new Set<string>();
    for (let budget = 700; budget >= 0; budget -= 10) {
      const collapsed = chooseCollapsedItems(layout(budget));
      for (const id of previous) expect(collapsed.has(id)).toBe(true);
      const ranked = TOOLBAR_COLLAPSE_ORDER.filter((id) => LANE.some((g) => g.items.includes(id)));
      expect([...collapsed].sort()).toEqual(ranked.slice(0, collapsed.size).sort());
      previous = collapsed;
    }
    expect(previous.has('insert')).toBe(true);
  });

  it('frees a separator along with the last button of its group', () => {
    const lane = layout(0);
    const withQuoteGroup = requiredRowWidth(
      lane,
      new Set(['code', 'superscript', 'subscript', 'hr']),
    );
    const withoutQuoteGroup = requiredRowWidth(
      lane,
      new Set(['quote', 'code', 'superscript', 'subscript', 'hr']),
    );
    // The button (32), its separator and the gap after it (13 + 2), and the
    // gap between groups (2).
    expect(withQuoteGroup - withoutQuoteGroup).toBe(32 + 15 + 2);
  });

  it('reserves room for the ··· trigger once anything collapses', () => {
    const lane = layout(0);
    const everything = requiredRowWidth(lane, new Set());
    const oneOut = requiredRowWidth(lane, new Set(['subscript']));
    expect(oneOut).toBe(everything - (32 + 2) + (32 + 1));
  });

  it('counts collapsible chrome toward the row and collapses it in priority order', () => {
    const withChrome = layout(400, { chrome: ['layouts', 'docSettings', 'files'] });
    const collapsed = chooseCollapsedItems(withChrome);
    expect(collapsed.has('layouts')).toBe(true);
    expect(collapsed.has('insert')).toBe(false);
    expect(collapsed.has('bold')).toBe(false);
  });

  it('collapses ids without a priority before every ranked one', () => {
    const lane = layout(0, { groups: [...LANE, { items: ['future-button'], separated: true }] });
    const budget = requiredRowWidth(lane, new Set(['future-button']));
    expect([...chooseCollapsedItems({ ...lane, budget })]).toEqual(['future-button']);
  });
});
