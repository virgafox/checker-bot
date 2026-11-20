'use strict';

// Minimal replacement for the `debug` package: DEBUG=checker:* or a comma-separated
// list of namespaces (a trailing * matches any suffix).
function parsePatterns(value) {
  return (value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function isEnabled(namespace, patterns) {
  return patterns.some(pattern => {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return namespace.startsWith(pattern.slice(0, -1));
    return pattern === namespace;
  });
}

const patterns = parsePatterns(process.env.DEBUG);

function createDebug(namespace) {
  return (...args) => {
    if (isEnabled(namespace, patterns)) console.log(`[${namespace}]`, ...args);
  };
}

module.exports = { createDebug, isEnabled, parsePatterns };
