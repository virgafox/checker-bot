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
- state persistence (JSON file)

The only runtime dependency is `node-html-parser` (HTML parsing + CSS selector querying).
`nodemon` is a dev dependency used by `npm run dev` and the VS Code launch configuration.

## Project structure

| Path | Purpose |
|:--|:--|
| `index.js` | Entry point: loads the configuration and wires the modules together |
| `src/config.js` | Environment variable parsing and checker configuration |
| `src/cron.js` | Cron pattern parsing and scheduler |
| `src/throttle.js` | Request queue (max concurrency + minimum delay between requests) |
| `src/http-client.js` | HTTP(S) GET with redirect handling |
| `src/checker.js` | Element extraction and change detection |
| `src/telegram.js` | Telegram notifications |
| `src/storage.js` | File-based state persistence |
| `src/server.js` | HTTP endpoint exposing the stored state |
| `test/` | Unit tests (`node:test`) |

## Development

```sh
npm install
cp .env.example .env   # then fill in the values
npm run dev            # restarts on changes to index.js and src/
npm test               # unit tests, no network access needed
```

In VS Code, the "Launch via nodemon" configuration uses the local `nodemon` and reads `.env`.

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
| STATE_FILE | String | No | data/state.json (`/data/state.json` in Docker) |
| BOTTLENECK_MAX_CONCURRENT_REQS | Integer | No | 1 |
| BOTTLENECK_MIN_MS_BETWEEN_REQS | Integer | No | 333 |
| HEADER_ACCEPT | String | No | safari standard on mac |
| HEADER_USERAGENT | String | No | safari standard on mac |
| HEADER_ACCEPT_LANGUAGE | String | No | it-it |
| HEADER_ACCEPT_ENCODING | String | No | gzip, deflate, br |


`CRON_PATTERN` uses standard crontab syntax with an optional leading seconds field: `[second] minute hour day-of-month month day-of-week`. Months are 1-12, days of week 0-7 (0 and 7 = Sunday), and `jan`-`dec` / `sun`-`sat` aliases are accepted. Each field supports `*`, lists (`1,15`), ranges (`1-5`) and steps (`*/5`, `10-30/5`). With 5 fields the check runs at second 0. If both day-of-month and day-of-week are restricted, either one matching is enough (as in crontab). Times are evaluated in `TZ`; around DST changes a time inside the skipped hour does not run and one inside the repeated hour runs twice.

`COMPARE_MODE` controls what is compared between checks:
- `text` (default): only the text content of the selected element. Changes to classes, attributes or tag structure are ignored.
- `html`: the full HTML of the selected element (`outerHTML`), so changes to classes, attributes and structure are detected too. Beware of attributes that change on every page load (tokens, random IDs, timestamps): they will trigger a notification on every check. Notifications still show the text content.

Switching mode on an existing checker triggers one notification on the next check, since the stored value changes format.

## State persistence

The last detected value of each checker is saved in `STATE_FILE` (a JSON object keyed by checker name; relative paths are resolved from the working directory). Without it, every restart would look like a change and send a notification for every checker. Writes are atomic (temporary file + rename). If the file exists but cannot be parsed, the bot refuses to start instead of overwriting it.

The state is saved only after the Telegram notification succeeds: if Telegram fails, the change is notified again on the next check.

`GET /` returns the stored state of the configured checkers. The Telegram bot token is never written to the state file nor returned by the endpoint.

### Docker

The image stores the state in `/data/state.json` and declares `/data` as a volume. Mount a named volume (or a host directory) there to keep the state across container restarts and image updates:

```sh
docker build -t checker-bot .
docker run -d --name checker-bot -v checker-bot-data:/data --env-file .env -p 3000:3000 checker-bot
```

With Docker Compose:

```yaml
services:
  checker-bot:
    image: ghcr.io/<owner>/checker-bot:latest
    env_file: .env
    ports:
      - "3000:3000"
    volumes:
      - checker-bot-data:/data
    restart: unless-stopped

volumes:
  checker-bot-data:
```

### Migrating from Redis

Redis support has been removed. On the first start with the file store, each checker has no stored value, so it sends one notification and then works normally.

