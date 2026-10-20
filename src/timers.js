import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';

const WEEKDAYS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
// Slash command names; a group's key becomes its command, so it must fit and not collide.
const COMMAND_NAME = /^[a-z0-9_-]{1,32}$/;
const RESERVED_COMMANDS = new Set(['region', 'faction', 'killed', 'alerts', 'remindme', 'reminders', 'tempvoice', 'invite', 'help']);

export function loadConfig(path = new URL('../config/timers.json', import.meta.url)) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  const regionIds = Object.keys(config.regions ?? {});
  if (!regionIds.length) throw new Error('Config needs at least one region');
  if (regionIds.length > 25) throw new Error('At most 25 regions are supported (Discord choice limit)');
  for (const [id, region] of Object.entries(config.regions)) {
    if (!region.name) throw new Error(`Region ${id} needs a name`);
    if (!validZone(region.timezone)) throw new Error(`Region ${id}: invalid timezone "${region.timezone}"`);
  }
  if (!config.regions[config.defaultRegion]) throw new Error(`defaultRegion "${config.defaultRegion}" is not a region`);

  // Optional: timers with a "faction" only show for servers that picked that faction.
  if (config.factions) {
    for (const [id, faction] of Object.entries(config.factions)) {
      if (!faction.name) throw new Error(`Faction ${id} needs a name`);
    }
    if (!config.factions[config.defaultFaction]) {
      throw new Error(`defaultFaction "${config.defaultFaction}" is not a faction`);
    }
  }

  for (const [id, group] of Object.entries(config.groups ?? {})) {
    if (!COMMAND_NAME.test(id) || RESERVED_COMMANDS.has(id)) {
      throw new Error(`Group "${id}" can't be used as a command name (lowercase letters, digits, - or _; not "region", "faction", "killed", "alerts", "remindme", "reminders", "tempvoice", "invite" or "help")`);
    }
    if (!group.name) throw new Error(`Group ${id} needs a name`);
    if (!group.description || group.description.length > 100) {
      throw new Error(`Group ${id} needs a description of at most 100 characters`);
    }
  }

  const ids = new Set();
  for (const timer of config.timers) {
    if (!timer.id || !timer.name) throw new Error('Every timer needs an id and a name');
    if (ids.has(timer.id)) throw new Error(`Duplicate timer id: ${timer.id}`);
    ids.add(timer.id);
    if (!config.groups?.[timer.group]) throw new Error(`${timer.id}: unknown group "${timer.group}"`);
    if (timer.faction != null && !config.factions?.[timer.faction]) {
      throw new Error(`${timer.id}: unknown faction "${timer.faction}"`);
    }
    validateSchedule(timer);
  }
}

function validateSchedule(timer) {
  const label = timer.id;
  if (timer.timezone != null && !validZone(timer.timezone)) throw new Error(`${label}: invalid timezone "${timer.timezone}"`);
  if (timer.durationMinutes != null && !(timer.durationMinutes > 0)) {
    throw new Error(`${label}: "durationMinutes" must be a positive number`);
  }
  switch (timer.type) {
    case 'hourly':
      if (!Number.isInteger(timer.minute) || timer.minute < 0 || timer.minute > 59) {
        throw new Error(`${label}: hourly timers need "minute" (0-59)`);
      }
      break;
    case 'daily':
      parseTimes(timer, label);
      break;
    case 'weekly':
      parseTimes(timer, label);
      if (!timer.days?.length) throw new Error(`${label}: weekly timers need "days"`);
      timer.days.forEach((day) => parseWeekday(day, label));
      break;
    case 'interval':
      if (!(timer.everyMinutes > 0)) throw new Error(`${label}: interval timers need "everyMinutes"`);
      if (!DateTime.fromISO(timer.anchor ?? '').isValid) {
        throw new Error(`${label}: interval timers need an ISO "anchor", e.g. "2026-01-01T00:00"`);
      }
      break;
    case 'respawn':
      if (!(timer.respawnMinutes > 0)) throw new Error(`${label}: respawn timers need "respawnMinutes"`);
      break;
    default:
      throw new Error(`${label}: unknown type "${timer.type}"`);
  }
}

const validZone = (zone) => typeof zone === 'string' && DateTime.local().setZone(zone).isValid;

