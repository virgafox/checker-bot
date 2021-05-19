# Checker Bot

This application periodically checks a portion of a web page for changes, and notifies the changes by Telegram.

## Environment Variables

| Variable | Type | Required | Default |
|:--:|:--:|:--:|:--:|
| TELEGRAM_BOT_TOKEN_DEFAULT | String | Yes | - |
| TELEGRAM_CHAT_ID_DEFAULT | String | Yes | - |
| CHECKER_NAMES | String | Yes | - |
| CHECKER_$checker-name-uppercase_URL | String | Yes | - |
| CHECKER_$checker-name-uppercase_CSS_SELECTOR | String | Yes | - |
| CHECKER_$checker-name-uppercase_MAX_REDIRECTS | String | No | 5 |
| CHECKER_$checker-name-uppercase_TELEGRAM_BOT_TOKEN | String | No | TELEGRAM_BOT_TOKEN_DEFAULT |
| CHECKER_$checker-name-uppercase_TELEGRAM_CHAT_ID | String | No | TELEGRAM_CHAT_ID_DEFAULT |
| CHECKER_$checker-name-uppercase_CRON_PATTERN | String | No | */20 * * * * * |
| CHECKER_$checker-name-uppercase_CRON_ENABLED | Boolean | No | true |
| PORT | Integer | No | 3000 | 
| NODE_ENV | String | No | production |
| TZ | String | No | Europe/Rome |
| DEBUG | String | No | - |
| REDIS_HOST | String | No | 127.0.0.1 | 
| REDIS_PORT | Integer | No | 6379 | 
| REDIS_FAMILY | Integer | No | 4 | 
| REDIS_PASSWORD | String | No | - | 
| REDIS_DB | Integer | No | 0 | 
| HEADER_ACCEPT | String | No | safari standard on mac |
| HEADER_USERAGENT | String | No | safari standard on mac |
| HEADER_ACCEPT_LANGUAGE | String | No | it-it |
| HEADER_ACCEPT_ENCODING | String | No | gzip, deflate, br |