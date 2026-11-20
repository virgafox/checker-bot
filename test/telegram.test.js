'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTelegramUrl, notifyTelegram } = require('../src/telegram');

const checker = { name: 'shop', url: 'https://example.com/shop', telegramBotToken: '123:ABC', telegramChatId: '-100' };

test('buildTelegramUrl encodes chat id and message', () => {
  const url = new URL(buildTelegramUrl(checker, '10 € & more'));
  assert.equal(url.origin + url.pathname, 'https://api.telegram.org/bot123:ABC/sendMessage');
  assert.equal(url.searchParams.get('chat_id'), '-100');
  assert.equal(url.searchParams.get('text'), 'Variation detected - shop - 10 € & more - https://example.com/shop');
});

test('notifyTelegram sends the request and propagates failures', async () => {
  const calls = [];
  await notifyTelegram(checker, 'x', async (url, maxRedirects) => { calls.push([url, maxRedirects]); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 2);
  await assert.rejects(notifyTelegram(checker, 'x', async () => { throw new Error('401'); }), /401/);
});
