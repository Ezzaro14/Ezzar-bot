import { ChannelType, RESTJSONErrorCodes } from 'discord.js';
import { saveState } from './store.js';

// Joining the hub again within this time doesn't make another channel, so join/leave spam can't flood the server.
const COOLDOWN_MS = 10_000;
const lastCreated = new Map(); // userId -> epoch ms

/**
 * Someone joining a guild's hub channel gets a new voice channel and is moved into it;
 * a temporary channel is deleted once the last person leaves.
 * guild.tempVoice = { hubId, channels: [channelId] }. `save` is only swapped out by tests.
 */
export async function onVoiceStateUpdate(oldState, newState, state, save = saveState) {
  const tempVoice = state.guilds[newState.guild.id]?.tempVoice;
  if (!tempVoice || oldState.channelId === newState.channelId) return;
  if (tempVoice.channels.includes(oldState.channelId)) {
    await deleteIfEmpty(oldState.guild, oldState.channelId, tempVoice, () => save(state));
  }
  if (newState.channelId && newState.channelId === tempVoice.hubId) await createFor(newState, tempVoice, () => save(state));
}

async function createFor({ member, channel: hub }, tempVoice, save) {
  const now = Date.now();
  if (now - (lastCreated.get(member.id) ?? 0) < COOLDOWN_MS) return;
  lastCreated.set(member.id, now);

  let channel;
  try {
    // Same category and permissions as the hub, so whoever can use the hub can use this one.
    channel = await hub.guild.channels.create({
      name: `${member.displayName}'s channel`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: hub.parentId,
      permissionOverwrites: hub.permissionOverwrites.cache,
      bitrate: hub.bitrate,
      reason: `Temporary voice channel for ${member.user.tag}`,
    });
  } catch (err) {
    console.error(`Failed to create a temporary voice channel in guild ${hub.guild.id}:`, err.message);
    return;
  }
  tempVoice.channels.push(channel.id);
  save();

  try {
    await member.voice.setChannel(channel);
  } catch (err) {
    // Usually they left the hub before the move; then nobody needs the channel.
    console.warn(`Couldn't move ${member.id} to their temporary voice channel in guild ${hub.guild.id}:`, err.message);
    await deleteIfEmpty(hub.guild, channel.id, tempVoice, save);
  }
}

async function deleteIfEmpty(guild, channelId, tempVoice, save) {
  const channel = guild.channels.cache.get(channelId);
  if (channel?.members.size) return;
  tempVoice.channels = tempVoice.channels.filter((id) => id !== channelId);
  save();
  try {
    await channel?.delete('Temporary voice channel is empty');
  } catch (err) {
    if (err.code !== RESTJSONErrorCodes.UnknownChannel) {
      console.error(`Failed to delete temporary voice channel ${channelId} in guild ${guild.id}:`, err.message);
    }
  }
}

/** On startup: deletes temporary channels that emptied while the bot was offline. */
export async function cleanupTempChannels(client, state, save = saveState) {
  for (const [guildId, guild] of Object.entries(state.guilds)) {
    const tempVoice = guild.tempVoice;
    const discordGuild = client.guilds.cache.get(guildId);
    if (!tempVoice?.channels.length || !discordGuild?.available) continue;
    for (const id of [...tempVoice.channels]) await deleteIfEmpty(discordGuild, id, tempVoice, () => save(state));
  }
}

/** Forgets a hub or temporary channel that someone deleted by hand. */
export function onChannelDelete(channel, state, save = saveState) {
  const tempVoice = state.guilds[channel.guildId]?.tempVoice;
  if (!tempVoice) return;
  if (tempVoice.hubId === channel.id) {
    delete tempVoice.hubId;
  } else if (tempVoice.channels.includes(channel.id)) {
    tempVoice.channels = tempVoice.channels.filter((id) => id !== channel.id);
  } else {
    return;
  }
  save(state);
}
