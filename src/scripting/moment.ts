// A moment.js subset for scripts (`require('moment')`). It covers formatting,
// parsing, arithmetic, comparisons and unit boundaries — the parts request
// scripts use. Formatting follows moment's tokens; parsing understands the
// format string and falls back to the browser's date parser.

/* eslint-disable @typescript-eslint/no-explicit-any -- mirrors moment's untyped API */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = DAYS.map(d => d.slice(0, 3));

type Part = 'year' | 'month' | 'date' | 'day' | 'hour' | 'minute' | 'second' | 'ms';

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, '0');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

const UNIT_ALIASES: Record<string, string> = {
  y: 'year', year: 'year', years: 'year',
  M: 'month', month: 'month', months: 'month',
  w: 'week', week: 'week', weeks: 'week',
  d: 'day', day: 'day', days: 'day',
  h: 'hour', hour: 'hour', hours: 'hour',
  m: 'minute', minute: 'minute', minutes: 'minute',
  s: 'second', second: 'second', seconds: 'second',
  ms: 'millisecond', millisecond: 'millisecond', milliseconds: 'millisecond',
};

function unitOf(unit: string): string {
  return UNIT_ALIASES[unit] ?? UNIT_ALIASES[unit.replace(/s$/, '')] ?? 'millisecond';
}

const FORMAT_TOKENS =
  /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|Do|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|A|a|ZZ|Z|X|x|Q/g;

