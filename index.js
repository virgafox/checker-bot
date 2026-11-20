'use strict';

const { loadConfig } = require('./src/config');
const { createDebug } = require('./src/debug');
const { parseCronPattern, createZonedTime, startCronScheduler } = require('./src/cron');
const { createRequestQueue } = require('./src/throttle');
const { requestTextWithRedirects } = require('./src/http-client');
const { notifyTelegram } = require('./src/telegram');
const { createFileStore } = require('./src/storage');
const { performCheck } = require('./src/checker');
const { createServer } = require('./src/server');

const debugSystem = createDebug('checker:system');
const debugNotifications = createDebug('checker:notifications');
const debugHTML = createDebug('checker:html');
const debugGeneral = createDebug('checker:general');

const config = loadConfig();
const zonedTime = createZonedTime(config.timeZone);
const store = createFileStore(config.stateFile);
const scheduleRequest = createRequestQueue(config.throttle);
debugSystem(`Using state file ${config.stateFile}`);

const deps = {
  store,
  log: debugGeneral,
  async fetchHtml(checker) {
    debugHTML(`[${checker.name}] Getting HTML: ${checker.url}`);
    const html = await scheduleRequest(() => requestTextWithRedirects(checker.url, checker.maxRedirects, {
      headers: config.headers
    }));
    debugHTML(`[${checker.name}] Got HTML`);
    return html;
  },
  async notify(checker, text) {
    debugNotifications(`[${checker.name}] Notifying...`);
    await notifyTelegram(checker, text);
    debugNotifications(`[${checker.name}] Notified.`);
  }
};

const cronJobs = config.checkers.filter(checker => checker.cronEnabled).map(checker => {
  debugSystem(`Enabled cron for checker "${checker.name}" with pattern "${checker.cronPattern}"`);
  return {
    fields: parseCronPattern(checker.cronPattern),
    run: () => performCheck(checker, deps).catch(err => {
      debugSystem(`[${checker.name}] Check failed: ${err.message}`);
    })
  };
});
startCronScheduler(cronJobs, zonedTime);

createServer({ checkers: config.checkers, store }).listen(config.port, () => {
  debugSystem(`App listening on port ${config.port}`);
});
