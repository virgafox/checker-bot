'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestQueue } = require('../src/throttle');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('resolves and rejects with the task outcome', async () => {
  const schedule = createRequestQueue({ maxConcurrent: 1, minMsBetween: 0 });
  assert.equal(await schedule(() => 'ok'), 'ok');
  await assert.rejects(schedule(() => { throw new Error('boom'); }), /boom/);
  assert.equal(await schedule(async () => 'after failure'), 'after failure');
});

test('never exceeds maxConcurrent', async () => {
  const schedule = createRequestQueue({ maxConcurrent: 2, minMsBetween: 0 });
  let active = 0;
  let peak = 0;
  const task = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(20);
    active -= 1;
  };
  await Promise.all(Array.from({ length: 6 }, () => schedule(task)));
  assert.equal(peak, 2);
});

test('spaces task starts by minMsBetween', async () => {
  const schedule = createRequestQueue({ maxConcurrent: 5, minMsBetween: 40 });
  const starts = [];
  await Promise.all(Array.from({ length: 3 }, () => schedule(() => starts.push(Date.now()))));
  for (let i = 1; i < starts.length; i++) {
    // Small tolerance for timer granularity.
    assert.ok(starts[i] - starts[i - 1] >= 35, `gap ${starts[i] - starts[i - 1]}ms`);
  }
});
