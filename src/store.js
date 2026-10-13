import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_PATH = fileURLToPath(new URL('../data/state.json', import.meta.url));

// state = { guilds: { [guildId]: { channelId, messageId, kills: { [timerId]: epochMs } } } }
export function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { guilds: {} };
    throw err;
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
  return state.guilds[guildId];
}
