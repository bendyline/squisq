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

/** All `@keyframes <name>` defined in the stylesheet. */
function definedKeyframes(): Set<string> {
  const names = new Set<string>();
  for (const m of transitionCss.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Map each `.transition-<x>-(enter|exit)` selector to the keyframe its rule
 * animates. Parses top-level `selectors { body }` blocks and reads the first
 * identifier of the `animation:` shorthand. Returns null for a transition rule
 * with no `animation` property (itself a defect).
 */
function transitionRuleKeyframes(): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rule: RegExpExecArray | null;
  while ((rule = ruleRe.exec(transitionCss)) !== null) {
    const selectors = rule[1].split(',').map((s) => s.trim());
    const transitionSelectors = selectors.filter((s) =>
      /\.transition-[A-Za-z0-9-]+-(?:enter|exit)\b/.test(s),
    );
    if (transitionSelectors.length === 0) continue;
    const animMatch = rule[2].match(/animation:\s*([A-Za-z0-9_-]+)/);
    const keyframe = animMatch ? animMatch[1] : null;
    for (const selector of transitionSelectors) {
      const classMatch = selector.match(/\.(transition-[A-Za-z0-9-]+-(?:enter|exit))/);
      if (classMatch && !map.has(classMatch[1])) map.set(classMatch[1], keyframe);
    }
  }
  return map;
}

describe('transition keyframe integrity', () => {
  it('every transition rule animates a defined @keyframes (catches typos)', () => {
    const keyframes = definedKeyframes();
    const broken: string[] = [];
    for (const [selector, keyframe] of transitionRuleKeyframes()) {
      if (keyframe === null) broken.push(`${selector}: no animation property`);
      else if (!keyframes.has(keyframe)) broken.push(`${selector}: missing @keyframes ${keyframe}`);
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('every generated transition class resolves to a defined keyframe', () => {
    // Ties the function output to the CSS end-to-end: a class the player can
    // emit must have a rule, and that rule must animate a real keyframe.
    const keyframes = definedKeyframes();
    const rules = transitionRuleKeyframes();
    for (const className of collectGeneratedTransitionClasses()) {
      const keyframe = rules.get(className);
      expect(keyframe, `${className} has no transition rule`).toBeDefined();
      expect(keyframe, `${className} animates undefined keyframe ${keyframe}`).not.toBeNull();
      if (keyframe) expect(keyframes.has(keyframe), `${className} -> ${keyframe}`).toBe(true);
    }
  });
});
