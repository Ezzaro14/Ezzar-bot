# Ezzar-bot

AION 2 global-server timers in Discord, shown in your local time.

| Command | What |
| --- | --- |
| `/events` | Shugo Festival, Spacetime Rift, Dimensional Invasion, Artifact Siege |
| `/bosses` | Abyss bosses: siege bosses, Nahma, Watcher Kaira |
| `/fieldbosses` | Gartua, Dartan, Lagta, Kashapa in your faction's home map |
| `/resets` | Daily and weekly reset |

Each command has:

- `show`: see the timers (only you)
- `post [channel]`: post a board that keeps itself updated
- `stop`: remove the board

## Server region

One region for the whole server, used by every timer, board and alert.

| Command | What |
| --- | --- |
| `/region` | Show the current region |
| `/region Europe` | Set the region |

Regions: NA East, NA West, Europe, South America, Asia. Default: Europe.

## Faction

`/fieldbosses`, `/killed` and alerts only show your faction's field bosses.

| Command | What |
| --- | --- |
| `/faction` | Show the current faction |
| `/faction Elyos` | Switch faction |

Default: Asmodian.

## Field bosses

Gartua, Dartan, Lagta and Kashapa respawn a set time after they die, so they start counting
once someone records the kill, or how long is left until the respawn:

| Command | What |
| --- | --- |
| `/killed Eternal Gartua` | Killed just now |
| `/killed Silent Dartan minutes_ago:20` | Killed 20 minutes ago |
| `/killed High Commander Lagta spawns_in:4h 25m` | Respawns in 4 hours 25 minutes |

`spawns_in` also understands `4 hrs 25 mins`, `4 hours and 25 minutes`, `90 min` and `4:25`.

## Alerts

Ping a role before a boss or event spawns. The ping is deleted once it has spawned.

| Command | What |
| --- | --- |
| `/alerts set Eternal Gartua @Bosses` | Ping @Bosses 15 minutes before, in this channel |
| `/alerts set Executor Argo @Siege minutes_before:10 channel:#pings` | Custom time and channel |
| `/alerts list` | Show all alerts |
| `/alerts remove Eternal Gartua` | Stop the alert |

The role must allow @mentions (Server Settings → Roles → Allow anyone to @mention this role).

## Reminders

Personal reminders, sent to you by DM (or in the channel you set them in, if your DMs are closed).

| Command | What |
| --- | --- |
| `/remindme in 12 hours to wash dishes` | Remind you in 12 hours |
| `/remindme at 2pm tuesday to fix my car` | Remind you at a clock time |
| `/reminders list` | Show your reminders |
| `/reminders cancel` | Cancel one |
| `/reminders timezone Europe/Berlin` | Set your time zone |

Clock times like "at 2pm" need your time zone, so set it once with `/reminders timezone`.
Relative times like "in 12 hours" work without it. Up to 25 reminders, at most a year ahead.

## Temporary voice channels

Pick a voice channel to act as a lobby. Whoever joins it gets their own voice channel, in the
same category and with the same permissions, and is moved into it. The channel is deleted once
everyone has left.

| Command | What |
| --- | --- |
| `/tempvoice set #Create-channel` | Joining #Create-channel makes a new voice channel |
| `/tempvoice show` | Show which channel does that |
| `/tempvoice off` | Turn it off |

The bot needs **Manage Channels**, **Move Members** and **Connect**. Servers that added it before
this feature need to give its role those; `/tempvoice set` says what's missing.

## Other

| Command | What |
| --- | --- |
| `/help` | List all commands |
| `/invite` | Get a link to add the bot to your server |

`post`, `stop`, setting a region or faction, changing alerts and `/tempvoice set` or `off` need **Manage Server**.
