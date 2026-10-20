import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  OAuth2Scopes,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { DateTime } from 'luxon';
import { DEFAULT_MINUTES_BEFORE } from './alerts.js';
import { MAX_REMINDERS, normalizeZone, parseReminder, zoneChoices } from './reminders.js';
import { buildBoard } from './render.js';
import { factionFor, groupState, guildState, regionFor, saveState } from './store.js';
import { hasFactions, shownFor } from './timers.js';

/** One command per timer group (e.g. /events, /bosses), plus /killed, /alerts, /remindme, /reminders, /tempvoice, /invite and /help. */
export function buildCommandData(config) {
  const regionChoices = Object.entries(config.regions).map(([value, region]) => ({ name: region.name, value }));

  const factionChoices = Object.entries(config.factions ?? {}).map(([value, faction]) => ({ name: faction.name, value }));

  const groupCommands = Object.entries(config.groups).map(([id, group]) => {
    const command = new SlashCommandBuilder()
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
      );
    if (hasFactions(config, id)) {
      command.addSubcommand((sub) =>
        sub
          .setName('faction')
          .setDescription(`Show or set which faction's ${group.name.toLowerCase()} to show`)
          .addStringOption((opt) =>
            opt
              .setName('faction')
              .setDescription('New faction (leave empty to see the current one)')
              .addChoices(...factionChoices),
          ),
      );
    }
    return command;
  });

  const killed = new SlashCommandBuilder()
    .setName('killed')
    .setDescription('Record a boss kill to start its respawn timer')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('boss').setDescription('Which boss').setRequired(true).setAutocomplete(true))
    .addIntegerOption((opt) =>
      opt.setName('minutes_ago').setDescription('How long ago it died (default: just now)').setMinValue(0),
    );

  const timerOption = (opt) =>
    opt.setName('timer').setDescription('Boss or event').setRequired(true).setAutocomplete(true);
  const alerts = new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Ping a role before a boss or event spawns')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Ping a role before a boss or event spawns')
        .addStringOption(timerOption)
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to ping').setRequired(true))
        .addIntegerOption((opt) =>
          opt
            .setName('minutes_before')
            .setDescription(`How early to ping (default: ${DEFAULT_MINUTES_BEFORE})`)
            .setMinValue(1)
            .setMaxValue(1440),
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Where to ping (defaults to this channel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) => sub.setName('remove').setDescription('Stop pinging for a boss or event').addStringOption(timerOption))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the alerts set up in this server'));

  const remindme = new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Get a reminder, e.g. "in 12 hours to wash dishes" or "at 2pm tuesday to fix my car"')
    .addStringOption((opt) =>
      opt.setName('reminder').setDescription('When and what, e.g. "in 12 hours to wash dishes"').setRequired(true).setMaxLength(500),
    );

  const reminders = new SlashCommandBuilder()
    .setName('reminders')
    .setDescription('See or cancel your reminders, or set your time zone')
    .addSubcommand((sub) => sub.setName('list').setDescription('Show your reminders'))
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel a reminder')
        .addStringOption((opt) =>
          opt.setName('reminder').setDescription('Which reminder').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('timezone')
        .setDescription('Show or set your time zone, used for times like "at 2pm"')
        .addStringOption((opt) =>
          opt
            .setName('timezone')
            .setDescription('e.g. Europe/Berlin (leave empty to see the current one)')
            .setAutocomplete(true),
        ),
    );

  const tempvoice = new SlashCommandBuilder()
    .setName('tempvoice')
    .setDescription('Joining a voice channel gives you your own, deleted once empty')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Pick the voice channel people join to get their own')
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Voice channel to join').setRequired(true).addChannelTypes(ChannelType.GuildVoice),
        ),
    )
    .addSubcommand((sub) => sub.setName('off').setDescription('Stop making temporary voice channels'))
    .addSubcommand((sub) => sub.setName('show').setDescription('Show which voice channel makes temporary ones'));

  const invite = new SlashCommandBuilder().setName('invite').setDescription('Get a link to add this bot to your server');

  const help = new SlashCommandBuilder().setName('help').setDescription('List all commands');

  return [...groupCommands, killed, alerts, remindme, reminders, tempvoice, invite, help].map((command) => command.toJSON());
}

