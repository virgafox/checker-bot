'use strict';

const { loadConfig } = require('./src/config');
const { createDebug } = require('./src/debug');
const { parseCronPattern, createZonedTime, startCronScheduler } = require('./src/cron');
const { createRequestQueue } = require('./src/throttle');
const { requestTextWithRedirects } = require('./src/http-client');
const { notifyTelegram } = require('./src/telegram');
const { createFileStore } = require('./src/storage');
const { performCheck } = require('./src/checker');
const { createFetcher } = require('./src/fetcher');
const { createBrowserFetcher } = require('./src/browser');
const { createServer } = require('./src/server');

const debugSystem = createDebug('checker:system');
const debugNotifications = createDebug('checker:notifications');
const debugHTML = createDebug('checker:html');
const debugGeneral = createDebug('checker:general');
const debugBrowser = createDebug('checker:browser');

const config = loadConfig();
const zonedTime = createZonedTime(config.timeZone);
const store = createFileStore(config.stateFile);
const scheduleRequest = createRequestQueue(config.throttle);
debugSystem(`Using state file ${config.stateFile}`);

// The browser is created only if at least one checker needs it, and launched on its first fetch.
const browser = config.checkers.some(checker => checker.fetchMode === 'browser')
  ? createBrowserFetcher({
    ...config.browser,
    acceptLanguage: config.headers['Accept-Language'],
    log: debugBrowser
  })
  : null;

const fetchHtml = createFetcher({
  schedule: scheduleRequest,
  log: debugHTML,
  fetchers: {
    http: checker => requestTextWithRedirects(checker.url, checker.maxRedirects, { headers: config.headers }),
    ...(browser && { browser: browser.fetchHtml })
  }
});

const deps = {
  store,
  log: debugGeneral,
  fetchHtml,
  async notify(checker, text) {
    debugNotifications(`[${checker.name}] Notifying...`);
    await notifyTelegram(checker, text);
    debugNotifications(`[${checker.name}] Notified.`);
  }
};

const cronJobs = config.checkers.filter(checker => checker.cronEnabled).map(checker => {
  debugSystem(`Enabled cron for checker "${checker.name}" with pattern "${checker.cronPattern}"`);
  // A browser check can last longer than the cron interval: skip a tick while the
  // previous check of the same checker is still running, instead of piling them up.
  let running = false;
  return {
    fields: parseCronPattern(checker.cronPattern),
    run: () => {
      if (running) {
        debugSystem(`[${checker.name}] Previous check still running, skipping this one`);
        return;
      }
      running = true;
      performCheck(checker, deps)
        .catch(err => debugSystem(`[${checker.name}] Check failed: ${err.message}`))
        .finally(() => { running = false; });
    }
  };
});
const stopScheduler = startCronScheduler(cronJobs, zonedTime);

const server = createServer({ checkers: config.checkers, store }).listen(config.port, () => {
  debugSystem(`App listening on port ${config.port}`);
});

// Graceful shutdown (docker stop sends SIGTERM): stop scheduling, close the HTTP server
// and the browser, so no Chromium process is left behind.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  debugSystem(`Received ${signal}, shutting down`);
  stopScheduler();
  server.close();
  if (browser) await browser.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
