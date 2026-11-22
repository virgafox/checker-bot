'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFetcher } = require('../src/fetcher');

test('routes each checker to the fetcher of its mode, defaulting to http', async () => {
  const fetchHtml = createFetcher({
    fetchers: {
      http: async checker => `http:${checker.name}`,
      browser: async checker => `browser:${checker.name}`
    }
  });
  assert.equal(await fetchHtml({ name: 'a', fetchMode: 'http' }), 'http:a');
  assert.equal(await fetchHtml({ name: 'b', fetchMode: 'browser' }), 'browser:b');
  assert.equal(await fetchHtml({ name: 'c' }), 'http:c');
});

test('every fetch goes through the shared schedule', async () => {
  let scheduled = 0;
  const fetchHtml = createFetcher({
    schedule: task => { scheduled += 1; return task(); },
    fetchers: { http: async () => 'h', browser: async () => 'b' }
  });
  await fetchHtml({ name: 'a', fetchMode: 'http' });
  await fetchHtml({ name: 'b', fetchMode: 'browser' });
  assert.equal(scheduled, 2);
});

test('rejects a mode without fetcher', async () => {
  const fetchHtml = createFetcher({ fetchers: { http: async () => '' } });
  await assert.rejects(fetchHtml({ name: 'x', fetchMode: 'browser' }), /No fetcher available for FETCH_MODE "browser" \(checker "x"\)/);
});
