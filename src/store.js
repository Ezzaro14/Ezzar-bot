import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_PATH = fileURLToPath(new URL('../data/state.json', import.meta.url));

// state = { guilds: { [guildId]: {
//   region, faction,
//   kills: { [timerId]: epochMs },
//   groups: { [groupId]: { channelId, messageId } },
//   alerts: { [timerId]: { roleId, channelId, minutesBefore, sentFor } },
//   tempVoice: { hubId, channels: [channelId] },
// } },
//   reminders: [{ id, userId, channelId, at, text, createdAt }],  (at, createdAt: epoch ms)
//   users: { [userId]: { timezone } } }
export function loadState() {
  let state;
  try {
    state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    state = { guilds: {} };
  }
  state.reminders ??= [];
  state.users ??= {};
  for (const guild of Object.values(state.guilds)) moveGroupSettingsToGuild(guild);
  return state;
}

/** Region and faction used to be set per group; they're now one per server. Keeps the first one a server had picked. */
export function moveGroupSettingsToGuild(guild) {
  for (const settings of Object.values(guild.groups ?? {})) {
    for (const key of ['region', 'faction']) {
      if (!settings[key]) continue;
      guild[key] ??= settings[key];
      delete settings[key];
    }
  }
}

export function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

export function guildState(state, guildId) {
  state.guilds[guildId] ??= { kills: {} };
  state.guilds[guildId].kills ??= {};
  state.guilds[guildId].groups ??= {};
  state.guilds[guildId].alerts ??= {};
  return state.guilds[guildId];
}

export function groupState(guild, groupId) {
  guild.groups[groupId] ??= {};
  return guild.groups[groupId];
}

/** The region a guild picked, falling back to the default if unset or no longer configured. */
export function regionFor(config, guild) {
  return config.regions[guild?.region] ? guild.region : config.defaultRegion;
}

/** The faction a guild picked, like regionFor; null when the config has no factions. */
export function factionFor(config, guild) {
  if (!config.factions) return null;
  return config.factions[guild?.faction] ? guild.faction : config.defaultFaction;
}
