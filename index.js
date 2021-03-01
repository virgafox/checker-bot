const getenv = require('getenv');
const axios = require('axios');
const { parse } = require('node-html-parser');
const Redis = require('ioredis');
const CronJob = require('cron').CronJob;
const debug = require('debug')('checker');
const fastify = require('fastify')();
const Bottleneck = require('bottleneck');

// CONFIGURATION

const nodeEnv = getenv('NODE_ENV', 'production');
const telegramBotToken = getenv('TELEGRAM_BOT_TOKEN');
const telegramChatId = getenv('TELEGRAM_CHAT_ID');

const checkCronEnabled = getenv.bool('CHECK_CRON_ENABLED', true);
const checkCronPattern = getenv('CHECK_CRON_PATTERN', '*/20 * * * * *');
const timeZone = getenv('TZ', 'Europe/Rome');
const enabledCheckers = getenv.array('ENABLED_CHECKERS', 'string', []);
const headers = {
  'Accept': getenv('HEADER_ACCEPT', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
  'User-Agent': getenv('HEADER_USERAGENT', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15'),
  'Accept-Language': getenv('HEADER_ACCEPT_LANGUAGE', 'it-it'),
  'Accept-Encoding': getenv('HEADER_ACCEPT_ENCODING', 'gzip, deflate, br')
}

const providers = {
  amazon: {
    baseUrl: getenv('AMAZON_BASEURL', 'https://www.amazon.it/dp'),
    limiter: new Bottleneck({
      maxConcurrent: getenv.int('AMAZON_MAX_CONCURRENT_REQS', 1),
      minTime: getenv.int('AMAZON_MIN_MS_BETWEEN_REQS', 333)
    }),
    productIDs: getenv.array('AMAZON_PRODUCT_IDS', 'string', []),
    maxRedirects: null,
    findTitle: root => root.querySelector('#productTitle').rawText.trim(),
    findAvailability: root => root.querySelector('#availability').querySelector('span').firstChild.rawText.trim()
  },
  unieuro: {
    baseUrl: getenv('UNIEURO_BASEURL', 'https://www.unieuro.it/online'),
    limiter: new Bottleneck({
      maxConcurrent: getenv.int('UNIEURO_MAX_CONCURRENT_REQS', 1),
      minTime: getenv.int('UNIEURO_MIN_MS_BETWEEN_REQS', 333)
    }),
    productIDs: getenv.array('UNIEURO_PRODUCT_IDS', 'string', []),
    maxRedirects: null,
    findTitle: root => root.querySelector('h1.subtitle').rawText.trim(),
    findAvailability: root => root.querySelector('.product-availability').rawText.trim()
  },
  mediaworld: {
    baseUrl: getenv('MEDIAWORLD_BASEURL', 'https://www.mediaworld.it/product'),
    limiter: new Bottleneck({
      maxConcurrent: getenv.int('MEDIAWORLD_MAX_CONCURRENT_REQS', 1),
      minTime: getenv.int('MEDIAWORLD_MIN_MS_BETWEEN_REQS', 333)
    }),
    productIDs: getenv.array('MEDIAWORLD_PRODUCT_IDS', 'string', []),
    maxRedirects: 0,
    findTitle: root => root.querySelector('.product-info-wrapper').querySelector('h1').rawText.trim(),
    findAvailability: root => root.querySelector('.js-add-to-cart').rawText.trim()
  },
  euronics: {
    baseUrl: getenv('EURONICS_BASEURL', 'https://www.euronics.it'),
    limiter: new Bottleneck({
      maxConcurrent: getenv.int('EURONICS_MAX_CONCURRENT_REQS', 1),
      minTime: getenv.int('EURONICS_MIN_MS_BETWEEN_REQS', 333)
    }),
    productIDs: getenv.array('EURONICS_PRODUCT_IDS', 'string', []),
    maxRedirects: null,
    findTitle: root => root.querySelector('h1.productDetails__name').rawText.trim(),
    findAvailability: root => root.querySelector('.button--blue.cart__cta').rawText.trim() === 'Aggiungi al carrello' ? 'Disponibile' : 'Non disponibile'
  }
}

const redis = new Redis({
  host: getenv('REDIS_HOST', '127.0.0.1'), // Redis host
  port: getenv.int('REDIS_PORT', 6379), // Redis port
  family: getenv.int('REDIS_FAMILY', 4), // 4 (IPv4) or 6 (IPv6)
  password: getenv('REDIS_PASSWORD', '') ? getenv('REDIS_PASSWORD', '') : null,
  db: getenv.int('REDIS_DB', 0)
});

// FUNCTIONS

async function notify({ provider, productID, title, availability, url }) {
  debug(`[${provider}][${productID}] Notifying...`);
  await axios.get(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    params: {
      chat_id: telegramChatId,
      text: `${title} - ${availability} - ${url}`
    }
  });
  debug(`[${provider}][${productID}] Notified.`);
  return;
}

async function checkProduct({ provider, productID }) {
  const url = `${providers[provider].baseUrl}/${productID}`;
  debug(`[${provider}][${productID}] Checking product: ${url}`);
  let title, availability;
  try {
    let response;
    try {
      response = await providers[provider].limiter.schedule(() => axios.get(url, { headers, maxRedirects: providers[provider].maxRedirects }));
    } catch (axiosError) {
      debug(`[${provider}][${productID}] Axios error status: ${axiosError.response.status} `);
      throw axiosError;
    }
    try {
      const root = parse(response.data);
      title = providers[provider].findTitle(root);
      availability = providers[provider].findAvailability(root);
      debug(`[${provider}][${productID}] Parsed HTML.`);
    } catch (parserError) {
      debug(`[${provider}][${productID}] Error parsing HTML.`);
      throw parserError;
    }
  } catch (error) {
    title = title || 'Prodotto assente';
    availability = 'Non disponibile';
  }

  const siteData = { provider, productID, title, availability: availability.toLowerCase().replace(/\./g, '').trim(), url };
  return siteData;
}

async function checkProducts() {
  return Promise.all(enabledCheckers.map(provider => {
    return Promise.all(providers[provider].productIDs.map(async function (productID) {
      try {
        const [redisData, siteData] = await Promise.all([redis.hgetall(`${provider}:${productID}`), checkProduct({ provider, productID })]);
        debug(`[${provider}][${productID}] Old status: "${redisData.availability}", New status: "${siteData.availability}".`);
        if (!redisData || (redisData && siteData && siteData.availability && redisData.availability !== siteData.availability)) {
          debug(`[${provider}][${productID}] Non existent doc or mismatch.`);
          await redis.hmset(`${provider}:${productID}`, siteData);
          await notify(siteData);
        } else { debug(`[${provider}][${productID}] Nothing changed, nothing to do.`); }
      } catch (error) { debug(error); }
      return;
    }));
  }));
}

fastify.get('/', async (request, reply) => {
  const data = await Promise.all(enabledCheckers.map(provider => {
    return Promise.all(providers[provider].productIDs.map(productID => redis.hgetall(`${provider}:${productID}`)));
  }));
  return data;
});

if (checkCronEnabled) {
  const job = new CronJob(checkCronPattern, checkProducts, null, true, timeZone);
  job.start();
}

const port = process.env.PORT || 3000;
const start = async () => {
  try {
    await fastify.listen(port);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
start();

if (nodeEnv === 'development') checkProducts();
