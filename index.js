const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parse } = require('node-html-parser');
const Redis = require('ioredis');

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

function envEnum(name, allowedValues, defaultValue) {
  const value = envString(name, defaultValue).toLowerCase();
  if (!allowedValues.includes(value)) {
    throw new Error(`Invalid value for environment variable ${name}: "${value}" (allowed: ${allowedValues.join(', ')})`);
  }
  return value;
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

// CRON SCHEDULING
// Standard crontab syntax with an optional leading seconds field:
// [second] minute hour dayOfMonth month dayOfWeek (5-field patterns get second = 0).
// Months are 1-12, days of week 0-7 (0 and 7 = Sunday); jan-dec and sun-sat aliases are accepted.
// Supported per field: *, lists (a,b), ranges (a-b) and steps (*/n, a-b/n, a/n).
const CRON_FIELD_RANGES = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const CRON_ALIASES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
};
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseCronPattern(pattern) {
  const invalid = reason => new Error(`Invalid cron pattern "${pattern}": ${reason}`);
  const parts = pattern.trim().replace(/[a-z]+/gi, name => {
    const value = CRON_ALIASES[name.toLowerCase()];
    if (value === undefined) throw invalid(`unknown alias "${name}"`);
    return value;
  }).split(/\s+/);
  if (parts.length === 5) parts.unshift('0');
  if (parts.length !== 6) throw invalid('expected 5 or 6 fields');
  return parts.map((part, index) => {
    const [min, max] = CRON_FIELD_RANGES[index];
    const values = new Set();
    for (const item of part.split(',')) {
      const match = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
      if (!match) throw invalid(`cannot parse "${item}"`);
      const [, from, to, stepText] = match;
      const step = stepText === undefined ? 1 : Number(stepText);
      const low = from === undefined ? min : Number(from);
      const high = from === undefined ? max : to !== undefined ? Number(to) : stepText !== undefined ? max : low;
      if (step === 0 || low > high || low < min || high > max) throw invalid(`"${item}" is out of range ${min}-${max}`);
      // Day of week 7 is an alias for 0 (Sunday).
      for (let value = low; value <= high; value += step) values.add(index === 5 && value === 7 ? 0 : value);
    }
    return { values, all: values.size === (index === 5 ? 7 : max - min + 1) };
  });
}

function cronMatches([second, minute, hour, dayOfMonth, month, dayOfWeek], time) {
  const dayOfMonthOk = dayOfMonth.values.has(time.day);
  const dayOfWeekOk = dayOfWeek.values.has(time.weekday);
  // Like classic cron: if both day fields are restricted, either one matching is enough.
  const dayOk = dayOfMonth.all || dayOfWeek.all ? dayOfMonthOk && dayOfWeekOk : dayOfMonthOk || dayOfWeekOk;
  return dayOk && second.values.has(time.second) && minute.values.has(time.minute) &&
    hour.values.has(time.hour) && month.values.has(time.month);
}

// Throws a RangeError at startup if TZ is not a valid IANA time zone.
const zonedClock = new Intl.DateTimeFormat('en-US', {
  timeZone, hourCycle: 'h23', weekday: 'short',
  month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
});

function zonedTime(date) {
  const parts = Object.fromEntries(zonedClock.formatToParts(date).map(part => [part.type, part.value]));
  return {
    second: Number(parts.second),
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: WEEKDAYS[parts.weekday]
  };
}

// Ticks on every second boundary. If the event loop was busy and seconds were skipped,
// they are checked too (up to one minute back) and each job runs at most once per tick.
function startCronScheduler(jobs) {
  const msToNextSecond = () => 1000 - (Date.now() % 1000);
  let lastSecond = Math.floor(Date.now() / 1000);
  const tick = () => {
    const nowSecond = Math.floor(Date.now() / 1000);
    const times = [];
    for (let s = Math.max(lastSecond + 1, nowSecond - 59); s <= nowSecond; s++) {
      times.push(zonedTime(new Date(s * 1000)));
    }
    lastSecond = nowSecond;
    for (const job of jobs) {
      if (times.some(time => cronMatches(job.fields, time))) job.run();
    }
    setTimeout(tick, msToNextSecond());
  };
  setTimeout(tick, msToNextSecond());
}

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
  setTimeout(() => {
    queueTimerScheduled = false;
    if (activeRequests >= maxConcurrentRequests || requestQueue.length === 0) {
      processRequestQueue();
      return;
    }
    const item = requestQueue.shift();
    activeRequests += 1;
    lastRequestAt = Date.now();
    Promise.resolve()
      .then(() => item.task())
      .then(result => item.resolve(result))
      .catch(error => item.reject(error))
      .finally(() => {
        activeRequests -= 1;
        processRequestQueue();
      });
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
  compareMode: envEnum(`CHECKER_${checkerName.toUpperCase()}_COMPARE_MODE`, ['text', 'html'], 'text'),
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

async function notify({ checker, checkText }) {
  debugNotifications(`[${checker.name}] Notifying...`);
  const telegramUrl = new URL(`https://api.telegram.org/bot${checker.telegramBotToken}/sendMessage`);
  telegramUrl.searchParams.set('chat_id', checker.telegramChatId);
  telegramUrl.searchParams.set('text', `Variation detected - ${checker.name} - ${checkText} - ${checker.url}`);
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
  selectedElement.removeWhitespace();
  const text = selectedElement.text;
  // "html" mode also detects changes to classes, attributes and tag structure.
  const value = checker.compareMode === 'html' ? selectedElement.outerHTML : text;
  debugHTML(`[${checker.name}] Parsed HTML`);
  return { value, text };
}

async function performCheck(checker) {
  let [oldData, { value: checkResult, text: checkText }] = await Promise.all([
    memoryGet(checker.name),
    getAndParseHTML(checker)
  ]);
  if (!oldData) oldData = {};
  debugGeneral(`[${checker.name}] Old value: "${oldData.value}", New value: "${checkResult}".`);
  if (oldData.value !== checkResult) {
    debugGeneral(`[${checker.name}] Mismatch.`);
    await Promise.all([
      notify({ checker, checkText }),
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

const cronJobs = checkers.filter(checker => checker.cronEnabled).map(checker => {
  const fields = parseCronPattern(checker.cronPattern);
  debugSystem(`Enabled cron for checker "${checker.name}" with pattern "${checker.cronPattern}"`);
  return {
    fields,
    run: () => performCheck(checker).catch(err => {
      debugSystem(`[${checker.name}] Check failed: ${err.message}`);
    })
  };
});
startCronScheduler(cronJobs);

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
