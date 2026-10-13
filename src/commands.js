import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildBoard } from './render.js';
import { guildState, saveState } from './store.js';

export const commandData = [
  new SlashCommandBuilder()
    .setName('timers')
    .setDescription('AION 2 timers')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('show').setDescription('Show the timers just to you'))
    .addSubcommand((sub) =>
      sub
        .setName('post')
        .setDescription('Post an auto-updating timer board in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Where to post (defaults to this channel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop updating the timer board')),

  new SlashCommandBuilder()
    .setName('killed')
    .setDescription('Record a boss kill to start its respawn timer')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('boss').setDescription('Which boss').setRequired(true).setAutocomplete(true))
    .addIntegerOption((opt) =>
      opt.setName('minutes_ago').setDescription('How long ago it died (default: just now)').setMinValue(0),
    ),
].map((command) => command.toJSON());

const canManage = (interaction) => interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

/** ctx = { config, state, intervalMinutes, refreshGuild(guildId) } */
export async function handleInteraction(interaction, ctx) {
  if (interaction.isAutocomplete()) return autocompleteBoss(interaction, ctx);
  if (!interaction.isChatInputCommand() || !interaction.guildId) return;

  const guild = guildState(ctx.state, interaction.guildId);

  if (interaction.commandName === 'killed') {
    const timer = ctx.config.timers.find((t) => t.type === 'respawn' && t.id === interaction.options.getString('boss'));
    if (!timer) {
      return interaction.reply({ content: 'Unknown boss. Pick one from the list.', flags: MessageFlags.Ephemeral });
    }
    const minutesAgo = interaction.options.getInteger('minutes_ago') ?? 0;
    guild.kills[timer.id] = Date.now() - minutesAgo * 60_000;
    saveState(ctx.state);
    await ctx.refreshGuild(interaction.guildId);
    const respawn = Math.floor((guild.kills[timer.id] + timer.respawnMinutes * 60_000) / 1000);
    return interaction.reply(`**${timer.name}** killed. Respawns <t:${respawn}:F> (<t:${respawn}:R>).`);
  }

  switch (interaction.options.getSubcommand()) {
    case 'show': {
      const embed = buildBoard(ctx.config, { kills: guild.kills, intervalMinutes: ctx.intervalMinutes });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    case 'post': {
      if (!canManage(interaction)) {
        return interaction.reply({ content: 'You need the Manage Server permission.', flags: MessageFlags.Ephemeral });
      }
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      const embed = buildBoard(ctx.config, { kills: guild.kills, intervalMinutes: ctx.intervalMinutes });
      let message;
      try {
        message = await channel.send({ embeds: [embed] });
      } catch {
        return interaction.reply({
          content: `I can't post in ${channel}. Check that I can view the channel, send messages and embed links.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      await deleteOldBoard(interaction.client, guild);
      guild.channelId = channel.id;
      guild.messageId = message.id;
      saveState(ctx.state);
      return interaction.reply({ content: `Timer board posted in ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    case 'stop': {
      if (!canManage(interaction)) {
        return interaction.reply({ content: 'You need the Manage Server permission.', flags: MessageFlags.Ephemeral });
      }
      await deleteOldBoard(interaction.client, guild);
      delete guild.channelId;
      delete guild.messageId;
      saveState(ctx.state);
      return interaction.reply({ content: 'Timer board removed.', flags: MessageFlags.Ephemeral });
    }
  }
}

async function deleteOldBoard(client, guild) {
  if (!guild.channelId || !guild.messageId) return;
  try {
    const channel = await client.channels.fetch(guild.channelId);
    await channel.messages.delete(guild.messageId);
  } catch {
    // Already gone or no access; nothing to clean up.
  }
}

function autocompleteBoss(interaction, ctx) {
  const query = interaction.options.getFocused().toLowerCase();
  const choices = ctx.config.timers
    .filter((t) => t.type === 'respawn' && t.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((t) => ({ name: t.name, value: t.id }));
  return interaction.respond(choices);
}