/** /help: every command with its subcommands or options, built from the command definitions. */
export function helpEmbed(config) {
  const usage = (opt) => `\`${opt.required ? opt.name : `[${opt.name}]`}\``;
  const lines = buildCommandData(config).map((command) => {
    const options = command.options ?? [];
    const subcommands = options.filter((o) => o.type === ApplicationCommandOptionType.Subcommand);
    const detail = subcommands.length ? subcommands.map((o) => `\`${o.name}\``) : options.map(usage);
    return [`**/${command.name}** - ${command.description}`, detail.join(' ')].filter(Boolean).join('\n');
  });
  return new EmbedBuilder()
    .setTitle('Commands')
    .setColor(0x5865f2)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: 'Posting boards, setting region or faction, and changing alerts or temp voice need Manage Server' });
}

const canManage = (interaction) => interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
// Mentions in replies are shown but never ping.
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const NEED_MANAGE = 'You need the Manage Server permission.';

/** Name plus location, so bosses that share a name (e.g. both Silent Dartans) can be told apart. */
const timerLabel = (timer) => (timer.location ? `${timer.name} (${timer.location})` : timer.name);

// What the bot needs in a channel to post a board there; alerts are plain text and skip Embed Links.
const REQUIRED = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
];
const REQUIRED_FOR_ALERTS = REQUIRED.slice(0, 2);
// In the hub channel, which temporary channels copy their permissions from; Manage Channels is checked on its category.
const REQUIRED_FOR_TEMP_VOICE = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.Connect, 'Connect'],
  [PermissionFlagsBits.MoveMembers, 'Move Members'],
];

/** Names of the `required` permissions the bot lacks in `channel` (all of them if it can't be checked). */
export function missingPermissions(channel, me, required = REQUIRED) {
  const perms = me && channel?.permissionsFor?.(me);
  if (!perms) return required.map(([, name]) => name);
  return required.filter(([flag]) => !perms.has(flag)).map(([, name]) => name);
}

/** Adds the bot as a member (bot scope) with its commands and the permissions boards and temp voice need. */
const inviteLink = (client) =>
  client.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: [...REQUIRED, ...REQUIRED_FOR_TEMP_VOICE].map(([flag]) => flag).concat(PermissionFlagsBits.ManageChannels),
  });

const notAMember = (client) =>
  `I'm not a member of this server, so I can't post here (only my commands were added).\n` +
  `Add me with this link, then try again: ${inviteLink(client)}`;

const cantPost = (channelId, missing) =>
  `I can't post in <#${channelId}>. I'm missing: **${missing.join('**, **')}**.\n` +
  `Fix: Edit Channel → Permissions → add my role and allow those.`;

/** The "channel" option (or the current channel), if the bot is a member and may post there; otherwise an error. */
async function targetChannel(interaction, required) {
  // Installed with only the applications.commands scope: commands work, but the bot isn't a member.
  if (!interaction.inCachedGuild()) return { error: notAMember(interaction.client) };
  const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
  const channel =
    interaction.guild.channels.cache.get(channelId) ??
    (await interaction.client.channels.fetch(channelId).catch(() => null));
  const missing = missingPermissions(channel, interaction.guild.members.me, required);
  return missing.length ? { error: cantPost(channelId, missing) } : { channel };
}

