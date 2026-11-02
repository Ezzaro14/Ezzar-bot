import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { formatDuration, normalizeZone, parseReminder, prefixReminder, reminderMessage, zoneChoices } from '../src/reminders.js';

const zone = 'Europe/Berlin';
// Tuesday 2026-10-20 17:00 in Berlin (UTC+2)
const now = DateTime.fromISO('2026-10-20T17:00', { zone }).toUTC();
const parse = (input, options) => {
  const result = parseReminder(input, { now, ...options });
  return result.error ? result : { at: result.at.setZone(zone).toISO(), text: result.text };
};

test('relative times need no time zone', () => {
  assert.deepEqual(parse('in 12 hours to wash dishes'), { at: '2026-10-21T05:00:00.000+02:00', text: 'wash dishes' });
  assert.deepEqual(parse('in 1 day and 3 hours call mom'), { at: '2026-10-21T20:00:00.000+02:00', text: 'call mom' });
  assert.deepEqual(parse('in 90 minutes'), { at: '2026-10-20T18:30:00.000+02:00', text: '' });
});

test('clock times use the user time zone', () => {
  // 2pm on Tuesday has passed, so it's next Tuesday.
  assert.deepEqual(parse('at 2pm tuesday to fix my car', { zone }), { at: '2026-10-27T14:00:00.000+01:00', text: 'fix my car' });
  assert.deepEqual(parse('tomorrow at 9 call mom', { zone }), { at: '2026-10-21T09:00:00.000+02:00', text: 'call mom' });
  assert.deepEqual(parse('at 2pm wash', { zone }), { at: '2026-10-21T14:00:00.000+02:00', text: 'wash' });
});

test('clock times after a daylight saving change keep their wall time', () => {
  // Berlin switches to UTC+1 on 2026-10-25.
  assert.equal(parse('on december 1 at 2pm', { zone }).at, '2026-12-01T14:00:00.000+01:00');
});

test('clock times without a time zone ask for one', () => {
  assert.match(parse('at 2pm tuesday to fix my car').error, /time zone/);
});

test('the time can come anywhere in the text', () => {
  assert.equal(parse('to fix my car at 2pm tuesday', { zone }).text, 'fix my car');
  assert.equal(parse('wash dishes, in 2 hours').text, 'wash dishes');
  assert.equal(parse('at noon lunch', { zone }).text, 'lunch');
});

test('rejects missing, past and far-off times', () => {
  assert.match(parse('wash dishes').error, /couldn't find a time/);
  assert.match(parse('yesterday').error, /past/);
  assert.match(parse('in 2 years').error, /a year ahead/);
});

test('time zones: case-insensitive names and search', () => {
  assert.equal(normalizeZone('europe/berlin'), 'Europe/Berlin');
  assert.equal(normalizeZone('utc'), 'UTC');
  assert.equal(normalizeZone('nowhere'), null);
  assert.deepEqual(zoneChoices('new york', now), [{ name: 'America/New_York (UTC-4)', value: 'America/New_York' }]);
});

test('reminder message pings only the user, and only in a channel', () => {
  const reminder = { userId: '42', at: now.toMillis(), createdAt: now.minus({ hours: 2 }).toMillis(), text: '@everyone dishes' };
  const dm = reminderMessage(reminder, { now: now.toMillis() });
  assert.equal(dm.content, `Reminder: **@everyone dishes**\n-# Set <t:${now.toSeconds() - 7200}:R>`);
  assert.deepEqual(dm.allowedMentions, { users: [] });
  const late = reminderMessage(reminder, { mention: true, now: now.plus({ hours: 1 }).toMillis() });
  assert.ok(late.content.startsWith('<@42> Reminder'));
  assert.ok(late.content.endsWith(`, was due <t:${now.toSeconds()}:R>`));
  assert.deepEqual(late.allowedMentions, { users: ['42'] });
});

test('!RemindMe messages: case-insensitive, other messages ignored', () => {
  assert.equal(prefixReminder('!RemindMe to X in 4 hours'), 'to X in 4 hours');
  assert.equal(prefixReminder('!remindme in 4 hours'), 'in 4 hours');
  assert.equal(prefixReminder('!remindmenow in 4 hours'), null);
  assert.equal(prefixReminder('hey !RemindMe in 4 hours'), null);
  assert.deepEqual(parse(prefixReminder('!RemindMe to check the raid in 4 hours')), {
    at: '2026-10-20T21:00:00.000+02:00',
    text: 'check the raid',
  });
});

test('reminders cannot mention @everyone, @here or roles', () => {
  for (const input of ['to ping @everyone in 4 hours', 'in 4 hours @here raid', 'in 4 hours tell <@&123> to log in', 'in 1 hour @Everyone']) {
    assert.match(parse(input).error, /@everyone, @here or roles/);
  }
  assert.equal(parse('in 4 hours tell <@42> hi').text, 'tell <@42> hi');
});

test('durations in words, two largest units', () => {
  const minutes = (n) => n * 60_000;
  assert.equal(formatDuration(minutes(240) - 50), '4 hours');
  assert.equal(formatDuration(minutes(90)), '1 hour 30 minutes');
  assert.equal(formatDuration(minutes(1)), '1 minute');
  assert.equal(formatDuration(minutes(1440 + 180 + 5)), '1 day 3 hours');
  assert.equal(formatDuration(minutes(2 * 1440 + 5)), '2 days 5 minutes');
  assert.equal(formatDuration(1000), '1 minute');
});
