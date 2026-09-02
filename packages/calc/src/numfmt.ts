/**
 * The TEXT() number-format subset: digit patterns (`0`/`#`), thousands
 * separators, decimals, percent, literal segments, and the common date/time
 * tokens. Deliberately NOT a full ECMA-376 formatter — full section
 * handling (positive;negative;zero;text), colors, fractions, and
 * scientific patterns are out of scope for this tier; unknown patterns
 * return null and TEXT degrades to #NUM! per its contract here.
 */

import { datePartsFromSerial, timePartsFromSerial } from './dates.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const two = (n: number): string => String(n).padStart(2, '0');

function isDatePattern(pattern: string): boolean {
  const cleaned = pattern.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(cleaned) && !/^[#0.,%\s-]*$/.test(cleaned);
}

function weekdayOf(serial: number, date1904: boolean): number {
  // Serial 1 (1900-01-01) was a Monday; the phantom Feb 29 shifts nothing
  // here because we compute from the resolved calendar date.
  const parts = datePartsFromSerial(serial, date1904);
  if (!parts) return 0;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function formatDate(serial: number, pattern: string, date1904: boolean): string | null {
  if (serial < 0) return null;
  const parts = datePartsFromSerial(serial, date1904);
  if (!parts) return null;
  const time = timePartsFromSerial(serial);
  const hasAmPm = /am\/pm/i.test(pattern);
  const hour12 = time.hour % 12 === 0 ? 12 : time.hour % 12;

  let out = '';
  let i = 0;
  const src = pattern;
  const n = src.length;
  // In date patterns `m` is month unless it directly follows an `h`/`hh`
  // token (then it is minutes) — track the last date token seen.
  let lastWasHour = false;

  while (i < n) {
    const ch = src[i]!;
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) return null;
      out += src.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '\\') {
      out += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (/[Aa]/.test(ch) && src.slice(i, i + 5).toLowerCase() === 'am/pm') {
      out += time.hour < 12 ? 'AM' : 'PM';
      i += 5;
      continue;
    }
    if (/[ymdhs]/i.test(ch)) {
      let j = i;
      while (j < n && src[j]!.toLowerCase() === ch.toLowerCase()) j++;
      const run = j - i;
      const token = ch.toLowerCase();
      if (token === 'y') {
        out += run <= 2 ? two(parts.year % 100) : String(parts.year);
        lastWasHour = false;
      } else if (token === 'd') {
        if (run === 1) out += String(parts.day);
        else if (run === 2) out += two(parts.day);
        else if (run === 3) out += DAYS[weekdayOf(serial, date1904)]!.slice(0, 3);
        else out += DAYS[weekdayOf(serial, date1904)]!;
        lastWasHour = false;
      } else if (token === 'h') {
        const hour = hasAmPm ? hour12 : time.hour;
        out += run === 1 ? String(hour) : two(hour);
        lastWasHour = true;
      } else if (token === 's') {
        out += run === 1 ? String(time.second) : two(time.second);
        lastWasHour = false;
      } else {
        // 'm': minutes when adjacent to hours or seconds, month otherwise.
        const followedBySeconds = /^\s*:?s/i.test(src.slice(j));
        if (lastWasHour || followedBySeconds) {
          out += run === 1 ? String(time.minute) : two(time.minute);
        } else if (run === 1) out += String(parts.month);
        else if (run === 2) out += two(parts.month);
        else if (run === 3) out += MONTHS[parts.month - 1]!.slice(0, 3);
        else out += MONTHS[parts.month - 1]!;
        lastWasHour = false;
      }
      i = j;
      continue;
    }
    out += ch;
    lastWasHour = lastWasHour && /[\s:]/.test(ch);
    i++;
  }
  return out;
}

function formatNumeric(value: number, pattern: string): string | null {
  // Split literals out; keep the digit skeleton.
  const percent = pattern.includes('%');
  let scaled = percent ? value * 100 : value;

  const skeleton = pattern.replace(/"[^"]*"/g, '').replace(/[^0#.,%]/g, '');
  const dotIndex = skeleton.indexOf('.');
  const decimalsPart = dotIndex >= 0 ? skeleton.slice(dotIndex + 1).replace(/[^0#]/g, '') : '';
  const decimals = decimalsPart.length;
  const minDecimals = (decimalsPart.match(/0/g) ?? []).length;
  const intPart = dotIndex >= 0 ? skeleton.slice(0, dotIndex) : skeleton;
  const thousands = intPart.includes(',');
  const minIntDigits = Math.max(1, (intPart.match(/0/g) ?? []).length);

  const negative = scaled < 0;
  scaled = Math.abs(scaled);
  const fixed = scaled.toFixed(decimals);
  let [intText = '0', decText = ''] = fixed.split('.');
  while (decText.length > minDecimals && decText.endsWith('0')) {
    decText = decText.slice(0, -1);
  }
  while (intText.length < minIntDigits) intText = `0${intText}`;
  if (thousands) intText = intText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let body = decText.length > 0 ? `${intText}.${decText}` : intText;
  if (decimals > 0 && minDecimals === decimals) {
    body = `${intText}.${fixed.split('.')[1] ?? ''}`;
  }

  // Reassemble literals around the numeric body: replace the first digit
  // run in the original pattern with the formatted number, drop the rest.
  let out = '';
  let placed = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '"') {
      const end = pattern.indexOf('"', i + 1);
      if (end < 0) return null;
      out += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (/[0#.,]/.test(ch)) {
      if (!placed) {
        out += body;
        placed = true;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  if (!placed) out += body;
  return (negative ? '-' : '') + out;
}

/** Format `value` with an Excel-style pattern; null = unsupported pattern. */
export function formatNumberWithPattern(
  value: number,
  pattern: string,
  date1904: boolean,
): string | null {
  const trimmed = pattern.trim();
  if (trimmed === '' || /^general$/i.test(trimmed)) {
    return String(value);
  }
  // Multi-section formats: use the first (positive) section only.
  const section = trimmed.split(';')[0]!;
  if (isDatePattern(section)) return formatDate(value, section, date1904);
  return formatNumeric(value, section);
}
