# Ezzar-bot

Discord bot that shows AION 2 timers (field bosses, resets, …) as Discord timestamps,
so every member sees them in their own timezone. A board message in a channel is
refreshed every 5 minutes so it always shows the *next* spawn.

## Setup

1. Create an application at <https://discord.com/developers/applications>, add a bot,
   and copy its token and the application ID.
2. Invite it with the `bot` and `applications.commands` scopes and the
   **View Channel**, **Send Messages** and **Embed Links** permissions.
3. Install and configure:

   ```sh
   npm install
   cp .env.example .env   # fill in DISCORD_TOKEN and CLIENT_ID (GUILD_ID for instant command updates)
   npm run deploy         # register slash commands (re-run when commands change)
   npm start
   ```

Requires Node.js 18.17+.

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/timers post [channel]` | Manage Server | Posts the auto-updating board (replaces any previous one) |
| `/timers stop` | Manage Server | Deletes the board and stops updates |
| `/timers show` | Everyone | Shows the timers only to you |
| `/killed <boss> [minutes_ago]` | Everyone | Starts a `respawn` timer from a kill |

## Configuring timers

Edit `config/timers.json` and restart the bot. Times are in `serverTimezone`
(an IANA name such as `Asia/Seoul` or `America/New_York`).

| `type` | Fields | Example |
| --- | --- | --- |
| `daily` | `time` | `{"type": "daily", "time": "05:00"}` |
| `weekly` | `days`, `time` | `{"type": "weekly", "days": ["Mon", "Thu"], "time": "21:30"}` |
| `interval` | `anchor`, `everyMinutes` | `{"type": "interval", "anchor": "2026-01-01T00:00", "everyMinutes": 120}` |
| `respawn` | `respawnMinutes` | `{"type": "respawn", "respawnMinutes": 480}` — started with `/killed` |

Every timer also needs a unique `id` and a `name`, and can have a `category`
(a key of `categories`) and a `location`.

The shipped schedule is a starting point: check the server timezone, the daily reset
hour and the boss times against your server in game.

## Development

```sh
npm test
```
