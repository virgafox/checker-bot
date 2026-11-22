'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createBrowserFetcher } = require('../src/browser');

// Minimal stand-in for the puppeteer Browser/BrowserContext/Page API used by src/browser.js.
function fakePuppeteer({ status = 200, html = '<html></html>', selectorAppears = true } = {}) {
  const calls = { launches: [], contexts: 0, closedContexts: 0, browserClosed: 0, pages: [] };
  const browsers = [];

  function createPage() {
    const page = new EventEmitter();
    page.state = { headers: null, interception: false };
    page.setDefaultTimeout = ms => { page.state.defaultTimeout = ms; };
    page.setUserAgent = async ua => { page.state.userAgent = ua; };
    page.setExtraHTTPHeaders = async headers => { page.state.headers = headers; };
    page.setRequestInterception = async value => { page.state.interception = value; };
    page.goto = async (url, options) => {
      page.state.goto = { url, options };
      return { status: () => status };
    };
    page.url = () => page.state.goto.url;
    page.waitForSelector = async (selector, options) => {
      page.state.waitedFor = { selector, options };
      if (!selectorAppears) throw new Error('Waiting for selector timed out');
    };
    page.content = async () => html;
    calls.pages.push(page);
    return page;
  }

  async function launch(options) {
    calls.launches.push(options);
    const browser = new EventEmitter();
    browser.version = async () => 'Chrome/1.0';
    browser.userAgent = async () => 'Mozilla/5.0 HeadlessChrome/1.0';
    browser.createBrowserContext = async () => {
      calls.contexts += 1;
      return {
        newPage: async () => createPage(),
        close: async () => { calls.closedContexts += 1; }
      };
    };
    browser.close = async () => { calls.browserClosed += 1; };
    browsers.push(browser);
    return browser;
  }

  return { launch, calls, browsers };
}

const checker = { name: 'shop', url: 'https://example.com/p?token=x', waitForSelector: '#price', waitUntil: 'load' };

test('launches the browser once, lazily, and reuses it across fetches', async () => {
  const fake = fakePuppeteer({ html: '<p>ok</p>' });
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', args: ['--a'], launch: fake.launch });
  assert.equal(fake.calls.launches.length, 0);
  const [first, second] = await Promise.all([fetcher.fetchHtml(checker), fetcher.fetchHtml(checker)]);
  assert.equal(first, '<p>ok</p>');
  assert.equal(second, '<p>ok</p>');
  assert.deepEqual(fake.calls.launches, [{ executablePath: '/chrome', args: ['--a'], headless: true }]);
  assert.equal(fake.calls.contexts, 2);
  assert.equal(fake.calls.closedContexts, 2);
});

test('configures the page and waits for the selector', async () => {
  const fake = fakePuppeteer();
  const fetcher = createBrowserFetcher({
    executablePath: '/chrome', timeoutMs: 1234, acceptLanguage: 'it-it', blockResources: ['image'], launch: fake.launch
  });
  await fetcher.fetchHtml({ ...checker, waitUntil: 'networkidle2' });
  const { state } = fake.calls.pages[0];
  assert.equal(state.userAgent, 'Mozilla/5.0 Chrome/1.0');
  assert.deepEqual(state.headers, { 'Accept-Language': 'it-it' });
  assert.equal(state.interception, true);
  assert.equal(state.defaultTimeout, 1234);
  assert.deepEqual(state.goto, { url: checker.url, options: { waitUntil: 'networkidle2', timeout: 1234 } });
  assert.deepEqual(state.waitedFor, { selector: '#price', options: { timeout: 1234 } });
});

test('blocks the configured resource types only', async () => {
  const fake = fakePuppeteer();
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', blockResources: ['image', 'font'], launch: fake.launch });
  await fetcher.fetchHtml(checker);
  const outcomes = [];
  const request = type => ({
    isInterceptResolutionHandled: () => false,
    resourceType: () => type,
    abort: async () => outcomes.push(`abort:${type}`),
    continue: async () => outcomes.push(`continue:${type}`)
  });
  for (const type of ['document', 'image', 'script', 'font']) fake.calls.pages[0].emit('request', request(type));
  assert.deepEqual(outcomes, ['continue:document', 'abort:image', 'continue:script', 'abort:font']);
});

test('does not intercept requests when nothing is blocked and honours a custom user agent', async () => {
  const fake = fakePuppeteer();
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', userAgent: 'custom', launch: fake.launch });
  await fetcher.fetchHtml(checker);
  assert.equal(fake.calls.pages[0].state.interception, false);
  assert.equal(fake.calls.pages[0].state.userAgent, 'custom');
});

test('rejects on HTTP errors without leaking the query string, and closes the context', async () => {
  const fake = fakePuppeteer({ status: 503 });
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', launch: fake.launch });
  await assert.rejects(
    fetcher.fetchHtml(checker),
    err => err.message === 'Request failed with status 503 for https://example.com/p'
  );
  assert.equal(fake.calls.closedContexts, 1);
});

test('a selector that never appears is not fatal: the page is still returned', async () => {
  const fake = fakePuppeteer({ html: '<p>no price</p>', selectorAppears: false });
  const logs = [];
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', launch: fake.launch, log: msg => logs.push(msg) });
  assert.equal(await fetcher.fetchHtml(checker), '<p>no price</p>');
  assert.ok(logs.some(msg => msg.includes('did not appear')));
});

test('relaunches the browser after a disconnection', async () => {
  const fake = fakePuppeteer();
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', launch: fake.launch });
  await fetcher.fetchHtml(checker);
  fake.browsers[0].emit('disconnected');
  await fetcher.fetchHtml(checker);
  assert.equal(fake.calls.launches.length, 2);
});

test('retries the launch after a failure', async () => {
  const fake = fakePuppeteer();
  let attempts = 0;
  const launch = async options => {
    attempts += 1;
    if (attempts === 1) throw new Error('no chrome');
    return fake.launch(options);
  };
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', launch });
  await assert.rejects(fetcher.fetchHtml(checker), /no chrome/);
  assert.equal(await fetcher.fetchHtml(checker), '<html></html>');
  assert.equal(attempts, 2);
});

test('close() closes the browser and later fetches fail', async () => {
  const fake = fakePuppeteer();
  const fetcher = createBrowserFetcher({ executablePath: '/chrome', launch: fake.launch });
  await fetcher.close(); // nothing launched yet: no-op
  assert.equal(fake.calls.launches.length, 0);

  const other = createBrowserFetcher({ executablePath: '/chrome', launch: fake.launch });
  await other.fetchHtml(checker);
  await other.close();
  assert.equal(fake.calls.browserClosed, 1);
  await assert.rejects(other.fetchHtml(checker), /closed/);
});
