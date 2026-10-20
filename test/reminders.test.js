import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { normalizeZone, parseReminder, reminderMessage, zoneChoices } from '../src/reminders.js';

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