/** ctx = { config, state, intervalMinutes, refreshGuild(guildId, groupId?) } */
export async function handleInteraction(interaction, ctx) {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'reminders') return autocompleteReminders(interaction, ctx);
    return autocompleteTimer(interaction, ctx);
  }
  if (!interaction.isChatInputCommand()) return;

  // /help, /invite and reminders work anywhere, DMs included.
  if (interaction.commandName === 'remindme') return handleRemindme(interaction, ctx);
  if (interaction.commandName === 'reminders') return handleReminders(interaction, ctx);
  if (interaction.commandName === 'help') {
    return interaction.reply({ embeds: [helpEmbed(ctx.config)], flags: MessageFlags.Ephemeral });
  }
  if (interaction.commandName === 'invite') {
    const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Add to server').setURL(inviteLink(interaction.client));
    return interaction.reply({
      content: 'Add Ezzar-bot to your server. You need **Manage Server** there.',
      components: [new ActionRowBuilder().addComponents(button)],
    });
  }

  if (!interaction.guildId) return;

  const guild = guildState(ctx.state, interaction.guildId);

  if (interaction.commandName === 'killed') {
    const timer = ctx.config.timers.find((t) => t.type === 'respawn' && t.id === interaction.options.getString('boss'));
    if (!timer) return interaction.reply(ephemeral('Unknown boss. Pick one from the list.'));
    const minutesAgo = interaction.options.getInteger('minutes_ago') ?? 0;
    guild.kills[timer.id] = Date.now() - minutesAgo * 60_000;
    saveState(ctx.state);
    await ctx.refreshGuild(interaction.guildId, timer.group);
    const respawn = Math.floor((guild.kills[timer.id] + timer.respawnMinutes * 60_000) / 1000);
    return interaction.reply(`**${timerLabel(timer)}** killed. Respawns <t:${respawn}:F> (<t:${respawn}:R>).`);
  }

  if (interaction.commandName === 'alerts') return handleAlerts(interaction, ctx, guild);
  if (interaction.commandName === 'tempvoice') return handleTempVoice(interaction, ctx, guild);

  const groupId = interaction.commandName;
  const group = ctx.config.groups[groupId];
  if (!group) return;
  const settings = groupState(guild, groupId);
  const board = () =>
    buildBoard(ctx.config, {
      group: groupId,
      region: regionFor(ctx.config, settings),
      faction: factionFor(ctx.config, settings),
      kills: guild.kills,
      intervalMinutes: ctx.intervalMinutes,
    });

  switch (interaction.options.getSubcommand()) {
    case 'show':
      return interaction.reply({ embeds: [board()], flags: MessageFlags.Ephemeral });

    case 'post': {
      if (!canManage(interaction)) return interaction.reply(ephemeral(NEED_MANAGE));
      const { channel, error } = await targetChannel(interaction, REQUIRED);
      if (error) return interaction.reply(ephemeral(error));
      let message;
      try {
        message = await channel.send({ embeds: [board()] });
      } catch (err) {
        console.error(`Posting ${groupId} board in channel ${channel.id} failed:`, err.message);
        return interaction.reply(ephemeral(cantPost(channel.id, REQUIRED.map(([, name]) => name))));
      }
      await deleteOldBoard(interaction.client, settings);
      settings.channelId = channel.id;
      settings.messageId = message.id;
      saveState(ctx.state);
      return interaction.reply(ephemeral(`${group.name} board posted in ${channel}.`));
    }

    case 'stop': {
      if (!canManage(interaction)) return interaction.reply(ephemeral(NEED_MANAGE));
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
      if (!canManage(interaction)) return interaction.reply(ephemeral(NEED_MANAGE));
      if (!ctx.config.regions[region]) return interaction.reply(ephemeral('Unknown region. Pick one from the list.'));
      settings.region = region;
      saveState(ctx.state);
      await ctx.refreshGuild(interaction.guildId, groupId);
      return interaction.reply(ephemeral(`${group.name} now use the **${ctx.config.regions[region].name}** region.`));
    }

    case 'faction': {
      const faction = interaction.options.getString('faction');
      if (!faction) {
        const current = ctx.config.factions[factionFor(ctx.config, settings)];
        return interaction.reply(ephemeral(`${group.name} show **${current.name}** bosses.`));
      }
      if (!canManage(interaction)) return interaction.reply(ephemeral(NEED_MANAGE));
      if (!ctx.config.factions?.[faction]) return interaction.reply(ephemeral('Unknown faction. Pick one from the list.'));
      settings.faction = faction;
      saveState(ctx.state);
      await ctx.refreshGuild(interaction.guildId, groupId);
      return interaction.reply(ephemeral(`${group.name} now show **${ctx.config.factions[faction].name}** bosses.`));
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

async function handleAlerts(interaction, ctx, guild) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const lines = Object.entries(guild.alerts).map(([timerId, alert]) => {
      const timer = ctx.config.timers.find((t) => t.id === timerId);
      const name = timer ? timerLabel(timer) : timerId;
      return `**${name}** - <@&${alert.roleId}> in <#${alert.channelId}>, ${alert.minutesBefore} min before`;
    });
    return interaction.reply(ephemeral(lines.length ? lines.join('\n') : 'No alerts set. Add one with `/alerts set`.'));
  }

  if (!canManage(interaction)) return interaction.reply(ephemeral(NEED_MANAGE));
  const timer = ctx.config.timers.find((t) => t.id === interaction.options.getString('timer'));
  if (!timer) return interaction.reply(ephemeral('Unknown boss or event. Pick one from the list.'));

  if (sub === 'remove') {
    if (!guild.alerts[timer.id]) return interaction.reply(ephemeral(`There's no alert for **${timerLabel(timer)}**.`));
    delete guild.alerts[timer.id];
    saveState(ctx.state);
    return interaction.reply(ephemeral(`Alert for **${timerLabel(timer)}** removed.`));
  }

  // set
  const role = interaction.options.getRole('role');
  if (role.id === interaction.guildId) return interaction.reply(ephemeral('Pick a specific role, not @everyone.'));
  const { channel, error } = await targetChannel(interaction, REQUIRED_FOR_ALERTS);
  if (error) return interaction.reply(ephemeral(error));
  const minutesBefore = interaction.options.getInteger('minutes_before') ?? DEFAULT_MINUTES_BEFORE;
  guild.alerts[timer.id] = { roleId: role.id, channelId: channel.id, minutesBefore };
  saveState(ctx.state);

  const notes = [];
  if (timer.type === 'respawn') notes.push('It counts from the kill time recorded with `/killed`.');
  const canPing =
    role.mentionable || channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.MentionEveryone);
  if (!canPing) {
    notes.push(
      `${role} can't be mentioned, so the ping won't notify anyone. Fix: Server Settings → Roles → ${role.name} → ` +
        `turn on "Allow anyone to @mention this role".`,
    );
  }
  return interaction.reply(
    ephemeral(
      [`I'll ping ${role} in ${channel} ${minutesBefore} min before **${timerLabel(timer)}** spawns.`, ...notes].join('\n'),
    ),
  );
}