function formatMoment(date: Date, utc: boolean, pattern: string): string {
  const part = (p: Part): number => {
    switch (p) {
      case 'year':
        return utc ? date.getUTCFullYear() : date.getFullYear();
      case 'month':
        return utc ? date.getUTCMonth() : date.getMonth();
      case 'date':
        return utc ? date.getUTCDate() : date.getDate();
      case 'day':
        return utc ? date.getUTCDay() : date.getDay();
      case 'hour':
        return utc ? date.getUTCHours() : date.getHours();
      case 'minute':
        return utc ? date.getUTCMinutes() : date.getMinutes();
      case 'second':
        return utc ? date.getUTCSeconds() : date.getSeconds();
      case 'ms':
        return utc ? date.getUTCMilliseconds() : date.getMilliseconds();
    }
  };
  const offsetMinutes = utc ? 0 : -date.getTimezoneOffset();
  const offset = `${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  const hour12 = part('hour') % 12 || 12;

  return pattern.replace(FORMAT_TOKENS, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY':
        return pad(part('year'), 4);
      case 'YY':
        return pad(part('year') % 100);
      case 'MMMM':
        return MONTHS[part('month')];
      case 'MMM':
        return MONTHS_SHORT[part('month')];
      case 'MM':
        return pad(part('month') + 1);
      case 'M':
        return String(part('month') + 1);
      case 'DDDD':
        return String(Math.floor((date.getTime() - new Date(part('year'), 0, 1).getTime()) / 86_400_000) + 1).padStart(3, '0');
      case 'DDD':
        return String(Math.floor((date.getTime() - new Date(part('year'), 0, 1).getTime()) / 86_400_000) + 1);
      case 'DD':
        return pad(part('date'));
      case 'Do':
        return ordinal(part('date'));
      case 'D':
        return String(part('date'));
      case 'dddd':
        return DAYS[part('day')];
      case 'ddd':
        return DAYS_SHORT[part('day')];
      case 'dd':
        return DAYS_SHORT[part('day')].slice(0, 2);
      case 'd':
        return String(part('day'));
      case 'HH':
        return pad(part('hour'));
      case 'H':
        return String(part('hour'));
      case 'hh':
        return pad(hour12);
      case 'h':
        return String(hour12);
      case 'mm':
        return pad(part('minute'));
      case 'm':
        return String(part('minute'));
      case 'ss':
        return pad(part('second'));
      case 's':
        return String(part('second'));
      case 'SSS':
        return pad(part('ms'), 3);
      case 'A':
        return part('hour') < 12 ? 'AM' : 'PM';
      case 'a':
        return part('hour') < 12 ? 'am' : 'pm';
      case 'ZZ':
        return offset.replace(':', '');
      case 'Z':
        return offset;
      case 'X':
        return String(Math.floor(date.getTime() / 1000));
      case 'x':
        return String(date.getTime());
      case 'Q':
        return String(Math.floor(part('month') / 3) + 1);
      default:
        return token;
    }
  });
}

/** Turn a format string into a regex + a reader for the captured parts. */
function parseWithFormat(text: string, pattern: string): { values: Record<string, number>; pm: boolean; offset: number | null } | null {
  const groups: { key: string }[] = [];
  let source = '';
  let lastIndex = 0;
  const push = (key: string, regex: string) => {
    groups.push({ key });
    source += regex;
  };
  for (const match of pattern.matchAll(new RegExp(FORMAT_TOKENS.source, 'g'))) {
    const token = match[0];
    const at = match.index ?? 0;
    source += pattern.slice(lastIndex, at).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    lastIndex = at + token.length;
    if (token.startsWith('[')) {
      source += token.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    switch (token) {
      case 'YYYY':
        push('year', '(\\d{4})');
        break;
      case 'YY':
        push('year', '(\\d{2})');
        break;
      case 'MMMM':
        push('monthName', `(${MONTHS.join('|')})`);
        break;
      case 'MMM':
        push('monthName', `(${MONTHS_SHORT.join('|')})`);
        break;
      case 'MM':
        push('month', '(\\d{2})');
        break;
      case 'M':
        push('month', '(\\d{1,2})');
        break;
      case 'DD':
        push('date', '(\\d{2})');
        break;
      case 'D':
        push('date', '(\\d{1,2})');
        break;
      case 'Do':
        push('date', '(\\d{1,2})(?:st|nd|rd|th)');
        break;
      case 'HH':
      case 'hh':
        push('hour', '(\\d{2})');
        break;
      case 'H':
      case 'h':
        push('hour', '(\\d{1,2})');
        break;
      case 'mm':
        push('minute', '(\\d{2})');
        break;
      case 'm':
        push('minute', '(\\d{1,2})');
        break;
      case 'ss':
        push('second', '(\\d{2})');
        break;
      case 's':
        push('second', '(\\d{1,2})');
        break;
      case 'SSS':
        push('ms', '(\\d{1,3})');
        break;
      case 'A':
        push('pm', '(AM|PM)');
        break;
      case 'a':
        push('pm', '(am|pm)');
        break;
      case 'Z':
        push('offset', '([+-]\\d{2}:\\d{2})');
        break;
      case 'ZZ':
        push('offset', '([+-]\\d{4})');
        break;
      case 'X':
        push('unix', '(\\d+)');
        break;
      case 'x':
        push('msSinceEpoch', '(\\d+)');
        break;
      default:
        source += token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  source += pattern.slice(lastIndex).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*${source}\\s*$`, 'i').exec(text);
  if (!match) return null;
  const values: Record<string, number> = {};
  const pm = /pm/i.test(match[groups.findIndex(g => g.key === 'pm') + 1] ?? '');
  let offset: number | null = null;
  groups.forEach((group, i) => {
    const raw = match[i + 1];
    if (raw === undefined) return;
    if (group.key === 'monthName') values.month = MONTHS.findIndex(m => m.toLowerCase().startsWith(raw.toLowerCase().slice(0, 3))) + 1;
    else if (group.key === 'pm') values.pm = pm ? 1 : 0;
    else if (group.key === 'offset') {
      const sign = raw.startsWith('-') ? -1 : 1;
      const digits = raw.replace(/[^\d]/g, '');
      const hours = Number(digits.slice(0, 2));
      const minutes = Number(digits.slice(2) || 0);
      offset = sign * (hours * 60 + minutes);
      values.offset = offset;
    } else values[group.key] = Number(raw);
  });
  return { values, pm, offset };
}

export class Moment {
  private instant: Date;
  private utcMode: boolean;
  private valid: boolean;

