'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { requestTextWithRedirects } = require('../src/http-client');

async function startServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('follows redirects and sends the given headers', async t => {
  const base = await startServer(t, (req, res) => {
    if (req.url === '/start') { res.writeHead(302, { Location: '/middle' }); return res.end(); }
    if (req.url === '/middle') { res.writeHead(301, { Location: `${base}/end` }); return res.end(); }
    res.end(`agent=${req.headers['user-agent']}`);
  });
  assert.equal(await requestTextWithRedirects(`${base}/start`, 5, { headers: { 'User-Agent': 'test' } }), 'agent=test');
});

test('stops after maxRedirects', async t => {
  const base = await startServer(t, (req, res) => {
    res.writeHead(302, { Location: '/loop' });
    res.end('redirect body');
  });
  assert.equal(await requestTextWithRedirects(`${base}/loop`, 2), 'redirect body');
});

test('rejects on HTTP errors', async t => {
  const base = await startServer(t, (req, res) => { res.statusCode = 503; res.end(); });
  await assert.rejects(requestTextWithRedirects(`${base}/x`, 0), /status 503/);
});
