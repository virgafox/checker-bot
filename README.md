# Checker Bot

This application periodically checks a portion of a web page for changes, and notifies the changes by Telegram.

## Dependencies

The runtime now relies on native Node.js implementations for:
- HTTP client requests
- HTTP server
- environment variable parsing
- debug logging
- request throttling
- cron scheduling

External dependencies are kept only for:
- `ioredis` (optional Redis persistence)
- `node-html-parser` (HTML parsing + CSS selector querying)

Note: `debug` may still appear in `package-lock.json` as a transitive dependency of `ioredis`, but it is no longer used directly by this application.

## Environment Variables

| Variable | Type | Required | Default |
|:--:|:--:|:--:|:--:|
| CHECKER_NAMES | String | Yes | - |
| CHECKER_$checker-name-uppercase_URL | String | Yes | - |
| CHECKER_$checker-name-uppercase_CSS_SELECTOR | String | Yes | - |
| CHECKER_$checker-name-uppercase_COMPARE_MODE | String (`text` \| `html`) | No | text |
| CHECKER_$checker-name-uppercase_TELEGRAM_BOT_TOKEN | String | Yes | - |
| CHECKER_$checker-name-uppercase_TELEGRAM_CHAT_ID | String | Yes | - |
| CHECKER_$checker-name-uppercase_MAX_REDIRECTS | String | No | 5 |
| CHECKER_$checker-name-uppercase_CRON_PATTERN | String | No | */20 * * * * * |
| CHECKER_$checker-name-uppercase_CRON_ENABLED | Boolean | No | true |
| PORT | Integer | No | 3000 | 
| NODE_ENV | String | No | production |
| TZ | String | No | Europe/Rome |
| DEBUG | String | No | - |
| REDIS_ENABLED | Boolean | No | false | 
| REDIS_HOST | String | No | 127.0.0.1 | 
| REDIS_PORT | Integer | No | 6379 | 
| REDIS_FAMILY | Integer | No | 4 | 
| REDIS_PASSWORD | String | No | - | 
| REDIS_DB | Integer | No | 0 | 
| HEADER_ACCEPT | String | No | safari standard on mac |
| HEADER_USERAGENT | String | No | safari standard on mac |
| HEADER_ACCEPT_LANGUAGE | String | No | it-it |
| HEADER_ACCEPT_ENCODING | String | No | gzip, deflate, br |


`CRON_PATTERN` uses standard crontab syntax with an optional leading seconds field: `[second] minute hour day-of-month month day-of-week`. Months are 1-12, days of week 0-7 (0 and 7 = Sunday), and `jan`-`dec` / `sun`-`sat` aliases are accepted. Each field supports `*`, lists (`1,15`), ranges (`1-5`) and steps (`*/5`, `10-30/5`). With 5 fields the check runs at second 0. If both day-of-month and day-of-week are restricted, either one matching is enough (as in crontab). Times are evaluated in `TZ`; around DST changes a time inside the skipped hour does not run and one inside the repeated hour runs twice.

`COMPARE_MODE` controls what is compared between checks:
- `text` (default): only the text content of the selected element. Changes to classes, attributes or tag structure are ignored.
- `html`: the full HTML of the selected element (`outerHTML`), so changes to classes, attributes and structure are detected too. Beware of attributes that change on every page load (tokens, random IDs, timestamps): they will trigger a notification on every check. Notifications still show the text content.

Switching mode on an existing checker triggers one notification on the next check, since the stored value changes format.