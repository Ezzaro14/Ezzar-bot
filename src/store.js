import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_PATH = fileURLToPath(new URL('../data/state.json', import.meta.url));

// state = { guilds: { [guildId]: {
//   kills: { [timerId]: epochMs },
//   groups: { [groupId]: { region, faction, channelId, messageId } },
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
  return state;
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

/** The region a guild picked for a group, falling back to the default if unset or no longer configured. */
export function regionFor(config, settings) {
  return config.regions[settings?.region] ? settings.region : config.defaultRegion;
}

/** The faction a guild picked for a group, like regionFor; null when the config has no factions. */
export function factionFor(config, settings) {
  if (!config.factions) return null;
  return config.factions[settings?.faction] ? settings.faction : config.defaultFaction;
}