  constructor(input?: any, pattern?: string, utcMode = false) {
    this.utcMode = utcMode;
    this.valid = true;
    if (input === undefined || input === null) {
      this.instant = new Date();
      return;
    }
    if (input instanceof Moment) {
      this.instant = new Date(input.valueOf());
      this.utcMode = input.utcMode;
      return;
    }
    if (input instanceof Date) {
      this.instant = new Date(input.getTime());
      this.valid = !Number.isNaN(this.instant.getTime());
      return;
    }
    if (typeof input === 'number') {
      this.instant = new Date(input);
      this.valid = !Number.isNaN(this.instant.getTime());
      return;
    }
    if (typeof input === 'object' && typeof input.toDate === 'function') {
      this.instant = new Date((input.toDate() as Date).getTime());
      this.valid = !Number.isNaN(this.instant.getTime());
      return;
    }
    const text = String(input).trim();
    if (pattern) {
      const parsed = parseWithFormat(text, pattern);
      if (parsed) {
        const now = new Date();
        const year = parsed.values.year === undefined ? now.getFullYear() : parsed.values.year < 100 ? 2000 + parsed.values.year : parsed.values.year;
        const month = (parsed.values.month ?? 1) - 1;
        const day = parsed.values.date ?? 1;
        let hour = parsed.values.hour ?? 0;
        if (parsed.pm && hour < 12) hour += 12;
        const minute = parsed.values.minute ?? 0;
        const second = parsed.values.second ?? 0;
        const ms = parsed.values.ms ?? 0;
        if (parsed.values.unix !== undefined) this.instant = new Date(parsed.values.unix * 1000);
        else if (parsed.values.msSinceEpoch !== undefined) this.instant = new Date(parsed.values.msSinceEpoch);
        else if (utcMode) this.instant = new Date(Date.UTC(year, month, day, hour, minute, second, ms) - (parsed.offset ?? 0) * 60_000);
        else this.instant = new Date(year, month, day, hour, minute, second, ms);
        this.valid = !Number.isNaN(this.instant.getTime());
        return;
      }
      this.instant = new Date(NaN);
      this.valid = false;
      return;
    }
    // ISO date-only strings are local midnight in moment, not UTC midnight.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
      const [, y, m, d] = dateOnly.map(Number);
      this.instant = utcMode ? new Date(Date.UTC(y, m - 1, d)) : new Date(y, m - 1, d);
    } else {
      this.instant = new Date(text);
    }
    this.valid = !Number.isNaN(this.instant.getTime());
  }

  private part(p: Part): number {
    const d = this.instant;
    switch (p) {
      case 'year':
        return this.utcMode ? d.getUTCFullYear() : d.getFullYear();
      case 'month':
        return this.utcMode ? d.getUTCMonth() : d.getMonth();
      case 'date':
        return this.utcMode ? d.getUTCDate() : d.getDate();
      case 'day':
        return this.utcMode ? d.getUTCDay() : d.getDay();
      case 'hour':
        return this.utcMode ? d.getUTCHours() : d.getHours();
      case 'minute':
        return this.utcMode ? d.getUTCMinutes() : d.getMinutes();
      case 'second':
        return this.utcMode ? d.getUTCSeconds() : d.getSeconds();
      case 'ms':
        return this.utcMode ? d.getUTCMilliseconds() : d.getMilliseconds();
    }
  }

  private setPart(p: Part, value: number): void {
    const d = this.instant;
    switch (p) {
      case 'year':
        if (this.utcMode) d.setUTCFullYear(value);
        else d.setFullYear(value);
        break;
      case 'month':
        if (this.utcMode) d.setUTCMonth(value);
        else d.setMonth(value);
        break;
      case 'date':
        if (this.utcMode) d.setUTCDate(value);
        else d.setDate(value);
        break;
      case 'hour':
        if (this.utcMode) d.setUTCHours(value);
        else d.setHours(value);
        break;
      case 'minute':
        if (this.utcMode) d.setUTCMinutes(value);
        else d.setMinutes(value);
        break;
      case 'second':
        if (this.utcMode) d.setUTCSeconds(value);
        else d.setSeconds(value);
        break;
      case 'ms':
        if (this.utcMode) d.setUTCMilliseconds(value);
        else d.setMilliseconds(value);
        break;
    }
  }

  format(pattern = 'YYYY-MM-DDTHH:mm:ssZ'): string {
    return this.valid ? formatMoment(this.instant, this.utcMode, pattern) : 'Invalid date';
  }

  add(amount: number | Record<string, number>, unit = 'milliseconds'): Moment {
    if (typeof amount === 'object' && amount !== null) {
      for (const [name, value] of Object.entries(amount)) this.shift(Number(value), name);
      return this;
    }
    this.shift(Number(amount), unit);
    return this;
  }

  subtract(amount: number | Record<string, number>, unit = 'milliseconds'): Moment {
    if (typeof amount === 'object' && amount !== null) {
      for (const [name, value] of Object.entries(amount)) this.shift(-Number(value), name);
      return this;
    }
    this.shift(-Number(amount), unit);
    return this;
  }

  private shift(amount: number, unit: string): void {
    if (!this.valid || amount === 0) return;
    const kind = unitOf(unit);
    switch (kind) {
      case 'year':
        this.shiftMonths(amount * 12);
        break;
      case 'month':
        this.shiftMonths(amount);
        break;
      case 'week':
        this.setPart('date', this.part('date') + amount * 7);
        break;
      case 'day':
        this.setPart('date', this.part('date') + amount);
        break;
      case 'hour':
        this.setPart('hour', this.part('hour') + amount);
        break;
      case 'minute':
        this.setPart('minute', this.part('minute') + amount);
        break;
      case 'second':
        this.setPart('second', this.part('second') + amount);
        break;
      default:
        this.instant = new Date(this.instant.getTime() + amount);
    }
  }

  private shiftMonths(months: number): void {
    const day = this.part('date');
    const targetMonth = this.part('month') + months;
    const year = this.part('year') + Math.floor(targetMonth / 12);
    const month = ((targetMonth % 12) + 12) % 12;
    this.setPart('date', 1);
    this.setPart('year', year);
    this.setPart('month', month);
    this.setPart('date', Math.min(day, daysInMonth(year, month)));
  }

  startOf(unit: string): Moment {
    if (!this.valid) return this;
    switch (unitOf(unit)) {
      case 'year':
        this.setPart('month', 0);
        this.setPart('date', 1);
        this.setPart('hour', 0);
        this.setPart('minute', 0);
        this.setPart('second', 0);
        this.setPart('ms', 0);
        break;
      case 'month':
        this.setPart('date', 1);
        this.setPart('hour', 0);
        this.setPart('minute', 0);
        this.setPart('second', 0);
        this.setPart('ms', 0);
        break;
      case 'week':
        this.setPart('date', this.part('date') - this.part('day'));
        this.setPart('hour', 0);
        this.setPart('minute', 0);
        this.setPart('second', 0);
        this.setPart('ms', 0);
        break;
      case 'day':
        this.setPart('hour', 0);
        this.setPart('minute', 0);
        this.setPart('second', 0);
        this.setPart('ms', 0);
        break;
      case 'hour':
        this.setPart('minute', 0);
        this.setPart('second', 0);
        this.setPart('ms', 0);
        break;
      case 'minute':
        this.setPart('second', 0);
        this.setPart('ms', 0);
        break;
      case 'second':
        this.setPart('ms', 0);
        break;
      default:
        break;
    }
    return this;
  }

  endOf(unit: string): Moment {
    const kind = unitOf(unit);
    if (kind === 'week') this.add(1, 'week');
    else if (kind !== 'millisecond') this.add(1, kind);
    this.startOf(kind);
    if (this.valid && kind !== 'millisecond') this.instant = new Date(this.instant.getTime() - 1);
    return this;
  }

  clone(): Moment {
    return new Moment(this);
  }

  isValid(): boolean {
    return this.valid;
  }

  isBefore(other: any, unit?: string): boolean {
    const target = toMoment(other);
    return unit ? this.clone().endOf(unit).valueOf() < target.valueOf() : this.valueOf() < target.valueOf();
  }

  isAfter(other: any, unit?: string): boolean {
    const target = toMoment(other);
    return unit ? this.clone().startOf(unit).valueOf() > target.valueOf() : this.valueOf() > target.valueOf();
  }

  isSame(other: any, unit?: string): boolean {
    const target = toMoment(other);
    if (!unit) return this.valueOf() === target.valueOf();
    return this.clone().startOf(unit).valueOf() === target.clone().startOf(unit).valueOf();
  }

  isSameOrBefore(other: any, unit?: string): boolean {
    return this.isSame(other, unit) || this.isBefore(other, unit);
  }

  isSameOrAfter(other: any, unit?: string): boolean {
    return this.isSame(other, unit) || this.isAfter(other, unit);
  }

  diff(other: any, unit = 'milliseconds', precise = false): number {
    const target = toMoment(other);
    const kind = unitOf(unit);
    const ms = this.valueOf() - target.valueOf();
    if (precise || kind === 'millisecond') return ms;
    switch (kind) {
      case 'year':
        return Math.trunc(this.monthDiff(target) / 12);
      case 'month':
        return Math.trunc(this.monthDiff(target));
      case 'week':
        return Math.trunc(ms / 604_800_000);
      case 'day':
        return Math.trunc(ms / 86_400_000);
      case 'hour':
        return Math.trunc(ms / 3_600_000);
      case 'minute':
        return Math.trunc(ms / 60_000);
      case 'second':
        return Math.trunc(ms / 1000);
      default:
        return ms;
    }
  }

  private monthDiff(other: Moment): number {
    const whole = (this.part('year') - other.part('year')) * 12 + (this.part('month') - other.part('month'));
    const anchor = other.clone().add(whole, 'month');
    const adjust = this.valueOf() < anchor.valueOf() ? -1 : 0;
    return whole + adjust;
  }

  valueOf(): number {
    return this.instant.getTime();
  }

  unix(): number {
    return Math.floor(this.valueOf() / 1000);
  }

  toDate(): Date {
    return new Date(this.instant.getTime());
  }

  toISOString(): string {
    return this.instant.toISOString();
  }

  toJSON(): string | null {
    return this.valid ? this.instant.toISOString() : null;
  }

  toString(): string {
    return this.valid ? this.instant.toString() : 'Invalid date';
  }

  utc(): Moment {
    this.utcMode = true;
    return this;
  }

  local(): Moment {
    this.utcMode = false;
    return this;
  }

  utcOffset(): number {
    return this.utcMode ? 0 : -this.instant.getTimezoneOffset();
  }

  year(value?: number): any {
    if (value === undefined) return this.part('year');
    this.setPart('year', value);
    return this;
  }

  month(value?: number): any {
    if (value === undefined) return this.part('month');
    this.setPart('month', value);
    return this;
  }

  date(value?: number): any {
    if (value === undefined) return this.part('date');
    this.setPart('date', value);
    return this;
  }

  day(value?: number): any {
    if (value === undefined) return this.part('day');
    this.setPart('date', this.part('date') - this.part('day') + value);
    return this;
  }

  hour(value?: number): any {
    if (value === undefined) return this.part('hour');
    this.setPart('hour', value);
    return this;
  }

  hours(value?: number): any {
    return this.hour(value);
  }

  minute(value?: number): any {
    if (value === undefined) return this.part('minute');
    this.setPart('minute', value);
    return this;
  }

  minutes(value?: number): any {
    return this.minute(value);
  }

  second(value?: number): any {
    if (value === undefined) return this.part('second');
    this.setPart('second', value);
    return this;
  }

  seconds(value?: number): any {
    return this.second(value);
  }

  millisecond(value?: number): any {
    if (value === undefined) return this.part('ms');
    this.setPart('ms', value);
    return this;
  }

  milliseconds(value?: number): any {
    return this.millisecond(value);
  }

  daysInMonth(): number {
    return daysInMonth(this.part('year'), this.part('month'));
  }
}

