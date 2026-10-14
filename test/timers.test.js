import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { buildCommandData, missingPermissions } from '../src/commands.js';
import { buildBoard } from '../src/render.js';
import { endsAt, loadConfig, nextOccurrence, upcoming, validateConfig } from '../src/timers.js';

const zone = 'Asia/Seoul';
// Wednesday 2026-10-14 10:00 in Seoul
const now = DateTime.fromISO('2026-10-14T10:00', { zone });

test('daily: later today, or tomorrow once passed', () => {
  assert.equal(nextOccurrence({ type: 'daily', time: '21:00' }, { now, zone }).toISO(), '2026-10-14T21:00:00.000+09:00');
  assert.equal(nextOccurrence({ type: 'daily', time: '05:00' }, { now, zone }).toISO(), '2026-10-15T05:00:00.000+09:00');
  assert.equal(nextOccurrence({ type: 'daily', time: '10:00' }, { now, zone }).toISO(), '2026-10-15T10:00:00.000+09:00');
});

test('daily: several times a day', () => {
  const timer = { type: 'daily', times: ['02:00', '11:00', '23:00'] };
  assert.equal(nextOccurrence(timer, { now, zone }).toISO(), '2026-10-14T11:00:00.000+09:00');
  const passed = { type: 'daily', times: ['02:00', '05:00'] };
  assert.equal(nextOccurrence(passed, { now, zone }).toISO(), '2026-10-15T02:00:00.000+09:00');
});

test('hourly: next matching minute', () => {
  assert.equal(nextOccurrence({ type: 'hourly', minute: 30 }, { now, zone }).toISO(), '2026-10-14T10:30:00.000+09:00');
  assert.equal(nextOccurrence({ type: 'hourly', minute: 0 }, { now, zone }).toISO(), '2026-10-14T11:00:00.000+09:00');
});

test('weekly: picks the soonest listed day', () => {
  const timer = { type: 'weekly', days: ['Mon', 'Thu', 'Sat'], time: '21:30' };
  assert.equal(nextOccurrence(timer, { now, zone }).toISO(), '2026-10-15T21:30:00.000+09:00');
  const wed = { type: 'weekly', days: ['Wed'], time: '05:00' };
  assert.equal(nextOccurrence(wed, { now, zone }).toISO(), '2026-10-21T05:00:00.000+09:00');
  const multi = { type: 'weekly', days: ['Wed'], times: ['09:00', '21:00'] };
  assert.equal(nextOccurrence(multi, { now, zone }).toISO(), '2026-10-14T21:00:00.000+09:00');
});

test("a timer's own timezone beats the region's", () => {
  const reset = { type: 'daily', time: '07:00', timezone: 'UTC' };
  assert.equal(nextOccurrence(reset, { now, zone: 'America/New_York' }).toUTC().toISO(), '2026-10-14T07:00:00.000Z');
});

test('regions: same local time lands on different instants', () => {
  const rift = { type: 'daily', time: '20:00' };
  const eu = nextOccurrence(rift, { now, zone: 'Europe/Berlin' });
  const na = nextOccurrence(rift, { now, zone: 'America/New_York' });
  assert.equal(eu.toUTC().toISO(), '2026-10-14T18:00:00.000Z');
  assert.equal(na.toUTC().toISO(), '2026-10-15T00:00:00.000Z');
});

test('interval: next cycle after the anchor', () => {
  const timer = { type: 'interval', anchor: '2026-10-14T00:00', everyMinutes: 180 };
  assert.equal(nextOccurrence(timer, { now, zone }).toISO(), '2026-10-14T12:00:00.000+09:00');
  const future = { type: 'interval', anchor: '2026-10-20T00:00', everyMinutes: 60 };
  assert.equal(nextOccurrence(future, { now, zone }).toISO(), '2026-10-20T00:00:00.000+09:00');
});

test('respawn: unknown until a kill is recorded', () => {
  const timer = { id: 'b', type: 'respawn', respawnMinutes: 90 };
  assert.equal(nextOccurrence(timer, { now, zone }), null);
  const kills = { b: now.minus({ minutes: 30 }).toMillis() };
  assert.equal(nextOccurrence(timer, { now, zone, kills }).toMillis(), now.plus({ minutes: 60 }).toMillis());
});

test('timezone: server time maps to the right unix timestamp', () => {
  const next = nextOccurrence({ type: 'daily', time: '21:00' }, { now, zone });
  assert.equal(next.toUTC().toISO(), '2026-10-14T12:00:00.000Z');
});

test('endsAt: only while a timer with a duration is running', () => {
  const shugo = { type: 'hourly', minute: 0, durationMinutes: 10 };
  assert.equal(endsAt(shugo, { now: now.plus({ minutes: 5 }), zone }).toISO(), '2026-10-14T10:10:00.000+09:00');
  assert.equal(endsAt(shugo, { now: now.plus({ minutes: 10 }), zone }), null);
  assert.equal(endsAt({ type: 'hourly', minute: 0 }, { now: now.plus({ minutes: 5 }), zone }), null);
});

const regions = { kr: { name: 'Korea', timezone: zone } };
const groups = { g: { name: 'G', description: 'G timers' }, other: { name: 'O', description: 'O timers' } };

