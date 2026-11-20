'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractValue, performCheck, publicConfiguration } = require('../src/checker');

const checker = { name: 'shop', url: 'https://example.com/shop?id=1', cssSelector: '#price', compareMode: 'text' };
const page = (price, cls = 'a') => `<html><body><div id="price" class="${cls}">  <b>${price}</b> EUR </div></body></html>`;

function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async key => data[key],
    set: async (key, value) => { data[key] = value; }
  };
}

test('extractValue returns the element text in text mode', () => {
  assert.deepEqual(extractValue(page('10'), checker), { value: '10EUR', text: '10EUR' });
});

test('extractValue returns outerHTML in html mode', () => {
  const result = extractValue(page('10', 'sale'), { ...checker, compareMode: 'html' });
  assert.match(result.value, /^<div id="price" class="sale">/);
  assert.equal(result.text, '10EUR');
});

test('extractValue reports a missing selector without leaking the query string', () => {
  assert.throws(
    () => extractValue('<p>nothing</p>', checker),
    err => err.message.includes('https://example.com/shop: #price') && !err.message.includes('id=1')
  );
});

test('first check notifies and stores the value', async () => {
  const store = fakeStore();
  const notified = [];
  const changed = await performCheck(checker, {
    store,
    fetchHtml: async () => page('10'),
    notify: async (c, text) => notified.push([c.name, text]),
    now: () => new Date('2026-01-01T00:00:00Z')
  });
  assert.equal(changed, true);
  assert.deepEqual(notified, [['shop', '10EUR']]);
  assert.deepEqual(store.data.shop, {
    name: 'shop', value: '10EUR', lastChangeAt: '2026-01-01T00:00:00.000Z', checkerConfiguration: checker
  });
});

test('the stored configuration never contains the bot token', async () => {
  const store = fakeStore();
  const withToken = { ...checker, telegramBotToken: '123:SECRET', telegramChatId: '42' };
  await performCheck(withToken, { store, fetchHtml: async () => page('10'), notify: async () => {} });
  assert.deepEqual(store.data.shop.checkerConfiguration, { ...checker, telegramChatId: '42' });
  assert.ok(!JSON.stringify(store.data).includes('SECRET'));
});

test('publicConfiguration does not mutate the checker', () => {
  const withToken = { ...checker, telegramBotToken: 't' };
  assert.equal('telegramBotToken' in publicConfiguration(withToken), false);
  assert.equal(withToken.telegramBotToken, 't');
});

test('unchanged value does not notify nor write', async () => {
  const previous = { name: 'shop', value: '10EUR', lastChangeAt: 'old' };
  const store = fakeStore({ shop: previous });
  let notifications = 0;
  const changed = await performCheck(checker, {
    store, fetchHtml: async () => page('10'), notify: async () => { notifications += 1; }
  });
  assert.equal(changed, false);
  assert.equal(notifications, 0);
  assert.equal(store.data.shop, previous);
});

test('text mode ignores attribute changes, html mode detects them', async () => {
  const run = async compareMode => {
    const c = { ...checker, compareMode };
    const store = fakeStore();
    await performCheck(c, { store, fetchHtml: async () => page('10', 'a'), notify: async () => {} });
    return performCheck(c, { store, fetchHtml: async () => page('10', 'b'), notify: async () => {} });
  };
  assert.equal(await run('text'), false);
  assert.equal(await run('html'), true);
});

test('a failed notification leaves the state untouched so it is retried', async () => {
  const store = fakeStore({ shop: { value: '10EUR' } });
  await assert.rejects(performCheck(checker, {
    store, fetchHtml: async () => page('12'), notify: async () => { throw new Error('telegram down'); }
  }), /telegram down/);
  assert.deepEqual(store.data.shop, { value: '10EUR' });
});

test('a failed fetch propagates and notifies nothing', async () => {
  let notifications = 0;
  await assert.rejects(performCheck(checker, {
    store: fakeStore(),
    fetchHtml: async () => { throw new Error('HTTP 503'); },
    notify: async () => { notifications += 1; }
  }), /HTTP 503/);
  assert.equal(notifications, 0);
});
