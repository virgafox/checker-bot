'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCronPattern, cronMatches, createZonedTime } = require('../src/cron');

const time = (overrides = {}) => ({ second: 0, minute: 0, hour: 0, day: 1, month: 1, weekday: 1, ...overrides });
const values = field => [...field.values].sort((a, b) => a - b);

test('5-field patterns run at second 0', () => {
  const fields = parseCronPattern('* * * * *');
  assert.deepEqual(values(fields[0]), [0]);
  assert.equal(fields[1].all, true);
});

test('parses lists, ranges and steps', () => {
  const [second, minute, hour] = parseCronPattern('*/20 1,15 8-10/2 * * *');
  assert.deepEqual(values(second), [0, 20, 40]);
  assert.deepEqual(values(minute), [1, 15]);
  assert.deepEqual(values(hour), [8, 10]);
});

test('a/n means from a to the end of the range', () => {
  const [, minute] = parseCronPattern('0 50/5 * * * *');
  assert.deepEqual(values(minute), [50, 55]);
});

test('aliases and day-of-week 7 map correctly', () => {
  const fields = parseCronPattern('0 0 * jan-mar sun,7');
  assert.deepEqual(values(fields[4]), [1, 2, 3]);
  assert.deepEqual(values(fields[5]), [0]);
  const all = parseCronPattern('* * * * 0-7');
  assert.equal(all[5].all, true);
});

test('rejects malformed patterns', () => {
  assert.throws(() => parseCronPattern('* * *'), /expected 5 or 6 fields/);
  assert.throws(() => parseCronPattern('61 * * * * *'), /out of range/);
  assert.throws(() => parseCronPattern('*/0 * * * *'), /out of range/);
  assert.throws(() => parseCronPattern('5-1 * * * *'), /out of range/);
  assert.throws(() => parseCronPattern('* * * foo *'), /unknown alias/);
  assert.throws(() => parseCronPattern('a? * * * *'), /cannot parse|unknown alias/);
});

test('cronMatches checks every field', () => {
  const fields = parseCronPattern('30 15 9 * * *');
  assert.equal(cronMatches(fields, time({ second: 30, minute: 15, hour: 9 })), true);
  assert.equal(cronMatches(fields, time({ second: 31, minute: 15, hour: 9 })), false);
  assert.equal(cronMatches(fields, time({ second: 30, minute: 15, hour: 10 })), false);
});

test('restricted day-of-month and day-of-week match with OR, otherwise AND', () => {
  const both = parseCronPattern('0 0 13 * fri');
  assert.equal(cronMatches(both, time({ day: 13, weekday: 2 })), true);
  assert.equal(cronMatches(both, time({ day: 5, weekday: 5 })), true);
  assert.equal(cronMatches(both, time({ day: 5, weekday: 2 })), false);

  const onlyWeekday = parseCronPattern('0 0 * * fri');
  assert.equal(cronMatches(onlyWeekday, time({ day: 13, weekday: 2 })), false);
  assert.equal(cronMatches(onlyWeekday, time({ day: 5, weekday: 5 })), true);
});

test('createZonedTime converts to the configured time zone', () => {
  const zonedTime = createZonedTime('Europe/Rome');
  // 2026-07-01T10:20:30Z is 12:20:30 in Rome (CEST, UTC+2), a Wednesday.
  assert.deepEqual(zonedTime(new Date('2026-07-01T10:20:30Z')), {
    second: 30, minute: 20, hour: 12, day: 1, month: 7, weekday: 3
  });
  // Midnight is reported as hour 0, not 24.
  assert.equal(createZonedTime('UTC')(new Date('2026-01-04T00:00:00Z')).hour, 0);
});

test('createZonedTime rejects unknown time zones', () => {
  assert.throws(() => createZonedTime('Mars/Olympus'), RangeError);
});
