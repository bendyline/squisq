/**
 * Date/time family over Excel serials — the epoch (1900 with its leap bug,
 * or 1904) comes from the evaluation context, and TODAY/NOW read the
 * INJECTED clock so replays and tests stay deterministic.
 */

import {
  datePartsFromSerial,
  serialFromDate,
  serialFromDateParts,
  timePartsFromSerial,
} from '../dates.js';
import { NUM_ERROR, isCalcError } from '../errors.js';
import type { CalcFunctionDef } from '../evaluate.js';
import { argNumber, isMissing } from './helpers.js';

type Def = CalcFunctionDef;

export const dateFunctions: Record<string, Def> = {
  DATE: {
    minArgs: 3,
    maxArgs: 3,
    fn: (args, ctx) => {
      const year = argNumber(args[0]!, ctx);
      if (isCalcError(year)) return year;
      const month = argNumber(args[1]!, ctx);
      if (isCalcError(month)) return month;
      const day = argNumber(args[2]!, ctx);
      if (isCalcError(day)) return day;
      // Excel treats years < 1900 as 1900-relative offsets.
      const fullYear = year < 1900 ? Math.trunc(year) + 1900 : Math.trunc(year);
      const serial = serialFromDateParts(
        fullYear,
        Math.trunc(month),
        Math.trunc(day),
        ctx.date1904,
      );
      return serial === null ? NUM_ERROR : serial;
    },
  },
  TIME: {
    minArgs: 3,
    maxArgs: 3,
    fn: (args, ctx) => {
      const hour = argNumber(args[0]!, ctx);
      if (isCalcError(hour)) return hour;
      const minute = argNumber(args[1]!, ctx);
      if (isCalcError(minute)) return minute;
      const second = argNumber(args[2]!, ctx);
      if (isCalcError(second)) return second;
      const seconds = Math.trunc(hour) * 3600 + Math.trunc(minute) * 60 + Math.trunc(second);
      if (seconds < 0) return NUM_ERROR;
      return (seconds % 86_400) / 86_400;
    },
  },
  YEAR: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      const parts = datePartsFromSerial(serial, ctx.date1904);
      return parts ? parts.year : NUM_ERROR;
    },
  },
  MONTH: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      const parts = datePartsFromSerial(serial, ctx.date1904);
      return parts ? parts.month : NUM_ERROR;
    },
  },
  DAY: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      const parts = datePartsFromSerial(serial, ctx.date1904);
      return parts ? parts.day : NUM_ERROR;
    },
  },
  HOUR: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      return timePartsFromSerial(serial).hour;
    },
  },
  MINUTE: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      return timePartsFromSerial(serial).minute;
    },
  },
  SECOND: {
    minArgs: 1,
    maxArgs: 1,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      return timePartsFromSerial(serial).second;
    },
  },
  WEEKDAY: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      const parts = datePartsFromSerial(serial, ctx.date1904);
      if (!parts) return NUM_ERROR;
      const sunday0 = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
      const mode = isMissing(args[1]) ? 1 : argNumber(args[1]!, ctx);
      if (isCalcError(mode)) return mode;
      switch (Math.trunc(mode)) {
        case 1:
          return sunday0 + 1; // Sunday = 1
        case 2:
          return sunday0 === 0 ? 7 : sunday0; // Monday = 1
        case 3:
          return sunday0 === 0 ? 6 : sunday0 - 1; // Monday = 0
        default:
          return NUM_ERROR;
      }
    },
  },
  TODAY: {
    minArgs: 0,
    maxArgs: 0,
    volatile: true,
    fn: (_args, ctx) => serialFromDate(ctx.now(), ctx.date1904, false),
  },
  NOW: {
    minArgs: 0,
    maxArgs: 0,
    volatile: true,
    fn: (_args, ctx) => serialFromDate(ctx.now(), ctx.date1904, true),
  },
  EDATE: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      const months = argNumber(args[1]!, ctx);
      if (isCalcError(months)) return months;
      const parts = datePartsFromSerial(serial, ctx.date1904);
      if (!parts) return NUM_ERROR;
      const total = parts.month - 1 + Math.trunc(months);
      const year = parts.year + Math.floor(total / 12);
      const month = ((total % 12) + 12) % 12;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const result = serialFromDateParts(
        year,
        month + 1,
        Math.min(parts.day, lastDay),
        ctx.date1904,
      );
      return result === null ? NUM_ERROR : result;
    },
  },
  EOMONTH: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const serial = argNumber(args[0]!, ctx);
      if (isCalcError(serial)) return serial;
      const months = argNumber(args[1]!, ctx);
      if (isCalcError(months)) return months;
      const parts = datePartsFromSerial(serial, ctx.date1904);
      if (!parts) return NUM_ERROR;
      const total = parts.month - 1 + Math.trunc(months);
      const year = parts.year + Math.floor(total / 12);
      const month = ((total % 12) + 12) % 12;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const result = serialFromDateParts(year, month + 1, lastDay, ctx.date1904);
      return result === null ? NUM_ERROR : result;
    },
  },
  DAYS: {
    minArgs: 2,
    maxArgs: 2,
    fn: (args, ctx) => {
      const end = argNumber(args[0]!, ctx);
      if (isCalcError(end)) return end;
      const start = argNumber(args[1]!, ctx);
      if (isCalcError(start)) return start;
      return Math.trunc(end) - Math.trunc(start);
    },
  },
};
