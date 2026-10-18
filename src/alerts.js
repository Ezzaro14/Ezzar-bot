import { DateTime } from 'luxon';
import { regionFor } from './store.js';
import { nextOccurrence } from './timers.js';

export const DEFAULT_MINUTES_BEFORE = 15;

const ts = (dt, style) => `<t:${Math.floor(dt.toSeconds())}:${style}>`;

/**
 * Alerts that should fire now: the timer's next spawn (in the region its group uses in this guild)
 * is within `minutesBefore`, and this spawn hasn't been announced yet.
 * guild.alerts = { [timerId]: { roleId, channelId, minutesBefore, sentFor } }, sentFor = announced spawn (epoch ms).
 */
export function dueAlerts(config, guild, now = DateTime.utc()) {
  const due = [];
  for (const [timerId, alert] of Object.entries(guild.alerts ?? {})) {
    const timer = config.timers.find((t) => t.id === timerId);
    if (!timer) continue;
    const zone = config.regions[regionFor(config, guild.groups?.[timer.group])].timezone;
    const next = nextOccurrence(timer, { now, zone, kills: guild.kills });
    if (!next || next <= now) continue;
    if (next.minus({ minutes: alert.minutesBefore }) > now) continue;
    if (alert.sentFor === next.toMillis()) continue;
    due.push({ timer, alert, next });
  }
  return due;
}

export function alertMessage({ timer, alert, next }) {
  const where = timer.location ? ` · *${timer.location}*` : '';
  return {
    content: `<@&${alert.roleId}> **${timer.name}** - spawns ${ts(next, 'R')} · ${ts(next, 't')}${where}`,
    allowedMentions: { roles: [alert.roleId] },
  };
}