test('upcoming: one group, soonest first, unknowns last', () => {
  const config = {
    regions,
    defaultRegion: 'kr',
    groups,
    timers: [
      { id: 'r', name: 'R', group: 'g', type: 'respawn', respawnMinutes: 10 },
      { id: 'late', name: 'Late', group: 'g', type: 'daily', time: '23:00' },
      { id: 'soon', name: 'Soon', group: 'g', type: 'daily', time: '11:00' },
      { id: 'elsewhere', name: 'Elsewhere', group: 'other', type: 'daily', time: '10:30' },
    ],
  };
  assert.deepEqual(upcoming(config, { group: 'g', region: 'kr', now }).map((e) => e.timer.id), ['soon', 'late', 'r']);
});

test('board: one line per timer, running ones first', () => {
  const config = {
    regions,
    defaultRegion: 'kr',
    groups,
    timers: [
      { id: 'on', name: 'Running', group: 'g', type: 'hourly', minute: 0, durationMinutes: 15 },
      { id: 'a', name: 'Boss A', group: 'g', type: 'daily', time: '21:30', location: 'Somewhere' },
      { id: 'b', name: 'Boss B', group: 'g', type: 'daily', time: '21:30' },
      { id: 'r', name: 'Respawner', group: 'g', type: 'respawn', respawnMinutes: 10 },
    ],
  };
  const { description, color } = buildBoard(config, { group: 'g', region: 'kr', now: now.plus({ minutes: 5 }) }).toJSON();
  assert.match(
    description,
    new RegExp(
      [
        '^\\*\\*Running\\*\\* - Open now · ends <t:\\d+:R>',
        '\\*\\*Boss A\\*\\* - <t:\\d+:R> · <t:\\d+:t> · \\*Somewhere\\*',
        '\\*\\*Boss B\\*\\* - <t:\\d+:R> · <t:\\d+:t>',
        '\\*\\*Respawner\\*\\* - Not tracked · use `/killed`$',
      ].join('\n\n'),
    ),
  );
  assert.equal(color, 0x57f287);
});

test('validateConfig rejects bad config', () => {
  const base = { regions, defaultRegion: 'kr', groups };
  const timer = (t) => ({ ...base, timers: [{ id: 'a', name: 'A', group: 'g', ...t }] });
  assert.doesNotThrow(() => validateConfig(timer({ type: 'daily', time: '01:00' })));
  assert.throws(() => validateConfig(timer({ type: 'daily', time: '25:00' })));
  assert.throws(() => validateConfig(timer({ type: 'daily', times: ['01:00', 'nope'] })));
  assert.throws(() => validateConfig(timer({ type: 'weekly', days: ['Xyz'], time: '01:00' })));
  assert.throws(() => validateConfig(timer({ type: 'hourly', minute: 60 })));
  assert.throws(() => validateConfig(timer({ type: 'hourly', minute: 0, durationMinutes: 0 })));
  assert.throws(() => validateConfig(timer({ type: 'daily', time: '01:00', timezone: 'Nope/Zone' })));
  assert.throws(() => validateConfig(timer({ type: 'daily', time: '01:00', group: 'missing' })));
  assert.throws(() => validateConfig({ ...base, regions: { kr: { name: 'K', timezone: 'Nope/Zone' } }, timers: [] }));
  assert.throws(() => validateConfig({ ...base, defaultRegion: 'missing', timers: [] }));
  assert.throws(() => validateConfig({ ...base, groups: { killed: { name: 'K', description: 'k' } }, timers: [] }));
  assert.throws(() => validateConfig({ ...base, groups: { 'Bad Name': { name: 'B', description: 'b' } }, timers: [] }));
});

test('shipped config is valid and renders every group in every region', () => {
  const config = loadConfig();
  for (const group of Object.keys(config.groups)) {
    for (const region of Object.keys(config.regions)) {
      const embed = buildBoard(config, { group, region, now }).toJSON();
      assert.match(embed.title, new RegExp(config.regions[region].name));
      assert.match(embed.description, /^\*\*.+\*\* - <t:\d+:R> · <t:\d+:[tF]>/m);
    }
  }
});

test('one slash command per group, with region choices', () => {
  const config = loadConfig();
  const commands = buildCommandData(config);
  assert.deepEqual(commands.map((c) => c.name).sort(), [...Object.keys(config.groups), 'killed'].sort());
  const region = commands.find((c) => c.name === 'events').options.find((o) => o.name === 'region');
  assert.deepEqual(region.options[0].choices.map((c) => c.value), Object.keys(config.regions));
});

test('missingPermissions names what the bot lacks in a channel', () => {
  const channel = (...flags) => ({ permissionsFor: () => new PermissionsBitField(flags) });
  const me = {};
  const { ViewChannel, SendMessages, EmbedLinks } = PermissionFlagsBits;
  assert.deepEqual(missingPermissions(channel(ViewChannel, SendMessages, EmbedLinks), me), []);
  assert.deepEqual(missingPermissions(channel(ViewChannel), me), ['Send Messages', 'Embed Links']);
  assert.deepEqual(missingPermissions(null, me), ['View Channel', 'Send Messages', 'Embed Links']);
});
