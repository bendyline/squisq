/**
 * Excel date serials, with the landmines reproduced on purpose:
 *
 *  - **1900 system**: serial 1 = 1900-01-01, and serial 60 is the
 *    FICTITIOUS 1900-02-29 (Lotus 1-2-3's leap bug, kept for compatibility
 *    forever). Serials > 60 are therefore shifted by one day relative to
 *    the real calendar.
 *  - **1904 system**: serial 0 = 1904-01-01, no leap bug.
 *  - Time is the fractional day.
 *
 * The ISO helpers exist for the oracle: squisq's XLSX importer normalizes
 * date-cell cached values to ISO strings, so comparing an engine's serial
 * result against the cache means converting one to the other with the SAME
 * epoch rules.
 */

const MS_PER_DAY = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 31); // serial 0 (day before 1900-01-01)
const EPOCH_1904 = Date.UTC(1904, 0, 1); // serial 0

export interface DateParts {
  year: number;
  month: number; // 1-based
  day: number;
}

/** Calendar parts → serial. Reproduces the fictitious 1900-02-29. */
export function serialFromDateParts(
  year: number,
  month: number,
  day: number,
  date1904: boolean,
): number | null {
  // Excel's DATE overflows months/days arithmetically (DATE(2020,13,1) =
  // 2021-01-01); Date.UTC has the same behavior.
  const utc = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(utc)) return null;
  if (date1904) {
    const serial = Math.round((utc - EPOCH_1904) / MS_PER_DAY);
    return serial < 0 ? null : serial;
  }
  if (year === 1900 && month === 2 && day === 29) return 60;
  let serial = Math.round((utc - EPOCH_1900) / MS_PER_DAY);
  if (serial >= 60) serial += 1; // real dates after Feb 28 1900 shift past the phantom day
  return serial < 1 ? null : serial;
}

/** Serial (integer part) → calendar parts. Serial 60 → the phantom Feb 29. */
export function datePartsFromSerial(serial: number, date1904: boolean): DateParts | null {
  const wholeDays = Math.floor(serial);
  if (!date1904 && wholeDays === 60) return { year: 1900, month: 2, day: 29 };
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900;
  const adjusted = !date1904 && wholeDays > 60 ? wholeDays - 1 : wholeDays;
  const date = new Date(epoch + adjusted * MS_PER_DAY);
  if (!Number.isFinite(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Fractional day → { hour, minute, second } (rounded to whole seconds). */
export function timePartsFromSerial(serial: number): {
  hour: number;
  minute: number;
  second: number;
} {
  const frac = serial - Math.floor(serial);
  const totalSeconds = Math.round(frac * 86_400) % 86_400;
  return {
    hour: Math.floor(totalSeconds / 3600),
    minute: Math.floor(totalSeconds / 60) % 60,
    second: totalSeconds % 60,
  };
}

const two = (n: number): string => String(n).padStart(2, '0');

/** Serial → `YYYY-MM-DD` (integer serial) or `YYYY-MM-DD HH:MM[:SS]`. */
export function isoFromSerial(serial: number, date1904: boolean): string | null {
  const parts = datePartsFromSerial(serial, date1904);
  if (!parts) return null;
  const date = `${parts.year}-${two(parts.month)}-${two(parts.day)}`;
  if (serial === Math.floor(serial)) return date;
  const { hour, minute, second } = timePartsFromSerial(serial);
  return second === 0
    ? `${date} ${two(hour)}:${two(minute)}`
    : `${date} ${two(hour)}:${two(minute)}:${two(second)}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** `YYYY-MM-DD[ HH:MM[:SS]]` → serial; null for non-ISO text. */
export function serialFromIso(text: string, date1904: boolean): number | null {
  const m = ISO_RE.exec(text.trim());
  if (!m) return null;
  const base = serialFromDateParts(Number(m[1]), Number(m[2]), Number(m[3]), date1904);
  if (base === null) return null;
  if (m[4] === undefined) return base;
  const seconds = Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0);
  return base + seconds / 86_400;
}

/** JS Date (local time) → serial, for TODAY/NOW off the injected clock. */
export function serialFromDate(date: Date, date1904: boolean, includeTime: boolean): number {
  const base = serialFromDateParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date1904,
  );
  if (base === null) return 0;
  if (!includeTime) return base;
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  return base + seconds / 86_400;
}
