import { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import { upcoming } from './timers.js';

const ts = (dt, style) => `<t:${Math.floor(dt.toSeconds())}:${style}>`;

function line({ timer, next }, now) {
  const where = timer.location ? ` · ${timer.location}` : '';
  if (!next) return `**${timer.name}** — unknown, use \`/killed\`${where}`;
  if (next <= now) return `**${timer.name}** — 🟢 up since ${ts(next, 't')} (${ts(next, 'R')})${where}`;
  return `**${timer.name}** — ${ts(next, 'F')} (${ts(next, 'R')})${where}`;
}

export function buildBoard(config, { now = DateTime.utc(), kills = {}, intervalMinutes = 5 } = {}) {
  const entries = upcoming(config, { now, kills });
  const embed = new EmbedBuilder()
    .setTitle('AION 2 Timers')
    .setColor(0x5865f2)
    .setFooter({ text: `Times shown in your local timezone · refreshes every ${intervalMinutes} min · last update` })
    .setTimestamp(now.toJSDate());

  const categories = config.categories ?? {};
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.timer.category ?? 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line(entry, now));
  }

  for (const [key, lines] of groups) {
    // Embed field values cap at 1024 chars; split long categories over several fields.
    let chunk = '';
    let first = true;
    for (const text of lines) {
      if (chunk && chunk.length + text.length + 1 > 1024) {
        embed.addFields({ name: first ? categories[key] ?? key : '​', value: chunk });
        chunk = '';
        first = false;
      }
      chunk += (chunk ? '\n' : '') + text;
    }
    if (chunk) embed.addFields({ name: first ? categories[key] ?? key : '​', value: chunk });
  }

  if (!entries.length) embed.setDescription('No timers configured. Edit `config/timers.json`.');
  return embed;
}
