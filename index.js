const getenv = require('getenv');
const axios = require('axios');
const { parse } = require('node-html-parser');
const Redis = require('ioredis');
const CronJob = require('cron').CronJob;
const debug = require('debug')('checker');
const express = require('express');
const Bottleneck = require('bottleneck');
const app = express();

const nodeEnv = getenv('NODE_ENV', 'production');
const checkCronEnabled = getenv.bool('CHECK_CRON_ENABLED', true);
const checkCronPattern = getenv('CHECK_CRON_PATTERN', '*/30 * * * * *');
const timeZone = getenv('TZ', 'Europe/Rome');

const amazonBaseUrl = getenv('AMAZON_BASEURL', 'https://www.amazon.it');
const amazonProductIDs = getenv.array('AMAZON_PRODUCT_IDS', 'string');
const amazonLimiter = new Bottleneck({
  maxConcurrent: getenv.int('AMAZON_MAX_CONCURRENT_REQS', 1),
  minTime: getenv.int('AMAZON_MIN_MS_BETWEEN_REQS', 333)
});
const headers = {
  'Accept': getenv('AMAZON_HEADER_ACCEPT', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
  'User-Agent': getenv('AMAZON_HEADER_USERAGENT', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15'),
  'Accept-Language': getenv('AMAZON_HEADER_ACCEPT_LANGUAGE', 'it-it'),
  'Accept-Encoding': getenv('AMAZON_HEADER_ACCEPT_ENCODING', 'gzip, deflate, br')
}

const telegramBotToken = getenv('TELEGRAM_BOT_TOKEN');
const telegramChatId = getenv('TELEGRAM_CHAT_ID');

const redis = new Redis({
  host: getenv('REDIS_HOST', '127.0.0.1'), // Redis host
  port: getenv.int('REDIS_PORT', 6379), // Redis port
  family: getenv.int('REDIS_FAMILY', 4), // 4 (IPv4) or 6 (IPv6)
  password: getenv('REDIS_PASSWORD', '') ? getenv('REDIS_PASSWORD', '') : null,
  db: getenv.int('REDIS_DB', 0)
});

async function notify(amazonData) {
  debug(`[${amazonData.id}] Notifying...`);
  await axios.get(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    params: {
      chat_id: telegramChatId,
      text: `${amazonData.title} - ${amazonData.availability} - ${amazonBaseUrl}/dp/${amazonData.id}`
    }
  });
  debug(`[${amazonData.id}] Notified.`);
  return;
}

async function getAmazonData(productID) {
  debug(`[${productID}] Checking product: ${amazonBaseUrl}/dp/${productID}`);
  const response = await amazonLimiter.schedule(() => axios.get(`${amazonBaseUrl}/dp/${productID}`, { headers }));
  const root = parse(response.data);
  const amazonData = {
    id: productID,
    title: root.querySelector('#productTitle').rawText.trim(),
    availability: root.querySelector('#availability').querySelector('span').firstChild.rawText.trim()
  };
  debug(`[${productID}] Parsed HTML.`);
  return amazonData;
}

async function checkProduct(productID) {
  try {
    const [redisData, amazonData] = await Promise.all([redis.hgetall(productID), getAmazonData(productID)]);
    debug(`[${productID}] Availability from Redis: ${redisData.availability}`);
    debug(`[${productID}] Availability from Amazon: ${amazonData.availability}`);
    if (!redisData || (redisData && amazonData && amazonData.availability && redisData.availability !== amazonData.availability)) {
      debug(`[${productID}] Non existent doc or mismatch.`);
      await redis.hmset(productID, amazonData);
      await notify(amazonData);
    } else { debug(`[${productID}] Noting changed, nothing to do.`); }
  } catch (error) { debug(error); }
  return;
}

async function routineFunction() { return Promise.all(amazonProductIDs.map(checkProduct)); }

app.get('/', async (req, res, next) => {
  const data = await Promise.all(amazonProductIDs.map((id) => redis.hgetall(id)))
  return res.json(data);
});

app.post('/check', async (req, res, next) => {
  res.sendStatus(200);
  await routineFunction();
  return;
})

if (checkCronEnabled) {
  const job = new CronJob(checkCronPattern, routineFunction, null, true, timeZone);
  job.start();
}

const port = process.env.PORT || 3000;
app.listen(port);
console.log('App listenting on port ' + port);

if (nodeEnv === 'development') {
  routineFunction();
}
