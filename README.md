# Checker Bot

This application periodically checks a portion of a web page for changes, and notifies the changes by Telegram.

Pages can be fetched with a plain HTTP request (fast, lightweight) or with a real headless Chromium, for sites whose content is rendered by JavaScript (single page applications, prices loaded via API, ...). The mode is chosen per checker with `FETCH_MODE`.

## Dependencies

The runtime now relies on native Node.js implementations for:
- HTTP client requests
- HTTP server
- environment variable parsing
- debug logging
- request throttling
- cron scheduling
- state persistence (JSON file)

Runtime dependencies:
- `node-html-parser`: HTML parsing + CSS selector querying.
- `puppeteer-core`: drives a headless Chromium for checkers with `FETCH_MODE=browser`. It does not download a browser: it uses the one at `BROWSER_EXECUTABLE_PATH` (the Docker image includes Chromium). It is loaded only when at least one checker uses the browser.

`nodemon` is a dev dependency used by `npm run dev` and the VS Code launch configuration.

## Project structure

| Path | Purpose |
|:--|:--|
| `index.js` | Entry point: loads the configuration and wires the modules together |
| `src/config.js` | Environment variable parsing and checker configuration |
| `src/cron.js` | Cron pattern parsing and scheduler |
| `src/throttle.js` | Request queue (max concurrency + minimum delay between requests) |
| `src/http-client.js` | HTTP(S) GET with redirect handling |
| `src/browser.js` | Headless Chromium fetcher (shared browser, one incognito context per check) |
| `src/fetcher.js` | Routes each checker to the HTTP or browser fetcher, through the request queue |
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

The real browser integration test (`test/browser.integration.test.js`) runs only when `BROWSER_EXECUTABLE_PATH` (or `PUPPETEER_EXECUTABLE_PATH`) points to a Chromium/Chrome binary, and is skipped otherwise. The dev container installs Chromium and sets it:

```sh
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm test
```

In VS Code, the "Launch via nodemon" configuration uses the local `nodemon` and reads `.env`.

## Environment Variables

| Variable | Type | Required | Default |
|:--:|:--:|:--:|:--:|
| CHECKER_NAMES | String | Yes | - |
| CHECKER_$checker-name-uppercase_URL | String | Yes | - |
| CHECKER_$checker-name-uppercase_CSS_SELECTOR | String | Yes | - |
| CHECKER_$checker-name-uppercase_COMPARE_MODE | String (`text` \| `html`) | No | text |
| CHECKER_$checker-name-uppercase_FETCH_MODE | String (`http` \| `browser`) | No | http |
| CHECKER_$checker-name-uppercase_WAIT_FOR_SELECTOR | String (browser only) | No | the CSS_SELECTOR |
| CHECKER_$checker-name-uppercase_WAIT_UNTIL | String (`load` \| `domcontentloaded` \| `networkidle0` \| `networkidle2`, browser only) | No | load |
| CHECKER_$checker-name-uppercase_EXTRA_WAIT_MS | Integer (browser only) | No | 0 |
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
| BROWSER_EXECUTABLE_PATH | String | If a checker uses `browser` | `PUPPETEER_EXECUTABLE_PATH` (`/usr/bin/chromium-browser` in Docker) |
| BROWSER_ARGS | String (space separated) | No | --disable-dev-shm-usage (`--no-sandbox --disable-dev-shm-usage --disable-gpu` in Docker) |
| BROWSER_TIMEOUT_MS | Integer | No | 30000 |
| BROWSER_USERAGENT | String | No | the browser's own, without "Headless" |
| BROWSER_BLOCK_RESOURCES | String (comma separated, or `none`) | No | image,media,font |


`CRON_PATTERN` uses standard crontab syntax with an optional leading seconds field: `[second] minute hour day-of-month month day-of-week`. Months are 1-12, days of week 0-7 (0 and 7 = Sunday), and `jan`-`dec` / `sun`-`sat` aliases are accepted. Each field supports `*`, lists (`1,15`), ranges (`1-5`) and steps (`*/5`, `10-30/5`). With 5 fields the check runs at second 0. If both day-of-month and day-of-week are restricted, either one matching is enough (as in crontab). Times are evaluated in `TZ`; around DST changes a time inside the skipped hour does not run and one inside the repeated hour runs twice.

`COMPARE_MODE` controls what is compared between checks:
- `text` (default): only the text content of the selected element. Changes to classes, attributes or tag structure are ignored.
- `html`: the full HTML of the selected element (`outerHTML`), so changes to classes, attributes and structure are detected too. Beware of attributes that change on every page load (tokens, random IDs, timestamps): they will trigger a notification on every check. Notifications still show the text content.

Switching mode on an existing checker triggers one notification on the next check, since the stored value changes format.

## Fetch modes

`FETCH_MODE` controls how the page is downloaded:
- `http` (default): a single HTTP GET with the `HEADER_*` headers, following up to `MAX_REDIRECTS` redirects. Only the HTML sent by the server is seen: content added later by JavaScript is missing.
- `browser`: the page is opened in a headless Chromium, JavaScript runs, and the rendered DOM is compared. Use it when the selected element is missing (or stale) in the HTTP response. It is much heavier: a few seconds and some hundred MB of RAM per check instead of milliseconds.

In both modes `CSS_SELECTOR` and `COMPARE_MODE` are applied in the same way to the resulting HTML (with `node-html-parser`), so switching an existing checker from `http` to `browser` notifies only if the rendered value really differs.

How a browser check works:
1. One Chromium process is launched on the first browser check and shared by all browser checkers (it is relaunched automatically if it crashes). Each check runs in a fresh incognito context, so no cookies or cache are shared between checks, and the context is closed afterwards.
2. The page is loaded until the `WAIT_UNTIL` event: `load` (default), `domcontentloaded`, `networkidle2` (at most 2 open connections for 500 ms) or `networkidle0` (no connections for 500 ms). Pages that poll continuously may never reach `networkidle0` and time out.
3. The browser waits for `WAIT_FOR_SELECTOR` (default: `CSS_SELECTOR`) to appear. If it does not appear within `BROWSER_TIMEOUT_MS`, the check fails with the usual "Selector not found" error.
4. It waits `EXTRA_WAIT_MS` more, for elements that appear first and are updated later (e.g. a price placeholder).
5. HTTP statuses >= 400 of the main document fail the check, as in `http` mode.

Notes:
- `BROWSER_TIMEOUT_MS` applies separately to the page load and to the selector wait.
- Images, media and fonts are not downloaded by default (`BROWSER_BLOCK_RESOURCES`), which makes checks faster. Add `stylesheet` to block CSS too, or set `none` if a site needs them.
- `HEADER_ACCEPT_LANGUAGE` is sent by the browser too. `HEADER_USERAGENT` is not, because a Safari user agent on Chromium is easy to detect as a bot: the browser uses its own (with "HeadlessChrome" replaced by "Chrome"), or `BROWSER_USERAGENT` if set.
- `MAX_REDIRECTS` is ignored: the browser follows redirects by itself.
- All requests, from both modes, go through the same queue (`BOTTLENECK_*`). If a check is still running when the next cron tick arrives, that tick is skipped for that checker.
- Content inside shadow DOM or iframes is not part of the serialized page and cannot be selected.
- Some sites detect and block headless browsers anyway: this mode does not try to evade bot detection.

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

The image includes Chromium (from the Alpine packages) and sets `BROWSER_EXECUTABLE_PATH` and `BROWSER_ARGS` for it. Since the container runs as root, Chromium runs with `--no-sandbox`. `tini` is the entry point, so `docker stop` shuts the bot and the browser down cleanly.

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

