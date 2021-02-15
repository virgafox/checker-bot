const getenv = require('getenv');
const axios = require('axios');
const { parse } = require('node-html-parser');
const Redis = require('ioredis');
const CronJob = require('cron').CronJob;
const debug = require('debug')('checker');
const express = require('express');
const Bottleneck = require('bottleneck');
const app = express();

// CONFIGURATION

const nodeEnv = getenv('NODE_ENV', 'production');
const checkCronEnabled = getenv.bool('CHECK_CRON_ENABLED', true);
const checkCronPattern = getenv('CHECK_CRON_PATTERN', '*/30 * * * * *');
const timeZone = getenv('TZ', 'Europe/Rome');
const headers = {
  'Accept': getenv('HEADER_ACCEPT', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
  'User-Agent': getenv('HEADER_USERAGENT', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15'),
  'Accept-Language': getenv('HEADER_ACCEPT_LANGUAGE', 'it-it'),
  'Accept-Encoding': getenv('HEADER_ACCEPT_ENCODING', 'gzip, deflate, br')
}

const amazonBaseUrl = getenv('AMAZON_BASEURL', 'https://www.amazon.it');
const amazonLimiter = new Bottleneck({
  maxConcurrent: getenv.int('AMAZON_MAX_CONCURRENT_REQS', 1),
  minTime: getenv.int('AMAZON_MIN_MS_BETWEEN_REQS', 333)
});

const unieuroBaseUrl = getenv('UNIEURO_BASEURL', 'https://www.unieuro.it');
const unieuroLimiter = new Bottleneck({
  maxConcurrent: getenv.int('UNIEURO_MAX_CONCURRENT_REQS', 1),
  minTime: getenv.int('UNIEURO_MIN_MS_BETWEEN_REQS', 333)
});

const mediaworldBaseUrl = getenv('MEDIAWORLD_BASEURL', 'https://www.mediaworld.it');
const mediaworldLimiter = new Bottleneck({
  maxConcurrent: getenv.int('MEDIAWORLD_MAX_CONCURRENT_REQS', 1),
  minTime: getenv.int('MEDIAWORLD_MIN_MS_BETWEEN_REQS', 333)
});

const enabledCheckers = getenv.array('ENABLED_CHECKERS', 'string', ['amazon']);
const productIDS = {
  amazon: getenv.array('AMAZON_PRODUCT_IDS', 'string'),
  unieuro: getenv.array('UNIEURO_PRODUCT_IDS', 'string'),
  mediaworld: getenv.array('MEDIAWORLD_PRODUCT_IDS', 'string'),
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

// FUNCTIONS

async function notify(siteData) {
  debug(`[${siteData.provider}][${siteData.id}] Notifying...`);
  await axios.get(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    params: {
      chat_id: telegramChatId,
      text: `${siteData.title} - ${siteData.availability} - ${siteData.url}`
    }
  });
  debug(`[${siteData.provider}][${siteData.id}] Notified.`);
  return;
}

const checkers = {
  amazon: async function getAmazonData(productID) {
    const url = `${amazonBaseUrl}/dp/${productID}`;
    debug(`[amazon][${productID}] Checking amazon product: ${url}`);
    const response = await amazonLimiter.schedule(() => axios.get(url, { headers }));
    const root = parse(response.data);
    const siteData = {
      provider: 'amazon',
      id: productID,
      title: root.querySelector('#productTitle').rawText.trim(),
      availability: root.querySelector('#availability').querySelector('span').firstChild.rawText.trim(),
      url
    };
    debug(`[amazon][${productID}] Parsed HTML.`);
    return siteData;
  },
  unieuro: async function getUnieuroData(productID) {
    const url = `${unieuroBaseUrl}/online/${productID}`;
    debug(`[unieuro][${productID}] Checking unieuro product: ${url}`);
    const response = await unieuroLimiter.schedule(() => axios.get(url, { headers }));
    const root = parse(response.data);
    const siteData = {
      provider: 'unieuro',
      id: productID,
      title: root.querySelector('h1.subtitle').rawText.trim(),
      availability: root.querySelector('.product-availability').rawText.trim(),
      url
    };
    debug(`[unieuro][${productID}] Parsed HTML.`);
    return siteData;
  },
  mediaworld: async function getMediaworldData(productID) {
    const url = `${mediaworldBaseUrl}/product/${productID}`;
    debug(`[mediaworld][${productID}] Checking mediaworld product: ${url}`);
    let siteData;
    try {
      const response = await mediaworldLimiter.schedule(() => axios.get(url, { headers, maxRedirects: 0 }));
      const root = parse(response.data);
      const title = root.querySelector('.product-info-wrapper').querySelector('h1').rawText.trim();
      const availability = root.querySelector('.js-add-to-cart').rawText.trim()
      siteData = {
        provider: 'mediaworld',
        id: productID,
        title,
        availability: availability === 'Aggiungi al carrello' ? 'Disponibile' : 'Non disponibile',
        url
      };
    } catch (error) {
      siteData = {
        provider: 'mediaworld',
        id: productID,
        title: 'Prodotto assente',
        availability: 'Non disponibile',
        url
      };
    }
    debug(`[mediaworld][${productID}] Parsed HTML.`);
    return siteData;
  }
}

async function checkProducts() {
  return Promise.all(enabledCheckers.map(provider => {
    return Promise.all(productIDS[provider].map(async function (productID) {
      try {
        const [redisData, siteData] = await Promise.all([redis.hgetall(`${provider}:${productID}`), checkers[provider](productID)]);
        debug(`[${provider}][${productID}] Availability from redis: ${redisData.availability}`);
        debug(`[${provider}][${productID}] Availability from ${provider}: ${siteData.availability}`);
        if (!redisData || (redisData && siteData && siteData.availability && redisData.availability !== siteData.availability)) {
          debug(`[${provider}][${productID}] Non existent doc or mismatch.`);
          await redis.hmset(`${provider}:${productID}`, siteData);
          await notify(siteData);
        } else { debug(`[${provider}][${productID}] Noting changed, nothing to do.`); }
      } catch (error) { debug(error); }
      return;
    }));
  }))
}

app.get('/', async (req, res, next) => {
  const data = await Promise.all(amazonProductIDs.map((id) => redis.hgetall(id)))
  return res.json(data);
});

app.post('/checkProducts', async (req, res, next) => {
  res.sendStatus(200);
  await checkProducts();
  return;
})

if (checkCronEnabled) {
  const job = new CronJob(checkCronPattern, checkProducts, null, true, timeZone);
  job.start();
}

const port = process.env.PORT || 3000;
app.listen(port);
console.log('App listenting on port ' + port);

if (nodeEnv === 'development') checkProducts();
