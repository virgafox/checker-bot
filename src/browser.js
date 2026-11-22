'use strict';

const { URL } = require('url');

// Fetches pages with a real headless Chromium (via puppeteer-core), so content rendered
// by JavaScript is available. A single browser process is launched lazily on the first
// fetch and shared by all checkers; each fetch runs in its own incognito context
// (no cookies, cache or storage shared between checks) that is closed afterwards.
// If the browser crashes or disconnects, the next fetch launches a new one.
//
// options:
//   executablePath  Chromium/Chrome binary (puppeteer-core does not download one)
//   args            extra Chromium command line flags
//   timeoutMs       navigation and wait-for-selector timeout
//   userAgent       optional User-Agent override (default: the browser's own, without "Headless")
//   acceptLanguage  optional Accept-Language header
//   blockResources  resource types not downloaded (e.g. image, media, font, stylesheet)
//   launch          injectable puppeteer.launch, for tests
//   log             debug logger
function createBrowserFetcher({
  executablePath,
  args = [],
  timeoutMs = 30000,
  userAgent,
  acceptLanguage,
  blockResources = [],
  launch = defaultLaunch,
  log = () => {}
}) {
  let browserPromise = null;
  let closed = false;
  const blocked = new Set(blockResources);

  function getBrowser() {
    if (closed) return Promise.reject(new Error('Browser fetcher is closed'));
    if (!browserPromise) {
      log(`Launching browser ${executablePath}`);
      const launching = Promise.resolve()
        .then(() => launch({ executablePath, args, headless: true }))
        .then(async browser => {
          browser.on('disconnected', () => {
            log(closed ? 'Browser closed' : 'Browser disconnected, it will be relaunched on the next fetch');
            if (browserPromise === launching) browserPromise = null;
          });
          const version = await browser.version().catch(() => 'unknown version');
          log(`Browser ready: ${version}`);
          return browser;
        });
      // A failed launch is retried on the next fetch instead of being cached forever.
      launching.catch(() => { if (browserPromise === launching) browserPromise = null; });
      browserPromise = launching;
    }
    return browserPromise;
  }

  async function resolveUserAgent(browser) {
    if (userAgent) return userAgent;
    // Headless Chromium announces itself as "HeadlessChrome", which many sites block.
    return (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
  }

  // Returns the serialized DOM (document.documentElement.outerHTML) after JavaScript ran.
  // checker: { name, url, waitForSelector, waitUntil, extraWaitMs }
  async function fetchHtml(checker) {
    const browser = await getBrowser();
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      await page.setUserAgent(await resolveUserAgent(browser));
      if (acceptLanguage) await page.setExtraHTTPHeaders({ 'Accept-Language': acceptLanguage });
      if (blocked.size > 0) {
        await page.setRequestInterception(true);
        page.on('request', request => {
          if (request.isInterceptResolutionHandled()) return;
          if (blocked.has(request.resourceType())) request.abort().catch(() => {});
          else request.continue().catch(() => {});
        });
      }

      const response = await page.goto(checker.url, { waitUntil: checker.waitUntil || 'load', timeout: timeoutMs });
      const status = response ? response.status() : 0;
      if (status >= 400) {
        throw new Error(`Request failed with status ${status} for ${safeUrl(page.url() || checker.url)}`);
      }

      if (checker.waitForSelector) {
        try {
          await page.waitForSelector(checker.waitForSelector, { timeout: timeoutMs });
        } catch (err) {
          // Not fatal: the page is still returned and the checker reports the missing
          // selector with the same error used for plain HTTP fetches.
          log(`[${checker.name}] Selector "${checker.waitForSelector}" did not appear: ${err.message}`);
        }
      }
      if (checker.extraWaitMs > 0) await new Promise(resolve => setTimeout(resolve, checker.extraWaitMs));

      return await page.content();
    } finally {
      await context.close().catch(err => log(`[${checker.name}] Failed to close browser context: ${err.message}`));
    }
  }

  async function close() {
    closed = true;
    const pending = browserPromise;
    browserPromise = null;
    if (!pending) return;
    const browser = await pending.catch(() => null);
    if (browser) await browser.close().catch(() => {});
  }

  return { fetchHtml, close };
}

function defaultLaunch(options) {
  // Loaded lazily: deployments with only http checkers never load puppeteer.
  return require('puppeteer-core').launch(options);
}

// Origin + path only: query strings may contain tokens.
function safeUrl(urlString) {
  try {
    const url = new URL(urlString);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(invalid url)';
  }
}

module.exports = { createBrowserFetcher };
