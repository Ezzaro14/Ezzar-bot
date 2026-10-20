import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupTempChannels, onChannelDelete, onVoiceStateUpdate } from '../src/tempvoice.js';

const noSave = () => {};

/** A guild with a hub voice channel; created channels and moves are recorded. */
function fakeGuild() {
  const guild = { id: 'g1', available: true, created: [], deleted: [] };
  const voiceChannel = (id, extra = {}) => ({
    id,
    guild,
    members: new Map(),
    delete: async () => {
      guild.deleted.push(id);
      guild.channels.cache.delete(id);
    },
    ...extra,
  });
  guild.channels = {
    cache: new Map(),
    create: async (options) => {
      const channel = voiceChannel(`temp${guild.created.length + 1}`);
      guild.created.push(options);
      guild.channels.cache.set(channel.id, channel);
      return channel;
    },
  };
  const hub = voiceChannel('hub', { parentId: 'cat', bitrate: 64000, permissionOverwrites: { cache: 'hub-perms' } });
  guild.channels.cache.set('hub', hub);
  guild.voiceChannel = voiceChannel;
  return guild;
}

let nextUser = 0;
/** A member who moves between channels, keeping the fake channels' member lists in sync. */
function fakeMember(guild, { failMove = false } = {}) {
  const id = `user${++nextUser}`;
  const member = { id, displayName: 'Ezzar', user: { tag: 'ezzar' }, channelId: null };
  const stateAt = (channelId) => ({ guild, member, channelId, channel: guild.channels.cache.get(channelId) });
  member.moveTo = async (state, channelId) => {
    const old = stateAt(member.channelId);
    guild.channels.cache.get(member.channelId)?.members.delete(id);
    member.channelId = channelId;
    guild.channels.cache.get(channelId)?.members.set(id, member);
    await onVoiceStateUpdate(old, stateAt(channelId), state, noSave);
  };
  member.voice = {
    setChannel: async (channel) => {
      if (failMove) throw new Error('Target user is not connected to voice.');
      await member.moveTo(member.state, channel.id);
    },
  };
  return member;
}

const stateFor = (guild, tempVoice) => ({ guilds: { [guild.id]: { tempVoice } } });

test('joining the hub makes a channel like the hub and moves you there', async () => {
  const guild = fakeGuild();
  const state = stateFor(guild, { hubId: 'hub', channels: [] });
  const member = fakeMember(guild);
  member.state = state;

  await member.moveTo(state, 'hub');
  assert.deepEqual(guild.created, [
    {
      name: "Ezzar's channel",
      type: 2,
      parent: 'cat',
      permissionOverwrites: 'hub-perms',
      bitrate: 64000,
      reason: 'Temporary voice channel for ezzar',
    },
  ]);
  assert.equal(member.channelId, 'temp1');
  assert.deepEqual(state.guilds.g1.tempVoice.channels, ['temp1']);
});

test('a temporary channel is deleted once the last person leaves', async () => {
  const guild = fakeGuild();
  const state = stateFor(guild, { hubId: 'hub', channels: [] });
  const [a, b] = [fakeMember(guild), fakeMember(guild)];
  a.state = state;
  await a.moveTo(state, 'hub');
  await b.moveTo(state, 'temp1');

  await a.moveTo(state, null);
  assert.deepEqual(guild.deleted, []);
  await b.moveTo(state, null);
  assert.deepEqual(guild.deleted, ['temp1']);
  assert.deepEqual(state.guilds.g1.tempVoice.channels, []);
});

test('rejoining the hub right away makes no new channel', async () => {
  const guild = fakeGuild();
  const state = stateFor(guild, { hubId: 'hub', channels: [] });
  const member = fakeMember(guild);
  member.state = state;
  await member.moveTo(state, 'hub');
  await member.moveTo(state, 'hub');
  assert.equal(guild.created.length, 1);
  assert.equal(member.channelId, 'hub');
});

test('the channel is deleted again if the move fails', async () => {
  const guild = fakeGuild();
  const state = stateFor(guild, { hubId: 'hub', channels: [] });
  const member = fakeMember(guild, { failMove: true });
  await member.moveTo(state, 'hub');
  assert.deepEqual(guild.deleted, ['temp1']);
  assert.deepEqual(state.guilds.g1.tempVoice.channels, []);
});

test('other channels and guilds without a hub are left alone', async () => {
  const guild = fakeGuild();
  guild.channels.cache.set('lobby', guild.voiceChannel('lobby'));
  const member = fakeMember(guild);
  await member.moveTo(stateFor(guild, { hubId: 'hub', channels: [] }), 'lobby');
  await member.moveTo({ guilds: {} }, 'hub');
  assert.deepEqual(guild.created, []);
});

test('startup cleanup deletes empty and forgets missing channels', async () => {
  const guild = fakeGuild();
  guild.channels.cache.set('empty', guild.voiceChannel('empty'));
  const busy = guild.voiceChannel('busy');
  busy.members.set('someone', {});
  guild.channels.cache.set('busy', busy);
  const state = stateFor(guild, { hubId: 'hub', channels: ['empty', 'busy', 'gone'] });

  await cleanupTempChannels({ guilds: { cache: new Map([['g1', guild]]) } }, state, noSave);
  assert.deepEqual(guild.deleted, ['empty']);
  assert.deepEqual(state.guilds.g1.tempVoice.channels, ['busy']);
});

test('deleting the hub or a temporary channel by hand is forgotten', () => {
  const state = { guilds: { g1: { tempVoice: { hubId: 'hub', channels: ['temp1'] } } } };
  onChannelDelete({ id: 'temp1', guildId: 'g1' }, state, noSave);
  onChannelDelete({ id: 'hub', guildId: 'g1' }, state, noSave);
  assert.deepEqual(state.guilds.g1.tempVoice, { channels: [] });
});