async function handleTempVoice(interaction, ctx, guild) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'show') {
    const hubId = guild.tempVoice?.hubId;
    return interaction.reply(
      ephemeral(hubId ? `Joining <#${hubId}> makes a temporary voice channel.` : 'Off. Turn it on with `/tempvoice set`.'),
    );
  }

  if (!canManage(interaction)) return interaction.reply(ephemeral(NEED_MANAGE));

  if (sub === 'off') {
    // Channels already made stay tracked, so they're still deleted once empty.
    if (guild.tempVoice) delete guild.tempVoice.hubId;
    saveState(ctx.state);
    return interaction.reply(ephemeral('Temporary voice channels are off. Existing ones are deleted once empty.'));
  }

  // set
  if (!interaction.inCachedGuild()) return interaction.reply(ephemeral(notAMember(interaction.client)));
  const hub = interaction.options.getChannel('channel');
  const me = interaction.guild.members.me;
  const missing = missingPermissions(hub, me, REQUIRED_FOR_TEMP_VOICE);
  const canCreate = (hub.parent ? hub.parent.permissionsFor(me) : me.permissions).has(PermissionFlagsBits.ManageChannels);
  if (!canCreate) missing.push('Manage Channels');
  if (missing.length) {
    return interaction.reply(
      ephemeral(
        `I can't make temporary channels from ${hub}. I'm missing: **${missing.join('**, **')}**.\n` +
          `Fix: Server Settings → Roles → my role, and allow those.`,
      ),
    );
  }
  guild.tempVoice = { channels: [], ...guild.tempVoice, hubId: hub.id };
  saveState(ctx.state);
  return interaction.reply(
    ephemeral(`Joining ${hub} now makes a temporary voice channel with the same permissions. It's deleted once empty.`),
  );
}

const userReminders = (ctx, userId) =>
  ctx.state.reminders.filter((r) => r.userId === userId).sort((a, b) => a.at - b.at);

