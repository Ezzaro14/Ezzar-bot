import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';

const WEEKDAYS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

export function loadConfig(path = new URL('../config/timers.json', import.meta.url)) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (!DateTime.local().setZone(config.serverTimezone).isValid) {
    throw new Error(`Invalid serverTimezone: ${config.serverTimezone}`);
  }
  const ids = new Set();
  for (const timer of config.timers) {
    if (!timer.id || !timer.name) throw new Error('Every timer needs an id and a name');
    if (ids.has(timer.id)) throw new Error(`Duplicate timer id: ${timer.id}`);
    ids.add(timer.id);

    switch (timer.type) {
      case 'daily':
        parseTime(timer);
        break;
      case 'weekly':
        parseTime(timer);
        if (!timer.days?.length) throw new Error(`${timer.id}: weekly timers need "days"`);
        timer.days.forEach((day) => parseWeekday(timer, day));
        break;
      case 'interval':
        if (!(timer.everyMinutes > 0)) throw new Error(`${timer.id}: interval timers need "everyMinutes"`);
        if (!DateTime.fromISO(timer.anchor ?? '').isValid) {
          throw new Error(`${timer.id}: interval timers need an ISO "anchor", e.g. "2026-01-01T00:00"`);
        }
        break;
      case 'respawn':
        if (!(timer.respawnMinutes > 0)) throw new Error(`${timer.id}: respawn timers need "respawnMinutes"`);
        break;
      default:
        throw new Error(`${timer.id}: unknown type "${timer.type}"`);
    }
  }
}

function parseTime(timer) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timer.time ?? '');
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`${timer.id}: "time" must be HH:MM, got "${timer.time}"`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function parseWeekday(timer, day) {
  const weekday = WEEKDAYS[String(day).slice(0, 3).toLowerCase()];
  if (!weekday) throw new Error(`${timer.id}: unknown day "${day}"`);
  return weekday;
}

/**
 * Returns the next time (as a Luxon DateTime) a timer fires strictly after `now`,
 * or null when it can't be known (a respawn timer with no recorded kill).
 */
export function nextOccurrence(timer, { now = DateTime.utc(), zone, kills = {} }) {
  now = now.setZone(zone);

  switch (timer.type) {
    case 'daily': {
      const { hour, minute } = parseTime(timer);
      let next = now.set({ hour, minute, second: 0, millisecond: 0 });
      if (next <= now) next = next.plus({ days: 1 });
      return next;
    }
    case 'weekly': {
      const { hour, minute } = parseTime(timer);
      const candidates = timer.days.map((day) => {
        const weekday = parseWeekday(timer, day);
        let next = now.set({ hour, minute, second: 0, millisecond: 0 }).plus({ days: (weekday - now.weekday + 7) % 7 });
        if (next <= now) next = next.plus({ weeks: 1 });
        return next;
      });
      return DateTime.min(...candidates);
    }
    case 'interval': {
      const anchor = DateTime.fromISO(timer.anchor, { zone });
      const elapsed = now.diff(anchor, 'minutes').minutes;
      const cycles = Math.max(0, Math.floor(elapsed / timer.everyMinutes) + 1);
      return anchor.plus({ minutes: cycles * timer.everyMinutes });
    }
    case 'respawn': {
      const killedAt = kills[timer.id];
      if (!killedAt) return null;
      return DateTime.fromMillis(killedAt, { zone }).plus({ minutes: timer.respawnMinutes });
    }
  }
  return null;
}

/** All timers with their next occurrence, soonest first; unknown ones last. */
export function upcoming(config, { now = DateTime.utc(), kills = {} } = {}) {
  return config.timers
    .map((timer) => ({ timer, next: nextOccurrence(timer, { now, zone: config.serverTimezone, kills }) }))
    .sort((a, b) => (a.next?.toMillis() ?? Infinity) - (b.next?.toMillis() ?? Infinity));
}
