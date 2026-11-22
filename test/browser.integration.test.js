'use strict';

// End-to-end test with a real Chromium. Skipped unless BROWSER_EXECUTABLE_PATH
// (or PUPPETEER_EXECUTABLE_PATH) points to a Chromium/Chrome binary, e.g.:
//   BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createBrowserFetcher } = require('../src/browser');
const { extractValue } = require('../src/checker');

const executablePath = process.env.BROWSER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
const skip = executablePath ? false : 'set BROWSER_EXECUTABLE_PATH to run the real browser tests';

// The price is rendered by JavaScript after a delay and is absent from the served HTML.
const PAGE = `<!doctype html><html><body>
<div id="app">loading...</div>
<img src="/image.png">
<script>
  setTimeout(() => {
    document.getElementById('app').innerHTML = '<span id="price" class="p">' + (40 + 2) + ' EUR</span>';
  }, 300);
</script>
</body></html>`;

test('renders JavaScript content with a real browser', { skip }, async t => {
  const requested = [];
  const server = http.createServer((req, res) => {
    requested.push({ url: req.url, lang: req.headers['accept-language'], ua: req.headers['user-agent'] });
    if (req.url === '/missing') { res.statusCode = 404; return res.end('nope'); }
    if (req.url === '/image.png') { res.setHeader('Content-Type', 'image/png'); return res.end(); }
    res.setHeader('Content-Type', 'text/html');
    res.end(PAGE);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetcher = createBrowserFetcher({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    timeoutMs: 15000,
    acceptLanguage: 'it-it',
    blockResources: ['image']
  });
  t.after(async () => { await fetcher.close(); server.close(); });

  const checker = { name: 'js', url: `${base}/page`, cssSelector: '#price', compareMode: 'text', waitForSelector: '#price' };
  const html = await fetcher.fetchHtml(checker);
  assert.deepEqual(extractValue(html, checker), { value: '42 EUR', text: '42 EUR' });

  const page = requested.find(r => r.url === '/page');
  assert.equal(page.lang, 'it-it');
  assert.ok(!page.ua.includes('Headless'), page.ua);
  assert.equal(requested.some(r => r.url === '/image.png'), false, 'images are blocked');

  // The plain HTTP response does not contain the rendered element.
  assert.throws(() => extractValue(PAGE, checker), /Selector not found/);

  await assert.rejects(fetcher.fetchHtml({ ...checker, url: `${base}/missing` }), /status 404/);
});
