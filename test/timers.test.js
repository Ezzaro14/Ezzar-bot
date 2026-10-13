import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { buildBoard } from '../src/render.js';
import { loadConfig, nextOccurrence, upcoming, validateConfig } from '../src/timers.js';

const zone = 'Asia/Seoul';
// Wednesday 2026-10-14 10:00 in Seoul
const now = DateTime.fromISO('2026-10-14T10:00', { zone });

test('daily: later today, or tomorrow once passed', () => {
  assert.equal(nextOccurrence({ type: 'daily', time: '21:00' }, { now, zone }).toISO(), '2026-10-14T21:00:00.000+09:00');
  assert.equal(nextOccurrence({ type: 'daily', time: '05:00' }, { now, zone }).toISO(), '2026-10-15T05:00:00.000+09:00');
  assert.equal(nextOccurrence({ type: 'daily', time: '10:00' }, { now, zone }).toISO(), '2026-10-15T10:00:00.000+09:00');
});

test('weekly: picks the soonest listed day', () => {
  const timer = { type: 'weekly', days: ['Mon', 'Thu', 'Sat'], time: '21:30' };
  assert.equal(nextOccurrence(timer, { now, zone }).toISO(), '2026-10-15T21:30:00.000+09:00');
  const wed = { type: 'weekly', days: ['Wed'], time: '05:00' };
  assert.equal(nextOccurrence(wed, { now, zone }).toISO(), '2026-10-21T05:00:00.000+09:00');
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

test('upcoming sorts soonest first with unknowns last', () => {
  const config = {
    serverTimezone: zone,
    timers: [
      { id: 'r', name: 'R', type: 'respawn', respawnMinutes: 10 },
      { id: 'late', name: 'Late', type: 'daily', time: '23:00' },
      { id: 'soon', name: 'Soon', type: 'daily', time: '11:00' },
    ],
  };
  assert.deepEqual(upcoming(config, { now }).map((e) => e.timer.id), ['soon', 'late', 'r']);
});

test('validateConfig rejects bad timers', () => {
  const base = { serverTimezone: zone };
  assert.throws(() => validateConfig({ ...base, timers: [{ id: 'a', name: 'A', type: 'daily', time: '25:00' }] }));
  assert.throws(() => validateConfig({ ...base, timers: [{ id: 'a', name: 'A', type: 'weekly', days: ['Xyz'], time: '01:00' }] }));
  assert.throws(() => validateConfig({ serverTimezone: 'Nope/Zone', timers: [] }));
});

test('shipped config is valid and renders Discord timestamps', () => {
  const config = loadConfig();
  const embed = buildBoard(config, { now }).toJSON();
  const text = embed.fields.map((f) => f.value).join('\n');
  assert.match(text, /<t:\d+:F> \(<t:\d+:R>\)/);
  assert.equal(embed.fields.length, Object.keys(config.categories).length);
});
