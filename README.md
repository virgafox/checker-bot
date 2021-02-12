# Amazon Checker

| Variable | Type | Required | Default |
|:--:|:--:|:--:|:--:|
| NODE_ENV | String | No | production |
| TELEGRAM_BOT_TOKEN | String | Yes | - |
| TELEGRAM_CHAT_ID | String | Yes | - |
| AMAZON_PRODUCT_IDS | String | Yes | - |
| AMAZON_BASEURL | String | No | https://www.amazon.it |
| AMAZON_HEADER_ACCEPT | String | No | safari standard on mac |
| AMAZON_HEADER_USERAGENT | String | No | safari standard on mac |
| AMAZON_HEADER_ACCEPT_LANGUAGE | String | No | it-it |
| AMAZON_HEADER_ACCEPT_ENCODING | String | No | gzip, deflate, br |
| AMAZON_MAX_CONCURRENT_REQS | Integer | No | 1 |
| AMAZON_MIN_MS_BETWEEN_REQS | Integer | No | 333 |
| CHECK_CRON_ENABLED | Boolean | No | true |
| CHECK_CRON_PATTERN | String | No | */30 * * * * * |
| REDIS_HOST | String | No | 127.0.0.1 | 
| REDIS_PORT | Integer | No | 6379 | 
| REDIS_FAMILY | Integer | No | 4 | 
| REDIS_PASSWORD | String | No | - | 
| REDIS_DB | Integer | No | 0 | 
| PORT | Integer | No | 3000 | 
| TZ | String | No | Europe/Rome |