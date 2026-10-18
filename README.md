# Ezzar-bot

AION 2 global-server timers in Discord, shown in your local time.

| Command | What |
| --- | --- |
| `/events` | Shugo Festival, Spacetime Rift, Dimensional Invasion, Artifact Siege |
| `/bosses` | Siege bosses, Nahma, Watcher Kaira, Gartua, Dartan |
| `/resets` | Daily and weekly reset |

Each command has:

- `show`: see the timers (only you)
- `post [channel]`: post a board that keeps itself updated
- `stop`: remove the board

## Server region

Each command has its own region, so `/events` and `/bosses` can use different ones.

| Command | What |
| --- | --- |
| `/events region` | Show the current region |
| `/events region Europe` | Set the region |
| `/bosses region NA East` | Same for bosses |
| `/resets region Asia` | Same for resets |

Regions: NA East, NA West, Europe, South America, Asia. Default: Europe.

## Faction

`/bosses` only shows your faction's field bosses (Gartua, Dartan).

| Command | What |
| --- | --- |
| `/bosses faction` | Show the current faction |
| `/bosses faction Elyos` | Switch faction |

Default: Asmodian.

## Field bosses

Gartua and Dartan respawn a set time after they die, so they start counting once someone
records the kill:

| Command | What |
| --- | --- |
| `/killed Eternal Gartua` | Killed just now |
| `/killed Silent Dartan (Altgard) minutes_ago:20` | Killed 20 minutes ago |

## Alerts

Ping a role before a boss or event spawns.

| Command | What |
| --- | --- |
| `/alerts set Eternal Gartua @Bosses` | Ping @Bosses 15 minutes before, in this channel |
| `/alerts set Executor Argo @Siege minutes_before:10 channel:#pings` | Custom time and channel |
| `/alerts list` | Show all alerts |
| `/alerts remove Eternal Gartua` | Stop the alert |

The role must allow @mentions (Server Settings → Roles → Allow anyone to @mention this role).

`post`, `stop`, setting a region or faction and changing alerts need **Manage Server**.