async function handleRemindme(interaction, ctx) {
  const userId = interaction.user.id;
  if (userReminders(ctx, userId).length >= MAX_REMINDERS) {
    return interaction.reply(ephemeral(`You have ${MAX_REMINDERS} reminders already. Cancel one with \`/reminders cancel\` first.`));
  }
  const zone = ctx.state.users[userId]?.timezone;
  const parsed = parseReminder(interaction.options.getString('reminder'), { zone });
  if (parsed.error) return interaction.reply(ephemeral(parsed.error));

  const at = parsed.at.toMillis();
  ctx.state.reminders.push({
    id: randomUUID(),
    userId,
    channelId: interaction.channelId,
    at,
    text: parsed.text,
    createdAt: Date.now(),
  });
  saveState(ctx.state);
  const what = parsed.text ? `: **${parsed.text}**` : '.';
  const when = `<t:${Math.floor(at / 1000)}:F> (<t:${Math.floor(at / 1000)}:R>)`;
  return interaction.reply(ephemeral(`I'll DM you ${when}${what}`));
}

async function handleReminders(interaction, ctx) {
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const lines = userReminders(ctx, userId).map((r) => {
      const at = Math.floor(r.at / 1000);
      return `<t:${at}:F> (<t:${at}:R>)${r.text ? ` - ${r.text}` : ''}`;
    });
    return interaction.reply(ephemeral(lines.length ? lines.join('\n') : 'No reminders. Add one with `/remindme`.'));
  }

  if (sub === 'cancel') {
    const id = interaction.options.getString('reminder');
    const index = ctx.state.reminders.findIndex((r) => r.id === id && r.userId === userId);
    if (index === -1) return interaction.reply(ephemeral('Unknown reminder. Pick one from the list.'));
    const [reminder] = ctx.state.reminders.splice(index, 1);
    saveState(ctx.state);
    return interaction.reply(ephemeral(`Reminder${reminder.text ? ` **${reminder.text}**` : ''} cancelled.`));
  }

  // timezone
  const input = interaction.options.getString('timezone');
  const current = ctx.state.users[userId]?.timezone;
  if (!input) {
    return interaction.reply(
      ephemeral(current ? `Your time zone is **${current}**.` : 'No time zone set. Set one with `/reminders timezone`.'),
    );
  }
  const zone = normalizeZone(input);
  if (!zone) return interaction.reply(ephemeral('Unknown time zone. Pick one from the list, e.g. Europe/Berlin.'));
  ctx.state.users[userId] = { ...ctx.state.users[userId], timezone: zone };
  saveState(ctx.state);
  const localNow = DateTime.now().setZone(zone).toFormat('ccc HH:mm');
  return interaction.reply(ephemeral(`Your time zone is now **${zone}** (it's ${localNow} there).`));
}

/** /reminders cancel: the user's reminders. /reminders timezone: time zones. */
function autocompleteReminders(interaction, ctx) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'timezone') return interaction.respond(zoneChoices(focused.value));

  // Choice names can't show Discord timestamps, so the time is written out in the user's zone.
  const zone = ctx.state.users[interaction.user.id]?.timezone ?? 'UTC';
  const query = focused.value.toLowerCase();
  const choices = userReminders(ctx, interaction.user.id)
    .map((r) => {
      const when = DateTime.fromMillis(r.at, { zone }).toFormat(zone === 'UTC' ? "ccc d LLL HH:mm 'UTC'" : 'ccc d LLL HH:mm');
      return { name: (r.text ? `${when} - ${r.text}` : when).slice(0, 100), value: r.id };
    })
    .filter((choice) => choice.name.toLowerCase().includes(query))
    .slice(0, 25);
  return interaction.respond(choices);
}

/**
 * /killed: respawn bosses. /alerts set: everything. Both only list the faction picked for the timer's group.
 * /alerts remove: timers with an alert.
 */
function autocompleteTimer(interaction, ctx) {
  const query = interaction.options.getFocused().toLowerCase();
  const guild = interaction.guildId ? guildState(ctx.state, interaction.guildId) : { groups: {}, alerts: {} };
  let timers = ctx.config.timers;
  if (interaction.commandName === 'alerts' && interaction.options.getSubcommand() === 'remove') {
    timers = timers.filter((t) => guild.alerts[t.id]);
  } else {
    timers = timers.filter((t) => shownFor(t, factionFor(ctx.config, guild.groups[t.group])));
    if (interaction.commandName === 'killed') timers = timers.filter((t) => t.type === 'respawn');
  }
  const choices = timers
    .filter((t) => timerLabel(t).toLowerCase().includes(query))
    .slice(0, 25)
    .map((t) => ({ name: timerLabel(t).slice(0, 100), value: t.id }));
  return interaction.respond(choices);
}
