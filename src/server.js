'use strict';

const http = require('http');
const { publicConfiguration } = require('./checker');

// Strips secrets also from records written before they were filtered at save time.
function toPublicRecord(record) {
  if (!record.checkerConfiguration) return record;
  return { ...record, checkerConfiguration: publicConfiguration(record.checkerConfiguration) };
}

// GET / returns the stored state of the configured checkers (those checked at least once).
function createServer({ checkers, store }) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/') {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    try {
      const records = await Promise.all(checkers.map(checker => store.get(checker.name)));
      res.end(JSON.stringify(records.filter(Boolean).map(toPublicRecord)));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

module.exports = { createServer };
