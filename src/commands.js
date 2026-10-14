import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildBoard } from './render.js';
import { groupState, guildState, regionFor, saveState } from './store.js';

/** One command per timer group (e.g. /events, /bosses), plus /killed. */
export function buildCommandData(config) {
  const regionChoices = Object.entries(config.regions).map(([value, region]) => ({ name: region.name, value }));

  const groupCommands = Object.entries(config.groups).map(([id, group]) =>
    new SlashCommandBuilder()
      .setName(id)
      .setDescription(group.description)
      .setDMPermission(false)
      .addSubcommand((sub) => sub.setName('show').setDescription(`Show ${group.name.toLowerCase()} just to you`))
      .addSubcommand((sub) =>
        sub
          .setName('post')
          .setDescription('Post an auto-updating board in a channel')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Where to post (defaults to this channel)')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((sub) => sub.setName('stop').setDescription('Stop updating the board'))
      .addSubcommand((sub) =>
        sub
          .setName('region')
          .setDescription(`Show or set the server region used for ${group.name.toLowerCase()}`)
          .addStringOption((opt) =>
            opt
              .setName('region')
              .setDescription('New region (leave empty to see the current one)')
              .addChoices(...regionChoices),
          ),
      ),
  );

  const killed = new SlashCommandBuilder()
    .setName('killed')
    .setDescription('Record a boss kill to start its respawn timer')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('boss').setDescription('Which boss').setRequired(true).setAutocomplete(true))
    .addIntegerOption((opt) =>
      opt.setName('minutes_ago').setDescription('How long ago it died (default: just now)').setMinValue(0),
    );

  return [...groupCommands, killed].map((command) => command.toJSON());
}

const canManage = (interaction) => interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

// What the bot needs in a channel to post a board there.
const REQUIRED = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
];

/** Names of the REQUIRED permissions the bot lacks in `channel` (all of them if it can't be checked). */
export function missingPermissions(channel, me) {
  const perms = me && channel?.permissionsFor?.(me);
  if (!perms) return REQUIRED.map(([, name]) => name);
  return REQUIRED.filter(([flag]) => !perms.has(flag)).map(([, name]) => name);
}

const cantPost = (channelId, missing) =>
  `I can't post in <#${channelId}>. I'm missing: **${missing.join('**, **')}**.\n` +
  `Fix: Edit Channel → Permissions → add my role and allow those.`;

/** ctx = { config, state, intervalMinutes, refreshGuild(guildId, groupId?) } */
export async function handleInteraction(interaction, ctx) {
  if (interaction.isAutocomplete()) return autocompleteBoss(interaction, ctx);
  if (!interaction.isChatInputCommand() || !interaction.guildId) return;

  const guild = guildState(ctx.state, interaction.guildId);

  if (interaction.commandName === 'killed') {
    const timer = ctx.config.timers.find((t) => t.type === 'respawn' && t.id === interaction.options.getString('boss'));
    if (!timer) return interaction.reply(ephemeral('Unknown boss. Pick one from the list.'));
    const minutesAgo = interaction.options.getInteger('minutes_ago') ?? 0;
    guild.kills[timer.id] = Date.now() - minutesAgo * 60_000;
    saveState(ctx.state);
    await ctx.refreshGuild(interaction.guildId, timer.group);
    const respawn = Math.floor((guild.kills[timer.id] + timer.respawnMinutes * 60_000) / 1000);
    return interaction.reply(`**${timer.name}** killed. Respawns <t:${respawn}:F> (<t:${respawn}:R>).`);
  }

  const groupId = interaction.commandName;
  const group = ctx.config.groups[groupId];
  if (!group) return;
  const settings = groupState(guild, groupId);
  const board = () =>
    buildBoard(ctx.config, {
      group: groupId,
      region: regionFor(ctx.config, settings),
      kills: guild.kills,
      intervalMinutes: ctx.intervalMinutes,
    });

  switch (interaction.options.getSubcommand()) {
    case 'show':
      return interaction.reply({ embeds: [board()], flags: MessageFlags.Ephemeral });

    case 'post': {
      if (!canManage(interaction)) return interaction.reply(ephemeral('You need the Manage Server permission.'));
      const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
      const channel =
        interaction.guild?.channels.cache.get(channelId) ??
        (await interaction.client.channels.fetch(channelId).catch(() => null));
      const missing = missingPermissions(channel, interaction.guild?.members.me);
      if (missing.length) return interaction.reply(ephemeral(cantPost(channelId, missing)));
      let message;
      try {
        message = await channel.send({ embeds: [board()] });
      } catch (err) {
        console.error(`Posting ${groupId} board in channel ${channelId} failed:`, err.message);
        return interaction.reply(ephemeral(cantPost(channelId, REQUIRED.map(([, name]) => name))));
      }
      await deleteOldBoard(interaction.client, settings);
      settings.channelId = channel.id;
      settings.messageId = message.id;
      saveState(ctx.state);
      return interaction.reply(ephemeral(`${group.name} board posted in ${channel}.`));
    }

    case 'stop': {
      if (!canManage(interaction)) return interaction.reply(ephemeral('You need the Manage Server permission.'));
      await deleteOldBoard(interaction.client, settings);
      delete settings.channelId;
      delete settings.messageId;
      saveState(ctx.state);
      return interaction.reply(ephemeral(`${group.name} board removed.`));
    }

    case 'region': {
      const region = interaction.options.getString('region');
      if (!region) {
        const current = ctx.config.regions[regionFor(ctx.config, settings)];
        return interaction.reply(ephemeral(`${group.name} use the **${current.name}** region.`));
      }
      if (!canManage(interaction)) return interaction.reply(ephemeral('You need the Manage Server permission.'));
      if (!ctx.config.regions[region]) return interaction.reply(ephemeral('Unknown region. Pick one from the list.'));
      settings.region = region;
      saveState(ctx.state);
      await ctx.refreshGuild(interaction.guildId, groupId);
      return interaction.reply(ephemeral(`${group.name} now use the **${ctx.config.regions[region].name}** region.`));
    }
  }
}

async function deleteOldBoard(client, settings) {
  if (!settings.channelId || !settings.messageId) return;
  try {
    const channel = await client.channels.fetch(settings.channelId);
    await channel.messages.delete(settings.messageId);
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
