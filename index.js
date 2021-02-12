const getenv = require('getenv');
const axios = require('axios');
const cheerio = require('cheerio');
const Redis = require("ioredis");
const CronJob = require('cron').CronJob;
const debug = require('debug')('checker');
const express = require('express');
const Bottleneck = require('bottleneck');
const app = express();

const checkCronPattern = getenv('CHECK_CRON_PATTERN', '*/10 * * * * *');
const timeZone = getenv('TZ', 'Europe/Rome');

const amazonBaseUrl = getenv('AMAZON_BASEURL', 'https://www.amazon.it');
const amazonProductIDs = getenv.array('AMAZON_PRODUCT_IDS', 'string', []);
const amazonLimiter = new Bottleneck({
  maxConcurrent: getenv.int('AMAZON_MAX_CONCURRENT_REQS', 1),
  minTime: getenv.int('AMAZON_MIN_MS_BETWEEN_REQS', 333)
});
const amazonLanguageHeader = getenv('AMAZON_ACCEPT_LANGUAGE_HEADER', 'it-it');

const telegramBotToken = getenv('TELEGRAM_BOT_TOKEN');
const telegramChatId = getenv('TELEGRAM_CHAT_ID');

const redis = new Redis({
  port: getenv.int('REDIS_PORT', 6379), // Redis port
  host: getenv('REDIS_HOST', '127.0.0.1'), // Redis host
  family: getenv.int('REDIS_FAMILY', 4), // 4 (IPv4) or 6 (IPv6)
  password: getenv('REDIS_PASSWORD', '') ? getenv('REDIS_PASSWORD', '') : null,
  db: getenv.int('REDIS_DB', 0)
});

async function notify(docInfo) {
  debug(`Notifying...`);
  await axios.request({
    baseURL: `https://api.telegram.org/bot${telegramBotToken}`,
    url: '/sendMessage',
    params: {
      chat_id: telegramChatId,
      text: `${docInfo.title} - ${docInfo.availability} - ${amazonBaseUrl}/dp/${docInfo.id}`
    }
  });
  debug(`Notified.`);
  return;
}

async function getAmazonData(productID) {
  debug(`[${productID}] Checking product`);
  const response = await amazonLimiter.schedule(() => axios.request({
    url: `${amazonBaseUrl}/dp/${productID}`,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15',
      'Accept-Language': amazonLanguageHeader,
      'Accept-Encoding': 'gzip, deflate, br'
    }
  }));
  debug(`[${productID}] Obtained HTML`);
  const $ = cheerio.load(response.data);
  const docInfo = {
    id: productID,
    title: $('#productTitle').text().trim(),
    availability: $('#availability span').text().trim()
  };
  debug(`[${productID}] Parsed HTML: ${JSON.stringify(docInfo)}`);
  return docInfo;
}

async function checkProduct(productID) {
  try {
    const [docData, docInfo] = await Promise.all([redis.hgetall(productID), getAmazonData(productID)]);
    debug(`[${productID}] Got doc`);
    debug(`Doc from Redis: ${JSON.stringify(docData)}`);
    debug(`Doc from Amazon: ${JSON.stringify(docInfo)}`);
    if (!docData || (docData && docInfo && docInfo.availability && docData.availability !== docInfo.availability)) {
      debug(`[${productID}] Non existent doc or mismatch`);
      await redis.hmset(productID, docInfo);
      await notify(docInfo);
    } else { debug(`[${productID}] Noting changed, nothing to do`); }
  } catch (error) { debug(error); }
  return;
}

async function routineFunction() { return Promise.all(amazonProductIDs.map(checkProduct)); }

app.get('/', async (req, res, next) => {
  const data = [];
  let el;
  for (let productID of amazonProductIDs) {
    el = await redis.hgetall(productID);
    data.push(el);
  }
  return res.json(data);
});

const job = new CronJob(checkCronPattern, routineFunction, null, true, timeZone);
job.start();

const port = process.env.PORT || 3000;
app.listen(port);
console.log('App listenting on port ' + port);