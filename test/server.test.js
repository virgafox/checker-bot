'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/server');

async function start(t, store) {
  const server = createServer({ checkers: [{ name: 'shop' }, { name: 'news' }], store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET / returns the state of checked checkers only', async t => {
  const data = { shop: { name: 'shop', value: '10' }, removed: { name: 'removed' } };
  const base = await start(t, { get: async key => data[key] });
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), [{ name: 'shop', value: '10' }]);
});

test('GET / strips the bot token from previously stored records', async t => {
  const data = { shop: { name: 'shop', checkerConfiguration: { name: 'shop', telegramBotToken: 'SECRET', telegramChatId: '1' } } };
  const base = await start(t, { get: async key => data[key] });
  const body = await (await fetch(`${base}/`)).text();
  assert.ok(!body.includes('SECRET'));
  assert.deepEqual(JSON.parse(body), [{ name: 'shop', checkerConfiguration: { name: 'shop', telegramChatId: '1' } }]);
});

test('other routes return 404', async t => {
  const base = await start(t, { get: async () => undefined });
  assert.equal((await fetch(`${base}/other`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 404);
});

test('storage errors return 500', async t => {
  const base = await start(t, { get: async () => { throw new Error('disk'); } });
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'disk' });
});
