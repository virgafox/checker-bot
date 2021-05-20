const getenv = require('getenv');
const axios = require('axios');
const { parse } = require('node-html-parser');
const Redis = require('ioredis');
const CronJob = require('cron').CronJob;
const fastify = require('fastify')();
const Bottleneck = require('bottleneck');
const https = require('https');

const debug = require('debug');
const debugSystem = debug('checker:system');
const debugNotifications = debug('checker:notifications');
const debugHTML = debug('checker:html');
const debugGeneral = debug('checker:general');

// CONFIGURATION
const port = getenv.int('PORT', 3000);
const timeZone = getenv('TZ', 'Europe/Rome');

const redis = new Redis({
  host: getenv('REDIS_HOST', '127.0.0.1'), // Redis host
  port: getenv.int('REDIS_PORT', 6379), // Redis port
  family: getenv.int('REDIS_FAMILY', 4), // 4 (IPv4) or 6 (IPv6)
  password: getenv('REDIS_PASSWORD', '') ? getenv('REDIS_PASSWORD', '') : null,
  db: getenv.int('REDIS_DB', 0)
});

const limiter = new Bottleneck({
  maxConcurrent: getenv.int(`BOTTLENECK_MAX_CONCURRENT_REQS`, 1),
  minTime: getenv.int(`BOTTLENECK_MIN_MS_BETWEEN_REQS`, 333)
});

const headers = {
  'Accept': getenv('HEADER_ACCEPT', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
  'User-Agent': getenv('HEADER_USERAGENT', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15'),
  'Accept-Language': getenv('HEADER_ACCEPT_LANGUAGE', 'it-it'),
  'Accept-Encoding': getenv('HEADER_ACCEPT_ENCODING', 'gzip, deflate, br')
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const checkers = getenv.array('CHECKER_NAMES', 'string').map(checkerName => ({
  name: checkerName,
  url: getenv(`CHECKER_${checkerName.toUpperCase()}_URL`),
  cssSelector: getenv(`CHECKER_${checkerName.toUpperCase()}_CSS_SELECTOR`),
  telegramBotToken: getenv(`CHECKER_${checkerName.toUpperCase()}_TELEGRAM_BOT_TOKEN`),
  telegramChatId: getenv(`CHECKER_${checkerName.toUpperCase()}_TELEGRAM_CHAT_ID`),
  maxRedirects: getenv.int(`CHECKER_${checkerName.toUpperCase()}_MAX_REDIRECTS`, 5),
  cronPattern: getenv(`CHECKER_${checkerName.toUpperCase()}_CRON_PATTERN`, '*/20 * * * * *'),
  cronEnabled: getenv.bool(`CHECKER_${checkerName.toUpperCase()}_CRON_ENABLED`, true)
}));

// FUNCTIONS
async function notify({ checker, checkResult }) {
  debugNotifications(`[${checker.name}] Notifying...`);
  await axios.get(`https://api.telegram.org/bot${checker.telegramBotToken}/sendMessage`, {
    params: {
      chat_id: checker.telegramChatId,
      text: `Variation detected - ${checker.name} - ${checkResult} - ${checker.url}`
    }
  });
  debugNotifications(`[${checker.name}] Notified.`);
  return;
}

async function getAndParseHTML(checker) {
  debugHTML(`[${checker.name}] Getting HTML: ${checker.url}`);
  const response = await limiter.schedule(() => axios.get(checker.url, {
    headers, maxRedirects: checker.maxRedirects, httpsAgent
  }));
  debugHTML(`[${checker.name}] Got HTML, parsing`);
  const checkResult = parse(response.data).querySelector(checker.cssSelector).text;
  debugHTML(`[${checker.name}] Parsed HTML`);
  return checkResult;
}

async function performCheck(checker) {
  const [redisData, checkResult] = await Promise.all([
    redis.hgetall(checker.name),
    getAndParseHTML(checker)
  ]);
  debugGeneral(`[${checker.name}] Old value: "${redisData.value}", New value: "${checkResult}".`);
  if (redisData.value !== checkResult) {
    debugGeneral(`[${checker.name}] Mismatch.`);
    await Promise.all([
      notify({ checker, checkResult }),
      redis.hmset(checker.name, {
        name: checker.name,
        value: checkResult,
        url: checker.url,
        updatedAt: new Date().toISOString()
      })
    ]);
  } else {
    debugGeneral(`[${checker.name}] Nothing changed, nothing to do.`);
  }
  return;
}

for (let checker of checkers) {
  if (checker.cronEnabled) {
    let job = new CronJob(checker.cronPattern, function () {
      performCheck(checker);
    }, null, true, timeZone);
    job.start();
    debugSystem(`Enabled cron for checker "${checker.name}" with pattern "${checker.cronPattern}"`);
  }
}

fastify.get('/', async (request, reply) => {
  const data = await Promise.all(checkers.map(checker => redis.hgetall(checker.name)));
  return data;
});

const start = async () => {
  try {
    await fastify.listen(port);
    debugSystem(`App listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
start();
