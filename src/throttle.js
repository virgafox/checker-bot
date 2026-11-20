'use strict';

// Minimal replacement for `bottleneck`: runs at most `maxConcurrent` tasks at a time,
// starting them at least `minMsBetween` ms apart. Returns schedule(task) => Promise.
function createRequestQueue({ maxConcurrent, minMsBetween }) {
  let activeRequests = 0;
  let lastRequestAt = 0;
  let timerScheduled = false;
  const queue = [];

  function processQueue() {
    if (timerScheduled) return;
    if (activeRequests >= maxConcurrent || queue.length === 0) return;
    const delayMs = Math.max(0, minMsBetween - (Date.now() - lastRequestAt));
    timerScheduled = true;
    setTimeout(() => {
      timerScheduled = false;
      if (activeRequests >= maxConcurrent || queue.length === 0) {
        processQueue();
        return;
      }
      const item = queue.shift();
      activeRequests += 1;
      lastRequestAt = Date.now();
      Promise.resolve()
        .then(() => item.task())
        .then(item.resolve, item.reject)
        .finally(() => {
          activeRequests -= 1;
          processQueue();
        });
      // Try to start the next task too: concurrency is limited by maxConcurrent, not by this one finishing.
      processQueue();
    }, delayMs);
  }

  return function schedule(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      processQueue();
    });
  };
}

module.exports = { createRequestQueue };