function toMoment(value: any): Moment {
  return value instanceof Moment ? value : new Moment(value);
}

export function createMoment(): Record<string, any> {
  const moment = (input?: any, pattern?: string) => new Moment(input, pattern);
  moment.utc = (input?: any, pattern?: string) => new Moment(input, pattern, true);
  moment.unix = (seconds: number) => new Moment(Number(seconds) * 1000);
  moment.isMoment = (value: any) => value instanceof Moment;
  moment.now = () => Date.now();
  moment.locale = () => 'en';
  moment.duration = (amount: number, unit = 'milliseconds') => {
    const ms = (() => {
      switch (unitOf(unit)) {
        case 'year':
          return amount * 365 * 86_400_000;
        case 'month':
          return amount * 30 * 86_400_000;
        case 'week':
          return amount * 604_800_000;
        case 'day':
          return amount * 86_400_000;
        case 'hour':
          return amount * 3_600_000;
        case 'minute':
          return amount * 60_000;
        case 'second':
          return amount * 1000;
        default:
          return amount;
      }
    })();
    return {
      asMilliseconds: () => ms,
      asSeconds: () => ms / 1000,
      asMinutes: () => ms / 60_000,
      asHours: () => ms / 3_600_000,
      asDays: () => ms / 86_400_000,
      asWeeks: () => ms / 604_800_000,
      asMonths: () => ms / (30 * 86_400_000),
      asYears: () => ms / (365 * 86_400_000),
      valueOf: () => ms,
    };
  };
  return moment;
}
