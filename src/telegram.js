'use strict';

const { URL } = require('url');
const { requestTextWithRedirects } = require('./http-client');

function buildTelegramUrl(checker, text) {
  const url = new URL(`https://api.telegram.org/bot${checker.telegramBotToken}/sendMessage`);
  url.searchParams.set('chat_id', checker.telegramChatId);
  url.searchParams.set('text', `Variation detected - ${checker.name} - ${text} - ${checker.url}`);
  return url.toString();
}

async function notifyTelegram(checker, text, request = requestTextWithRedirects) {
  await request(buildTelegramUrl(checker, text), 2);
}

module.exports = { buildTelegramUrl, notifyTelegram };
