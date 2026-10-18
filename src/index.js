import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags, RESTJSONErrorCodes } from 'discord.js';
import { alertMessage, dueAlerts } from './alerts.js';
import { handleInteraction } from './commands.js';
import { buildBoard } from './render.js';
import { factionFor, loadState, regionFor, saveState } from './store.js';
import { loadConfig } from './timers.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const intervalMinutes = Number(process.env.UPDATE_INTERVAL_MINUTES) || 5;
const ALERT_CHECK_MS = 30_000;
const config = loadConfig();
const state = loadState();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/** Re-renders a guild's posted boards: one group's, or all of them. */
async function refreshGuild(guildId, groupId) {
  const groups = state.guilds[guildId]?.groups ?? {};
  const ids = groupId ? [groupId] : Object.keys(groups);
  await Promise.all(ids.map((id) => refreshBoard(guildId, id)));
}

async function refreshBoard(guildId, groupId) {
  const guild = state.guilds[guildId];
  const settings = guild.groups?.[groupId];
  if (!settings?.channelId || !settings?.messageId) return;
  // The group was removed from the config; leave its last board as is.
  if (!config.groups[groupId]) return;
  try {
    const channel = await client.channels.fetch(settings.channelId);
    const embed = buildBoard(config, {
      group: groupId,
      region: regionFor(config, settings),
      faction: factionFor(config, settings),
      kills: guild.kills,
      intervalMinutes,
    });
    await channel.messages.edit(settings.messageId, { embeds: [embed] });
  } catch (err) {
    if (err.code === RESTJSONErrorCodes.UnknownMessage || err.code === RESTJSONErrorCodes.UnknownChannel) {
      console.warn(`${groupId} board in guild ${guildId} was deleted; stopping updates there.`);
      delete settings.channelId;
      delete settings.messageId;
      saveState(state);
    } else {
      console.error(`Failed to update ${groupId} board in guild ${guildId}:`, err.message);
    }
  }
}

async function refreshAll() {
  await Promise.all(Object.keys(state.guilds).map((guildId) => refreshGuild(guildId)));
}

/** Sends role pings for timers spawning soon; each spawn is announced once. */
async function sendAlerts() {
  const sends = [];
  for (const [guildId, guild] of Object.entries(state.guilds)) {
    for (const due of dueAlerts(config, guild)) {
      // Marked before sending so a failing channel isn't retried every check.
      due.alert.sentFor = due.next.toMillis();
      sends.push(sendAlert(guildId, guild, due));
    }
  }
  if (!sends.length) return;
  saveState(state);
  await Promise.all(sends);
}

async function sendAlert(guildId, guild, due) {
  try {
    const channel = await client.channels.fetch(due.alert.channelId);
    await channel.send(alertMessage(due));
  } catch (err) {
    if (err.code === RESTJSONErrorCodes.UnknownChannel) {
      console.warn(`Alert channel for ${due.timer.id} in guild ${guildId} was deleted; removing the alert.`);
      delete guild.alerts[due.timer.id];
      saveState(state);
    } else {
      console.error(`Failed to send ${due.timer.id} alert in guild ${guildId}:`, err.message);
    }
  }
}

const ctx = { config, state, intervalMinutes, refreshGuild };

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}; refreshing boards every ${intervalMinutes} min.`);
  await refreshAll();
  setInterval(refreshAll, intervalMinutes * 60_000);
  await sendAlerts();
  setInterval(() => sendAlerts().catch((err) => console.error('Alert check failed:', err)), ALERT_CHECK_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction(interaction, ctx);
  } catch (err) {
    console.error('Interaction failed:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.login(token);