/** Accepts "time": "HH:MM" or "times": ["HH:MM", ...]. */
function parseTimes(timer, label = timer.id) {
  const list = timer.times ?? (timer.time != null ? [timer.time] : []);
  if (!list.length) throw new Error(`${label}: needs "time" or "times"`);
  return list.map((time) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new Error(`${label}: times must be HH:MM, got "${time}"`);
    }
    return { hour: Number(match[1]), minute: Number(match[2]) };
  });
}

function parseWeekday(day, label) {
  const weekday = WEEKDAYS[String(day).slice(0, 3).toLowerCase()];
  if (!weekday) throw new Error(`${label}: unknown day "${day}"`);
  return weekday;
}

/**
 * Returns the next time (as a Luxon DateTime) a timer fires strictly after `now`,
 * or null when it can't be known (a respawn timer with no recorded kill).
 * `zone` is the region's timezone; a timer's own "timezone" takes precedence.
 */
export function nextOccurrence(timer, { now = DateTime.utc(), zone, kills = {} }) {
  zone = timer.timezone ?? zone;
  now = now.setZone(zone);
  const at = ({ hour, minute }, base = now) => base.set({ hour, minute, second: 0, millisecond: 0 });

  switch (timer.type) {
    case 'hourly': {
      const next = now.set({ minute: timer.minute, second: 0, millisecond: 0 });
      return next <= now ? next.plus({ hours: 1 }) : next;
    }
    case 'daily': {
      const candidates = parseTimes(timer).map((time) => {
        const next = at(time);
        return next <= now ? at(time, now.plus({ days: 1 })) : next;
      });
      return DateTime.min(...candidates);
    }
    case 'weekly': {
      const candidates = [];
      for (const day of timer.days) {
        const weekday = parseWeekday(day, timer.id);
        const date = now.plus({ days: (weekday - now.weekday + 7) % 7 });
        for (const time of parseTimes(timer)) {
          const next = at(time, date);
          candidates.push(next <= now ? at(time, date.plus({ weeks: 1 })) : next);
        }
      }
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

/**
 * When a timer with "durationMinutes" is running at `now`, the time it ends; otherwise null.
 * It's running if its first occurrence after (now - duration) has already started.
 */
export function endsAt(timer, { now = DateTime.utc(), zone, kills = {} }) {
  if (!timer.durationMinutes) return null;
  const start = nextOccurrence(timer, { now: now.minus({ minutes: timer.durationMinutes }), zone, kills });
  const end = start?.plus({ minutes: timer.durationMinutes });
  return start && start <= now && end > now ? end : null;
}

/** Whether a timer shows for a faction; timers without one show for everyone. */
export const shownFor = (timer, faction) => !timer.faction || !faction || timer.faction === faction;

/** Whether a group has faction-specific timers (and so a faction setting). */
export const hasFactions = (config, group) => config.timers.some((t) => t.group === group && t.faction);

/**
 * A group's timers (for `faction`, if given) in a region's clock, with their next occurrence (and end, if running now),
 * soonest first; unknown ones last.
 */
export function upcoming(config, { group, region, faction, now = DateTime.utc(), kills = {} }) {
  const zone = config.regions[region].timezone;
  return config.timers
    .filter((timer) => timer.group === group && shownFor(timer, faction))
    .map((timer) => ({
      timer,
      next: nextOccurrence(timer, { now, zone, kills }),
      endsAt: endsAt(timer, { now, zone, kills }),
    }))
    .sort((a, b) => (a.next?.toMillis() ?? Infinity) - (b.next?.toMillis() ?? Infinity));
}

const DURATION_PART = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)(?![a-z])/g;

/** Minutes in "4h 25m", "4 hrs 25 mins", "in 4 hours and 25 minutes", "90 min" or "4:25"; null if it can't be read. */
export function parseDuration(text) {
  const input = text.trim().toLowerCase().replace(/^in\s+/, '');
  const clock = /^(\d+):([0-5]\d)$/.exec(input);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const parts = [...input.matchAll(DURATION_PART)];
  // Anything besides the parts, spaces, commas and "and" means it's not a duration.
  const rest = input.replace(DURATION_PART, '').replace(/\band\b|,/g, '').trim();
  if (!parts.length || rest) return null;
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * (unit.startsWith('h') ? 60 : 1), 0);
}

/** 265 -> "4h 25m". */
export const formatMinutes = (minutes) =>
  [Math.floor(minutes / 60) && `${Math.floor(minutes / 60)}h`, minutes % 60 && `${minutes % 60}m`].filter(Boolean).join(' ') ||
  '0m';
