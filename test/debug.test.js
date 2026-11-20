'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isEnabled, parsePatterns } = require('../src/debug');

test('parsePatterns splits and trims', () => {
  assert.deepEqual(parsePatterns(' checker:html , ,checker:system'), ['checker:html', 'checker:system']);
  assert.deepEqual(parsePatterns(undefined), []);
});

test('isEnabled supports exact names and wildcards', () => {
  assert.equal(isEnabled('checker:html', ['*']), true);
  assert.equal(isEnabled('checker:html', ['checker:*']), true);
  assert.equal(isEnabled('checker:html', ['checker:html']), true);
  assert.equal(isEnabled('checker:html', ['checker:system']), false);
  assert.equal(isEnabled('checker:html', []), false);
});
