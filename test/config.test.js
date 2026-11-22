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
    fetchMode: 'http',
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

test('loadConfig adds browser options only to browser checkers', () => {
  const config = loadConfig({
    ...baseEnv,
    CHECKER_SHOP_FETCH_MODE: 'Browser',
    BROWSER_EXECUTABLE_PATH: '/usr/bin/chromium'
  });
  const [shop, news] = config.checkers;
  assert.equal(shop.fetchMode, 'browser');
  assert.equal(shop.waitForSelector, '#price');
  assert.equal(shop.waitUntil, 'load');
  assert.equal(shop.extraWaitMs, 0);
  assert.equal(news.fetchMode, 'http');
  assert.equal('waitForSelector' in news, false);
  assert.deepEqual(config.browser, {
    executablePath: '/usr/bin/chromium',
    args: ['--disable-dev-shm-usage'],
    timeoutMs: 30000,
    userAgent: undefined,
    blockResources: ['image', 'media', 'font']
  });
});

test('loadConfig parses browser overrides', () => {
  const config = loadConfig({
    ...baseEnv,
    CHECKER_SHOP_FETCH_MODE: 'browser',
    CHECKER_SHOP_WAIT_FOR_SELECTOR: '.loaded',
    CHECKER_SHOP_WAIT_UNTIL: 'networkidle2',
    CHECKER_SHOP_EXTRA_WAIT_MS: '500',
    PUPPETEER_EXECUTABLE_PATH: '/opt/chrome',
    BROWSER_ARGS: '  --no-sandbox   --window-size=1280,800 ',
    BROWSER_TIMEOUT_MS: '10000',
    BROWSER_USERAGENT: 'bot',
    BROWSER_BLOCK_RESOURCES: 'none'
  });
  const [shop] = config.checkers;
  assert.equal(shop.waitForSelector, '.loaded');
  assert.equal(shop.waitUntil, 'networkidle2');
  assert.equal(shop.extraWaitMs, 500);
  assert.deepEqual(config.browser, {
    executablePath: '/opt/chrome',
    args: ['--no-sandbox', '--window-size=1280,800'],
    timeoutMs: 10000,
    userAgent: 'bot',
    blockResources: []
  });
});

test('loadConfig rejects invalid fetch options', () => {
  assert.throws(() => loadConfig({ ...baseEnv, CHECKER_SHOP_FETCH_MODE: 'curl' }), /CHECKER_SHOP_FETCH_MODE/);
  assert.throws(() => loadConfig({
    ...baseEnv, CHECKER_SHOP_FETCH_MODE: 'browser', BROWSER_EXECUTABLE_PATH: '/x', CHECKER_SHOP_WAIT_UNTIL: 'never'
  }), /CHECKER_SHOP_WAIT_UNTIL/);
});

test('loadConfig requires a browser executable only when a checker uses the browser', () => {
  assert.doesNotThrow(() => loadConfig(baseEnv));
  assert.throws(
    () => loadConfig({ ...baseEnv, CHECKER_NEWS_FETCH_MODE: 'browser' }),
    /BROWSER_EXECUTABLE_PATH is required by checkers with FETCH_MODE=browser: news/
  );
});
