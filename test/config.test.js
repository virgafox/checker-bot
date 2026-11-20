'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createEnvReader, loadConfig } = require('../src/config');

const baseEnv = {
  CHECKER_NAMES: 'shop, news',
  CHECKER_SHOP_URL: 'https://example.com/shop',
  CHECKER_SHOP_CSS_SELECTOR: '#price',
  CHECKER_SHOP_TELEGRAM_BOT_TOKEN: 'token',
  CHECKER_SHOP_TELEGRAM_CHAT_ID: '42',
  CHECKER_NEWS_URL: 'https://example.com/news',
  CHECKER_NEWS_CSS_SELECTOR: 'h1',
  CHECKER_NEWS_TELEGRAM_BOT_TOKEN: 'token2',
  CHECKER_NEWS_TELEGRAM_CHAT_ID: '43',
  CHECKER_NEWS_COMPARE_MODE: 'HTML',
  CHECKER_NEWS_CRON_ENABLED: 'no',
  CHECKER_NEWS_MAX_REDIRECTS: '2'
};

test('env reader parses typed values and defaults', () => {
  const read = createEnvReader({ A: 'x', N: '12', B: 'Yes', E: '', L: ' a, ,b ' });
  assert.equal(read.string('A'), 'x');
  assert.equal(read.string('E', 'def'), 'def');
  assert.equal(read.int('N', 0), 12);
  assert.equal(read.int('MISSING', 7), 7);
  assert.equal(read.bool('B', false), true);
  assert.equal(read.bool('MISSING', true), true);
  assert.deepEqual(read.list('L'), ['a', 'b']);
});

test('env reader rejects invalid or missing values', () => {
  const read = createEnvReader({ N: 'abc', M: 'pdf' });
  assert.throws(() => read.int('N', 0), /Invalid integer/);
  assert.throws(() => read.string('X', undefined, true), /Missing required environment variable: X/);
  assert.throws(() => read.oneOf('M', ['text', 'html'], 'text'), /Invalid value/);
});

test('loadConfig builds checkers with defaults and overrides', () => {
  const config = loadConfig(baseEnv, '/app');
  assert.equal(config.port, 3000);
  assert.equal(config.timeZone, 'Europe/Rome');
  assert.equal(config.stateFile, path.resolve('/app', 'data/state.json'));
  assert.deepEqual(config.throttle, { maxConcurrent: 1, minMsBetween: 333 });
  assert.equal(config.checkers.length, 2);
  const [shop, news] = config.checkers;
  assert.deepEqual(shop, {
    name: 'shop',
    url: 'https://example.com/shop',
    cssSelector: '#price',
    compareMode: 'text',
    telegramBotToken: 'token',
    telegramChatId: '42',
    maxRedirects: 5,
    cronPattern: '*/20 * * * * *',
    cronEnabled: true
  });
  assert.equal(news.compareMode, 'html');
  assert.equal(news.cronEnabled, false);
  assert.equal(news.maxRedirects, 2);
});

test('loadConfig honours an absolute STATE_FILE', () => {
  const config = loadConfig({ ...baseEnv, STATE_FILE: '/data/state.json' }, '/app');
  assert.equal(config.stateFile, '/data/state.json');
});

test('loadConfig fails when a checker misses a required variable', () => {
  const env = { ...baseEnv };
  delete env.CHECKER_SHOP_URL;
  assert.throws(() => loadConfig(env), /CHECKER_SHOP_URL/);
});
