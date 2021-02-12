# Amazon Checker

| Variable | Type | Required | Default |
|:--:|:--:|:--:|:--:|
| TELEGRAM_BOT_TOKEN | String | Yes | - |
| TELEGRAM_CHAT_ID | String | Yes | - |
| AMAZON_PRODUCT_IDS | String | Yes | - |
| AMAZON_BASEURL | String | No | https://www.amazon.it |
| AMAZON_ACCEPT_LANGUAGE_HEADER | String | No | it-it |
| AMAZON_MAX_CONCURRENT_REQS | Integer | No | 1 |
| AMAZON_MIN_MS_BETWEEN_REQS | Integer | No | 333 |
| CHECK_CRON_PATTERN | String | No | */30 * * * * * |
| REDIS_HOST | String | No | 127.0.0.1 | 
| REDIS_PORT | Integer | No | 6379 | 
| REDIS_FAMILY | Integer | No | 4 | 
| REDIS_PASSWORD | String | No | - | 
| REDIS_DB | Integer | No | 0 | 
| PORT | Integer | No | 3000 | 
| TZ | String | No | Europe/Rome |