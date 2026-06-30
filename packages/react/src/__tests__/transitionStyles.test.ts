import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TransitionDirection, TransitionType } from '@bendyline/squisq/schemas';
import { TRANSITION_TYPES } from '@bendyline/squisq/schemas';
import { getTransitionClass } from '../utils/animationUtils';

const transitionCss = readFileSync(
  resolve(process.cwd(), 'packages/react/src/styles/doc-animations.css'),
  'utf8',
);

const directionalTypes: TransitionType[] = [
  'cover',
  'pan',
  'pull',
  'push',
  'reveal',
  'strips',
  'uncover',
  'wipe',
];

const axisTypes: TransitionType[] = ['blinds', 'comb', 'randomBar', 'randomBars', 'split'];
const cardinalDirections = [
  'left',
  'right',
  'up',
  'down',
] as const satisfies readonly TransitionDirection[];
const axisDirections = ['horizontal', 'vertical'] as const satisfies readonly TransitionDirection[];

function collectGeneratedTransitionClasses(): string[] {
  const classNames = new Set<string>();

  for (const type of TRANSITION_TYPES) {
    if (type === 'cut') continue;
    classNames.add(getTransitionClass(type, true));
    classNames.add(getTransitionClass(type, false));
  }

  for (const type of directionalTypes) {
    for (const direction of cardinalDirections) {
      classNames.add(getTransitionClass(type, true, direction));
      classNames.add(getTransitionClass(type, false, direction));
    }
  }

  for (const type of axisTypes) {
    for (const direction of axisDirections) {
      classNames.add(getTransitionClass(type, true, direction));
      classNames.add(getTransitionClass(type, false, direction));
    }
  }

  return [...classNames].sort();
}

describe('transition CSS coverage', () => {
  it('contains enter and exit selectors for every generated transition class', () => {
    for (const className of collectGeneratedTransitionClasses()) {
      expect(transitionCss, className).toContain(`.${className}`);
    }
  });
});
