'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Follows up to maxRedirects redirects and rejects on HTTP status >= 400. Resolves with the body.
async function requestTextWithRedirects(urlString, maxRedirects, options = {}) {
  let nextUrl = urlString;
  let redirects = 0;
  while (true) {
    const { statusCode, headers, body } = await requestText(nextUrl, options);
    if (headers.location && [301, 302, 303, 307, 308].includes(statusCode) && redirects < maxRedirects) {
      nextUrl = new URL(headers.location, nextUrl).toString();
      redirects += 1;
      continue;
    }
    if (statusCode >= 400) {
      throw new Error(`Request failed with status ${statusCode} for ${nextUrl}`);
    }
    return body;
  }
}

module.exports = { requestText, requestTextWithRedirects };
