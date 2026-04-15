const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parse } = require('node-html-parser');
const Redis = require('ioredis');
const CronJob = require('cron').CronJob;

// CONFIGURATION
function envString(name, defaultValue, required = false) {
  const value = process.env[name];
  if ((value === undefined || value === '') && required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value !== undefined && value !== '' ? value : defaultValue;
}

function envInt(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer environment variable: ${name}`);
  return parsed;
}

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function envArray(name) {
  const value = envString(name, undefined, true);
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

const debugPatterns = (process.env.DEBUG || '').split(',').map(item => item.trim()).filter(Boolean);
function createDebug(namespace) {
  return (...args) => {
    const enabled = debugPatterns.some(pattern => {
      if (pattern === '*') return true;
      if (pattern.endsWith('*')) return namespace.startsWith(pattern.slice(0, -1));
      return pattern === namespace;
    });
    if (enabled) {
      console.log(`[${namespace}]`, ...args);
    }
  };
}

const debugSystem = createDebug('checker:system');
const debugNotifications = createDebug('checker:notifications');
const debugHTML = createDebug('checker:html');
const debugGeneral = createDebug('checker:general');

const port = envInt('PORT', 3000);
const timeZone = envString('TZ', 'Europe/Rome');

let memoryGet, memorySet;

if (envBool('REDIS_ENABLED', false)) {
  const redisPassword = envString('REDIS_PASSWORD', '');
  const redis = new Redis({
    host: envString('REDIS_HOST', '127.0.0.1'),
    port: envInt('REDIS_PORT', 6379),
    family: envInt('REDIS_FAMILY', 4),
    password: redisPassword ? redisPassword : null,
    db: envInt('REDIS_DB', 0)
  });
  memoryGet = async function (checkerName) {
    return redis.hgetall(checkerName);
  };
  memorySet = async function (checkerName, data) {
    return redis.hmset(checkerName, data);
  };
} else {
  const memoryDict = {}
  memoryGet = async (key) => memoryDict[key];
  memorySet = async function (key, value) {
    memoryDict[key] = value;
    return;
  }
}

const maxConcurrentRequests = envInt('BOTTLENECK_MAX_CONCURRENT_REQS', 1);
const minMsBetweenRequests = envInt('BOTTLENECK_MIN_MS_BETWEEN_REQS', 333);
let activeRequests = 0;
let lastRequestAt = 0;
const requestQueue = [];
let queueTimerScheduled = false;

function scheduleRequest(task) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ task, resolve, reject });
    processRequestQueue();
  });
}

function processRequestQueue() {
  if (queueTimerScheduled) return;
  if (activeRequests >= maxConcurrentRequests || requestQueue.length === 0) return;
  const delayMs = Math.max(0, minMsBetweenRequests - (Date.now() - lastRequestAt));
  queueTimerScheduled = true;
  setTimeout(async () => {
    queueTimerScheduled = false;
    if (activeRequests >= maxConcurrentRequests || requestQueue.length === 0) {
      processRequestQueue();
      return;
    }
    const item = requestQueue.shift();
    activeRequests += 1;
    lastRequestAt = Date.now();
    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      activeRequests -= 1;
      processRequestQueue();
    }
  }, delayMs);
}

const headers = {
  'Accept': envString('HEADER_ACCEPT', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
  'User-Agent': envString('HEADER_USERAGENT', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15'),
  'Accept-Language': envString('HEADER_ACCEPT_LANGUAGE', 'it-it'),
  'Accept-Encoding': envString('HEADER_ACCEPT_ENCODING', 'gzip, deflate, br')
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const checkers = envArray('CHECKER_NAMES').map(checkerName => ({
  name: checkerName,
  url: envString(`CHECKER_${checkerName.toUpperCase()}_URL`, undefined, true),
  cssSelector: envString(`CHECKER_${checkerName.toUpperCase()}_CSS_SELECTOR`, undefined, true),
  telegramBotToken: envString(`CHECKER_${checkerName.toUpperCase()}_TELEGRAM_BOT_TOKEN`, undefined, true),
  telegramChatId: envString(`CHECKER_${checkerName.toUpperCase()}_TELEGRAM_CHAT_ID`, undefined, true),
  maxRedirects: envInt(`CHECKER_${checkerName.toUpperCase()}_MAX_REDIRECTS`, 5),
  cronPattern: envString(`CHECKER_${checkerName.toUpperCase()}_CRON_PATTERN`, '*/20 * * * * *'),
  cronEnabled: envBool(`CHECKER_${checkerName.toUpperCase()}_CRON_ENABLED`, true)
}));

// FUNCTIONS
function requestText(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlString);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const requestOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      agent: isHttps ? httpsAgent : undefined
    };
    const req = client.request(parsedUrl, requestOptions, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function requestTextWithRedirects(urlString, maxRedirectsAllowed, options = {}) {
  let nextUrl = urlString;
  let redirects = 0;
  while (true) {
    const response = await requestText(nextUrl, options);
    const statusCode = response.statusCode;
    const location = response.headers.location;
    if (location && [301, 302, 303, 307, 308].includes(statusCode) && redirects < maxRedirectsAllowed) {
      nextUrl = new URL(location, nextUrl).toString();
      redirects += 1;
      continue;
    }
    if (statusCode >= 400) {
      throw new Error(`Request failed with status ${statusCode} for ${nextUrl}`);
    }
    return response.body;
  }
}

async function notify({ checker, checkResult }) {
  debugNotifications(`[${checker.name}] Notifying...`);
  const telegramUrl = new URL(`https://api.telegram.org/bot${checker.telegramBotToken}/sendMessage`);
  telegramUrl.searchParams.set('chat_id', checker.telegramChatId);
  telegramUrl.searchParams.set('text', `Variation detected - ${checker.name} - ${checkResult} - ${checker.url}`);
  await requestTextWithRedirects(telegramUrl.toString(), 2);
  debugNotifications(`[${checker.name}] Notified.`);
  return;
}

async function getAndParseHTML(checker) {
  debugHTML(`[${checker.name}] Getting HTML: ${checker.url}`);
  const html = await scheduleRequest(() => requestTextWithRedirects(checker.url, checker.maxRedirects, {
    headers
  }));
  debugHTML(`[${checker.name}] Got HTML, parsing`);
  const selectedElement = parse(html, {
    lowerCaseTagName: false,  // convert tag name to lower case (hurt performance heavily)
    comment: false,
    blockTextElements: {
      script: false,	// keep text content when parsing
      noscript: false,	// keep text content when parsing
      style: false,		// keep text content when parsing
      pre: false			// keep text content when parsing
    }
  }).querySelector(checker.cssSelector);
  if (!selectedElement) {
    const sanitizedUrl = new URL(checker.url);
    throw new Error(`Selector not found for checker "${checker.name}" on ${sanitizedUrl.origin}${sanitizedUrl.pathname}: ${checker.cssSelector}`);
  }
  const checkResult = selectedElement.removeWhitespace().text;
  debugHTML(`[${checker.name}] Parsed HTML`);
  return checkResult;
}

async function performCheck(checker) {
  let [oldData, checkResult] = await Promise.all([
    memoryGet(checker.name),
    getAndParseHTML(checker)
  ]);
  if (!oldData) oldData = {};
  debugGeneral(`[${checker.name}] Old value: "${oldData.value}", New value: "${checkResult}".`);
  if (oldData.value !== checkResult) {
    debugGeneral(`[${checker.name}] Mismatch.`);
    await Promise.all([
      notify({ checker, checkResult }),
      memorySet(checker.name, {
        name: checker.name,
        value: checkResult,
        lastChangeAt: new Date().toISOString(),
        checkerConfiguration: JSON.stringify(checker)
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
      performCheck(checker).catch(err => {
        debugSystem(`[${checker.name}] Check failed: ${err.message}`);
      });
    }, null, true, timeZone);
    job.start();
    debugSystem(`Enabled cron for checker "${checker.name}" with pattern "${checker.cronPattern}"`);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' || req.url !== '/') {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  try {
    const data = await Promise.all(checkers.map(async checker => {
      const element = await memoryGet(checker.name);
      if (!element || !element.checkerConfiguration) {
        debugSystem(`[${checker.name}] No checker state found in storage yet.`);
        return null;
      }
      return {
        ...element,
        checkerConfiguration: JSON.parse(element.checkerConfiguration)
      };
    }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data.filter(item => item !== null)));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(port, () => {
  debugSystem(`App listening on port ${port}`);
});
