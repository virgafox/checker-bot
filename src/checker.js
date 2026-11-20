'use strict';

const { URL } = require('url');
const { parse } = require('node-html-parser');

const PARSE_OPTIONS = {
  lowerCaseTagName: false,
  comment: false,
  blockTextElements: { script: false, noscript: false, style: false, pre: false }
};

const SECRET_FIELDS = ['telegramBotToken'];

// Checker configuration without secrets, safe to persist and expose over HTTP.
function publicConfiguration(checker) {
  const result = { ...checker };
  for (const field of SECRET_FIELDS) delete result[field];
  return result;
}

// Returns { value, text } for the element matched by checker.cssSelector.
// "html" mode compares outerHTML, so class/attribute/structure changes are detected too.
function extractValue(html, checker) {
  const element = parse(html, PARSE_OPTIONS).querySelector(checker.cssSelector);
  if (!element) {
    const url = new URL(checker.url);
    throw new Error(`Selector not found for checker "${checker.name}" on ${url.origin}${url.pathname}: ${checker.cssSelector}`);
  }
  element.removeWhitespace();
  const text = element.text;
  const value = checker.compareMode === 'html' ? element.outerHTML : text;
  return { value, text };
}

// Fetches the page, compares the selected value with the stored one and, on change,
// notifies and then saves the new state. Saving only after a successful notification
// means a failed notification is retried on the next check instead of being lost.
// Returns true when a change was detected.
async function performCheck(checker, { store, fetchHtml, notify, now = () => new Date(), log = () => {} }) {
  const [previous, html] = await Promise.all([store.get(checker.name), fetchHtml(checker)]);
  const { value, text } = extractValue(html, checker);
  const oldValue = previous ? previous.value : undefined;
  log(`[${checker.name}] Old value: "${oldValue}", New value: "${value}".`);
  if (oldValue === value) {
    log(`[${checker.name}] Nothing changed, nothing to do.`);
    return false;
  }
  log(`[${checker.name}] Mismatch.`);
  await notify(checker, text);
  await store.set(checker.name, {
    name: checker.name,
    value,
    lastChangeAt: now().toISOString(),
    checkerConfiguration: publicConfiguration(checker)
  });
  return true;
}

module.exports = { extractValue, performCheck, publicConfiguration };
