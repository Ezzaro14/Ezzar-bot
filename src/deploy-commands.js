import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { buildCommandData } from './commands.js';
import { loadConfig } from './timers.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

// --clear removes the commands instead, e.g. a test guild's copy once they're registered globally.
const clear = process.argv.includes('--clear');
const commandData = clear ? [] : buildCommandData(loadConfig());
const rest = new REST().setToken(DISCORD_TOKEN);
const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);
const where = GUILD_ID ? `in guild ${GUILD_ID}` : 'globally';

await rest.put(route, { body: commandData });
console.log(clear ? `Removed all commands ${where}.` : `Registered ${commandData.length} commands ${where}.`);
