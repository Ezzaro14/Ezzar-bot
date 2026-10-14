# Ezzar-bot

AION 2 global-server timers in Discord, shown in your local time.

| Command | What |
| --- | --- |
| `/events` | Shugo Festival, Spacetime Rift, Dimensional Invasion, Artifact Siege |
| `/bosses` | Siege bosses, Nahma, Watcher Kaira |
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

`post`, `stop` and setting a region need **Manage Server**.
