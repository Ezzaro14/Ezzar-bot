import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';

// chrono works out weekdays ("tuesday") in the system time zone; pin it so only the offset we pass counts.
process.env.TZ = 'UTC';

export const MAX_REMINDERS = 25;
const MAX_DAYS_AHEAD = 365;
// A reminder sent this late (e.g. the bot was offline) says when it was due.
const LATE_MS = 60_000;

const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

const ZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];

/** The zone's canonical name ("europe/berlin" -> "Europe/Berlin"), or null if luxon doesn't know it. */
export function normalizeZone(input) {
  const known = ZONES.find((zone) => zone.toLowerCase() === input.trim().toLowerCase());
  if (known) return known;
  const dt = DateTime.now().setZone(input.trim());
  return dt.isValid ? dt.zoneName : null;
}

/** Up to 25 zones matching the query ("new york" finds America/New_York), labelled with their current offset. */
export function zoneChoices(query, now = DateTime.utc()) {
  const q = query.trim().toLowerCase().replace(/\s+/g, '_');
  return ZONES.filter((zone) => zone.toLowerCase().includes(q))
    .slice(0, 25)
    .map((zone) => ({ name: `${zone} (${now.setZone(zone).toFormat("'UTC'Z")})`, value: zone }));
}

/**
 * Splits "in 12 hours to wash dishes" or "at 2pm tuesday to fix my car" into when and what.
 * zone: the user's time zone, needed only for clock times; relative ones ("in 2 hours") work without it.
 * Returns { at: DateTime, text } or { error } with a message for the user.
 */
export function parseReminder(input, { now = DateTime.utc(), zone = null } = {}) {
  const parse = (offset) =>
    chrono.parse(input, { instant: now.toJSDate(), timezone: offset }, { forwardDate: true })[0];

  // Parsed at two far-apart offsets: if both agree, the time is relative and no zone is needed.
  let match = parse(0);
  if (!match) {
    return { error: 'I couldn\'t find a time in that. Try "in 12 hours to wash dishes" or "at 2pm tuesday to fix my car".' };
  }
  let at = DateTime.fromJSDate(match.start.date());
  if (parse(600)?.start.date().getTime() !== at.toMillis()) {
    if (!zone) return { error: 'I need your time zone for clock times. Set it with `/reminders timezone`, then try again.' };
    const offset = now.setZone(zone).offset;
    match = parse(offset);
    at = DateTime.fromJSDate(match.start.date()).setZone(zone);
    // Across a daylight saving change the offset on that day differs from today's.
    if (at.offset !== offset) {
      match = parse(at.offset);
      at = DateTime.fromJSDate(match.start.date()).setZone(zone);
    }
  }

  if (at <= now) return { error: `That's in the past (${ts(at.toMillis(), 'F')}).` };
  if (at > now.plus({ days: MAX_DAYS_AHEAD })) return { error: 'Reminders can be at most a year ahead.' };
  return { at, text: reminderText(input, match) };
}

/** The input without the time phrase and its joining words: "to fix my car at 2pm tuesday" -> "fix my car". */
function reminderText(input, match) {
  const before = input.slice(0, match.index).replace(/\b(at|on|in|by)\s*$/i, '');
  const after = input.slice(match.index + match.text.length);
  return `${before} ${after}`
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:;-]*(?:(?:to|that|about)\b)?[\s,:;-]*/i, '')
    .replace(/[\s,:;-]+$/, '');
}

/** The reminder as a message; in a channel it pings the user, and its text never pings anyone. */
export function reminderMessage(reminder, { mention = false, now = Date.now() } = {}) {
  const text = reminder.text ? `Reminder: **${reminder.text}**` : 'Reminder';
  const late = now - reminder.at > LATE_MS ? `, was due ${ts(reminder.at, 'R')}` : '';
  return {
    content: `${mention ? `<@${reminder.userId}> ` : ''}${text}\n-# Set ${ts(reminder.createdAt, 'R')}${late}`,
    allowedMentions: { users: mention ? [reminder.userId] : [] },
  };
}
