import { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import { upcoming } from './timers.js';

const ts = (dt, style) => `<t:${Math.floor(dt.toSeconds())}:${style}>`;
const DESCRIPTION_LIMIT = 4096;
const COLOR_IDLE = 0x5865f2;
const COLOR_ACTIVE = 0x57f287;

/** "in 2 hours · 9:30 PM"; the full date only once it's more than a day away. */
const when = (dt, now) => `${ts(dt, 'R')} · ${ts(dt, dt.diff(now, 'hours').hours < 24 ? 't' : 'F')}`;

const isActive = ({ next, endsAt }, now) => Boolean(endsAt) || (next != null && next <= now);

function status({ next, endsAt }, now) {
  if (endsAt) return `Open now · ends ${ts(endsAt, 'R')}`;
  if (!next) return 'Not tracked · use `/killed`';
  if (next <= now) return `Up since ${ts(next, 'R')}`;
  return when(next, now);
}

/** One line per timer: "**Name** - time", location in italics at the end. */
function block(entry, now) {
  const where = entry.timer.location ? ` · *${entry.timer.location}*` : '';
  return `**${entry.timer.name}** - ${status(entry, now)}${where}`;
}

/** The board for one group (= one command) as it runs in `region`. */
export function buildBoard(config, { group, region, now = DateTime.utc(), kills = {}, intervalMinutes = 5 }) {
  const entries = upcoming(config, { group, region, now, kills });
  // Running timers first; the rest keep upcoming()'s soonest-first order (sort is stable).
  const ordered = [...entries].sort((a, b) => isActive(b, now) - isActive(a, now));
  const embed = new EmbedBuilder()
    .setTitle(`${config.groups[group].name} · ${config.regions[region].name}`)
    .setColor(ordered.some((entry) => isActive(entry, now)) ? COLOR_ACTIVE : COLOR_IDLE)
    .setFooter({ text: `AION 2 · your local time · updates every ${intervalMinutes} min` })
    .setTimestamp(now.toJSDate());

  if (!ordered.length) return embed.setDescription('No timers configured. Edit `config/timers.json`.');

  let description = '';
  for (const entry of ordered) {
    const next = description ? `${description}\n\n${block(entry, now)}` : block(entry, now);
    if (next.length > DESCRIPTION_LIMIT - 2) {
      description += '\n…';
      break;
    }
    description = next;
  }
  return embed.setDescription(description);
}
