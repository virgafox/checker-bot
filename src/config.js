'use strict';

const path = require('path');

const DEFAULT_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15',
  acceptLanguage: 'it-it',
  acceptEncoding: 'gzip, deflate, br'
};

// Typed readers over an environment object (process.env by default).
function createEnvReader(env) {
  function string(name, defaultValue, required = false) {
    const value = env[name];
    if ((value === undefined || value === '') && required) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value !== undefined && value !== '' ? value : defaultValue;
  }

  function int(name, defaultValue) {
    const value = env[name];
    if (value === undefined || value === '') return defaultValue;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) throw new Error(`Invalid integer environment variable: ${name}`);
    return parsed;
  }

  function bool(name, defaultValue) {
    const value = env[name];
    if (value === undefined || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  }

  function oneOf(name, allowedValues, defaultValue) {
    const value = string(name, defaultValue).toLowerCase();
    if (!allowedValues.includes(value)) {
      throw new Error(`Invalid value for environment variable ${name}: "${value}" (allowed: ${allowedValues.join(', ')})`);
    }
    return value;
  }

  function list(name) {
    return string(name, undefined, true).split(',').map(item => item.trim()).filter(Boolean);
  }

  return { string, int, bool, oneOf, list };
}

function loadCheckers(read) {
  return read.list('CHECKER_NAMES').map(name => {
    const prefix = `CHECKER_${name.toUpperCase()}_`;
    return {
      name,
      url: read.string(`${prefix}URL`, undefined, true),
      cssSelector: read.string(`${prefix}CSS_SELECTOR`, undefined, true),
      compareMode: read.oneOf(`${prefix}COMPARE_MODE`, ['text', 'html'], 'text'),
      telegramBotToken: read.string(`${prefix}TELEGRAM_BOT_TOKEN`, undefined, true),
      telegramChatId: read.string(`${prefix}TELEGRAM_CHAT_ID`, undefined, true),
      maxRedirects: read.int(`${prefix}MAX_REDIRECTS`, 5),
      cronPattern: read.string(`${prefix}CRON_PATTERN`, '*/20 * * * * *'),
      cronEnabled: read.bool(`${prefix}CRON_ENABLED`, true)
    };
  });
}

function loadConfig(env = process.env, cwd = process.cwd()) {
  const read = createEnvReader(env);
  return {
    port: read.int('PORT', 3000),
    timeZone: read.string('TZ', 'Europe/Rome'),
    stateFile: path.resolve(cwd, read.string('STATE_FILE', 'data/state.json')),
    throttle: {
      maxConcurrent: read.int('BOTTLENECK_MAX_CONCURRENT_REQS', 1),
      minMsBetween: read.int('BOTTLENECK_MIN_MS_BETWEEN_REQS', 333)
    },
    headers: {
      'Accept': read.string('HEADER_ACCEPT', DEFAULT_HEADERS.accept),
      'User-Agent': read.string('HEADER_USERAGENT', DEFAULT_HEADERS.userAgent),
      'Accept-Language': read.string('HEADER_ACCEPT_LANGUAGE', DEFAULT_HEADERS.acceptLanguage),
      'Accept-Encoding': read.string('HEADER_ACCEPT_ENCODING', DEFAULT_HEADERS.acceptEncoding)
    },
    checkers: loadCheckers(read)
  };
}

module.exports = { createEnvReader, loadConfig };
