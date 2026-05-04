/**
 * Built-in Theme Library
 *
 * Loads each built-in theme from its JSON sidecar, validates it, and
 * exports the typed `Theme` constants. The JSON files in this directory
 * are syntactically identical to customizer-authored themes — they just
 * use more of the schema.
 *
 * Validation runs at module init: if a built-in JSON drifts from the
 * schema, the import fails loudly during build / startup.
 */

import type { Theme } from '../Theme.js';
import { assertTheme } from '../themeValidator.js';

import standardJson from './standard.json' with { type: 'json' };
import documentaryJson from './documentary.json' with { type: 'json' };
import minimalistJson from './minimalist.json' with { type: 'json' };
import boldJson from './bold.json' with { type: 'json' };
import morningLightJson from './morning-light.json' with { type: 'json' };
import techDarkJson from './tech-dark.json' with { type: 'json' };
import magazineJson from './magazine.json' with { type: 'json' };
import cinematicJson from './cinematic.json' with { type: 'json' };
import warmEarthJson from './warm-earth.json' with { type: 'json' };
import gezelligJson from './gezellig.json' with { type: 'json' };

export const standard: Theme = assertTheme(standardJson, 'standard.json');
export const documentary: Theme = assertTheme(documentaryJson, 'documentary.json');
export const minimalist: Theme = assertTheme(minimalistJson, 'minimalist.json');
export const bold: Theme = assertTheme(boldJson, 'bold.json');
export const morningLight: Theme = assertTheme(morningLightJson, 'morning-light.json');
export const techDark: Theme = assertTheme(techDarkJson, 'tech-dark.json');
export const magazine: Theme = assertTheme(magazineJson, 'magazine.json');
export const cinematic: Theme = assertTheme(cinematicJson, 'cinematic.json');
export const warmEarth: Theme = assertTheme(warmEarthJson, 'warm-earth.json');
export const gezellig: Theme = assertTheme(gezelligJson, 'gezellig.json');

/** All built-in themes, keyed by id. */
export const BUILTIN_THEMES: Record<string, Theme> = {
  standard,
  documentary,
  minimalist,
  bold,
  'morning-light': morningLight,
  'tech-dark': techDark,
  magazine,
  cinematic,
  'warm-earth': warmEarth,
  gezellig,
};
