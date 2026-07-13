import { describe, expect, it } from 'vitest';
import {
  selectionToTable,
  selectionToTableMarkdown,
  selectionToTaskItems,
  selectionToTaskListMarkdown,
} from '../selectionConversions';

describe('selectionToTable', () => {
  it('detects consistently pipe-delimited rows, including outer pipes', () => {
    expect(selectionToTable('| Name | Role |\n| Ada | Engineer |')).toEqual({
      delimiter: 'pipe',
      rows: [
        ['Name', 'Role'],
        ['Ada', 'Engineer'],
      ],
    });
  });

  it('detects CSV rows without splitting quoted commas', () => {
    expect(selectionToTable('Name,Notes\nAda,"Math, logic"')).toEqual({
      delimiter: 'comma',
      rows: [
        ['Name', 'Notes'],
        ['Ada', 'Math, logic'],
      ],
    });
  });

  it('retains literal quotes in comma-delimited cells', () => {
    expect(selectionToTable('Item,Size\nDisplay,5" screen').rows[1]).toEqual([
      'Display',
      '5" screen',
    ]);
  });

  it.each([
    ['tab', 'Name\tRole\nAda\tEngineer'],
    ['multispace', 'Name    Role\nAda     Engineer'],
  ] as const)('detects %s-delimited rows', (delimiter, text) => {
    expect(selectionToTable(text)).toEqual({
      delimiter,
      rows: [
        ['Name', 'Role'],
        ['Ada', 'Engineer'],
      ],
    });
  });

  it('falls back to one column when delimiter counts are inconsistent', () => {
    expect(selectionToTable('One,Two\nThree\nFour,Five,Six')).toEqual({
      delimiter: null,
      rows: [['One,Two'], ['Three'], ['Four,Five,Six']],
    });
  });

  it('uses the first row as the Markdown header and escapes cell pipes', () => {
    expect(selectionToTableMarkdown('Name,Notes\nAda,A | B')).toBe(
      '| Name | Notes |\n| --- | --- |\n| Ada | A \\| B |',
    );
  });
});

describe('selectionToTaskListMarkdown', () => {
  it('turns non-empty selected lines into unchecked tasks', () => {
    expect(selectionToTaskListMarkdown('Buy milk\n\nCall Sam')).toBe(
      '- [ ] Buy milk\n- [ ] Call Sam',
    );
  });

  it('normalizes list markers and retains existing checked state', () => {
    const text = '- first\n2. second\n- [x] already done';
    expect(selectionToTaskItems(text)).toEqual([
      { checked: false, text: 'first' },
      { checked: false, text: 'second' },
      { checked: true, text: 'already done' },
    ]);
    expect(selectionToTaskListMarkdown(text)).toBe('- [ ] first\n- [ ] second\n- [x] already done');
  });
});
