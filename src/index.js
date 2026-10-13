import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags, RESTJSONErrorCodes } from 'discord.js';
import { handleInteraction } from './commands.js';
import { buildBoard } from './render.js';
import { loadState, saveState } from './store.js';
import { loadConfig } from './timers.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const intervalMinutes = Number(process.env.UPDATE_INTERVAL_MINUTES) || 5;
const config = loadConfig();
const state = loadState();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function refreshGuild(guildId) {
  const guild = state.guilds[guildId];
  if (!guild?.channelId || !guild?.messageId) return;
  try {
    const channel = await client.channels.fetch(guild.channelId);
    const embed = buildBoard(config, { kills: guild.kills, intervalMinutes });
    await channel.messages.edit(guild.messageId, { embeds: [embed] });
  } catch (err) {
    if (err.code === RESTJSONErrorCodes.UnknownMessage || err.code === RESTJSONErrorCodes.UnknownChannel) {
      console.warn(`Board in guild ${guildId} was deleted; stopping updates there.`);
      delete guild.channelId;
      delete guild.messageId;
      saveState(state);
    } else {
      console.error(`Failed to update board in guild ${guildId}:`, err.message);
    }
  }
}

async function refreshAll() {
  await Promise.all(Object.keys(state.guilds).map(refreshGuild));
}

const ctx = { config, state, intervalMinutes, refreshGuild };

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}; refreshing boards every ${intervalMinutes} min.`);
  await refreshAll();
  setInterval(refreshAll, intervalMinutes * 60_000);
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
